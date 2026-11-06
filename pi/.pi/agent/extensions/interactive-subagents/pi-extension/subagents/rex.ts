/**
 * Rex surface layer — tab, floating-layer and block control via `rex`.
 *
 * Mirrors the export contract of ./tmux.ts and ./herdr.ts so index.ts can
 * target any of the three through ./surface.ts. A launched subagent floats in
 * a layer over its parent's window, so the captain keeps the work in sight
 * without opening a tab per child. The rest of the extension addresses the
 * child by its block id (e.g. `block:01a1...`), which is Rex's pane.
 *
 * A floating layer belongs to one window. When the child runs in the caller's
 * session, that window is the anchor block's window. When the child runs in
 * another session (a mission session), it floats in that session's active
 * window instead. A server that refuses layers falls back to a tab, so a
 * subagent still launches.
 *
 * Rex does not set a TERM the way tmux does, so this module never infers
 * availability from TERM. `./surface.ts` uses TERM only to break a tie when
 * both TMUX and REX_SESSION are set (a nested mux).
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
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

/** Optional injection for tests: the env and the PATH probe. */
type RexInputCheck = {
  env?: Record<string, string | undefined>;
  commandAvailable?: (command: string) => boolean;
};

/**
 * Which of the three Rex inputs are missing, in a fixed order:
 * `REX_SESSION`, `REX_BLOCK`, `rex on PATH`.
 *
 * Reads the environment on every call — a session can gain its Rex identity
 * after load, and a cached environment answer is what left sessions unable to
 * spawn children until they restarted. The PATH probe is the only cached
 * input (`hasCommand`).
 */
export function missingRexInputs(options: RexInputCheck = {}): string[] {
  const env = options.env ?? process.env;
  const present = options.commandAvailable ?? hasCommand;
  const missing: string[] = [];
  if (!env.REX_SESSION) missing.push("REX_SESSION");
  if (!env.REX_BLOCK) missing.push("REX_BLOCK");
  if (!present("rex")) missing.push("rex on PATH");
  return missing;
}

function listInputs(inputs: string[]): string {
  if (inputs.length <= 1) return inputs.join("");
  return `${inputs.slice(0, -1).join(", ")} and ${inputs[inputs.length - 1]}`;
}

/**
 * One sentence naming exactly which Rex input is missing, or null when the
 * identity is complete (nothing to report) or wholly absent (no Rex identity
 * at all, so this is not a Rex session and the caller's generic multiplexer
 * hint is the right one).
 */
export function rexRefusalDetail(options: RexInputCheck = {}): string | null {
  const env = options.env ?? process.env;
  if (!env.REX_SESSION && !env.REX_BLOCK) return null;
  const missing = missingRexInputs(options);
  if (missing.length === 0) return null;
  return `Rex is not fully available: missing ${listInputs(missing)}.`;
}

/**
 * True when running inside Rex with the `rex` binary on PATH.
 * Rex sets `REX_SESSION` and `REX_BLOCK` on every process in a block;
 * `REX_BLOCK` is the parent pi's own block, the analogue of `TMUX_PANE`.
 */
export function isRexAvailable(): boolean {
  return missingRexInputs().length === 0;
}

/** Surface-agnostic gate (matches the ./tmux.ts `isMuxAvailable` contract). */
export function isMuxAvailable(): boolean {
  return isRexAvailable();
}

export function muxSetupHint(): string {
  return "Start pi inside Rex (`rex new pi -- pi`).";
}

