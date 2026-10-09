/**
 * Blank hidden-thinking label.
 *
 * Pi's default hidden-thinking row shows the wordy "Thinking..." label.
 * With hideThinkingBlock on, the user wants no thinking indicator at all:
 * no glyph, no word, no newline. This extension sets the label to an empty
 * string; Text("") renders zero lines. The structural Spacer rows around a
 * hidden run come from pi's bundle — scripts/pi-patch-hidden-thinking
 * guards them out. Re-run that script after every `pi update`.
 * Headless and RPC surfaces stub setHiddenThinkingLabel as a no-op, so the
 * call is safe in every mode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Empty string: survives the `??` default reset, renders no text. */
export const HIDDEN_THINKING_LABEL = "";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL);
	});
}
