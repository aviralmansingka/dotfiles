/**
 * Hidden-thinking marker glyph.
 *
 * Pi's default hidden-thinking label is the wordy "Thinking...". Replace it
 * with a single dim glyph so a hidden thinking run only marks where thinking
 * happened. This is uniform across models: models that title their reasoning
 * (Astra writes a bold first line) and models that write plain prose collapse
 * to the same marker. The row stays clickable, and Ctrl+T still toggles
 * visibility for inspection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Single glyph; the theme paints it with the dim italic thinkingText style. */
export const HIDDEN_THINKING_GLYPH = "…";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_GLYPH);
	});
}
