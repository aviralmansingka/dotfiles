import type { OverlayOptions } from "@earendil-works/pi-tui";

/**
 * Overlay placement shared by every learner-facing question panel
 * (ask_user_question, quiz, explain, run-command).
 *
 * Without `overlay: true`, `ctx.ui.custom()` hands the panel the entire
 * interactive area — the transcript underneath is unmounted, so the lesson
 * text the learner needs to read to answer the question disappears for the
 * duration of the prompt. Overlay mode composites the panel above the mounted
 * transcript instead of replacing it.
 *
 * Top-anchored, full-width: the panel hangs from the top row and the freshest
 * transcript content plus the editor stay visible below it.
 */
export const QUESTION_PANEL_OVERLAY = {
	overlay: true,
	overlayOptions: {
		anchor: "top-center",
		width: "100%",
	} satisfies OverlayOptions,
} as const;

// This module lives in ~/.pi/agent/extensions/, where pi auto-loads every
// file as an extension. It is a shared constant, not an extension, so
// export a no-op factory to satisfy the extension loader.
export default function () {}