function requireRex(): void {
  const missing = missingRexInputs();
  if (missing.length === 0) return;
  throw new Error(
    `rex is required for subagents; missing ${listInputs(missing)}. ${muxSetupHint()}`,
  );
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

/** True for a value that is a file path, not a session label or id. */
function looksLikePath(value: string): boolean {
  return value.includes("/") || value.endsWith(".jsonl");
}

/** Resolve one routing candidate (an id or a label) to a session id. */
function resolveRoutedSession(want: string): string | null {
  if (want.startsWith("session:")) return want;
  return findSessionByLabel(want);
}

/**
 * The value the routing variables name, or null when neither names one.
 * `PI_SUBAGENT_REX_SESSION` wins; `PI_SUBAGENT_SESSION` routes only while it
 * holds a plain label, never the child's session file.
 */
function routingWant(): string | null {
  const rex = process.env.PI_SUBAGENT_REX_SESSION?.trim();
  if (rex) return rex;
  const legacy = process.env.PI_SUBAGENT_SESSION?.trim();
  if (legacy && !looksLikePath(legacy)) return legacy;
  return null;
}

/** Every session label the server has, for an error a caller can act on. */
function sessionLabels(): string {
  const listed = rexJsonOrNull<{ sessions?: Array<{ label?: string }> }>(["ls", "--json"]);
  const labels = (listed?.sessions ?? []).map((s) => s.label).filter(Boolean);
  return labels.length ? labels.join(", ") : "none";
}

/** A label or a full id, or a throw that names the live sessions. */
function requireSession(want: string): string {
  if (want.startsWith("session:")) return want;
  const found = findSessionByLabel(want);
  if (found) return found;
  throw new Error(`unknown session "${want}"; live sessions: ${sessionLabels()}`);
}

/**
 * The session a child runs in. `PI_SUBAGENT_REX_SESSION` names a Rex label or
 * id, so a mission captain fans work out into the mission session instead of
 * its own.
 *
 * `PI_SUBAGENT_SESSION` is the child's pi session *file* (`/…/2026-…_abc.jsonl`),
 * read by subagent-done.ts and the resume path. It routes only while it holds a
 * plain label, which is how mission deploy seats its troops today; a path is
 * never a session target. Without either variable a child follows the caller.
 */
let childSession: string | null = null;

function childSessionId(explicit?: string): string | null {
  if (explicit) return requireSession(explicit.trim());
  const want = routingWant();
  // No routing variable (or only the child's session file, which is not a
  // session target): a child follows the caller, as before.
  if (!want) return process.env.REX_SESSION?.trim() || null;
  // Cache only a session a routing variable resolved to: a lookup that found
  // nothing must retry on the next call, because the session can appear later.
  if (childSession) return childSession;
  childSession = resolveRoutedSession(want);
  return childSession ?? (process.env.REX_SESSION?.trim() || null);
}

/** `-s` scope for a child tab, or none when no session is known. */
function childSessionArgs(explicit?: string): string[] {
  const session = childSessionId(explicit);
  return session ? ["-s", session] : [];
}

/**
 * The cwd a child starts in. A rank tab belongs to the mission worktree, so a
 * captain sets `PI_SUBAGENT_CWD`; otherwise the child inherits the caller.
 */
function childCwd(explicit?: string): string | null {
  return explicit?.trim() || process.env.PI_SUBAGENT_CWD?.trim() || process.cwd() || null;
}

/**
 * Block ids are unique, but Rex resolves a block target inside ONE session:
 * `rex capture -b <id>` fails with "block target not found" when the block
 * belongs to another session. A block this module created on another session
 * (see createSession) is remembered here, so every later call scopes to the
 * right one. Blocks created elsewhere fall back to REX_SESSION.
 */
const blockSessions = new Map<string, string>();

/** `-s` scope for a block-targeted call. */
function scopeArgs(blockId: string): string[] {
  const session = blockSessions.get(blockId) ?? process.env.REX_SESSION;
  return session ? ["-s", session] : [];
}

/** `-s` scope plus `-b` target for a block-targeted call. */
function blockArgs(blockId: string): string[] {
  return [...scopeArgs(blockId), "-b", blockId];
}

/** Remember which session owns a block (needed for cross-session adoption). */
export function rememberBlock(blockId: string, sessionId: string): void {
  if (blockId && sessionId) blockSessions.set(blockId, sessionId);
}

/** Session id whose label matches exactly, or null. */
function findSessionByLabel(label: string): string | null {
  const list = rexJsonOrNull<{
    sessions?: Array<{ session_id?: unknown; label?: unknown }>;
  }>(["ls", "--json"]);
  const hit = list?.sessions?.find(
    (entry) => entry?.label === label && typeof entry.session_id === "string" && entry.session_id,
  );
  return typeof hit?.session_id === "string" ? hit.session_id : null;
}

/** First block of a session, or null when it has no windows left. */
function rootBlockOf(sessionId: string): string | null {
  const info = rexJsonOrNull<{
    windows?: Array<{ layers?: Array<{ blocks?: Array<{ block_id?: unknown }> }> }>;
  }>(["session", "inspect", sessionId, "--json"]);
  const block = info?.windows?.[0]?.layers?.[0]?.blocks?.[0]?.block_id;
  return typeof block === "string" && block !== "" ? block : null;
}

/**
 * Create — or reuse — the dedicated Rex session for one worktree. A repeat
 * call finds the existing session by label and adopts its first block, so
 * repeated worktree calls never pile up empty sessions. `rex new` does not
 * switch the app's visible session, so this never steals the human's focus.
 * Returns the session id and its first block, and remembers the mapping so
 * the subagent machinery can drive that block from the caller's session.
 */
export function createSession(
  label: string,
  cwd: string,
): { session: string; pane: string } | null {
  requireRex();
  const name = sanitizeLabel(label);

  const existing = findSessionByLabel(name);
  if (existing) {
    const pane = rootBlockOf(existing);
    if (pane) {
      rememberBlock(pane, existing);
      return { session: existing, pane };
    }
  }

  const out = rexSync(["new", name, "-c", cwd, "--window", name, "--json"]);
  let parsed: { session_id?: unknown; initial_windows?: Array<{ block_ids?: unknown }> };
  try {
    parsed = JSON.parse(out);
  } catch {
    return null;
  }
  const session = parsed?.session_id;
  const blocks = parsed?.initial_windows?.[0]?.block_ids;
  const pane = Array.isArray(blocks) ? blocks[0] : undefined;
  if (
    typeof session !== "string" ||
    session === "" ||
    typeof pane !== "string" ||
    pane === ""
  ) {
    return null;
  }
  rememberBlock(pane, session);
  return { session, pane };
}

// ── Surface primitives ──

// Centered, 80% of the window on each axis. Bounds are window fractions, so
// the layer keeps that share as the window resizes. No cascade by default:
// one layer is visible at a time, and identical bounds keep a restored child
// exactly where the last one was.
const LAYER_W = 0.8;
const LAYER_H = 0.8;
const LAYER_BASE = 0.1;
const LAYER_STEP = 0;
const LAYER_STEPS = 6;

/**
 * How a child opens. `minimized` keeps the human's view unchanged while the
 * program runs; `normal` floats it in view; `off` opens a tab instead.
 * Set per launch through SurfaceOptions.layer, or for every launch through
 * PI_SUBAGENT_LAYER (`minimized` | `normal` | `off`).
 */
export type LayerMode = "minimized" | "normal" | "off";

function layerMode(explicit?: LayerMode): LayerMode {
  if (explicit) return explicit;
  const raw = process.env.PI_SUBAGENT_LAYER?.trim().toLowerCase();
  if (raw === "off" || raw === "none" || raw === "tab") return "off";
  if (raw === "normal" || raw === "open" || raw === "visible") return "normal";
  return "minimized";
}

/** `x,y,w,h` as window fractions, or null for the built-in cascade. */
function layerBoundsOverride(): { x: number; y: number; w: number; h: number } | null {
  const raw = process.env.PI_SUBAGENT_LAYER_BOUNDS?.trim();
  if (!raw) return null;
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x, y, w, h] = parts;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return null;
  return { x, y, w, h };
}

