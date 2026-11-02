/**
 * Chrome extension for pi: drive a local Chrome over the DevTools protocol.
 * Works on macOS and Linux. Chrome runs on a dedicated profile (default ~/.chrome-agent).
 */

import { writeFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PORT, evaluate, launch, pages, send, shotPath } from "./cdp.ts";

const Index = Type.Optional(
	Type.Number({ description: "Page index from chrome_tabs. Defaults to 0." }),
);

async function settle(index: number, timeoutMs = 10000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const state = await evaluate("document.readyState", index);
			if (state === "complete") break;
		} catch {
			// page may be mid-navigation; keep polling
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	const info = await evaluate("document.title + '\\n' + location.href", index);
	const [title, url] = String(info).split("\n");
	return { title, url };
}

const launchTool = defineTool({
	name: "chrome_launch",
	label: "Launch Chrome",
	description:
		"Start local Chrome with the agent profile and a DevTools port. No-op when already running. " +
		"Use headless on machines without a display.",
	parameters: Type.Object({
		headless: Type.Optional(Type.Boolean({ description: "Run without a window." })),
		url: Type.Optional(Type.String({ description: "Page to open on start." })),
	}),
	annotations: { openWorldHint: true },
	async execute(_id, params: any) {
		const r = await launch({ headless: params.headless, url: params.url });
		const tabs = await pages(r.port);
		const text = r.started
			? `Started Chrome: ${r.binary}\nprofile ${r.profile}\nport ${r.port}${r.headless ? " (headless)" : ""}`
			: `Chrome already running on port ${r.port}, profile ${r.profile}`;
		return {
			content: [{ type: "text", text: `${text}\n${tabs.length} page(s) open.` }],
			details: { ...r, tabs: tabs.length },
		};
	},
});

const tabsTool = defineTool({
	name: "chrome_tabs",
	label: "List Chrome tabs",
	description: "List open pages with their index, title and URL.",
	parameters: Type.Object({}),
	annotations: { readOnlyHint: true },
	async execute() {
		const list = await pages();
		if (!list.length) {
			return { content: [{ type: "text", text: "No pages. Run chrome_launch or chrome_open." }], details: undefined };
		}
		const text = list.map((p, i) => `${i}  ${p.title || "(untitled)"}\n   ${p.url}`).join("\n");
		return {
			content: [{ type: "text", text }],
			details: { pages: list.map(({ title, url }) => ({ title, url })) },
		};
	},
});

const openTool = defineTool({
	name: "chrome_open",
	label: "Open URL",
	description: "Navigate the page at an index, or open a new tab, and wait for the load.",
	parameters: Type.Object({
		url: Type.String({ description: "URL to open." }),
		newTab: Type.Optional(Type.Boolean({ description: "Open in a new tab instead of the current one." })),
		index: Index,
	}),
	annotations: { openWorldHint: true },
	async execute(_id, params: any) {
		const index = params.index ?? 0;
		if (params.newTab) {
			const res = await fetch(
				`http://127.0.0.1:${DEFAULT_PORT}/json/new?${encodeURIComponent(params.url)}`,
				{ method: "PUT" },
			);
			if (!res.ok) throw new Error(`Could not open tab: ${res.status}`);
			const list = await pages();
			const at = list.length - 1;
			const info = await settle(at);
			return {
				content: [{ type: "text", text: `Tab ${at}: ${info.title}\n${info.url}` }],
				details: { index: at, ...info },
			};
		}
		await send("Page.navigate", { url: params.url }, index);
		const info = await settle(index);
		return {
			content: [{ type: "text", text: `${info.title}\n${info.url}` }],
			details: { index, ...info },
		};
	},
});

