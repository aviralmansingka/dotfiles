// Tab cycles the quiz panel's input modes. `answer` is the option-selection
// state; the other three own the bottom input box:
//   steering  — Enter sends the text to the agent as a steer; the quiz stays
//               open and the question is never removed
//   note      — the text is kept locally and rides with the eventual answer
//               (the note-field semantics for "I don't know" and every other
//               answer); the quiz stays open
//   follow-up — Enter ends the quiz and returns the text as followUp
//               guidance for the agent
export type InputMode = "answer" | "steering" | "note" | "follow-up";

export const INPUT_MODES: InputMode[] = ["answer", "steering", "note", "follow-up"];

export function nextInputMode(mode: InputMode): InputMode {
	const i = INPUT_MODES.indexOf(mode);
	if (i < 0) return INPUT_MODES[0];
	return INPUT_MODES[(i + 1) % INPUT_MODES.length];
}

export function inputModeLabel(mode: InputMode): string {
	switch (mode) {
		case "answer":
			return "Answer";
		case "steering":
			return "Steering";
		case "note":
			return "Note";
		case "follow-up":
			return "Follow-up";
	}
}

// Modes where the bottom input box owns the keyboard (everything but answer).
export function isInputBoxMode(mode: InputMode): boolean {
	return mode !== "answer";
}

// Per-mode hint row for the bottom of the panel, so the active mode and what
// Enter/Esc/Tab do in it are always visible before the captain types. The
// steering hint only advertises `o` when the quiz actually has context files
// to open.
export function inputModeHint(mode: InputMode, hasContextFiles = false): string {
	switch (mode) {
		case "steering":
			return hasContextFiles
				? "type a steer • Enter send, quiz stays open • o open files • Tab note • Esc answer"
				: "type a steer • Enter send, quiz stays open • Tab note • Esc answer";
		case "note":
			return "type a note — sent with your answer • Enter keep + back to answers • Tab follow-up • Esc answer";
		case "follow-up":
			return "type guidance • Enter end quiz and send • Tab answer • Esc answer";
		default:
			return "";
	}
}
