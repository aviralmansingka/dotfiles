import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "explain-grader-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
// explain now imports md-log (journal shortcut), which imports nvim-open and
// focus-buffer — stub its peer deps too (house pattern from md-log.test.mjs).
// The h-shortcut path calls the focus buffers; hard-off so a machine WITH a
// live herdr/nvim (the homelab) can never receive test writes.
process.env.PI_DISABLE_FOCUS_BUFFER = "1";
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; }
	getText() { return this.text; }
	handleInput(data) { this.text += data; }
	render() { return [this.text]; }
	invalidate() {}
}
exports.Editor = Editor;
exports.Key = { enter: "\\r", escape: "\\x1b" };
exports.Loader = class Loader { start() {} stop() {} render() { return ["grading"]; } };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
exports.wrapTextWithAnsi = text => [text];
`);
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const { default: registerExplain } = jiti("./explain.ts");
let explainTool;
registerExplain({ registerTool(tool) { explainTool = tool; } });
assert.equal(explainTool?.name, "explain");
assert.ok(
	explainTool.promptGuidelines.some((guideline) =>
		guideline.includes("press `h` while the answer field is empty or in the verdict phase") &&
		guideline.includes("`H` (Shift+H) opens the full journal")
	),
	"generated explain guidance should describe both lesson shortcuts",
);

const calls = [];
const notifications = [];
let component;
let renderRequests = 0;
const rendered = {};
const gradingJson = JSON.stringify({
	verdict: "correct",
	grade: "A",
	summary: "All required claims are present.",
	correctAnswer: "Occupancy counts resident warps.",
	refinements: [],
});
const ctx = {
	hasUI: true,
	model: { provider: "session", id: "slow-model" },
	modelRegistry: {
		find(provider, id) {
			if (provider === "fireworks" && [
				"glm-fast-latest",
				"accounts/fireworks/routers/glm-5p3-fast",
			].includes(id)) return { provider, id };
			return undefined;
		},
		hasConfiguredAuth: () => true,
		async complete(model, prompt, options) {
			calls.push({ model, prompt, options });
			return { content: [{ type: "text", text: gradingJson }] };
		},
	},
	ui: {
		notify(message, level) {
			notifications.push({ message, level });
		},
		custom(factory) {
			return new Promise((done) => {
				const tui = {
					requestRender() {
						renderRequests++;
						if (renderRequests === 1) rendered.grading = component.render(120).join("\n");
						if (renderRequests === 2) {
							rendered.verdict = component.render(120).join("\n");
							queueMicrotask(() => {
								component.handleInput("h");
								component.handleInput("\r");
							});
						}
					},
				};
				const theme = { fg: (_color, text) => text, bold: (text) => text };
				component = factory(tui, theme, {}, done);
				rendered.empty = component.render(120).join("\n");
				component.handleInput("shift+h");
				component.handleInput("h");
				component.handleInput(" ");
				component.handleInput("h");
				component.handleInput("Occupancy counts resident warps.");
				rendered.composing = component.render(120).join("\n");
				component.handleInput("\r");
				component.handleInput("shift+h");
			});
		},
	},
};

const signal = new AbortController().signal;
const result = await explainTool.execute(
	"grader-regression",
	{
		question: "What does occupancy count?",
		expected: "Occupancy counts resident warps, not currently executing warps.",
	},
	signal,
	undefined,
	ctx,
);

assert.equal(calls.length, 1);
assert.deepEqual(calls[0].model, {
	provider: "fireworks",
	id: "accounts/fireworks/routers/glm-5p3-fast",
});
assert.equal(calls[0].options.signal, signal);
assert.equal(calls[0].options.maxTokens, 800);
assert.equal(calls[0].options.reasoningEffort, "low");
assert.ok(!Object.hasOwn(calls[0].options, "reasoning"));
assert.match(calls[0].prompt.messages[0].content, /Learner's answer \(their own words\):\nhOccupancy/);
assert.equal(notifications.filter(({ message }) => message === "Opening lesson journal…").length, 2);
assert.equal(notifications.filter(({ message }) => message === "Opening current node…").length, 2);
assert.match(rendered.empty, /h \(empty\) — node · H — journal/);
assert.match(rendered.composing, /hOccupancy counts resident warps\./);
assert.match(rendered.grading, /H — journal · Esc — abort grading/);
assert.match(rendered.verdict, /Enter — continue · h — node · H — journal/);
assert.equal(result.details.grading.verdict, "correct");
assert.match(result.content[0].text, /Grader verdict: CORRECT/);

rmSync(tempRoot, { recursive: true, force: true });
if (process.env.EXPLAIN_TEST_EVIDENCE === "1") {
	console.log([
		"EMPTY ANSWER — bare h opened the node view, Shift+H the journal, without changing the answer:",
		rendered.empty,
		"",
		"COMPOSING — printable h stayed in the answer:",
		rendered.composing,
		"",
		"GRADING — Shift+H remained available:",
		rendered.grading,
		"",
		"VERDICT — bare h opened the node view:",
		rendered.verdict,
	].join("\n"));
}
console.log("explain shortcut and grader regression passed");