const evalTool = defineTool({
	name: "chrome_eval",
	label: "Evaluate JS",
	description:
		"Run a JavaScript expression in the page and return its value. Waits for promises. " +
		"This is the escape hatch for anything the other chrome tools do not cover.",
	parameters: Type.Object({
		expression: Type.String({ description: "JavaScript expression with a return value." }),
		index: Index,
	}),
	annotations: { openWorldHint: true },
	async execute(_id, params: any) {
		const index = params.index ?? 0;
		const value = await evaluate(params.expression, index);
		const text =
			value === undefined ? "(no value)" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
		return { content: [{ type: "text", text: String(text).slice(0, 20000) }], details: { index } };
	},
});

const clickTool = defineTool({
	name: "chrome_click",
	label: "Click element",
	description: "Click an element by CSS selector or by exact visible text. Scrolls it into view first.",
	parameters: Type.Object({
		selector: Type.Optional(Type.String({ description: "CSS selector." })),
		text: Type.Optional(Type.String({ description: "Visible text of a link, button or label." })),
		index: Index,
	}),
	annotations: { openWorldHint: true, destructiveHint: true },
	async execute(_id, params: any) {
		const index = params.index ?? 0;
		if (!params.selector && !params.text) throw new Error("Give a selector or text.");
		const expr = `(() => {
  const q = 'a,button,[role="button"],[role="link"],input[type="submit"],input[type="button"],label,summary';
  let el = ${params.selector ? `document.querySelector(${JSON.stringify(params.selector)})` : "null"};
  if (!el && ${JSON.stringify(params.text ?? "")}) {
    const want = ${JSON.stringify(params.text ?? "")}.trim();
    const items = [...document.querySelectorAll(q)];
    el = items.find(e => (e.textContent || "").trim() === want)
      || items.find(e => (e.textContent || "").trim().includes(want));
  }
  if (!el) return { ok: false, reason: "element not found" };
  el.scrollIntoView({ block: "center", inline: "center" });
  el.click();
  return { ok: true, tag: el.tagName.toLowerCase(), label: (el.textContent || el.value || "").trim().slice(0, 80) };
})()`;
		const r = await evaluate(expr, index);
		if (!r?.ok) throw new Error(`Click failed: ${r?.reason ?? "element not found"}`);
		return {
			content: [{ type: "text", text: `Clicked <${r.tag}> ${r.label}` }],
			details: { index, ...r },
		};
	},
});

const typeTool = defineTool({
	name: "chrome_type",
	label: "Type text",
	description:
		"Focus a field and insert text as real keyboard input, so frameworks see the change. " +
		"Optionally press Enter.",
	parameters: Type.Object({
		selector: Type.Optional(Type.String({ description: "CSS selector. Omit to type into the focused element." })),
		text: Type.String({ description: "Text to insert." }),
		submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
		index: Index,
	}),
	annotations: { openWorldHint: true, destructiveHint: true },
	async execute(_id, params: any) {
		const index = params.index ?? 0;
		if (params.selector) {
			const focused = await evaluate(
				`(() => { const el = document.querySelector(${JSON.stringify(params.selector)});
				  if (!el) return false; el.focus(); el.click(); return document.activeElement === el; })()`,
				index,
			);
			if (!focused) throw new Error(`Could not focus ${params.selector}`);
		}
		await send("Input.insertText", { text: params.text }, index);
		if (params.submit) {
			const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
			await send("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...key }, index);
			await send("Input.dispatchKeyEvent", { type: "keyUp", ...key }, index);
		}
		return {
			content: [{ type: "text", text: `Typed ${params.text.length} characters${params.submit ? " and pressed Enter" : ""}.` }],
			details: { index },
		};
	},
});

const shotTool = defineTool({
	name: "chrome_screenshot",
	label: "Screenshot",
	description: "Capture the page as a PNG and return the image plus its file path.",
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
	pi.registerTool(tabsTool);
	pi.registerTool(openTool);
	pi.registerTool(evalTool);
	pi.registerTool(clickTool);
	pi.registerTool(typeTool);
	pi.registerTool(shotTool);
}
