/**
 * Chrome extension for pi: drive a local Chrome over the DevTools protocol.
 * Works on macOS and Linux. Chrome runs on a dedicated profile (default ~/.chrome-agent).
 */

import { writeFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { launch, pages, send, evaluate, shotPath } from "./cdp.ts";

const Index = Type.Optional(
	Type.Number({ description: "Page index from chrome_launch. Defaults to 0." }),
);

const launchTool = defineTool({
	name: "chrome_launch",
	label: "Launch Chrome",
	description:
		"Start local Chrome on the agent profile with a DevTools port, then list the open pages with their index. " +
		"No-op when Chrome already listens. Use headless on machines with no display. Call this first.",
	parameters: Type.Object({
		headless: Type.Optional(Type.Boolean({ description: "Run without a window." })),
		url: Type.Optional(Type.String({ description: "Page to open on start." })),
	}),
	annotations: { openWorldHint: true },
	async execute(_id, params: any) {
		const r = await launch({ headless: params.headless, url: params.url });
		const tabs = await pages(r.port);
		const head = r.started
			? `Started Chrome: ${r.binary}\nprofile ${r.profile}\nport ${r.port}${r.headless ? " (headless)" : ""}`
			: `Chrome already running on port ${r.port}, profile ${r.profile}`;
		const list = tabs.length
			? tabs.map((p, i) => `${i}  ${p.title || "(untitled)"}\n   ${p.url}`).join("\n")
			: "No pages open.";
		return {
			content: [{ type: "text", text: `${head}\n\n${list}` }],
			details: { ...r, pages: tabs.map(({ title, url }) => ({ title, url })) },
		};
	},
});

const evalTool = defineTool({
	name: "chrome_eval",
	label: "Evaluate JS",
	description:
		"Run a JavaScript expression in the page and return its value. Awaits promises. " +
		"Use it to navigate (`location.href = 'https://x'`), read text, click (`el.click()`), " +
		"or type. For React inputs, set the value with the native setter, then dispatch an input event.",
	parameters: Type.Object({
		expression: Type.String({ description: "JavaScript expression with a return value." }),
		index: Index,
	}),
	annotations: { openWorldHint: true },
	async execute(_id, params: any) {
		const index = params.index ?? 0;
		const value = await evaluate(params.expression, index);
		const text =
			value === undefined
				? "(no value)"
				: typeof value === "string"
					? value
					: JSON.stringify(value, null, 2);
		return {
			content: [{ type: "text", text: String(text).slice(0, 20000) }],
			details: { index },
		};
	},
});

const shotTool = defineTool({
	name: "chrome_screenshot",
	label: "Screenshot",
	description: "Capture the page as a PNG. Returns the image and the file path.",
	parameters: Type.Object({
		path: Type.Optional(Type.String({ description: "File path. Defaults to a temp file." })),
		fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole page, not just the viewport." })),
		index: Index,
	}),
	annotations: { readOnlyHint: true },
	async execute(_id, params: any) {
		const index = params.index ?? 0;
		const out = params.path || shotPath();
		const cap = await send(
			"Page.captureScreenshot",
			{ format: "png", captureBeyondViewport: Boolean(params.fullPage) },
			index,
		);
		writeFileSync(out, Buffer.from(cap.data, "base64"));
		const bytes = Math.round((cap.data.length * 3) / 4);
		const content: any[] = [{ type: "text", text: `${out} (${Math.round(bytes / 1024)} KB)` }];
		if (bytes < 4_000_000) content.push({ type: "image", data: cap.data, mimeType: "image/png" });
		return { content, details: { path: out, bytes } };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(launchTool);
	pi.registerTool(evalTool);
	pi.registerTool(shotTool);
}
