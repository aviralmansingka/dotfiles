import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WAITING_LABEL = "Waiting for user input";

export default function herdrPromptState(pi: ExtensionAPI) {
	pi.on("ui_prompt_start", (event) => {
		pi.events.emit("herdr:blocked", {
			active: true,
			label: event.title?.trim() || WAITING_LABEL,
		});
	});

	pi.on("ui_prompt_end", () => {
		pi.events.emit("herdr:blocked", { active: false });
	});
}
