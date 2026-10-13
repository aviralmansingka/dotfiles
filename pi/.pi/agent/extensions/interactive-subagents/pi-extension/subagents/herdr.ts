/**
 * Herdr surface layer — tab and pane control via the `herdr` CLI socket API.
 *
 * Mirrors the export contract of ./tmux.ts so index.ts can target either
 * multiplexer through ./surface.ts. Each launched subagent gets a labeled,
 * unfocused Herdr tab; the rest of the extension addresses that tab through
 * its root pane id (e.g. `w44:p2`).
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// Explicit stdio on every captured execFileSync below is load-bearing: with
// the default (unspecified) stdio, Node passes the child's stderr through to
// this process's terminal while also capturing it — the #291 splatter class
// (a failing herdr call painted raw error lines over the agent's TUI).
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
 * True when running inside Herdr with the `herdr` binary on PATH.
 * Herdr sets `HERDR_ENV=1` and `HERDR_PANE_ID` on every process it manages
 * (the parent pi's pane id lives in `HERDR_PANE_ID`, the tmux analogue of
 * `TMUX_PANE`).
 */
export function isHerdrAvailable(): boolean {
  return process.env.HERDR_ENV === "1" && !!process.env.HERDR_PANE_ID && hasCommand("herdr");
}

/** Surface-agnostic gate (matches the ./tmux.ts `isMuxAvailable` contract). */
export function isMuxAvailable(): boolean {
  return isHerdrAvailable();
}

export function muxSetupHint(): string {
  return "Start pi inside Herdr (`herdr` — panes are managed by the Herdr server).";
}

