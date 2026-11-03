import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOMEBREW_JITI, resolveJiti } from "../test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
const { createJiti } = require(jitiPath);

// U2 — input-mode cycling inside the quiz panel. Tab cycles four modes:
// Answer (pick an option), Steering (Enter sends a live steer to the agent
// and the quiz STAYS OPEN), Note (text rides with the eventual answer), and
// Follow-up (Enter ends the quiz with a visible follow-up result). Steering
// never eats the quiz: the question stays rendered, `o` still opens context
// files on an empty buffer, and the send is confirmed in-panel. Hermetic:
// pi-tui, ./nvim-open and ./md-log are all stubs, so no editor, pane, or
// journal file is ever touched.
const tempRoot = mkdtempSync(join(tmpdir(), "quiz-input-modes-test-"));
try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTypes = join(tempRoot, "types.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	const stubNvimOpen = join(tempRoot, "nvim-open.cjs");
	const stubMdLog = join(tempRoot, "md-log.cjs");
	writeFileSync(stubAgent, "exports.defineTool = value => value;\n");
	writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
	writeFileSync(stubNvimOpen, `
exports.openEditor = async (...args) => {
	(globalThis.__openedEditors ||= []).push(args);
	return { message: "opened", mode: "split" };
};
`);
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
	const sentSteers = [];
	const registry = {
		registerTool(tool) { tools[tool.name] = tool; },
		sendUserMessage(text, options) { sentSteers.push({ text, options }); },
	};
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
							for (const rx of step.rejected ?? []) assert.doesNotMatch(rendered, rx);
						}
					});
				},
			},
		};
		return quizTool.execute("input-modes", runParams, signal, undefined, ctx);
	}

	// Tab cycles Answer -> Steering -> Note -> Follow-up -> Answer. The mode
	// indicator and the question stay visible at every stop, so the captain
	// always sees which mode is active before typing.
	const cycle = await execute(params, [
		{ data: "tab", selected: [/Pick beta[\s\S]*Mode: Steering/, /quiz stays open/, /› █/] },
		{ data: "tab", selected: [/Pick beta[\s\S]*Mode: Note/, /Tab[\s\S]{0,30}follow-up • Esc answer/, /› █/] },
		{ data: "tab", selected: [/Pick beta[\s\S]*Mode: Follow-up/, /Enter end quiz and send/, /› █/] },
		{ data: "tab", selected: [/Mode: Answer[\s\S]*› answer/, /Tab steering/] },
		// Enter walks select → thinking → feedback; the verdict waits for the
		// thinking step to finish.
		{ data: "enter", selected: [/Enter see verdict · Esc skip/, /› your thinking \(optional\)/] },
		{ data: "enter", selected: [/› feedback/] },
		{ data: "enter" },
	]);
	assert.equal(cycle.details.status, "answered");
	assert.equal(cycle.details.answers[0].value, "alpha");

	// Steering sends the text to the agent as a live steer and the quiz stays
	// open: the question is still rendered, the send is confirmed in-panel,
	// and the captain can keep typing (j/k are literal text here, never
	// navigation) and finally answer the same question.
	const steer = await execute(params, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "h" }, { data: "e" }, { data: "y" },
		{
			data: "enter",
			selected: [/Pick beta/, /Mode: Steering/, /✓ Steer sent — the quiz stays open/],
		},
		// The next interaction dismisses the confirmation; the editor is empty
		// again and j is text, not navigation.
		{ data: "j", selected: [/Mode: Steering[\s\S]*› j/], rejected: [/Steer sent/] },
		{ data: "escape", selected: [/Mode: Answer[\s\S]*› answer/] },
		{ data: "2", selected: [/● 2\. Beta/] },
		{ data: "enter" },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.equal(steer.details.status, "answered");
	assert.equal(steer.details.correct, true, "answering after a steer still grades");
	assert.deepEqual(sentSteers, [{ text: "hey", options: { deliverAs: "steer" } }]);

	// Enter on an EMPTY steering buffer returns to Answer mode instead of
	// sending an empty steer.
	const emptySteer = await execute(params, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "enter", selected: [/Mode: Answer[\s\S]*› answer/] },
		{ data: "escape" },
	]);
	assert.equal(emptySteer.details.status, "cancelled");
	assert.equal(sentSteers.length, 1, "an empty steering Enter sends nothing");

	// With an empty steering buffer, `o` still opens the context files and the
	// quiz stays open; once text is in the buffer, `o` is literal text again.
	globalThis.__openedEditors = [];
	const steerO = await execute({ ...params, contextFiles: ["notes.md"] }, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "o", selected: [/Pick beta[\s\S]*Mode: Steering/] },
		{ data: "x", selected: [/› x/] },
		{ data: "o", selected: [/› xo/] },
		{ data: "enter", selected: [/✓ Steer sent/] },
		{ data: "escape", selected: [/Mode: Answer/] },
		{ data: "escape" },
	]);
	assert.equal(steerO.details.status, "cancelled");
	assert.equal(globalThis.__openedEditors.length, 1, "empty-buffer o opens the context files once");
	assert.deepEqual(globalThis.__openedEditors[0][1], ["notes.md"]);
	assert.equal(sentSteers.at(-1).text, "xo", "non-empty-buffer o stays literal text");

	// Note mode keeps the quiz open: Enter keeps the note and returns to the
	// options, and the note rides with the eventual answer.
	const noted = await execute(params, [
		{ data: "tab" },
		{ data: "tab", selected: [/Mode: Note/, /sent with your answer/] },
		{ data: "i" }, { data: "d" }, { data: "k", selected: [/› idk/] },
		{ data: "enter", selected: [/Mode: Answer[\s\S]*› answer/] },
		{ data: "2" },
		{ data: "enter" },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.equal(noted.details.status, "answered");
	assert.equal(noted.details.note, "idk");
	assert.match(noted.content[0].text, /User's note: idk/);
	assert.equal(sentSteers.length, 2, "note mode never sends a live steer");

	// Follow-up mode is the only mode that ends the quiz — visibly, with a
	// follow-up result the agent, the transcript, and the UI all show.
	const followUp = await execute(params, [
		{ data: "tab" },
		{ data: "tab" },
		{ data: "tab", selected: [/Mode: Follow-up/, /Enter end quiz and send/] },
		{ data: "g" },
		{ data: "o", selected: [/› go/] },
		{ data: "enter" },
	]);
	assert.equal(followUp.details.status, "follow-up");
	assert.equal(followUp.details.followUp, "go");
	assert.equal(followUp.details.answers.length, 0);
	assert.match(followUp.content[0].text, /User steered instead of answering: go/);
	const followUpView = quizTool.renderResult({ details: followUp.details }, {}, theme);
	assert.match(followUpView.text, /Steering: go/);
	assert.doesNotMatch(followUpView.text, /Correct/);
	assert.equal(sentSteers.length, 2, "follow-up ends the quiz instead of sending a steer");

	// Enter on an EMPTY follow-up buffer returns to Answer mode — the quiz is
	// never closed silently.
	const emptyFollowUp = await execute(params, [
		{ data: "tab" },
		{ data: "tab" },
		{ data: "tab", selected: [/Mode: Follow-up/] },
		{ data: "enter", selected: [/Mode: Answer[\s\S]*› answer/] },
		{ data: "escape" },
	]);
	assert.equal(emptyFollowUp.details.status, "cancelled");

	// Ctrl+P still works from every mode — the too-hard escape hatch is never
	// blocked by an open input box.
	const tooHardFromNote = await execute(params, [
		{ data: "tab" },
		{ data: "tab", selected: [/Mode: Note/] },
		{ data: "ctrl+p" },
	]);
	assert.equal(tooHardFromNote.details.status, "too-hard");
	assert.equal(tooHardFromNote.details.followUp, undefined);

	// Multi-select cycles the same modes: a steer keeps the quiz open and the
	// captain can still toggle and submit an answer afterwards.
	const multiSteer = await execute({ ...params, multiSelect: true }, [
		{ data: "tab", selected: [/Mode: Steering/] },
		{ data: "j" }, { data: "k", selected: [/› jk/] },
		{ data: "enter", selected: [/✓ Steer sent/] },
		{ data: "escape", selected: [/Mode: Answer/] },
		{ data: "1" },
		{ data: "enter" },
		{ data: "enter" },
		{ data: "enter" },
	]);
	assert.equal(multiSteer.details.status, "answered");
	assert.deepEqual(multiSteer.details.answers.map((a) => a.value), ["alpha"]);
	assert.equal(sentSteers.at(-1).text, "jk");
	assert.equal(sentSteers.at(-1).options.deliverAs, "steer");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("quiz input-mode cycling tests passed");
