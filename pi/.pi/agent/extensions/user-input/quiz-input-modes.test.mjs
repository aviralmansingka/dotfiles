import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath =
	process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);

// U2 — input-mode cycling inside the quiz panel. The quiz has two input
// modes: Answer (pick an option) and Steering (type guidance). Tab cycles
// them. Steering never eats the quiz: an empty submit does nothing, and a
// real submit ends the quiz with a follow-up result that both the agent and
// the transcript can see. Hermetic: pi-tui, ./nvim-open and ./md-log are all
// stubs, so no editor, pane, or journal file is ever touched.
const tempRoot = mkdtempSync(join(tmpdir(), "quiz-input-modes-test-"));
try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTypes = join(tempRoot, "types.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	const stubNvimOpen = join(tempRoot, "nvim-open.cjs");
	const stubMdLog = join(tempRoot, "md-log.cjs");
	writeFileSync(stubAgent, "exports.defineTool = value => value;\n");
	writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
	writeFileSync(stubNvimOpen, "exports.openEditor = async () => ({ message: \"opened\", mode: \"split\" });\n");
	writeFileSync(stubMdLog, `
exports.openNodeView = async () => ({ mode: "node", message: "node view" });
exports.openJournalInEditor = async () => ({ mode: "journal", message: "journal" });
`);
	writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; this.focused = false; this.disableSubmit = false; }
	getText() { return this.text; }
	setText(text) { this.text = text; }
	handleInput(data) {
		if (data === "enter" && !this.disableSubmit && this.onSubmit) this.onSubmit(this.text);
		else this.text += data;
	}
	render() { return [this.text || (this.focused ? "█" : "")]; }
	invalidate() {}
}
const kitty = { "\\u001b[106u": "j", "\\u001b[107u": "k" };
exports.Editor = Editor;
exports.Key = { enter: "enter", escape: "escape", tab: "tab", up: "up", down: "down", space: " ", ctrl: key => "ctrl+" + key };
exports.Loader = class Loader { start() {} stop() {} render() { return ["grading"]; } };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key || kitty[data] === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
exports.wrapTextWithAnsi = (text, width) => {
	const words = String(text).split(" ");
	const lines = [];
	let line = "";
	for (const word of words) {
		if (line.length === 0) line = word;
		else if (line.length + 1 + word.length <= width) line += " " + word;
		else { lines.push(line); line = word; }
	}
	if (line) lines.push(line);
	return lines.length ? lines : [""];
};
`);

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-ai": stubTypes,
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			typebox: stubTypes,
			"./nvim-open": stubNvimOpen,
			"./md-log": stubMdLog,
		},
	});
	const tools = {};
	const registry = { registerTool(tool) { tools[tool.name] = tool; } };
	jiti("../quiz.ts").default(registry);
	const quizTool = tools.quiz;
	assert.equal(quizTool?.name, "quiz");

	const theme = { fg: (_color, text) => text, bold: (text) => text };
	const signal = new AbortController().signal;
	const options = [
		{ label: "Alpha", value: "alpha" },
		{ label: "Beta", value: "beta" },
	];
	const params = {
		question: "Pick beta",
		options,
		correctAnswer: "beta",
		explanation: "Beta is correct.",
		shuffle: false,
	};

	async function execute(runParams, steps) {
		const ctx = {
			cwd: process.cwd(),
			hasUI: true,
			model: {},
			modelRegistry: {
				find() {},
				complete() { return new Promise(() => {}); },
			},
			ui: {
				custom(factory) {
					return new Promise((done) => {
						const component = factory({ requestRender() {} }, theme, {}, done);
						component.focused = true;
						for (const step of steps) {
							component.handleInput(step.data);
							const rendered = component.render(step.width ?? 100).join("\n");
							for (const rx of step.selected ?? []) assert.match(rendered, rx);
						}
					});
				},
			},
		};
		return quizTool.execute("input-modes", runParams, signal, undefined, ctx);
	}

	// Tab cycles Answer -> Steering -> Answer, and the question stays visible
	// the whole time — steering is a mode of the quiz, not a replacement for it.
	const cycle = await execute(params, [
		{ data: "tab", selected: [/Pick beta[\s\S]*Mode: Steering/, /Tab answer/, /type guidance/] },
		{ data: "tab", selected: [/Mode: Answer[\s\S]*› answer/] },
		{ data: "tab", selected: [/Mode: Steering[\s\S]*› █/] },
		{ data: "escape", selected: [/Mode: Answer[\s\S]*› answer/] },
		{ data: "enter", selected: [/› feedback/] },
		{ data: "enter" },
	]);
	assert.equal(cycle.details.status, "answered");
	assert.equal(cycle.details.answers[0].value, "alpha");

	// Enter on an EMPTY steering buffer does nothing: the quiz stays open in
	// steering mode, later typing still works, and the eventual follow-up
	// carries exactly the text typed after the empty submit.
	const emptyFollowUp = await execute(params, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "enter", selected: [/Mode: Steering[\s\S]*› █/] },
		{ data: "g" },
		{ data: "o" },
		{ data: "enter" },
	]);
	assert.equal(emptyFollowUp.details.status, "follow-up");
	assert.equal(emptyFollowUp.details.followUp, "go");
	assert.equal(emptyFollowUp.details.answers.length, 0);

	// The follow-up result is visible everywhere: tool text for the agent,
	// structured details for the transcript, and a rendered row for the UI.
	assert.match(emptyFollowUp.content[0].text, /User steered instead of answering: go/);
	const followUpView = quizTool.renderResult({ details: emptyFollowUp.details }, {}, theme);
	assert.match(followUpView.text, /Steering: go/);
	assert.doesNotMatch(followUpView.text, /Correct/);

	// The steering editor keeps its text on Enter (disableSubmit): the
	// submitted follow-up is the full composed text, never an empty string.
	const keeps = await execute(params, [
		{ data: "tab" },
		{ data: "p" }, { data: "a" }, { data: "u" }, { data: "s" }, { data: "e" },
		{ data: "enter" },
	]);
	assert.equal(keeps.details.followUp, "pause");
	assert.match(keeps.content[0].text, /pause/);

	// Literal j/k are TEXT in steering mode — they must never navigate the
	// option list (that would steal letters out of the captain's guidance).
	const literalJk = await execute(params, [
		{ data: "tab", selected: [/Mode: Steering[\s\S]*› █/] },
		{ data: "j", selected: [/› j/] },
		{ data: "k", selected: [/Mode: Steering[\s\S]*› jk/] },
		{ data: "enter" },
	]);
	assert.equal(literalJk.details.status, "follow-up");
	assert.equal(literalJk.details.followUp, "jk");

	// The same holds in multi-select steering mode.
	const multiSteer = await execute({ ...params, multiSelect: true }, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "j" }, { data: "k" },
		{ data: "enter" },
	]);
	assert.equal(multiSteer.details.status, "follow-up");
	assert.equal(multiSteer.details.followUp, "jk");

	// Ctrl+P still works from either mode — the too-hard escape hatch is
	// never blocked by steering.
	const tooHardFromSteering = await execute(params, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "ctrl+p" },
	]);
	assert.equal(tooHardFromSteering.details.status, "too-hard");
	assert.equal(tooHardFromSteering.details.followUp, undefined);
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("quiz input-mode cycling tests passed");
