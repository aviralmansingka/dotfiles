import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MOBILE_PROMPT = [
	"",
	"## MOBILE MODE ACTIVE",
	"",
	"You are responding on a mobile terminal that is 50 columns wide and 21 rows tall.",
	"Your entire response MUST fit within that viewport.",
	"",
	"Rules:",
	"- Keep every line at most 50 characters.",
	"- Keep the total response at most 21 lines (including blank lines and code blocks).",
	"- Use short, dense prose. No filler. No preamble.",
	"- If the answer needs more than 26 lines, give a ONE-sentence summary instead.",
	"  That single sentence must capture the key point and fit on one line (≤50 chars).",
	"- Prefer code blocks only when essential; keep them tiny.",
	"",
].join("\n");

export default function (pi: ExtensionAPI) {
	let mobile = false;

	pi.registerCommand("mobile", {
		description: "Toggle mobile mode — constrains responses to 50×21",
		handler: async (_args, ctx) => {
			mobile = !mobile;
			ctx.ui.notify(
				mobile ? "Mobile mode ON — responses constrained to 50×21" : "Mobile mode OFF",
				"info",
			);
		},
	});

	pi.on("before_agent_start", (event, _ctx) => {
		if (!mobile) return undefined;
		return {
			systemPrompt: event.systemPrompt + MOBILE_PROMPT,
		};
	});
}
