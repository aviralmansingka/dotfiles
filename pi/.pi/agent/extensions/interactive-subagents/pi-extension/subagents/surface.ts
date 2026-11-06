/**
 * Surface dispatcher — selects shared tmux/Herdr/Rex pane operations when a
 * call is made and exposes Herdr-only helpers for readiness-gated launches.
 *
 * Nothing here decides the surface at module load. A pi session can start
 * without REX_SESSION/REX_BLOCK or without `rex` on PATH and gain them later
 * (an `attach` that exports the identity, a shell that fixes PATH); a
 * load-time constant makes that session dead for subagents until it restarts.
 * So `selectSurface()` re-reads the environment on every call. Only the PATH
 * lookup is cached — inside each surface module's `commandAvailability` map.
 *
 * Selection order (first match wins):
 *   1. tmux (`$TERM` is a tmux/screen entry) — TERM names the *innermost*
 *      mux, so tmux running inside a Rex block must still split with tmux.
 *   2. Rex    — `REX_SESSION` + `REX_BLOCK` set and `rex` on PATH.
 *   3. Herdr  — `HERDR_ENV=1`, `HERDR_PANE_ID` set, `herdr` on PATH.
 *   4. tmux   — `TMUX` set and `tmux` on PATH (non-tmux TERM).
 *   5. neither — `isMuxAvailable()` returns false and `muxSetupHint()` tells
 *                the caller how to start a supported multiplexer, naming the
 *                exact Rex input that is missing when the identity is partial.
 *
 * index.ts imports this module instead of ./tmux.ts directly. Shared surface
 * symbols match ./tmux.ts; readiness and prompt submission are Herdr-only.
 */
import * as tmux from "./tmux.ts";
import type { SurfaceOptions } from "./tmux.ts";
import * as herdr from "./herdr.ts";
import * as rex from "./rex.ts";

export type PollResult = herdr.PollResult;

/** Which mux surface the current environment supports. */
export type SurfaceKind = "herdr" | "rex" | "tmux" | "none";

/** tmux sets TERM to a `tmux-*`/`screen-*` entry inside its panes. */
function termIsTmux(): boolean {
  return /^(tmux|screen)/.test(process.env.TERM ?? "");
}

/**
 * Resolve the surface supported *right now*. Cheap: environment reads plus
 * the cached PATH probes in the surface modules. Never memoized — that is the
 * whole point of this module.
 */
export function selectSurface(): SurfaceKind {
  if (termIsTmux() && tmux.isTmuxAvailable()) return "tmux";
  if (rex.isRexAvailable()) return "rex";
  if (herdr.isHerdrAvailable()) return "herdr";
  if (tmux.isTmuxAvailable()) return "tmux";
  return "none";
}

/**
 * The module for the surface selected right now. `rex.ts` and `herdr.ts`
 * implement the `./tmux.ts` export contract and only add extras, so one
 * module-typed view is safe. With no surface, Herdr supplies the
 * surface-agnostic helpers (its `requireHerdr` refusal is the clearest one).
 */
function currentSurface(): typeof tmux {
  const kind = selectSurface();
  return (kind === "rex" ? rex : kind === "tmux" ? tmux : herdr) as unknown as typeof tmux;
}

/** True when any supported multiplexer surface is available. */
export const isMuxAvailable = (): boolean => selectSurface() !== "none";

/** Human-readable hint for starting a supported multiplexer. */
export function muxSetupHint(): string {
  const kind = selectSurface();
  if (kind === "tmux") return tmux.muxSetupHint();
  if (kind === "rex") return rex.muxSetupHint();
  if (kind === "herdr") return herdr.muxSetupHint();
  // No surface. When the Rex identity is only half present, say exactly which
  // input is missing — a bare "pick a multiplexer" hint sends the captain
  // hunting for minutes while the answer is one unset variable.
  const rexDetail = rex.rexRefusalDetail();
  if (rexDetail) return `${rexDetail} ${rex.muxSetupHint()}`;
  // No Rex identity at all: name every supported surface so the hint is
  // actionable whichever terminal the captain actually uses.
  return `${rex.muxSetupHint()} ${herdr.muxSetupHint()} Or start pi inside tmux (\`tmux new -A -s pi 'pi'\`).`;
}