/** Distance between cascaded children, as a window fraction. */
function layerStep(): number {
  const raw = Number(process.env.PI_SUBAGENT_LAYER_STEP?.trim());
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : LAYER_STEP;
}

interface RexLayer {
  layer_id?: unknown;
  kind?: unknown;
  state?: unknown;
  bounds?: unknown;
  blocks?: Array<{ block_id?: unknown }>;
}

interface RexWindow {
  window_id?: unknown;
  layers?: RexLayer[];
}

interface RexView {
  active_window_id?: unknown;
  windows?: RexWindow[];
}

function viewOf(sessionId: string): RexView | null {
  return rexJsonOrNull<RexView>(["session", "inspect", sessionId, "--json"]);
}

function windowById(view: RexView | null, windowId: string): RexWindow | null {
  return (view?.windows ?? []).find((w) => w.window_id === windowId) ?? null;
}

/** The window a block sits in, scoped to the session this module knows. */
function windowOfBlock(blockId: string): string | null {
  const session = blockSessions.get(blockId) ?? process.env.REX_SESSION?.trim();
  if (!session) return null;
  return windowHoldingBlock(session, blockId);
}

/**
 * The window of one session whose layers hold a block. Read from the session
 * view, so it answers from the same snapshot the caller is about to change.
 */
