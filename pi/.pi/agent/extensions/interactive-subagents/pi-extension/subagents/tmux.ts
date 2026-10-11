/**
 * tmux surface layer — the only terminal multiplexer this extension supports.
 *
 * Everything the extension does to a pane goes through the small API in this
 * file: create/split a pane, type a command into it, read its screen, close
 * it, and poll for exit. Keeping the tmux calls isolated here means index.ts
 * stays testable without a multiplexer running.
 *
 * Panes are identified by tmux pane ids (e.g. `%12`). Splits always target
 * the parent pi's pane (`$TMUX_PANE`) so they follow the agent rather than
 * the user's focus.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// Explicit stdio on every captured execFileSync below is load-bearing: with
// the default (unspecified) stdio, Node passes the child's stderr through to
// this process's terminal while also capturing it — the #291 splatter class
// (a failing tmux call painted raw error lines over the agent's TUI).
// stdio: ["pipe", "pipe", "pipe"] keeps the CLI's stderr fully captured
// (real failures still surface through the thrown error) and off the
// terminal. Best-effort close sites swallow the error as before.

// ── Availability ──

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

/**
 * True when running inside tmux with the tmux binary on PATH.
 * `TMUX` is set by tmux in every process it spawns (shell or pane).
 */
export function isTmuxAvailable(): boolean {
  return !!process.env.TMUX && hasCommand("tmux");
}

export function isMuxAvailable(): boolean {
  return isTmuxAvailable();
}

export function muxSetupHint(): string {
  return "Start pi inside tmux (`tmux new -A -s pi 'pi'`).";
}

function requireTmux(): void {
  if (!isTmuxAvailable()) {
    throw new Error(`tmux is required for subagents. ${muxSetupHint()}`);
  }
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Pane layout ──

/**
 * tmux layout applied to the subagent window to keep panes evenly sized.
 * Switchable: "even-horizontal" (equal columns, matches Ctrl+b Alt+1),
 * "main-vertical" (big main pane + tiled column), "tiled" (grid).
 */
const SUBAGENT_TMUX_LAYOUT = "even-horizontal";

let rebalanceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-balance subagent panes so repeated splits don't leave them lopsided.
 * tmux halves the target pane on every split and dumps freed space onto a
 * neighbor on close, so without this panes drift to wildly uneven widths.
 * Applies SUBAGENT_TMUX_LAYOUT to the parent pi window. Debounced so a burst
 * of parallel spawns or staggered exits collapses into a single layout call,
 * and non-fatal: a cosmetic resize must never break spawning or watching.
 */
function rebalanceSurfaces(hintPane?: string): void {
  // Prefer the parent pi pane (stable; survives a closing subagent pane).
  const target = process.env.TMUX_PANE ?? hintPane;
  if (!target) return;
  if (rebalanceTimer) clearTimeout(rebalanceTimer);
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    try {
      // -t <pane> resolves to that pane's window; does not change focus.
      execFileSync("tmux", ["select-layout", "-t", target, SUBAGENT_TMUX_LAYOUT], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Pane/window may be gone; balancing is best-effort.
    }
  }, 120);
}

// ── Surface primitives ──

/**
 * Create a new pane for a subagent: a right split off the parent pi's pane,
 * so new panes follow the agent rather than the user's focus.
 * See https://github.com/HazAT/pi-interactive-subagents/issues/12
 *
 * Returns the new pane id (e.g. `%12`).
 */
export function createSurface(name: string): string {
  void name; // tmux panes are not named; the pi process inside shows its own title.
  return createSurfaceSplit(name, "right", process.env.TMUX_PANE);
}

/**
 * Create a new split in the given direction from an optional source pane.
 * Returns the new pane id (e.g. `%12`).
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name;
  requireTmux();

  const args = ["split-window", "-d"];
  if (direction === "left" || direction === "right") {
    args.push("-h");
  } else {
    args.push("-v");
  }
  if (direction === "left" || direction === "up") {
    args.push("-b");
  }
  if (fromSurface) {
    args.push("-t", fromSurface);
  }
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${pane}`);
  }

  rebalanceSurfaces(pane);
  return pane;
}

/**
 * Send a command string to a pane and execute it.
 * Typed literally (`-l`) so special characters are not interpreted as keys,
 * then submitted with Enter.
 */