function requireHerdr(): void {
  if (!isHerdrAvailable()) {
    throw new Error(`Herdr is required for subagents. ${muxSetupHint()}`);
  }
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Herdr CLI helpers ──

/** Parse the root pane id returned by tab creation or pane splitting. */
function parsePaneId(stdout: string): string {
  const data = JSON.parse(stdout);
  const paneId = data?.result?.root_pane?.pane_id ?? data?.result?.pane?.pane_id;
  if (typeof paneId !== "string" || paneId.length === 0) {
    throw new Error(`Unexpected Herdr surface creation output: ${stdout}`);
  }
  return paneId;
}

function workspaceForPane(paneId: string): string {
  const stdout = execFileSync("herdr", ["pane", "get", paneId], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const workspaceId = JSON.parse(stdout)?.result?.pane?.workspace_id;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new Error(`Unexpected Herdr pane output: ${stdout}`);
  }
  return workspaceId;
}

/** Map a pane to the tab that holds it (`herdr pane get` reports tab_id).
 *  Returns null when the pane cannot be resolved. */
export function tabForPane(paneId: string): string | null {
  try {
    const stdout = execFileSync("herdr", ["pane", "get", paneId], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const tabId = JSON.parse(stdout)?.result?.pane?.tab_id;
    return typeof tabId === "string" && tabId.length > 0 ? tabId : null;
  } catch {
    return null;
  }
}

// ── Pane layout ──

/**
 * Herdr has no named-layout rebalance command, so this is a no-op. Panes keep
 * the ratio set at split time. Kept as a hook so index.ts / future Herdr
 * layout support can plug in without changing call sites.
 */
function rebalanceSurfaces(_hintPane?: string): void {
  // no-op: Herdr pane layout is not `select-layout`-style rebalanceable today.
}

// ── Surface primitives ──

/** Best-effort tab id extraction from a `tab create` response that carried
 *  no root pane id. Used only by createSurface's missing-pane-id recovery:
 *  the response's own tab key is the only close target that exists. */
function tabIdFromCreateOutput(stdout: string): string | undefined {
  try {
    const data = JSON.parse(stdout);
    const tab = data?.result?.tab ?? data?.result;
    const tabId = tab?.tab_id ?? tab?.id ?? data?.result?.tab_id;
    return typeof tabId === "string" && tabId.length > 0 ? tabId : undefined;
  } catch {
    return undefined;
  }
}

/** Create a labeled, unfocused tab and return its root pane id. */
export function createSurface(name: string): string {
  requireHerdr();
  const workspaceId = workspaceForPane(process.env.HERDR_PANE_ID!);
  const stdout = execFileSync(
    "herdr",
    [
      "tab", "create",
      "--workspace", workspaceId,
      "--cwd", process.cwd(),
      "--label", `subagent: ${name}`,
      "--no-focus",
    ],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  // C31: a `tab create` answer without a pane id leaves no close target for
  // the caller (withNewSurface closes by pane id). Recover by closing the tab
  // the response DOES name — best-effort, then surface the original parse
  // failure — so a pane-less tab-create answer never leaks an empty tab.
  try {
    return parsePaneId(stdout);
  } catch (error) {
    const tabId = tabIdFromCreateOutput(stdout);
    if (tabId) {
      try {
        execFileSync("herdr", ["tab", "close", tabId], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Best-effort: the tab may already be gone. The parse error below
        // still reports the malformed response.
      }
    }
    throw error;
  }
}

/**
 * Create a new split in the given direction from an optional source pane.
 * Returns the new pane id (e.g. `w44:p3`).
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name;
  requireHerdr();

  // Herdr only exposes `right` and `down` split directions. Map the tmux-style
  // four-way directions onto the two Herdr supports, choosing the closest
  // non-overlapping direction for `left`/`up` (split the parent anyway).
  const herdrDirection: "right" | "down" =
    direction === "up" || direction === "down" ? "down" : "right";

  const args = ["pane", "split"];
  if (fromSurface) {
    args.push(fromSurface);
  }
  args.push("--direction", herdrDirection, "--ratio", "0.5", "--no-focus");

  const stdout = execFileSync("herdr", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pane = parsePaneId(stdout);
  rebalanceSurfaces(pane);
  return pane;
}

/**
 * Send a command string to a pane and execute it atomically.
 * `pane run` honors live bracketed-paste mode and submits text plus Enter.
 */
export function sendCommand(surface: string, command: string): void {
  requireHerdr();
  execFileSync("herdr", ["pane", "run", surface, command], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Wait until Herdr sees the launched agent at its interactive prompt. */
export async function waitForAgentReady(
  surface: string,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<void> {
  requireHerdr();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const { stdout } = await execFileAsync("herdr", ["agent", "get", surface], {
        encoding: "utf8",
        signal,
      });
      const status = JSON.parse(stdout)?.result?.agent?.agent_status;
      if (status === "idle") return;
      if (status === "blocked") {
        throw new Error(`Subagent in ${surface} was blocked during startup`);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.message.includes("blocked during startup")) throw error;
    }

    const screen = await readScreenAsync(surface, 5, signal);
    const exited = screen.match(/__SUBAGENT_DONE_(\d+)__/);
    if (exited) {
      throw new Error(
        `Subagent in ${surface} exited with code ${exited[1]} before becoming ready`,
      );
    }

    await sleep(100, undefined, { signal });
  }

  throw new Error(`Timed out waiting for subagent in ${surface} to become ready`);
}

/** Submit a prompt only after waitForAgentReady has observed interactive readiness. */
export function sendAgentPrompt(surface: string, prompt: string): void {
  requireHerdr();
  execFileSync("herdr", ["agent", "prompt", surface, prompt], {
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
 * `herdr pane read --source recent` is the tmux `capture-pane -p` analogue.
 */
export function readScreen(surface: string, lines = 50): string {
  requireHerdr();
  return execFileSync(
    "herdr",
    ["pane", "read", surface, "--source", "recent", "--lines", String(Math.max(1, lines)), "--format", "text"],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(
  surface: string,
  lines = 50,
  signal?: AbortSignal,
): Promise<string> {
  requireHerdr();
  const { stdout } = await execFileAsync(
    "herdr",
    ["pane", "read", surface, "--source", "recent", "--lines", String(Math.max(1, lines)), "--format", "text"],
    { encoding: "utf8", signal },
  );
  return stdout;
}

/**
 * Close a pane.
 */
export function closeSurface(surface: string): void {
  requireHerdr();
  execFileSync("herdr", ["pane", "close", surface], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  rebalanceSurfaces();
}

/**
 * Close the whole tab holding a pane, so sibling panes (e.g. editor splits
 * a subagent opened) close with it instead of holding the tab open forever
 * after the subagent finished. Best-effort: falls back to closing just the
 * pane when the tab cannot be resolved or `tab close` fails, preserving
 * the historical cleanup behavior.
 */
export function closeTabForPane(paneId: string): void {
  requireHerdr();
  const tabId = tabForPane(paneId);
  if (tabId) {
    try {
      execFileSync("herdr", ["tab", "close", tabId], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return;
    } catch {}
  }
  try {
    execFileSync("herdr", ["pane", "close", paneId], {
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
 *  They change no default behavior. Identical contract in ./tmux.ts. */
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
 * open and signals the parent via a separate `.ask` file.
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

/** Does the pane still exist? Probed after repeated process-info read
 *  failures to tell a transient read problem from a destroyed pane. */
async function paneExistsAsync(paneId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileAsync("herdr", ["pane", "get", paneId], { encoding: "utf8", signal });
    return true;
  } catch {
    return false;
  }
}

// ── Liveness fallback ──

/** Result of probing a subagent pane for adoption: does the pane still
 *  exist, and is the pi agent still its foreground process? */
export interface PaneAgentProbe {
  /** False when the pane (or its whole tab) no longer resolves — the run
   *  is over and only the transcript can supply a result. */
  paneExists: boolean;
  /** True when the pane's foreground processes include the pi agent.
   *  Null when the process read fails — callers treat null as alive
   *  (adopt) so a transient read can never finalize a live run. */
  agentAlive: boolean | null;
}

/** One-shot pane probe for adoption decisions (see index.ts). Uses the
 *  same reads as pollForExit's liveness fallback. */
export async function probePaneAgent(
  paneId: string,
  signal?: AbortSignal,
): Promise<PaneAgentProbe> {
  if (!(await paneExistsAsync(paneId, signal))) {
    return { paneExists: false, agentAlive: null };
  }
  const processes = await paneForegroundProcessesAsync(paneId, signal);
  if (processes === null) return { paneExists: true, agentAlive: null };
  return { paneExists: true, agentAlive: processes.some(isPiForegroundProcess) };
}

/** True when a foreground-process entry is the subagent pane's pi agent.
 *  herdr reports argv[0] as a bare name; also basename-match a full path. */
export function isPiForegroundProcess(proc: { name?: string; argv?: string[] }): boolean {
  const argv0 = proc?.argv?.[0];
  const base = typeof argv0 === "string" ? argv0.replace(/^.*[\/\\]/, "") : "";
  return proc?.name === "pi" || base === "pi";
}

/**
 * One liveness-fallback state step. `processes === null` (transient read
 * failure) keeps the current state and never reports gone. Otherwise:
 * seeing the pi agent marks seenAgent; once seen, its absence means the
 * agent loop ended (agentGone). It never fires before the agent was seen
 * once, so a slow-starting pane cannot false-positive — and a crashed
 * startup is caught by the sentinel echo or the .exit sidecar instead.
 */
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

/** The pane's foreground processes, or null when the read fails. A missing
 *  pane also answers null here — the screen read in the same poll tick is
 *  what turns that into the killed result. */
async function paneForegroundProcessesAsync(
  paneId: string,
  signal?: AbortSignal,
): Promise<Array<{ name?: string; argv?: string[] }> | null> {
  try {
    const { stdout } = await execFileAsync(
      "herdr",
      ["pane", "process-info", "--pane", paneId],
      { encoding: "utf8", signal },
    );
    const info = JSON.parse(stdout)?.result?.process_info;
    return Array.isArray(info?.foreground_processes) ? info.foreground_processes : null;
  } catch {
    return null;
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
 * Poll until the subagent exits — but never forever. Checks for a `.exit`
 * sidecar file first (written by the error path), falling back to the
 * terminal sentinel for clean-completion and crash detection, plus a
 * liveness fallback and three hard bounds:
 *
 *   1. HARD DEADLINE (`maxWaitMs`, env PI_SUBAGENT_MAX_WAIT_MS, default
 *      30 min): on expiry, one final harvest attempt (sidecar + sentinel)
 *      and a `timeout` result. The wedged-agent failure class.
 *   2. NO-SIGHTING GRACE (`startupGraceMs`, env
 *      PI_SUBAGENT_STARTUP_GRACE_MS, default 60 s): pi was never seen in
 *      the pane's foreground processes and no sentinel appeared → the
 *      launch itself died → `no-agent`. The bare-shell failure class.
 *   3. READ-FAILURE THRESHOLD (`processInfoFailLimit`, default 3): that
 *      many consecutive process-info failures trigger a pane-existence
 *      probe — gone → `killed`, alive → keep waiting (failures still
 *      count toward the deadline).
 *
 * Identical logic to ./tmux.ts; only the underlying pane reads differ.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    /** Poll cadence. Defaults to the PI_SUBAGENT_POLL_MS knob (1000 ms). */
    interval?: number;
    sessionFile?: string;
    /** Spawn-time transcript size baseline: only growth beyond it counts
     *  as agent output (seeded scaffolding is not life). Defaults to 0. */
    transcriptBaseline?: number;
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

  // ── Single invariant: the session transcript is the agent's truth ──
  // Pane and process signals only accelerate a verdict; they never
  // classify death on their own. Only output the AGENT appended — growth
  // beyond the spawn-time baseline — counts as life: seeded session
  // scaffolding does not (seed with no growth past the grace window is a
  // genuine launch death). A still-growing transcript proves a live run
  // even headless after pane churn; a frozen one plus a lost surface
  // closes as a clean completion so the session-file harvest delivers
  // the result.
  const transcriptBaseline = Math.max(0, options.transcriptBaseline ?? 0);
  let transcriptSize = -1;
  let transcriptMtimeMs = -1;
  let lastAgentWriteAt = 0;
  let agentWrote = false;
  const readTranscriptState = () => {
    if (!options.sessionFile) return;
    try {
      const st = statSync(options.sessionFile);
      if (st.size !== transcriptSize || st.mtimeMs !== transcriptMtimeMs) {
        if (st.size > transcriptBaseline) {
          agentWrote = true;
          lastAgentWriteAt = Date.now();
        }
        transcriptSize = st.size;
        transcriptMtimeMs = st.mtimeMs;
      }
    } catch {}
  };

  /** How long a vanished pi or lost surface must go without transcript
   *  growth before closing — covers brief mid-tool silence. */
  const confirmGoneMs = Math.max(bounds.pollMs, 400);

  /** Verdict for a lost/unreadable surface. null = keep waiting — the
   *  transcript is still growing, so the agent plausibly runs headless. */
  const classifySurfaceLoss = (): PollResult | null => {
    if (!agentWrote) return paneKilledResult();
    if (Date.now() - lastAgentWriteAt < confirmGoneMs) return null;
    return agentGoneResult();
  };

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
    }

    // Durable liveness first: the transcript, not the pane.
    readTranscriptState();

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
      // Surface was destroyed (manual pane close/kill) unless a late .exit
      // file explains it. Under pane churn a live headless session also
      // lands here — the transcript decides, not the lost surface.
      const verdict = classifySurfaceLoss();
      if (verdict) return readExitSidecar(options.sessionFile) ?? verdict;
    }

    // Liveness fallback: the sentinel echo can go undetected on the
    // visible screen (e.g. the agent left a full-screen app running above
    // it). Once the pane's foreground processes have included the pi
    // agent, its disappearance — with no sentinel and no .exit sidecar —
    // means the agent loop ended. Report a clean completion so the normal
    // session-file harvest, not the screen, produces the summary. Two
    // lost workers were recovered by hand this way; this makes it
    // automatic.
    const processes = await paneForegroundProcessesAsync(surface, signal);
    if (processes === null) {
      // Read failure (transient server error, or a pane that no longer
      // answers). After the threshold, probe pane existence: gone → the
      // killed path; alive → keep waiting, the deadline still bounds it.
      consecutiveReadFails++;
      if (consecutiveReadFails >= bounds.processInfoFailLimit) {
        if (!(await paneExistsAsync(surface, signal))) {
          const verdict = classifySurfaceLoss();
          if (verdict) return readExitSidecar(options.sessionFile) ?? verdict;
          // Pane gone but transcript still writing: headless run, keep
          // waiting. The hard deadline still bounds the wait.
        }
      }
    } else {
      consecutiveReadFails = 0;
      const liveness = updateAgentLiveness(seenAgentProcess, processes);
      seenAgentProcess = liveness.seenAgent;
      if (liveness.agentGone) {
        // Registry-desync guard: pi vanished from the pane. Transcript
        // growth within the confirm window means a live headless run;
        // silence past it confirms completion.
        if (Date.now() - lastAgentWriteAt >= confirmGoneMs) {
          return agentGoneResult();
        }
      }
      // No-sighting grace — genuine launch death only: no pi sighting AND
      // no agent output beyond the spawn baseline, past the grace window.
      // Agent transcript growth proves the launch lived; a broken pane
      // read can never write off a live session as "never started".
      // Bounded, never infinite.
      if (
        !seenAgentProcess &&
        !agentWrote &&
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
