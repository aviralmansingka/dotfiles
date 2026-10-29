/**
 * Rex surface layer — tab and block control via the `rex` CLI.
 *
 * Mirrors the export contract of ./tmux.ts and ./herdr.ts so index.ts can
 * target any of the three through ./surface.ts. Each launched subagent gets a
 * labeled, unfocused Rex tab; the rest of the extension addresses that tab
 * through its root block id (e.g. `block:01a1...`), which is Rex's pane.
 *
 * Rex does not set a TERM the way tmux does, so this module never infers
 * availability from TERM. `./surface.ts` uses TERM only to break a tie when
 * both TMUX and REX_SESSION are set (a nested mux).
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getSubagentPollBounds,
  interpretExitSidecar,
  isPiForegroundProcess,
  readExitSidecar,
  updateAgentLiveness,
  type PollResult,
} from "./tmux.ts";

const execFileAsync = promisify(execFile);

// Explicit stdio on every captured call below is load-bearing: with the
// default stdio, Node passes the child's stderr through to this process's
// terminal while also capturing it — the #291 splatter class (a failing rex
// call painted raw error lines over the agent's TUI). Captured stderr still
// surfaces through the thrown error.

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
 * True when running inside Rex with the `rex` binary on PATH.
 * Rex sets `REX_SESSION` and `REX_BLOCK` on every process in a block;
 * `REX_BLOCK` is the parent pi's own block, the analogue of `TMUX_PANE`.
 */
export function isRexAvailable(): boolean {
  return !!process.env.REX_SESSION && !!process.env.REX_BLOCK && hasCommand("rex");
}

/** Surface-agnostic gate (matches the ./tmux.ts `isMuxAvailable` contract). */
export function isMuxAvailable(): boolean {
  return isRexAvailable();
}

export function muxSetupHint(): string {
  return "Start pi inside Rex (`rex new pi -- pi`).";
}

