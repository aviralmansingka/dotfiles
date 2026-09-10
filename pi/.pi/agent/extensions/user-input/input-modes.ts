// Tab switches between choosing an answer and typing guidance for the agent.
export type InputMode = "answer" | "steering";

export const INPUT_MODES: InputMode[] = ["answer", "steering"];

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
	}
}
