/**
 * Surface dispatcher — selects shared tmux/Herdr/Rex pane operations at module
 * load time and exposes Herdr-only helpers for readiness-gated launches.
 *
 * Selection order (first match wins):
 *   1. tmux (`$TERM` is a tmux/screen entry) — TERM names the *innermost*
 *      mux, so tmux running inside a Rex block must still split with tmux.
 *   2. Rex    — `REX_SESSION` + `REX_BLOCK` set and `rex` on PATH.
 *   3. Herdr  — `HERDR_ENV=1`, `HERDR_PANE_ID` set, `herdr` on PATH.
 *   4. tmux   — `TMUX` set and `tmux` on PATH (non-tmux TERM).
 *   5. neither — `isMuxAvailable()` returns false and `muxSetupHint()` tells
 *                the caller how to start a supported multiplexer.
 *
 * index.ts imports this module instead of ./tmux.ts directly. Shared surface
 * symbols match ./tmux.ts; readiness and prompt submission are Herdr-only.
 */
import * as tmux from "./tmux.ts";
import * as herdr from "./herdr.ts";
import * as rex from "./rex.ts";

export type PollResult = herdr.PollResult;

/** tmux sets TERM to a `tmux-*`/`screen-*` entry inside its panes. */
function termIsTmux(): boolean {
  return /^(tmux|screen)/.test(process.env.TERM ?? "");
}

const useTmuxInner = termIsTmux() && tmux.isTmuxAvailable();
const useRex = !useTmuxInner && rex.isRexAvailable();
const useHerdr = !useTmuxInner && !useRex && herdr.isHerdrAvailable();
const useTmux = !useTmuxInner && !useRex && !useHerdr && tmux.isTmuxAvailable();

const surface =
  useTmuxInner || useTmux ? tmux : useRex ? rex : useHerdr ? herdr : herdr;

/** True when any supported multiplexer surface is available. */
export const isMuxAvailable = (): boolean =>
  useTmuxInner || useRex || useHerdr || useTmux;

/** Human-readable hint for starting a supported multiplexer. */
export function muxSetupHint(): string {
  if (useTmuxInner || useTmux) return tmux.muxSetupHint();
  if (useRex) return rex.muxSetupHint();
  if (useHerdr) return herdr.muxSetupHint();
  // None available: name every supported surface so the hint is actionable
  // whichever terminal the captain actually uses.
  return `${rex.muxSetupHint()} ${herdr.muxSetupHint()} Or start pi inside tmux (\`tmux new -A -s pi 'pi'\`).`;
}

export const createSurface = surface.createSurface;
export const createSurfaceSplit = surface.createSurfaceSplit;
export const sendCommand = surface.sendCommand;
export const sendLongCommand = surface.sendLongCommand;
export const readScreen = surface.readScreen;
export const readScreenAsync = surface.readScreenAsync;
export const closeSurface = surface.closeSurface;
export const closeTabForPane = surface.closeTabForPane;

export const waitForAgentReady = herdr.waitForAgentReady;
export const sendAgentPrompt = herdr.sendAgentPrompt;
export const assertAdoptablePane = herdr.assertAdoptablePane;

export async function withNewSurface<T>(
  name: string,
  use: (surface: string) => Promise<T>,
): Promise<T> {
  const created = createSurface(name);
  try {
    return await use(created);
  } catch (error) {
    try { closeSurface(created); } catch {}
    throw error;
  }
}

export const shellEscape = surface.shellEscape;
export const pollForExit = surface.pollForExit;
export const probePaneAgent = surface.probePaneAgent;
export type PaneAgentProbe = herdr.PaneAgentProbe;
export const __pollForExitTest__ = surface.__pollForExitTest__;

/** Wait bounds for the exit poller and the index.ts watcher. Pure env
 *  resolution (no surface behavior), so the herdr implementation is
 *  re-exported directly — every surface carries the identical contract. */
export const getSubagentPollBounds = herdr.getSubagentPollBounds;
export type SubagentPollBounds = herdr.SubagentPollBounds;

/** Which surface is active — exposed for diagnostics/tests. */
export const activeSurface: "herdr" | "rex" | "tmux" | "none" =
  useTmuxInner || useTmux ? "tmux" : useRex ? "rex" : useHerdr ? "herdr" : "none";
