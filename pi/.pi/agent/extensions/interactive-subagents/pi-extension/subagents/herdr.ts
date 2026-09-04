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
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

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
  const stdout = execFileSync("herdr", ["pane", "get", paneId], { encoding: "utf8" });
  const workspaceId = JSON.parse(stdout)?.result?.pane?.workspace_id;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new Error(`Unexpected Herdr pane output: ${stdout}`);
  }
  return workspaceId;
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
    { encoding: "utf8" },
  );
  return parsePaneId(stdout);
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

  const stdout = execFileSync("herdr", args, { encoding: "utf8" });
  const pane = parsePaneId(stdout);
  rebalanceSurfaces(pane);
  return pane;
}

/**
 * Send a command string to a pane and execute it.
 * `herdr pane send-text` sends literal text (the tmux `send-keys -l` analogue),
 * then `herdr pane send-keys Enter` submits it.
 */
export function sendCommand(surface: string, command: string): void {
  requireHerdr();
  execFileSync("herdr", ["pane", "send-text", surface, command], { encoding: "utf8" });
  execFileSync("herdr", ["pane", "send-keys", surface, "Enter"], { encoding: "utf8" });
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
    { encoding: "utf8" },
  );
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireHerdr();
  const { stdout } = await execFileAsync(
    "herdr",
    ["pane", "read", surface, "--source", "recent", "--lines", String(Math.max(1, lines)), "--format", "text"],
    { encoding: "utf8" },
  );
  return stdout;
}

/**
 * Close a pane.
 */
export function closeSurface(surface: string): void {
  requireHerdr();
  execFileSync("herdr", ["pane", "close", surface], { encoding: "utf8" });
  rebalanceSurfaces();
}

// ── Exit polling ──

export interface PollResult {
  /** How the subagent exited */
  reason: "done" | "sentinel" | "error" | "killed";
  /** Shell exit code. 0 for file-based exits; 130 when the pane was killed. */
  exitCode: number;
  /** Error message if reason is "error" (auto-retry exhausted, provider overload, etc.) */
  errorMessage?: string;
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

export const __pollForExitTest__ = { interpretExitSidecar, paneKilledResult };

/**
 * Poll until the subagent exits. Checks for a `.exit` sidecar file first
 * (written by the error path), falling back to the terminal sentinel for
 * clean-completion and crash detection. Identical logic to ./tmux.ts; only
 * the underlying readScreenAsync differs.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
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

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
