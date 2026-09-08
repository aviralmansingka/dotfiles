import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath =
	process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "option-navigation-test-"));

try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTypes = join(tempRoot, "types.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	writeFileSync(stubAgent, "exports.defineTool = value => value;\n");
	writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
	writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; this.focused = false; this.disableSubmit = false; }
	getText() { return this.text; }
	setText(text) { this.text = text; }
	handleInput(data) {
		if (data === "enter" && !this.disableSubmit && this.onSubmit) this.onSubmit(this.text);
		else this.text += data;
	}
	render() { return [this.text]; }
	invalidate() {}
}
const kitty = { "\\u001b[106u": "j", "\\u001b[107u": "k" };
exports.Editor = Editor;
exports.Key = { enter: "enter", escape: "escape", tab: "tab", up: "up", down: "down", space: " ", ctrl: key => "ctrl+" + key };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key || kitty[data] === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
exports.wrapTextWithAnsi = text => [text];
`);

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-ai": stubTypes,
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			typebox: stubTypes,
		},
	});
	const tools = {};
	const registry = { registerTool(tool) { tools[tool.name] = tool; } };
	jiti("../ask-user-question.ts").default(registry);
	jiti("../quiz.ts").default(registry);

	const theme = { fg: (_color, text) => text, bold: (text) => text };
	const signal = new AbortController().signal;
	const options = [
		{ label: "Alpha", value: "alpha" },
		{ label: "Beta", value: "beta" },
	];

	async function execute(tool, params, steps) {
		const ctx = {
			cwd: process.cwd(),
			hasUI: true,
			ui: {
				custom(factory) {
					return new Promise((done) => {
						const component = factory({ requestRender() {} }, theme, {}, done);
						for (const step of steps) {
							component.handleInput(step.data);
							if (step.selected) assert.match(component.render(100).join("\n"), step.selected);
						}
					});
				},
			},
		};
		return tool.execute("navigation", params, signal, undefined, ctx);
	}

	const askSingle = await execute(tools.ask_user_question, { question: "Pick one", options }, [
		{ data: "\u001b[106u", selected: /> 2\. Beta/ },
		{ data: "\u001b[107u", selected: /> 1\. Alpha/ },
		{ data: "j", selected: /> 2\. Beta/ },
		{ data: "enter" },
	]);
	assert.equal(askSingle.details.answers[0].value, "beta");

	const askMulti = await execute(tools.ask_user_question, { question: "Pick many", options, multiSelect: true }, [
		{ data: "\u001b[106u", selected: /> \[ \] 2\. Beta/ },
		{ data: "\u001b[107u", selected: /> \[ \] 1\. Alpha/ },
		{ data: " " },
		{ data: "\u001b[106u" },
		{ data: "\u001b[106u" },
		{ data: "\u001b[106u", selected: /> ✓ Submit/ },
		{ data: "enter" },
	]);
	assert.deepEqual(askMulti.details.answers.map((answer) => answer.value), ["alpha"]);

	const other = await execute(tools.ask_user_question, { question: "Custom", options }, [
		{ data: "j" },
		{ data: "j" },
		{ data: "enter" },
		{ data: "j" },
		{ data: "k" },
		{ data: "enter" },
	]);
	assert.equal(other.details.answers[0].value, "jk");

	const quizParams = {
		question: "Pick beta",
		options,
		correctAnswer: "beta",
		explanation: "Beta is correct.",
		shuffle: false,
	};
	const quizSingle = await execute(tools.quiz, quizParams, [
		{ data: "\u001b[106u", selected: /> 2\. Beta/ },
		{ data: "\u001b[107u", selected: /> 1\. Alpha/ },
		{ data: "\u001b[106u", selected: /> 2\. Beta/ },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.equal(quizSingle.details.answers[0].value, "beta");

	const quizMulti = await execute(tools.quiz, { ...quizParams, multiSelect: true }, [
		{ data: "\u001b[106u", selected: /> \[ \] 2\. Beta/ },
		{ data: "\u001b[107u", selected: /> \[ \] 1\. Alpha/ },
		{ data: " " },
		{ data: "\u001b[106u" },
		{ data: "\u001b[106u" },
		{ data: "\u001b[106u", selected: /> ✓ Submit/ },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.deepEqual(quizMulti.details.answers.map((answer) => answer.value), ["alpha"]);

	const quizNote = await execute(tools.quiz, quizParams, [
		{ data: "tab" },
		{ data: "j" },
		{ data: "k" },
		{ data: "enter" },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.equal(quizNote.details.note, "jk");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("option navigation regressions passed");
