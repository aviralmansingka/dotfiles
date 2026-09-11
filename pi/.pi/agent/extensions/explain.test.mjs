import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath =
	process.env.JITI_PATH ||
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "explain-grader-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubAgent, "");
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
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const { default: registerExplain } = jiti("./explain.ts");
let explainTool;
registerExplain({ registerTool(tool) { explainTool = tool; } });
assert.equal(explainTool?.name, "explain");

const calls = [];
let component;
let renderRequests = 0;
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
		custom(factory) {
			return new Promise((done) => {
				const tui = {
					requestRender() {
						renderRequests++;
						if (renderRequests === 2) queueMicrotask(() => component.handleInput("\r"));
					},
				};
				const theme = { fg: (_color, text) => text, bold: (text) => text };
				component = factory(tui, theme, {}, done);
				component.handleInput("Occupancy counts resident warps.");
				component.handleInput("\r");
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
assert.equal(result.details.grading.verdict, "correct");
assert.match(result.content[0].text, /Grader verdict: CORRECT/);

rmSync(tempRoot, { recursive: true, force: true });
console.log("explain grader regression passed");
