/**
 * Surface dispatcher — selects between the tmux and Herdr pane surfaces at
 * module load time, so the rest of the extension (index.ts) stays
 * multiplexer-agnostic and talks to a single surface contract.
 *
 * Selection order:
 *   1. Herdr  — when `HERDR_ENV=1`, `HERDR_PANE_ID` is set, and `herdr` is on PATH.
 *   2. tmux   — when `TMUX` is set and `tmux` is on PATH (the upstream surface).
 *   3. neither — `isMuxAvailable()` returns false and `muxSetupHint()` tells
 *                the caller how to start a supported multiplexer.
 *
 * index.ts imports this module instead of ./tmux.ts directly. Every symbol
 * re-exported here matches the ./tmux.ts export contract one-for-one.
 */
import * as tmux from "./tmux.ts";
import * as herdr from "./herdr.ts";

export type PollResult = herdr.PollResult;

const useHerdr = herdr.isHerdrAvailable();
const useTmux = !useHerdr && tmux.isTmuxAvailable();
const surface = useHerdr ? herdr : useTmux ? tmux : herdr; // default to herdr for hint when none available

/** True when any supported multiplexer surface is available. */
export const isMuxAvailable = (): boolean => useHerdr || useTmux;

/** Human-readable hint for starting a supported multiplexer. */
export function muxSetupHint(): string {
  if (useHerdr) return herdr.muxSetupHint();
  if (useTmux) return tmux.muxSetupHint();
  // Neither available: prefer the Herdr hint (captain's primary surface), but
  // mention tmux as the upstream alternative.
  return `${herdr.muxSetupHint()} Alternatively start pi inside tmux (\`tmux new -A -s pi 'pi'\`).`;
}

export const createSurface = surface.createSurface;
export const createSurfaceSplit = surface.createSurfaceSplit;
export const sendCommand = surface.sendCommand;
export const sendLongCommand = surface.sendLongCommand;
export const readScreen = surface.readScreen;
export const readScreenAsync = surface.readScreenAsync;
export const closeSurface = surface.closeSurface;
export const shellEscape = surface.shellEscape;
export const pollForExit = surface.pollForExit;
export const __pollForExitTest__ = surface.__pollForExitTest__;

/** Which surface is active — exposed for diagnostics/tests. */
export const activeSurface: "herdr" | "tmux" | "none" = useHerdr
  ? "herdr"
  : useTmux
    ? "tmux"
    : "none";