function requireRex(): void {
  if (!isRexAvailable()) {
    throw new Error(`rex is required for subagents. ${muxSetupHint()}`);
  }
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── rex CLI plumbing ──

/** Run `rex` and return stdout. Throws with captured stderr on failure. */
async function rexAsync(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("rex", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/** Run `rex` synchronously and return stdout. */
function rexSync(args: string[]): string {
  return execFileSync("rex", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** JSON-shaped rex call. Returns null instead of throwing, for probes. */
function rexJsonOrNull<T>(args: string[]): T | null {
  try {
    const out = rexSync(args);
    const trimmed = out.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function sessionArgs(): string[] {
  const session = process.env.REX_SESSION;
  return session ? ["-s", session] : [];
}

// ── Surface primitives ──

/**
 * Create a new tab for a subagent, anchored to nothing: Rex tabs are
 * session-scoped, so a new tab follows the agent the way a Herdr tab does.
 * The tab is created unfocused so the captain keeps their current view.
 *
 * Returns the new tab's root block id (e.g. `block:01a1...`).
 */
export function createSurface(name: string): string {
  requireRex();
  const label = sanitizeLabel(name);
  const out = rexSync([
    "window",
    "new",
    ...sessionArgs(),
    label,
    "--focus=false",
    "--json",
  ]);
  const created = parseCreated(out);
  if (!created) {
    throw new Error(`Unexpected rex window new output: ${out.slice(0, 200)}`);
  }
  return created;
}

/**
 * Create a split beside an optional source block. Rex tabs are the default
 * for subagents, so this exists to satisfy the shared surface contract and
 * for callers that explicitly want a pane beside an existing block.
 *
 * Returns the new block id.
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name; // Rex block labels are not settable at split time.
  requireRex();
  const anchor = fromSurface ?? process.env.REX_BLOCK;
  const args = ["split", ...sessionArgs()];
  if (anchor) args.push("-b", anchor);
  args.push(`--split=${direction}`, "--focus=false", "--json");
  const out = rexSync(args);
  const created = parseCreated(out);
  if (!created) {
    throw new Error(`Unexpected rex split output: ${out.slice(0, 200)}`);
  }
  return created;
}

/** Read the block id out of a `window new` / `split` JSON answer. */
function parseCreated(out: string): string | null {
  try {
    const parsed = JSON.parse(out) as {
      block_ids?: unknown;
      initial_windows?: Array<{ block_ids?: unknown }>;
    };
    const direct = Array.isArray(parsed.block_ids) ? parsed.block_ids[0] : undefined;
    if (typeof direct === "string" && direct !== "") return direct;
    const initial = parsed.initial_windows?.[0]?.block_ids;
    if (Array.isArray(initial) && typeof initial[0] === "string" && initial[0] !== "") {
      return initial[0];
    }
    return null;
  } catch {
    return null;
  }
}

/** Rex tab names reject control characters and show poorly when huge. */
function sanitizeLabel(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!cleaned) return "subagent";
  return cleaned.length > 60 ? cleaned.slice(0, 60) : cleaned;
}

/**
 * Send a command string to a block and execute it. `--` keeps a command that
 * starts with `-` from being read as a rex flag; Enter submits it.
 */
export function sendCommand(surface: string, command: string): void {
  requireRex();
  rexSync(["send", ...sessionArgs(), "-b", surface, "--", command]);
  rexSync(["send-key", ...sessionArgs(), "-b", surface, "enter"]);
}

/**
 * Send a long command to a block by writing it to a script file first.
 * Same rationale as ./tmux.ts: a long line sent as keystrokes wraps in a
 * narrow pane and breaks the command.
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

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", { mode: 0o755 });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/** Keep the last `lines` non-empty lines of a capture. */
function tailLines(text: string, lines: number): string {
  const all = text.split("\n");
  const keep = Math.max(1, lines);
  return all.slice(Math.max(0, all.length - keep)).join("\n");
}

/**
 * Read the recent screen contents of a block (sync).
 * `--trim --unwrap` drops Rex's padding and hard wraps, so the sentinel and
 * the shell prompt scan the same way they do under tmux.
 */
export function readScreen(surface: string, lines = 50): string {
  requireRex();
  const out = rexSync(["capture", ...sessionArgs(), "-b", surface, "--trim", "--unwrap"]);
  return tailLines(out, lines);
}

/** Read the recent screen contents of a block (async). */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireRex();
  const out = await rexAsync(["capture", ...sessionArgs(), "-b", surface, "--trim", "--unwrap"]);
  return tailLines(out, lines);
}

/** Close a block. */
export function closeSurface(surface: string): void {
  requireRex();
  rexSync(["block", "close", ...sessionArgs(), surface]);
}

/**
 * Close the whole tab holding a block, so sibling panes close with it.
 * Best-effort, with a plain block close as the fallback.
 */
export function closeTabForPane(blockId: string): void {
  const inspected = rexJsonOrNull<{ block?: { window_id?: string } }>([
    "block",
    "inspect",
    ...sessionArgs(),
    blockId,
    "--json",
  ]);
  const windowId = inspected?.block?.window_id;
  if (typeof windowId === "string" && windowId !== "") {
    try {
      rexSync(["window", "close", ...sessionArgs(), windowId]);
      return;
    } catch {}
  }
  try {
    rexSync(["block", "close", ...sessionArgs(), blockId]);
  } catch {}
}

// ── Liveness ──

/** Same contract as ./tmux.ts and ./herdr.ts. */
export interface PaneAgentProbe {
  paneExists: boolean;
  agentAlive: boolean | null;
}

interface RexProcessInfo {
  foreground?: { name?: string; argv0?: string; path?: string } | null;
  ancestors?: Array<{ name?: string; argv0?: string; path?: string }>;
  last_exit?: number | null;
}

/** One `rex block call ... process` read, or null when the block is gone. */
async function readProcessInfo(
  blockId: string,
  signal?: AbortSignal,
): Promise<RexProcessInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      "rex",
      ["block", "call", ...sessionArgs(), "-b", blockId, "process"],
      { encoding: "utf8", signal, maxBuffer: 8 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as RexProcessInfo;
  } catch {
    return null;
  }
}

/**
 * Map Rex's foreground/ancestor entries onto the `{name, argv}` shape the
 * shared matchers expect. `argv0` carries the real program name (`pi` when
 * the interpreter is node), so it becomes argv[0].
 */
function toProcessList(info: RexProcessInfo): Array<{ name?: string; argv?: string[] }> {
  const entries = [info.foreground, ...(info.ancestors ?? [])].filter(
    (entry): entry is { name?: string; argv0?: string; path?: string } => !!entry,
  );
  return entries.map((entry) => {
    const program = entry.argv0 ?? entry.path ?? entry.name ?? "";
    return { name: entry.name, argv: program ? [program] : [] };
  });
}

/** True when the block still resolves. */
async function blockExists(blockId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileAsync("rex", ["block", "inspect", ...sessionArgs(), blockId, "--json"], {
      encoding: "utf8",
      signal,
      maxBuffer: 8 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

export async function probePaneAgent(
  blockId: string,
  signal?: AbortSignal,
): Promise<PaneAgentProbe> {
  const info = await readProcessInfo(blockId, signal);
  if (info === null) {
    // A null read is either a transient failure or a closed block. Ask the
    // server directly rather than guessing.
    const exists = await blockExists(blockId, signal);
    return { paneExists: exists, agentAlive: null };
  }
  const processes = toProcessList(info);
  if (processes.length === 0) return { paneExists: true, agentAlive: null };
  return { paneExists: true, agentAlive: processes.some(isPiForegroundProcess) };
}

/** Foreground process tree, or null when the read fails. */
async function blockForegroundProcessesAsync(
  blockId: string,
  signal?: AbortSignal,
): Promise<Array<{ name?: string; argv?: string[] }> | null> {
  const info = await readProcessInfo(blockId, signal);
  if (info === null) return null;
  const processes = toProcessList(info);
  return processes.length > 0 ? processes : null;
}

export const __pollForExitTest__ = {
  interpretExitSidecar,
  updateAgentLiveness,
  isPiForegroundProcess,
  tailLines,
  toProcessList,
};

/**
 * Poll until the subagent exits, with the same four-signal ladder and the
 * same three hard bounds as ./tmux.ts and ./herdr.ts:
 * sidecar → sentinel file → screen sentinel → liveness fallback, bounded by
 * the hard deadline, the no-sighting grace window, and the read-failure
 * threshold.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
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

    // Hard deadline: one final harvest, then a timeout — never an infinite wait.
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
        return { reason: "killed", exitCode: 130 };
      }
      return { reason: "timeout", exitCode: null };
    }

    const sidecar = readExitSidecar(options.sessionFile);
    if (sidecar) return sidecar;

    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch {
      // Block closed by hand unless a late sidecar explains it.
      return readExitSidecar(options.sessionFile) ?? { reason: "killed", exitCode: 130 };
    }

    const processes = await blockForegroundProcessesAsync(surface, signal);
    if (processes === null) {
      consecutiveReadFails++;
      if (consecutiveReadFails >= bounds.processInfoFailLimit) {
        if (!(await blockExists(surface, signal))) {
          return readExitSidecar(options.sessionFile) ?? { reason: "killed", exitCode: 130 };
        }
      }
    } else {
      consecutiveReadFails = 0;
      const liveness = updateAgentLiveness(seenAgentProcess, processes);
      seenAgentProcess = liveness.seenAgent;
      if (liveness.agentGone) {
        return { reason: "agent-gone", exitCode: 0 };
      }
      if (!seenAgentProcess && Date.now() - start >= bounds.startupGraceMs) {
        return { reason: "no-agent", exitCode: null };
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