function windowHoldingBlock(session: string, blockId: string): string | null {
  for (const window of viewOf(session)?.windows ?? []) {
    for (const layer of window.layers ?? []) {
      if ((layer.blocks ?? []).some((block) => block.block_id === blockId)) {
        const id = window.window_id;
        return typeof id === "string" && id !== "" ? id : null;
      }
    }
  }
  return null;
}

/**
 * Where the next floating child sits. The server does not offset layers, so
 * every child would land on top of the last one; stepping by a fixed amount
 * keeps each one reachable, and wraps back to the base corner.
 */
function nextLayerBounds(view: RexView | null, windowId: string): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const layers = windowById(view, windowId)?.layers ?? [];
  // Count minimized layers too: they are restored later, and two children
  // that share a corner overlap exactly once both are visible again.
  const floating = layers.filter((layer) => layer.kind === "floating").length;
  const step = layerStep() * (floating % LAYER_STEPS);
  return { x: LAYER_BASE + step, y: LAYER_BASE + step, w: LAYER_W, h: LAYER_H };
}

/** The layer that holds a block, with the kind the server reports. */
function layerOfBlock(
  blockId: string,
): { session: string; layerId: string; kind: string } | null {
  const session = blockSessions.get(blockId) ?? process.env.REX_SESSION?.trim();
  if (!session) return null;
  const windowId = windowHoldingBlock(session, blockId);
  if (!windowId) return null;
  const view = viewOf(session);
  for (const layer of windowById(view, windowId)?.layers ?? []) {
    const holds = (layer.blocks ?? []).some((block) => block.block_id === blockId);
    if (holds && typeof layer.layer_id === "string" && layer.layer_id !== "") {
      return {
        session,
        layerId: layer.layer_id,
        kind: typeof layer.kind === "string" ? layer.kind : "",
      };
    }
  }
  return null;
}

/** Close the floating layer that holds a block. False when it is not floating. */
function closeFloatingLayer(blockId: string): boolean {
  const layer = layerOfBlock(blockId);
  if (!layer || layer.kind !== "floating") return false;
  try {
    rexSync([
      "api",
      "call",
      "session.close_layer",
      JSON.stringify({ session_id: layer.session, layer_id: layer.layerId }),
    ]);
    return true;
  } catch {
    // Fall through so the caller closes the block itself.
    return false;
  }
}

/**
 * The window that hosts a child's floating layer. A child in the anchor's
 * session floats over the anchor's window; a child routed to another session
 * floats over that session's active window.
 */
