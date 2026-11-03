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

// Delivery mode for pi.sendUserMessage when Enter fires in the given mode, or
// undefined when Enter does not send a live message: note stays local and
// follow-up ends the quiz through the tool result instead.
export function inputModeDeliverAs(mode: InputMode): "steer" | undefined {
	return mode === "steering" ? "steer" : undefined;
}

// In-panel confirmation after a steer is sent. The send never closes the
// quiz, and the confirmation says so. Only steering sends live.
export function inputModeSentConfirmation(mode: InputMode): string | undefined {
	return mode === "steering" ? "Steer sent — the quiz stays open" : undefined;
}

// Per-mode hint row for the bottom of the panel, so the active mode and what
// Enter/Esc/Tab do in it are always visible before the captain types.
export function inputModeHint(mode: InputMode): string {
	switch (mode) {
		case "steering":
			return "type a steer • Enter send, quiz stays open • o open files • Tab note • Esc answer";
		case "note":
			return "type a note — sent with your answer • Enter keep + back to answers • Tab follow-up • Esc answer";
		case "follow-up":
			return "type guidance • Enter end quiz and send • Tab answer • Esc answer";
		default:
			return "";
	}
}