export const createSurface = (name: string, options?: SurfaceOptions): string =>
  currentSurface().createSurface(name, options);
export const createSurfaceSplit = (
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
  options?: SurfaceOptions,
): string => currentSurface().createSurfaceSplit(name, direction, fromSurface, options);
export const sendCommand = (surface: string, command: string): void =>
  currentSurface().sendCommand(surface, command);
export const sendLongCommand = (
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string => currentSurface().sendLongCommand(surface, command, options);
export const readScreen = (surface: string, lines?: number): string =>
  currentSurface().readScreen(surface, lines);
export const readScreenAsync = (surface: string, lines?: number): Promise<string> =>
  currentSurface().readScreenAsync(surface, lines);
export const closeSurface = (surface: string): void => currentSurface().closeSurface(surface);
export const closeTabForPane = (paneId: string): void => currentSurface().closeTabForPane(paneId);
export const pollForExit = (
  surface: string,
  signal: AbortSignal,
  options: Parameters<typeof tmux.pollForExit>[2],
): Promise<PollResult> => currentSurface().pollForExit(surface, signal, options);
export const probePaneAgent = (
  paneId: string,
  signal?: AbortSignal,
): Promise<herdr.PaneAgentProbe> => currentSurface().probePaneAgent(paneId, signal);

/** Shell quoting is identical on every surface; no dispatch needed. */
export const shellEscape = tmux.shellEscape;

/** Readiness and prompt submission follow the selected surface: Rex reads
 *  OSC 7501 program status, Herdr reads its agent registry. */
export const waitForAgentReady = (
  surface: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<void> =>
  selectSurface() === "rex"
    ? rex.waitForAgentReady(surface, signal, timeoutMs)
    : herdr.waitForAgentReady(surface, signal, timeoutMs);
export const sendAgentPrompt = (surface: string, prompt: string): void =>
  selectSurface() === "rex"
    ? rex.sendAgentPrompt(surface, prompt)
    : herdr.sendAgentPrompt(surface, prompt);

/**
 * Adoption validation, dispatched to the active surface. Herdr and Rex both
 * drive an existing pane/block; tmux has no adoption path.
 */
export function assertAdoptablePane(paneId: string, expectCwd: string): void {
  const kind = selectSurface();
  if (kind === "rex") return rex.assertAdoptablePane(paneId, expectCwd);
  if (kind === "herdr") return herdr.assertAdoptablePane(paneId, expectCwd);
  throw new Error("Pane adoption requires Herdr or Rex; this session runs on another surface");
}

/**
 * Create a dedicated session for a worktree — a Rex-only concept. Herdr gets
 * its worktree session from `herdr worktree create`, and tmux has none, so
 * both return null and the caller falls back to a plain surface.
 */
export function createWorktreeSession(
  label: string,
  cwd: string,
): { session: string; pane: string } | null {
  return selectSurface() === "rex" ? rex.createSession(label, cwd) : null;
}

export async function withNewSurface<T>(
  name: string,
  use: (surface: string) => Promise<T>,
  options?: SurfaceOptions,
): Promise<T> {
  const created = createSurface(name, options);
  try {
    return await use(created);
  } catch (error) {
    try { closeSurface(created); } catch {}
    throw error;
  }
}

export const __pollForExitTest__ = herdr.__pollForExitTest__;

/** Wait bounds for the exit poller and the index.ts watcher. Pure env
 *  resolution (no surface behavior), so the herdr implementation is
 *  re-exported directly — every surface carries the identical contract. */
export const getSubagentPollBounds = herdr.getSubagentPollBounds;
export type SubagentPollBounds = herdr.SubagentPollBounds;
/** Durable-run inactivity bound (PI_SUBAGENT_STALL_MS, default 20 min). */
export const getSubagentStallMs = herdr.getSubagentStallMs;

/** Which surface is active — exposed for diagnostics/tests. Resolved per
 *  call, like every other accessor here. */
export const activeSurface = (): SurfaceKind => selectSurface();