function floatingWindowFor(session: string, anchor: string | null): string | null {
  // The tab the caller runs in, resolved from the caller's block. This is the
  // only tab that can hold the child: a layer belongs to one window, and a
  // window belongs to one session.
  if (anchor) {
    const anchorSession = blockSessions.get(anchor) ?? process.env.REX_SESSION?.trim();
    if (anchorSession === session) {
      const windowId = windowHoldingBlock(session, anchor);
      if (windowId) return windowId;
    }
  }
  // A child in another session (a mission trooper) cannot float in the
  // caller's tab. Take that session's first window, never `active_window_id`:
  // the active window follows whatever tab the human is looking at, which is
  // exactly how a child ends up in the wrong tab after a tab switch.
  const first = (viewOf(session)?.windows ?? [])[0];
  const id = first?.window_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Create one floating layer. Null when the server refuses the call. */
function createFloatingLayer(
  session: string,
  windowId: string,
  label: string,
  cwd: string | null,
  mode: LayerMode,
  fixedBounds: { x: number; y: number; w: number; h: number } | null,
): string | null {
  const bounds = fixedBounds ?? nextLayerBounds(viewOf(session), windowId);
  const block: Record<string, unknown> = {
    flavor: "com.superlogical.terminal.shell",
    label,
  };
  if (cwd) block.options = { cwd };
  try {
    const out = rexSync([
      "api",
      "call",
      "session.new_layer",
      JSON.stringify({
        session_id: session,
        window_id: windowId,
        bounds,
        focus: false,
        layout: { block },
      }),
    ]);
    const parsed = JSON.parse(out) as { block_ids?: unknown; layer_id?: unknown };
    const created = Array.isArray(parsed.block_ids) ? parsed.block_ids[0] : undefined;
    if (typeof created !== "string" || created === "") return null;
    const layerId = parsed.layer_id;
    if (mode === "minimized" && typeof layerId === "string" && layerId !== "") {
      try {
        rexSync([
          "api",
          "call",
          "session.set_layer_state",
          JSON.stringify({ session_id: session, layer_id: layerId, state: "minimized" }),
        ]);
      } catch {
        // The child runs either way; a failed minimize only leaves it open.
      }
    }
    return created;
  } catch {
    return null;
  }
}

/**
 * Create a new tab for a subagent. Kept for callers that explicitly want a
 * tab; subagents now float (see createSurface).
 *
 * Returns the new tab's root block id (e.g. `block:01a1...`).
 */
function createTabSurface(name: string, options?: SurfaceOptions): string {
  const label = `π ${sanitizeLabel(name)}`;
  const session = childSessionId(options?.session);
  const cwd = childCwd(options?.cwd);
  const args = ["window", "new"];
  if (session) args.push("-s", session);
  args.push(label, "--focus=false", "--json");
  if (cwd) args.push("-c", cwd);
  const out = rexSync(args);
  const created = parseCreated(out);
  if (!created) {
    throw new Error(`Unexpected rex window new output: ${out.slice(0, 200)}`);
  }
  // Later reads and sends resolve a block inside one session.
  if (session) rememberBlock(created, session);
  return created;
}

/**
 * Create a floating child surface anchored to `options.anchor` (default: this
 * process's block), so a captain's children stay in the captain's window.
 *
 * Returns the new block id (e.g. `block:01a1...`).
 */
export function createSurface(name: string, options?: SurfaceOptions): string {
  requireRex();
  const label = `π ${sanitizeLabel(name)}`;
  const session = childSessionId(options?.session);
  const cwd = childCwd(options?.cwd);
  const anchor = options?.anchor ?? process.env.REX_BLOCK?.trim() ?? null;
  const mode = layerMode(options?.layer);
  const fixedBounds = options?.bounds ?? layerBoundsOverride();

  if (session && mode !== "off") {
    const windowId = floatingWindowFor(session, anchor && anchor !== "" ? anchor : null);
    if (windowId) {
      const created = createFloatingLayer(session, windowId, label, cwd, mode, fixedBounds);
      if (created) {
        rememberBlock(created, session);
        return created;
      }
    }
  }

  // No window to float over, or the server refused the layer: a tab still runs
  // the child, so a launch never fails for want of a layer.
  return createTabSurface(name, options);
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
  options?: SurfaceOptions,
): string {
  void name; // Rex block labels are not settable at split time.
  requireRex();
  const anchor = fromSurface ?? process.env.REX_BLOCK;
  // A split lives beside its anchor, so the anchor's session wins. Without one,
  // the child target decides.
  const scope = anchor ? scopeArgs(anchor) : childSessionArgs(options?.session);
  const args = ["split", ...scope];
  if (anchor) args.push("-b", anchor);
  args.push(`--split=${direction}`, "--focus=false", "--json");
  const out = rexSync(args);
  const created = parseCreated(out);
  if (!created) {
    throw new Error(`Unexpected rex split output: ${out.slice(0, 200)}`);
  }
  const session = scope[1];
  if (session) rememberBlock(created, session);
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
  rexSync(["send", ...blockArgs(surface), "--", command]);
  rexSync(["send-key", ...blockArgs(surface), "enter"]);
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
  // An interactive bash gives the script's foreground job its own process group
  // and the terminal's foreground slot, so Rex names the block's program as pi
  // (the pi glyph) instead of bash. Sourcing keeps the script's trailing done
  // sentinel running.
  sendCommand(surface, `bash --norc --noprofile -i -c ${shellEscape(`. ${scriptPath}`)}`);
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
  const out = rexSync(["capture", ...blockArgs(surface), "--trim", "--unwrap"]);
  return tailLines(out, lines);
}

/** Read the recent screen contents of a block (async). */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireRex();
  const out = await rexAsync(["capture", ...blockArgs(surface), "--trim", "--unwrap"]);
  return tailLines(out, lines);
}