export function sendCommand(surface: string, command: string): void {
  requireTmux();
  execFileSync("tmux", ["send-keys", "-t", surface, "-l", command], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Send a long command to a pane by writing it to a script file first.
 * This avoids terminal line-wrapping issues that break commands exceeding the
 * pane's column width when sent character-by-character via sendCommand.
 *
 * By default the script is written to a temp directory, but callers can pass a
 * stable path (for example under session artifacts) so the exact invocation is
 * preserved for debugging.
 *
 * Returns the script path.
 */
export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) {
    scriptParts.push(options.scriptPreamble.trimEnd());
  }
  scriptParts.push(command);

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", {
    mode: 0o755,
  });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/**
 * Read the screen contents of a pane (sync).
 */
export function readScreen(surface: string, lines = 50): string {
  requireTmux();
  return execFileSync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireTmux();
  const { stdout } = await execFileAsync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
  return stdout;
}

/**
 * Close a pane.
 */
export function closeSurface(surface: string): void {
  requireTmux();
  execFileSync("tmux", ["kill-pane", "-t", surface], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  rebalanceSurfaces();
}

/**
 * Close the whole window holding a pane, so sibling panes close with it
 * (the tmux analogue of the Herdr tab close). Best-effort: falls back to
 * killing just the pane.
 */
export function closeTabForPane(paneId: string): void {
  try {
    const windowId = execFileSync(
      "tmux",
      ["list-panes", "-t", paneId, "-F", "#{window_id}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (windowId) {
      execFileSync("tmux", ["kill-window", "-t", windowId], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return;
    }
  } catch {}
  try {
    execFileSync("tmux", ["kill-pane", "-t", paneId], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {}
}

// ── Exit polling ──

/** TESTABILITY knobs (the same pattern as bridge.ts's NM_BRIDGE_POLL_MS):
 *  PI_SUBAGENT_POLL_MS (poll cadence), PI_SUBAGENT_MAX_WAIT_MS (hard
 *  deadline), PI_SUBAGENT_STARTUP_GRACE_MS (no-sighting grace), and
 *  PI_SUBAGENT_PROCINFO_FAIL_LIMIT (consecutive read failures before a
 *  pane-existence probe) override a wait bound so tests run in milliseconds.
 *  They change no default behavior. Identical contract in ./herdr.ts. */
export const DEFAULT_SUBAGENT_POLL_MS = 1000;
export const DEFAULT_SUBAGENT_MAX_WAIT_MS = 30 * 60_000;
export const DEFAULT_SUBAGENT_STARTUP_GRACE_MS = 60_000;
export const DEFAULT_SUBAGENT_PROCINFO_FAIL_LIMIT = 3;

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface PollResult {
  /** How the subagent exited */
  reason:
    | "done"
    | "sentinel"
    | "error"
    | "killed"
    | "agent-gone"
    | "no-agent"
    | "timeout";
  /** Shell exit code. 0 for file-based exits; 130 when the pane was killed.
   *  null for timeout/no-agent unless the deadline harvest reveals one. */
  exitCode: number | null;
  /** Error message if reason is "error" (auto-retry exhausted, provider overload, etc.) */
  errorMessage?: string;
}

/** Resolved wait bounds shared by pollForExit and the index.ts watcher. */
export interface SubagentPollBounds {
  pollMs: number;
  maxWaitMs: number;
  startupGraceMs: number;
  processInfoFailLimit: number;
}

export function getSubagentPollBounds(
  overrides?: Partial<SubagentPollBounds>,
): SubagentPollBounds {
  return {
    pollMs: overrides?.pollMs ?? envMs("PI_SUBAGENT_POLL_MS", DEFAULT_SUBAGENT_POLL_MS),
    maxWaitMs:
      overrides?.maxWaitMs ?? envMs("PI_SUBAGENT_MAX_WAIT_MS", DEFAULT_SUBAGENT_MAX_WAIT_MS),
    startupGraceMs:
      overrides?.startupGraceMs ??
      envMs("PI_SUBAGENT_STARTUP_GRACE_MS", DEFAULT_SUBAGENT_STARTUP_GRACE_MS),
    processInfoFailLimit:
      overrides?.processInfoFailLimit ??
      envMs("PI_SUBAGENT_PROCINFO_FAIL_LIMIT", DEFAULT_SUBAGENT_PROCINFO_FAIL_LIMIT),
  };
}

/**
 * Interpret an `.exit` sidecar payload (written by the error path in
 * subagent-done.ts). Centralized so both the fast and slow paths in
 * pollForExit decode the payload the same way. Clean completions write no
 * sidecar and are detected via the terminal sentinel instead.
 *
 * Note: ask_question does NOT write a `.exit` sidecar — it keeps the session
 * open and signals the parent via a separate `.ask` file (see deliverPendingQuestion).
 */
function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

function readExitSidecar(sessionFile?: string): PollResult | null {
  if (!sessionFile) return null;
  try {
    const exitFile = `${sessionFile}.exit`;
    if (!existsSync(exitFile)) return null;
    const data = JSON.parse(readFileSync(exitFile, "utf-8"));
    rmSync(exitFile, { force: true });
    return interpretExitSidecar(data);
  } catch {
    return null;
  }
}

function paneKilledResult(): PollResult {
  return { reason: "killed", exitCode: 130 };
}

/** Clean completion reported by the liveness fallback: the sentinel was
 *  never detected, but the pane's pi agent process is gone. */
function agentGoneResult(): PollResult {
  return { reason: "agent-gone", exitCode: 0 };
}

/** Startup death: pi was never seen in the pane's foreground processes and
 *  no sentinel/sidecar appeared within the startup grace window — the failed
 *  delegation launch (bare shell) failure class. */
function noAgentResult(): PollResult {
  return { reason: "no-agent", exitCode: null };
}

/** Hard deadline expired while the subagent was still pending (the wedged
 *  agent failure class). exitCode stays null unless the deadline harvest
 *  (final sidecar/sentinel check) reveals one. */
function timeoutResult(): PollResult {
  return { reason: "timeout", exitCode: null };
}

// ── Liveness fallback ──

/** True when a foreground-process entry is the subagent pane's pi agent.
 *  Same matcher as ./herdr.ts (name or argv[0] basename). */
export function isPiForegroundProcess(proc: { name?: string; argv?: string[] }): boolean {
  const argv0 = proc?.argv?.[0];
  const base = typeof argv0 === "string" ? argv0.replace(/^.*[\/\\]/, "") : "";
  return proc?.name === "pi" || base === "pi";
}

/** One liveness-fallback state step — identical semantics to ./herdr.ts:
 *  `processes === null` (transient read failure) keeps the current state
 *  and never reports gone; seeing the pi agent marks seenAgent; once seen,
 *  its absence means the agent loop ended (agentGone). It never fires
 *  before the agent was seen once, so a slow-starting pane cannot
 *  false-positive. */
export function updateAgentLiveness(
  seenAgent: boolean,
  processes: Array<{ name?: string; argv?: string[] }> | null,
): { seenAgent: boolean; agentGone: boolean } {
  if (processes === null) return { seenAgent, agentGone: false };
  if (processes.some((proc) => isPiForegroundProcess(proc))) {
    return { seenAgent: true, agentGone: false };
  }
  return { seenAgent, agentGone: seenAgent };
}

/** The pane's foreground process tree, or null when the read fails — the
 *  tmux analogue of herdr's `pane process-info`. tmux exposes the pane's
 *  shell pid (`display-message #{pane_pid}`); `ps` then enumerates the
 *  pane's whole process tree (the shell, the launch script, the pi agent,
 *  and any tool children it spawned — the pgid-member analogue of herdr's
 *  foreground_processes, so a child listed alongside pi never counts as
 *  gone). A missing pane also answers null here — the screen read in the
 *  same poll tick is what turns that into the killed result. */
async function paneForegroundProcessesAsync(
  paneId: string,
  signal?: AbortSignal,
): Promise<Array<{ name?: string; argv?: string[] }> | null> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", paneId, "#{pane_pid}"],
      { encoding: "utf8", signal },
    );
    const panePid = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(panePid) || panePid <= 0) return null;
    const { stdout: psOut } = await execFileAsync(
      "ps",
      ["-eo", "pid=,ppid=,args="],
      { encoding: "utf8", signal },
    );
    interface PsProc {
      pid: number;
      ppid: number;
      argv: string[];
    }
    const procs: PsProc[] = [];
    for (const line of psOut.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const pid = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(pid)) continue;
      const afterPid = trimmed.slice(String(pid).length).trimStart();
      const ppid = Number.parseInt(afterPid, 10);
      if (!Number.isFinite(ppid)) continue;
      const args = afterPid.slice(String(ppid).length).trim();
      if (!args) continue;
      procs.push({ pid, ppid, argv: args.split(/\s+/) });
    }
    const byParent = new Map<number, PsProc[]>();
    for (const proc of procs) {
      const siblings = byParent.get(proc.ppid);
      if (siblings) siblings.push(proc);
      else byParent.set(proc.ppid, [proc]);
    }
    const foreground: Array<{ name?: string; argv?: string[] }> = [];
    const queue: PsProc[] = procs.filter((proc) => proc.pid === panePid);
    while (queue.length > 0) {
      const proc = queue.shift()!;
      foreground.push({ name: proc.argv[0]?.replace(/^.*[\/\\]/, ""), argv: proc.argv });
      queue.push(...(byParent.get(proc.pid) ?? []));
    }
    return foreground.length > 0 ? foreground : null;
  } catch {
    return null;
  }
}

