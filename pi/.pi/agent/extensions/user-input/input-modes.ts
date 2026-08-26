// The three input modes the quiz panel cycles through with Tab while a quiz
// prompt is open. Extracted as a pure module so the cycling order is unit
// testable without spinning up the TUI.
//
// - steering: the options list is focused (arrows navigate, number keys +
//   Enter answer, `o` opens context files). The quiz question stays visible
//   and the quiz is never removed in this mode.
// - note: the always-present note editor is focused (the "I don't know" /
//   commentary free-text that attaches to the eventual answer).
// - follow-up: a follow-up editor is focused; submitting it ends the quiz and
//   returns the follow-up message to the agent.
export type InputMode = "steering" | "note" | "follow-up";

// Display order == Tab cycle order.
export const INPUT_MODES: InputMode[] = ["steering", "note", "follow-up"];

export function nextInputMode(mode: InputMode): InputMode {
	const i = INPUT_MODES.indexOf(mode);
	if (i < 0) return INPUT_MODES[0];
	return INPUT_MODES[(i + 1) % INPUT_MODES.length];
}

export function inputModeLabel(mode: InputMode): string {
	switch (mode) {
		case "steering":
			return "Steering";
		case "note":
			return "Note";
		case "follow-up":
			return "Follow-up";
	}
}
