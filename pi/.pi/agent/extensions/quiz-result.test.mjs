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
const tempRoot = mkdtempSync(join(tmpdir(), "quiz-result-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubAgent, "exports.defineTool = (tool) => tool;\n");
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
exports.Key = {
	enter: "enter",
	escape: "escape",
	up: "up",
	down: "down",
	space: "space",
	tab: "tab",
	ctrl: (key) => "ctrl-" + key,
};
exports.Text = class Text {};
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = (text) => text.length;
exports.wrapTextWithAnsi = (text) => [text];
`);

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const { default: registerQuiz } = jiti("./quiz.ts");
let quizTool;
registerQuiz({ registerTool(tool) { quizTool = tool; } });
assert.equal(quizTool?.name, "quiz");

const theme = { fg: (_color, text) => text, bold: (text) => text };
function contextFor(inputs) {
	return {
		hasUI: true,
		ui: {
			custom(factory) {
				return new Promise((done) => {
					const component = factory({ requestRender() {} }, theme, {}, done);
					for (const input of inputs) component.handleInput(input);
				});
			},
		},
	};
}

const params = {
	title: "Node A — result metadata",
	question: "Which option is correct?",
	options: [
		{ label: "First", value: "first" },
		{ label: "Second", value: "second" },
	],
	correctAnswer: "first",
	explanation: "The first option is correct.",
	shuffle: false,
};
const signal = new AbortController().signal;

const answered = await quizTool.execute(
	"answered-result",
	params,
	signal,
	undefined,
	contextFor(["enter", "enter"]),
);
assert.equal(answered.details.status, "answered");
assert.equal(answered.details.title, params.title);
assert.equal(answered.details.correct, true);
assert.equal(answered.details.dontKnow, false);
assert.equal(answered.details.followUp, undefined);

const tooHard = await quizTool.execute(
	"too-hard-result",
	params,
	signal,
	undefined,
	contextFor(["ctrl-p"]),
);
assert.equal(tooHard.details.status, "too-hard");
assert.equal(tooHard.details.title, params.title);
assert.equal(tooHard.details.dontKnow, undefined);
assert.equal(tooHard.details.followUp, undefined);

rmSync(tempRoot, { recursive: true, force: true });
console.log("quiz result tests passed");
