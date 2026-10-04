import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);

// Peer packages are stubbed the same way explain.test.mjs stubs them: the
// lesson tool's logic is what's under test, not pi-tui rendering.
const tempRoot = mkdtempSync(join(tmpdir(), "lesson-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(
	stubAgent,
	"exports.getMarkdownTheme = () => ({ heading: (t) => t, link: (t) => t, linkUrl: (t) => t, code: (t) => t, codeBlock: (t) => t, codeBlockBorder: (t) => t, quote: (t) => t, quoteBorder: (t) => t, listMarker: (t) => t, hr: (t) => t, tableBorder: (t) => t });\n",
);
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTui, `
class Markdown {
	constructor(text) { this.text = text; }
	render(width) { return this.text.split("\\n"); }
	invalidate() {}
}
class Text {
	constructor(text) { this.text = text; }
	render() { return this.text.split("\\n"); }
	invalidate() {}
}
class Container {
	constructor() { this.children = []; }
	addChild(child) { this.children.push(child); }
	render(width) { return this.children.flatMap((child) => child.render(width)); }
	invalidate() { for (const child of this.children) child.invalidate(); }
}
exports.Markdown = Markdown;
exports.Text = Text;
exports.Container = Container;
exports.Key = { enter: "\\r", escape: "\\x1b", up: "up", down: "down", pageUp: "pageUp", pageDown: "pageDown", home: "home", end: "end" };
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => String(text).slice(0, width);
exports.visibleWidth = (text) => String(text).length;
`);

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const extension = jiti("./lesson.ts").default;

// Register the tool against a fake pi and capture the registration.
const registered = [];
const pi = {
	registerTool(def) {
		registered.push(def);
	},
};
extension(pi);

assert.equal(registered.length, 1, "lesson should register exactly one tool");
const tool = registered[0];
assert.equal(tool.name, "lesson");
assert.equal(typeof tool.execute, "function");
assert.equal(typeof tool.renderCall, "function");
assert.equal(typeof tool.renderResult, "function");
assert.ok(tool.description.length > 40, "description should be substantive");
assert.ok(tool.promptGuidelines.length >= 3, "should carry usage guidelines");

// The shared UI lock must use the SAME globalThis key as quiz/explain, so
// the lesson panel serializes against every other pop-up tool.
assert.ok(
	"__piSharedUiLock" in globalThis,
	"lesson must install the shared __piSharedUiLock mutex",
);

// RPC advertises UI but cannot mount terminal custom components.
const noUi = await tool.execute(
	"id",
	{ title: "T", body: "B" },
	undefined,
	undefined,
	{ mode: "rpc", hasUI: true },
);
assert.equal(noUi.details.status, "unavailable");
assert.equal(noUi.details.title, "T");

// Aborted before display → cancelled.
const aborted = new AbortController();
aborted.abort();
const abortedResult = await tool.execute(
	"id",
	{ title: "T", body: "B" },
	aborted.signal,
	undefined,
	{ mode: "tui", hasUI: true },
);
assert.equal(abortedResult.details.status, "cancelled");

let releaseBlockingLesson;
const blockingLesson = tool.execute(
	"blocking",
	{ title: "Blocking", body: "B" },
	undefined,
	undefined,
	{
		mode: "tui",
		ui: {
			custom: () => new Promise((resolve) => {
				releaseBlockingLesson = resolve;
			}),
		},
	},
);
await Promise.resolve();
let queuedPanelMounted = false;
const queuedAbort = new AbortController();
const queuedLesson = tool.execute(
	"queued",
	{ title: "Queued", body: "B" },
	queuedAbort.signal,
	undefined,
	{
		mode: "tui",
		ui: {
			custom: () => {
				queuedPanelMounted = true;
				return Promise.resolve(true);
			},
		},
	},
);
queuedAbort.abort();
releaseBlockingLesson(true);
await blockingLesson;
const queuedResult = await queuedLesson;
assert.equal(queuedResult.details.status, "cancelled");
assert.equal(queuedPanelMounted, false, "an aborted queued lesson must not mount its panel");

// Happy path: ui.custom resolves true → "read".
let sawOverlayOptions = null;
const ackCtx = {
	mode: "tui",
	hasUI: true,
	ui: {
		custom(factory, options) {
			sawOverlayOptions = options;
			const tui = { terminal: { rows: 12 }, requestRender() {} };
			const theme = {
				fg: (_token, text) => text,
				bold: (t) => t,
			};
			const component = factory(tui, theme, {}, () => {});
			const lines = component.render(80);
			assert.ok(lines.length > 3, "panel should render more than a frame");
			assert.ok(
				lines.some((l) => l.includes("Enter")),
				"panel should show the continue hint",
			);
			assert.ok(
				lines.some((l) => l.includes("blocked beats working")),
				"panel should render the markdown body",
			);
			return Promise.resolve(true);
		},
	},
};
const read = await tool.execute(
	"id",
	{ title: "Herdr states", body: "blocked beats working" },
	undefined,
	undefined,
	{ ...ackCtx, sessionManager: { getSessionFile: () => "/tmp/s/session-abc.jsonl" } },
);
assert.equal(read.details.status, "read");
assert.equal(read.details.title, "Herdr states");
assert.equal(read.details.journalPath, "/tmp/s/session-abc.md");
assert.ok(read.content[0].text.includes("acknowledged"));
assert.ok(
	read.content[0].text.includes("Journal: /tmp/s/session-abc.md"),
	`result should mention the journal path: ${read.content[0].text}`,
);
const renderedResult = tool.renderResult(read, {}, {
	fg: (_token, text) => text,
});
assert.ok(
	renderedResult.render(120).some((line) =>
		line.includes("[session-abc.md](file:///tmp/s/session-abc.md)"),
	),
	"visible result should contain a clickable journal link",
);
// The panel must mount as an overlay, not replace the transcript.
assert.deepEqual(sawOverlayOptions, {
	overlay: true,
	overlayOptions: { anchor: "top-center", width: "100%", maxHeight: "90%" },
});

let longLessonComponent;
const longBody = Array.from({ length: 20 }, (_, index) => `lesson line ${index + 1}`).join("\n");
await tool.execute(
	"id",
	{ title: "Long lesson", body: longBody },
	undefined,
	undefined,
	{
		mode: "tui",
		ui: {
			custom(factory) {
				longLessonComponent = factory(
					{ terminal: { rows: 12 }, requestRender() {} },
					{ fg: (_token, text) => text, bold: (text) => text },
					{},
					() => {},
				);
				return Promise.resolve(true);
			},
		},
	},
);
assert.ok(!longLessonComponent.render(80).some((line) => line.includes("lesson line 20")));
longLessonComponent.handleInput("end");
assert.ok(
	longLessonComponent.render(80).some((line) => line.includes("lesson line 20")),
	"long lessons must expose their final line through viewport navigation",
);

// Esc path: ui.custom resolves null → "cancelled".
const escCtx = {
	mode: "tui",
	hasUI: true,
	ui: { custom: () => Promise.resolve(null) },
};
const skipped = await tool.execute("id", { title: "T2", body: "B" }, undefined, undefined, escCtx);
assert.equal(skipped.details.status, "cancelled");

rmSync(tempRoot, { recursive: true, force: true });
console.log("lesson tests passed");