/**
 * The state a program reported through OSC 7501, or null when nothing
 * reported. pi reports `app=pi`, so its state is the readiness signal Rex
 * offers in place of an agent registry.
 */
async function readProgramState(
  blockId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "rex",
      ["block", "call", ...blockArgs(blockId), "program_status"],
      { encoding: "utf8", signal, maxBuffer: 8 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const records =
      (JSON.parse(trimmed) as { records?: Array<{ app?: string; state?: string }> })
        .records ?? [];
    return records.find((record) => record.app === "pi")?.state ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait until the pi running in a block reports that it is at its prompt.
 * Mirrors ./herdr.ts: idle means ready, blocked fails the launch, and the
 * done sentinel means the child exited before it could take the prompt.
 */
export async function waitForAgentReady(
  surface: string,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<void> {
  requireRex();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const state = await readProgramState(surface, signal);
    if (state === "idle" || state === "done") return;
    if (state === "blocked") {
      throw new Error(`Subagent in ${surface} was blocked during startup`);
    }
    const screen = await readScreenAsync(surface, 5);
    const exited = screen.match(/__SUBAGENT_DONE_(\d+)__/);
    if (exited) {
      throw new Error(
        `Subagent in ${surface} exited with code ${exited[1]} before becoming ready`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for subagent in ${surface} to become ready`);
}

/**
 * Submit a prompt after waitForAgentReady. Bracketed paste keeps a multi-line
 * brief from submitting one line at a time; Enter submits the whole paste.
 */
export function sendAgentPrompt(surface: string, prompt: string): void {
  requireRex();
  const pasted = `\u001b[200~${prompt.replaceAll("\u001b[201~", "")}\u001b[201~`;
  rexSync(["send", ...blockArgs(surface), "--", pasted]);
  rexSync(["send-key", ...blockArgs(surface), "enter"]);
}

/** Close a block, or the floating layer that holds it. */
export function closeSurface(surface: string): void {
  requireRex();
  if (closeFloatingLayer(surface)) return;
  rexSync(["block", "close", ...scopeArgs(surface), surface]);
}

/** True when the block is the only block of its window's tiled layer. */
function isTiledRoot(blockId: string): boolean {
  const session = blockSessions.get(blockId) ?? process.env.REX_SESSION?.trim();
  if (!session) return false;
  const windowId = windowOfBlock(blockId);
  if (!windowId) return false;
  const tiled = (windowById(viewOf(session), windowId)?.layers ?? []).find(
    (layer) => layer.kind === "tiled",
  );
  const blocks = tiled?.blocks ?? [];
  return blocks.length === 1 && blocks[0]?.block_id === blockId;
}

/**
 * Close the surface a subagent lived in: its floating layer when it had one,
 * otherwise the tab that was created for it. Best-effort, with a plain block
 * close as the fallback. A block that shares a window with the human never
 * closes that window.
 */
export function closeTabForPane(blockId: string): void {
  const layer = layerOfBlock(blockId);
  if (layer?.kind === "floating") {
    if (closeFloatingLayer(blockId)) return;
    try {
      rexSync(["block", "close", ...scopeArgs(blockId), blockId]);
    } catch {}
    return;
  }
  const inspected = rexJsonOrNull<{ block?: { window_id?: string } }>([
    "block",
    "inspect",
    ...scopeArgs(blockId),
    blockId,
    "--json",
  ]);
  const windowId = inspected?.block?.window_id;
  if (typeof windowId === "string" && windowId !== "" && isTiledRoot(blockId)) {
    try {
      rexSync(["window", "close", ...scopeArgs(blockId), windowId]);
      return;
    } catch {}
  }
  try {
    rexSync(["block", "close", ...scopeArgs(blockId), blockId]);
  } catch {}
}

// ── Liveness ──

/** Same contract as ./tmux.ts and ./herdr.ts. */
export interface PaneAgentProbe {
  paneExists: boolean;
  agentAlive: boolean | null;
}

interface RexProcessInfo {
  foreground?: { name?: string; argv0?: string; path?: string; cwd?: string } | null;
  ancestors?: Array<{ name?: string; argv0?: string; path?: string; cwd?: string }>;
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
      ["block", "call", ...blockArgs(blockId), "process"],
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
    await execFileAsync("rex", ["block", "inspect", ...scopeArgs(blockId), blockId, "--json"], {
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

/** Resolve a directory, or null when it does not exist. */
function realDir(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Refuse to adopt a block that is not a safe subagent surface: the parent's
 * own block, a block where an agent already runs, a block that does not
 * exist, or a shell sitting in a different directory than the launch expects.
 * Same contract as the Herdr version, so index.ts can gate both identically.
 */
export function assertAdoptablePane(paneId: string, expectCwd: string): void {
  requireRex();
  if (paneId === process.env.REX_BLOCK) {
    throw new Error("Refusing to adopt the parent session's own block as a subagent surface");
  }
  const info = rexJsonOrNull<RexProcessInfo>([
    "block",
    "call",
    ...blockArgs(paneId),
    "process",
  ]);
  if (!info) {
    throw new Error(`Pane ${paneId} does not exist (rex block call returned no process)`);
  }
  const foreground = info.foreground;
  const program = foreground?.argv0 ?? foreground?.name ?? "";
  if (program === "pi") {
    throw new Error(`Refusing to adopt ${paneId}: pi is already running there`);
  }
  const cwd = foreground?.cwd;
  if (typeof cwd === "string" && cwd !== "" && expectCwd) {
    const actual = realDir(cwd);
    const expected = realDir(expectCwd);
    if (actual && expected && actual !== expected) {
      throw new Error(
        `Refusing to adopt ${paneId}: its shell runs in ${actual}, not ${expected}`,
      );
    }
  }
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
