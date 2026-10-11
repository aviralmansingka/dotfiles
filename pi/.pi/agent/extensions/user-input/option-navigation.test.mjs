import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOMEBREW_JITI, resolveJiti } from "../test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
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
	render() { return [this.text || (this.focused ? "█" : "")]; }
	invalidate() {}
}
const kitty = { "\\u001b[50u": "2", "\\u001b[106u": "j", "\\u001b[107u": "k" };
exports.Editor = Editor;
exports.Key = { enter: "enter", escape: "escape", tab: "tab", up: "up", down: "down", space: " ", ctrl: key => "ctrl+" + key };
exports.Loader = class Loader { start() {} stop() {} render() { return ["grading"]; } };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key || kitty[data] === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
// Naive word wrap, close enough to the real ANSI-aware wrapper for hint rows.
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
		},
	});
	const tools = {};
	const registry = { registerTool(tool) { tools[tool.name] = tool; } };
	jiti("../ask-user-question.ts").default(registry);
	jiti("../explain.ts").default(registry);
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
							const lines = component.render(step.width ?? 100);
							const rendered = lines.join("\n");
							if (step.selected) assert.match(rendered, step.selected);
							if (step.notSelected) assert.doesNotMatch(rendered, step.notSelected);
							for (const hint of step.hints ?? []) assert.match(rendered, hint);
							if (step.promptRow) {
								const w = step.width ?? 100;
								if (w < 24) {
									// Narrow fallback: no borders at all, but the prompt row stays padded.
									assert.equal(lines.at(-1), " ");
									assert.ok(lines.every((line) => !line.includes("│")), "narrow panels drop the frame");
								} else {
									// U4: every prompt row keeps one column of padding on both sides,
									// so wrapped-away content can never touch the merged frame's borders.
									const promptRow = lines.at(-2);
									assert.match(promptRow, /^│ /);
									assert.ok(promptRow.endsWith(" │"), "prompt row keeps right padding");
									assert.equal(promptRow.length, w, "prompt row fills the bottom box");
									assert.ok(
										lines.some((line) => line.includes("┴")),
										"merged frame keeps its tee row",
									);
								}
							}
						}
					});
				},
			},
		};
		return tool.execute("navigation", params, signal, undefined, ctx);
	}

	const askSingle = await execute(tools.ask_user_question, { question: "Pick one", options }, [
		{ data: "\u001b[106u", selected: /> 2\. Beta[\s\S]*\n│ › answer/, hints: [/↑↓\/jk navigate/, /1-2 select • Enter select/] },
		{ data: "\u001b[107u", selected: /> 1\. Alpha/ },
		{ data: "j", selected: /> 2\. Beta/ },
		{ data: "enter" },
	]);
	assert.equal(askSingle.details.answers[0].value, "beta");

	// U1: in single-select ask, a digit shortcut selects AND submits in one press.
	const askDigit = await execute(tools.ask_user_question, { question: "Pick one", options }, [
		{ data: "2" },
	]);
	assert.equal(askDigit.details.answers[0].value, "beta");
	assert.equal(askDigit.details.answers[0].index, 2);

	const askMulti = await execute(tools.ask_user_question, { question: "Pick many", options, multiSelect: true }, [
		{ data: "\u001b[106u", selected: /> \[ \] 2\. Beta/, hints: [/1-2 toggle • Space toggle/] },
		{ data: "\u001b[107u", selected: /> \[ \] 1\. Alpha/ },
		{ data: " " },
		{ data: "\u001b[106u" },
		{ data: "\u001b[106u" },
		{ data: "\u001b[106u", selected: /> ✓ Submit/ },
		{ data: "enter" },
	]);
	assert.deepEqual(askMulti.details.answers.map((answer) => answer.value), ["alpha"]);

	// U1: in multi-select ask, a digit shortcut TOGGLES — press twice to clear.
	const askMultiDigits = await execute(tools.ask_user_question, { question: "Pick many", options, multiSelect: true }, [
		{ data: "1", selected: /\[x\] 1\. Alpha/ },
		{ data: "1", selected: /\[ \] 1\. Alpha/, notSelected: /\[x\] 1\. Alpha/ },
		{ data: "1", selected: /\[x\] 1\. Alpha/ },
		{ data: "j" },
		{ data: "j" },
		{ data: "j", selected: /> ✓ Submit \(1 selected\)/ },
		{ data: "enter" },
	]);
	assert.deepEqual(askMultiDigits.details.answers.map((answer) => answer.value), ["alpha"]);

	const other = await execute(tools.ask_user_question, { question: "Custom", options }, [
		{ data: "j" },
		{ data: "j" },
		{ data: "enter", selected: /Other[\s\S]*\n│ › █/, hints: [/Write your custom answer below/, /Enter to submit/] },
		{ data: "j" },
		{ data: "k" },
		{ data: "enter" },
	]);
	// U1: literal j/k fall through to the Other free-text editor, not navigation.
	assert.equal(other.details.answers[0].value, "jk");

	// U1: free-text ask (no options) — j/k are plain text there too.
	const askText = await execute(tools.ask_user_question, { question: "Name it" }, [
		{ data: "j", selected: /│ › j/, hints: [/Enter submit/] },
		{ data: "k", selected: /│ › jk/ },
		{ data: "enter" },
	]);
	assert.equal(askText.details.mode, "text");
	assert.equal(askText.details.answers[0].label, "jk");

	const explained = await execute(tools.explain, { question: "Why?", expected: "Because." }, [
		{ data: "x" },
		{ data: "enter", promptRow: true },
		{ data: "ignored", width: 20, promptRow: true },
		{ data: "escape" },
	]);
	assert.equal(explained.details.status, "cancelled");

	const quizParams = {
		question: "Pick beta",
		options,
		correctAnswer: "beta",
		explanation: "Beta is correct.",
		shuffle: false,
	};
	const quizSingle = await execute(tools.quiz, quizParams, [
		{ data: "\u001b[106u", selected: /> 2\. Beta/, hints: [/1-2 select/, /Ctrl\+P pause/, /Tab steering/, /h node · H journal/] },
		{ data: "\u001b[107u", selected: /> 1\. Alpha/ },
		{ data: "\u001b[57401;129u", selected: /> ● 2\. Beta[\s\S]*\n│ › answer/ },
		{ data: "enter", selected: /\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.equal(quizSingle.details.answers[0].value, "beta");

	// U1: in single-select quiz, a digit shortcut SELECTS (● marker) but does not
	// submit — Enter walks through feedback first. Contrast with ask, which submits.
	const quizDigit = await execute(tools.quiz, quizParams, [
		{ data: "2", selected: /● 2\. Beta/, notSelected: /> 2\. Beta/ },
		{ data: "enter", selected: /\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.equal(quizDigit.details.answers[0].value, "beta");
	assert.equal(quizDigit.details.answers[0].index, 2);

	const movedAfterNumber = await execute(tools.quiz, quizParams, [
		{ data: "2", selected: /● 2\. Beta/ },
		{ data: "k", selected: /> 1\. Alpha/, notSelected: /● 2\. Beta/ },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.equal(movedAfterNumber.details.answers[0].value, "alpha");

	const quizMulti = await execute(tools.quiz, { ...quizParams, multiSelect: true }, [
		{ data: "\u001b[106u", selected: /> \[ \] 2\. Beta/, hints: [/1-2 toggle • Space toggle/, /h node · H journal/] },
		{ data: "\u001b[107u", selected: /> \[ \] 1\. Alpha/ },
		{ data: " " },
		{ data: "enter", selected: /\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.deepEqual(quizMulti.details.answers.map((answer) => answer.value), ["alpha"]);

	// U1: in multi-select quiz, digit shortcuts toggle selections on and off.
	const quizMultiDigits = await execute(tools.quiz, { ...quizParams, multiSelect: true }, [
		{ data: "1", selected: /\[x\] 1\. Alpha/ },
		{ data: "1", selected: /\[ \] 1\. Alpha/, notSelected: /\[x\] 1\. Alpha/ },
		{ data: "2", selected: /\[x\] 2\. Beta/ },
		{ data: "1", selected: /\[x\] 1\. Alpha/ },
		{ data: "enter", selected: /\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.deepEqual(quizMultiDigits.details.answers.map((answer) => answer.value), ["alpha", "beta"]);

	const quizOther = await execute(tools.quiz, quizParams, [
		{ data: "k", selected: /2\. Beta[\s\S]*Other[\s\S]*Mode: Answer[\s\S]*› answer/ },
		{ data: "j" },
		{ data: "j" },
		{ data: "enter", selected: /You chose Other \(I don't know\)[\s\S]*\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.equal(quizOther.details.dontKnow, true);

	const quizMultiOther = await execute(tools.quiz, { ...quizParams, multiSelect: true }, [
		{ data: "j" },
		{ data: "j", selected: /> \[ \] Other[\s\S]*Mode: Answer/ },
		{ data: "enter", selected: /You chose Other \(I don't know\)[\s\S]*\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.equal(quizMultiOther.details.dontKnow, true);

	// Other is EXCLUSIVE in multi-select quiz: picking it clears every real
	// selection, and picking a real option clears Other.
	const quizMultiExclusive = await execute(tools.quiz, { ...quizParams, multiSelect: true }, [
		{ data: "1", selected: /\[x\] 1\. Alpha/ },
		{ data: "j" },
		{ data: "j", selected: /> \[ \] Other/ },
		{ data: " ", selected: /\[ \] 1\. Alpha[\s\S]*\[x\] Other/, notSelected: /\[x\] 1\. Alpha/ },
		{ data: "1", selected: /\[x\] 1\. Alpha[\s\S]*\[ \] Other/, notSelected: /\[x\] Other/ },
		{ data: "enter", selected: /\n│ › feedback/ },
		{ data: "enter" },
	]);
	assert.equal(quizMultiExclusive.details.dontKnow, false);
	assert.deepEqual(quizMultiExclusive.details.answers.map((answer) => answer.value), ["alpha"]);

	const quizSteer = await execute(tools.quiz, quizParams, [
		{ data: "tab", selected: /Mode: Steering[\s\S]*\n│ › █/ },
		{ data: "p" },
		{ data: "a" },
		{ data: "u" },
		{ data: "s" },
		{ data: "e" },
		{ data: "enter" },
	]);
	assert.equal(quizSteer.details.status, "follow-up");
	assert.equal(quizSteer.details.followUp, "pause");

	// Ask multi-select: Esc from the Other editor returns to the option list
	// and the custom text is discarded (single-select ask).
	const askOtherEscape = await execute(tools.ask_user_question, { question: "Custom", options }, [
		{ data: "j" },
		{ data: "j" },
		{ data: "enter", selected: /Other[\s\S]*› █/ },
		{ data: "x" },
		{ data: "escape", selected: /Other[\s\S]*› answer/, notSelected: /› x/ },
		{ data: "escape" },
	]);
	assert.equal(askOtherEscape.details.status, "cancelled");

	// Ask multi-select: choosing Other through the free-text editor stores a
	// custom answer that rides along to submission.
	const askMultiOtherTyped = await execute(tools.ask_user_question, { question: "Pick many", options, multiSelect: true }, [
		{ data: "j" },
		{ data: "j", selected: /> \[ \] Other/ },
		{ data: " " }, // space on Other enters the editor
		{ data: "c" }, { data: "u" }, { data: "s" }, { data: "t" }, { data: "o" }, { data: "m" },
		{ data: "enter", selected: /\[x\] Other — custom/ }, // editor onSubmit saves and returns to the list
		{ data: "j", selected: /> ✓ Submit \(1 selected\)/ },
		{ data: "enter" },
	]);
	assert.equal(askMultiOtherTyped.details.status, "answered");
	assert.equal(askMultiOtherTyped.details.answers[0].type, "other");
	assert.equal(askMultiOtherTyped.details.answers[0].label, "custom");
	assert.match(askMultiOtherTyped.content[0].text, /- Other: custom/);

	// Submit with zero selected does not end the question; the warning row
	// says to pick at least one answer first.
	const askMultiEmptySubmit = await execute(tools.ask_user_question, { question: "Pick many", options, multiSelect: true }, [
		{ data: "j" }, { data: "j" }, { data: "j", selected: /> ○ Submit/ },
		{ data: "enter", selected: /Select at least one answer before submitting/ },
		{ data: "1", selected: /\[x\] 1\. Alpha/ },
		{ data: "j" }, { data: "j" }, { data: "j", selected: /> ✓ Submit \(1 selected\)/ },
		{ data: "enter" },
	]);
	assert.equal(askMultiEmptySubmit.details.status, "answered");
	assert.deepEqual(askMultiEmptySubmit.details.answers.map((answer) => answer.value), ["alpha"]);

	// Ask renderResult rows: option, Other, free text, and the no-details
	// content fallback.
	const render = (result) => tools.ask_user_question.renderResult(result, {}, theme).text;
	assert.match(render(other), /✓ Other: jk/);
	assert.match(render(askSingle), /✓ 2\. Beta/);
	assert.match(render(askText), /✓ jk/);
	assert.equal(
		render({ content: [{ type: "text", text: "plain fallback" }] }),
		"plain fallback",
	);

	// Ask renderCall: the streaming-time render lists the options plus the
	// automatic Other row and the multi-select marker.
	{
		const callView = tools.ask_user_question.renderCall(
			{ question: "Pick many", options, multiSelect: true },
			theme,
		);
		assert.match(callView.text, /ask_user_question /);
		assert.match(callView.text, /Pick many/);
		assert.match(callView.text, /\[multi-select\]/);
		assert.match(callView.text, /Options: Alpha, Beta, Other/);
	}

	// Ask guard paths — structured results without any UI.
	const abortController = new AbortController();
	abortController.abort();
	const askAborted = await tools.ask_user_question.execute(
		"aborted",
		{ question: "Pick one", options },
		abortController.signal,
		undefined,
		{ hasUI: true, ui: {} },
	);
	assert.equal(askAborted.details.status, "cancelled");
	assert.match(askAborted.details.message, /User cancelled the question/);
	const askNoUi = await tools.ask_user_question.execute(
		"no-ui",
		{ question: "Pick one", options },
		signal,
		undefined,
		{ hasUI: false, ui: {} },
	);
	assert.equal(askNoUi.details.status, "unavailable");
	assert.match(askNoUi.details.message, /requires interactive mode UI/);
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("option navigation regressions passed");
