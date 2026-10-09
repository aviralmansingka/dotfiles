/**
 * Blank hidden-thinking label.
 *
 * Pi's default hidden-thinking row shows the wordy "Thinking..." label.
 * With hideThinkingBlock on, the user wants no thinking indicator at all:
 * no glyph, no word, no ellipsis. Set the label to an empty string so the
 * hidden row renders blank. The row stays clickable and Ctrl+T still
 * expands it for inspection. Headless and RPC surfaces stub
 * setHiddenThinkingLabel as a no-op, so the call is safe in every mode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Empty string: survives the `??` default reset, renders no text. */
export const HIDDEN_THINKING_LABEL = "";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL);
	});
}