/** Does the pane still exist? Probed after repeated foreground read
 *  failures to tell a transient read problem from a destroyed pane. */
async function paneExistsAsync(paneId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", paneId, "#{pane_id}"],
      { encoding: "utf8", signal },
    );
    return true;
  } catch {
    return false;
  }
}

export const __pollForExitTest__ = {
  interpretExitSidecar,
  paneKilledResult,
  agentGoneResult,
  noAgentResult,
  timeoutResult,
  updateAgentLiveness,
  isPiForegroundProcess,
};

/**
 * Poll until the subagent exits — but never forever. Identical logic to
 * ./herdr.ts (sidecar → sentinel file → screen sentinel → liveness
 * fallback) plus three hard bounds:
 *
 *   1. HARD DEADLINE (`maxWaitMs`, env PI_SUBAGENT_MAX_WAIT_MS, default
 *      30 min): on expiry, one final harvest attempt (sidecar + sentinel)
 *      and a `timeout` result. The wedged-agent failure class.
 *   2. NO-SIGHTING GRACE (`startupGraceMs`, env
 *      PI_SUBAGENT_STARTUP_GRACE_MS, default 60 s): pi was never seen in
 *      the pane's foreground processes and no sentinel appeared → the
 *      launch itself died → `no-agent`. The bare-shell failure class.
 *   3. READ-FAILURE THRESHOLD (`processInfoFailLimit`, default 3): that
 *      many consecutive foreground-read failures trigger a pane-existence
 *      probe — gone → `killed`, alive → keep waiting (failures still
 *      count toward the deadline).
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    /** Poll cadence. Defaults to the PI_SUBAGENT_POLL_MS knob (1000 ms). */
    interval?: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
    maxWaitMs?: number;
    startupGraceMs?: number;
    processInfoFailLimit?: number;
  },
): Promise<PollResult> {
  const start = Date.now();
  const bounds = getSubagentPollBounds({
    pollMs: options.interval,
    maxWaitMs: options.maxWaitMs,
    startupGraceMs: options.startupGraceMs,
    processInfoFailLimit: options.processInfoFailLimit,
  });
  const deadline = start + bounds.maxWaitMs;
  let seenAgentProcess = false;
  let consecutiveReadFails = 0;

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
    }

    // Hard deadline: one final harvest attempt (a sidecar or a screen
    // sentinel that landed at the wire still produces its real result;
    // a dead pane reads as killed), then a timeout — never an infinite wait.
    if (Date.now() >= deadline) {
      const sidecar = readExitSidecar(options.sessionFile);
      if (sidecar) return sidecar;
      if (options.sentinelFile) {
        try {
          if (existsSync(options.sentinelFile)) return { reason: "sentinel", exitCode: 0 };
        } catch {}
      }
      try {
        const screen = await readScreenAsync(surface, 5);
        const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
        if (match) return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      } catch {
        return paneKilledResult();
      }
      return timeoutResult();
    }

    // Fast path: check for .exit sidecar file (written by the error path)
    const sidecar = readExitSidecar(options.sessionFile);
    if (sidecar) return sidecar;

    // Check Claude sentinel file (written by plugin Stop hook)
    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    // Slow path: read terminal screen for sentinel (crash detection)
    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch {
      // Surface was destroyed (manual pane close/kill) unless a late .exit file explains it.
      return readExitSidecar(options.sessionFile) ?? paneKilledResult();
    }

    // Liveness fallback — see ./herdr.ts for the full rationale.
    const processes = await paneForegroundProcessesAsync(surface, signal);
    if (processes === null) {
      // Read failure (transient, or a pane that no longer answers). After
      // the threshold, probe pane existence: gone → the killed path;
      // alive → keep waiting, the deadline still bounds it.
      consecutiveReadFails++;
      if (consecutiveReadFails >= bounds.processInfoFailLimit) {
        if (!(await paneExistsAsync(surface, signal))) {
          return readExitSidecar(options.sessionFile) ?? paneKilledResult();
        }
      }
    } else {
      consecutiveReadFails = 0;
      const liveness = updateAgentLiveness(seenAgentProcess, processes);
      seenAgentProcess = liveness.seenAgent;
      if (liveness.agentGone) {
        return agentGoneResult();
      }
      // No-sighting grace: a successful foreground read that never listed
      // pi, with no sentinel and no sidecar, past the grace window means
      // the launch itself died (bare shell). Bounded, never infinite.
      if (
        !seenAgentProcess &&
        Date.now() - start >= bounds.startupGraceMs
      ) {
        return noAgentResult();
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, bounds.pollMs);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
