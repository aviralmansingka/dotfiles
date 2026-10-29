import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
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
exports.Text = class Text { constructor(text) { this.text = text; } };
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
	contextFor(["enter", "enter", "enter"]),
);
assert.equal(answered.details.status, "answered");
assert.equal(answered.details.title, params.title);
assert.equal(answered.details.correct, true);
assert.equal(answered.details.dontKnow, false);
assert.equal(answered.details.followUp, undefined);
assert.equal(answered.details.thinking, undefined, "a skipped thinking step adds no field");

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
// too-hard never reveals the answer in its user-facing text.
assert.doesNotMatch(tooHard.content[0].text, /First|Second|Correct:/);
assert.match(tooHard.content[0].text, /Do not grade this as wrong or reveal the original answer/);

// dontKnow: the user picks the ungraded Other row instead of guessing.
const dontKnow = await quizTool.execute(
	"dont-know-result",
	params,
	signal,
	undefined,
	contextFor(["j", "j", "enter", "enter", "enter"]),
);
assert.equal(dontKnow.details.status, "answered");
assert.equal(dontKnow.details.dontKnow, true);
assert.equal(dontKnow.details.correct, false);
assert.deepEqual(dontKnow.details.answers, []);
assert.match(dontKnow.content[0].text, /genuine knowledge gap, not a wrong guess/);
assert.match(dontKnow.content[0].text, /Correct: 1\. First/);

// cancelled: escape closes the quiz without an answer.
const cancelled = await quizTool.execute(
	"cancelled-result",
	params,
	signal,
	undefined,
	contextFor(["escape"]),
);
assert.equal(cancelled.details.status, "cancelled");
assert.deepEqual(cancelled.details.answers, []);
assert.match(cancelled.content[0].text, /User cancelled the quiz/);

// follow-up: steering guidance ends the quiz as its own visible status.
const followUp = await quizTool.execute(
	"follow-up-result",
	params,
	signal,
	undefined,
	contextFor(["tab", "w", "a", "i", "t", "enter"]),
);
assert.equal(followUp.details.status, "follow-up");
assert.equal(followUp.details.followUp, "wait");
assert.deepEqual(followUp.details.answers, []);
assert.match(followUp.content[0].text, /User steered instead of answering: wait/);

// Every status renders a distinct, visible transcript row.
const identityTheme = { fg: (_color, text) => text, bold: (text) => text };
const render = (result) => quizTool.renderResult(result, {}, identityTheme).text;
assert.match(render(answered), /Correct!/);
assert.match(render(tooHard), /Passed — question was too hard; simplifying next/);
assert.match(render(dontKnow), /Other — I don't know/);
assert.match(render(dontKnow), /✓ 1\. First/);
assert.doesNotMatch(render(dontKnow), /✗/, "dontKnow never shows a wrong mark");
assert.match(render(cancelled), /User cancelled the quiz/);
assert.match(render(followUp), /Steering: wait/);

// The thinking phase sits between select and feedback: select-Enter opens it,
// Enter submits the learner's optional reasoning, and the verdict comes after.
const withThinking = await quizTool.execute(
	"thinking-result",
	params,
	signal,
	undefined,
	contextFor(["enter", "b", "e", "c", "a", "u", "s", "e", "enter", "enter"]),
);
assert.equal(withThinking.details.status, "answered");
assert.equal(withThinking.details.correct, true, "typing reasoning never changes the verdict");
assert.equal(withThinking.details.thinking, "because");
{
	const text = withThinking.content[0].text;
	assert.match(text, /Thinking: because/);
	assert.ok(text.indexOf("Thinking: because") > text.indexOf("Correct: "), "thinking follows the verdict lines");
	assert.ok(text.indexOf("Thinking: because") < text.indexOf("Explanation: "), "thinking precedes the explanation");
}
assert.match(render(withThinking), /Thinking: because/);

// Esc skips the thinking step: the answer still grades, with no thinking.
const skippedThinking = await quizTool.execute(
	"thinking-skipped",
	params,
	signal,
	undefined,
	contextFor(["enter", "escape", "enter"]),
);
assert.equal(skippedThinking.details.status, "answered");
assert.equal(skippedThinking.details.thinking, undefined);
assert.doesNotMatch(skippedThinking.content[0].text, /Thinking:/);
assert.doesNotMatch(render(skippedThinking), /Thinking:/);

// Multi-select takes the same thinking step before its verdict.
const multiThinking = await quizTool.execute(
	"thinking-multi",
	{ ...params, multiSelect: true, correctAnswer: ["first"] },
	signal,
	undefined,
	contextFor(["1", "enter", "o", "k", "enter", "enter"]),
);
assert.equal(multiThinking.details.status, "answered");
assert.equal(multiThinking.details.thinking, "ok");
assert.match(multiThinking.content[0].text, /Thinking: ok/);

// renderResult fallbacks: no structured details at all, and older results
// that predate details.options (marks come from the answers themselves).
assert.equal(
	render({ content: [{ type: "text", text: "plain text result" }] }),
	"plain text result",
);
const legacy = render({
	content: [{ type: "text", text: "x" }],
	details: {
		status: "answered",
		question: "q",
		mode: "single-select",
		answers: [{ index: 1, label: "First", value: "first" }],
		correctIndices: [2],
		note: "kept for older sessions",
	},
});
// Older results without details.options fall back to the selected answers.
assert.match(legacy, /✗ 1\. First/);
assert.match(legacy, /Incorrect/);
assert.match(legacy, /Note: kept for older sessions/);

// Guard paths — each returns a structured result without ever opening a UI.
const bareCtx = { hasUI: true, ui: {} };
const abortController = new AbortController();
abortController.abort();
const abortedResult = await quizTool.execute(
	"aborted-result",
	params,
	abortController.signal,
	undefined,
	bareCtx,
);
assert.equal(abortedResult.details.status, "cancelled");

const noUi = await quizTool.execute("no-ui", params, signal, undefined, { hasUI: false, ui: {} });
assert.equal(noUi.details.status, "unavailable");
assert.match(noUi.details.message, /requires interactive mode UI/);

const tooFew = await quizTool.execute(
	"too-few",
	{ ...params, options: [{ label: "  " }, { label: "Second", value: "second" }] },
	signal,
	undefined,
	bareCtx,
);
assert.equal(tooFew.details.status, "unavailable");
assert.match(tooFew.details.message, /requires at least two options/);

const duplicate = await quizTool.execute(
	"duplicate",
	{ ...params, options: [{ label: "A", value: "x" }, { label: "B", value: "x" }] },
	signal,
	undefined,
	bareCtx,
);
assert.equal(duplicate.details.status, "unavailable");
assert.match(duplicate.details.message, /duplicate option value/);

const mismatch = await quizTool.execute(
	"mismatch",
	{ ...params, correctAnswer: "nope" },
	signal,
	undefined,
	bareCtx,
);
assert.equal(mismatch.details.status, "unavailable");
assert.match(mismatch.details.message, /correctAnswer "nope" does not match any option value/);
assert.match(mismatch.details.message, /"first", "second"/);

// The harness sometimes delivers a multi-select correctAnswer array as a
// JSON string — it must grade against the real option values either way.
const stringified = await quizTool.execute(
	"stringified-correct",
	{ ...params, multiSelect: true, correctAnswer: '["first"]' },
	signal,
	undefined,
	contextFor(["1", "enter", "enter", "enter"]),
);
assert.equal(stringified.details.status, "answered");
assert.equal(stringified.details.correct, true);

// The tool emits the true (post-shuffle) display order BEFORE the UI blocks,
// and that early update never leaks the answer.
{
	const updates = [];
	const shuffled = { ...params, shuffle: true };
	await quizTool.execute(
		"early-update",
		shuffled,
		signal,
		(update) => updates.push(update),
		contextFor(["escape"]),
	);
	assert.equal(updates.length, 1);
	assert.match(updates[0].content[0].text, /Awaiting user response/);
	const labels = updates[0].details.options.map((option) => option.label);
	assert.deepEqual([...labels].sort(), ["First", "Second"]);
	assert.deepEqual(
		updates[0].details.options.map((option) => option.index),
		[1, 2],
	);
	assert.ok(!("correctIndices" in updates[0].details), "early update must not leak the answer");
	assert.ok(!("explanation" in updates[0].details), "early update must not leak the explanation");
}

// renderCall: the streaming-time render must show the shape of the call
// (title, question, option count, context files) but NEVER the answer or the
// explanation — they would leak into the transcript before the user answers.
{
	const callView = quizTool.renderCall(
		{
			title: params.title,
			question: params.question,
			multiSelect: true,
			options: params.options,
			correctAnswer: "first",
			explanation: params.explanation,
			contextFiles: ["bench.py", "fast.cu"],
		},
		identityTheme,
	);
	assert.match(callView.text, /quiz /);
	assert.match(callView.text, /Node A — result metadata/);
	assert.match(callView.text, /Which option is correct\?/);
	assert.match(callView.text, /\[multi-select\]/);
	assert.match(callView.text, /\(2 options\)/);
	assert.match(callView.text, /\(2 context files\)/);
	assert.ok(!callView.text.includes(params.explanation), "renderCall must not leak the explanation");
	assert.ok(!callView.text.includes("Correct"), "renderCall must not leak the answer");
	assert.ok(!callView.text.includes("1. "), "renderCall must not enumerate options pre-shuffle");
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("quiz result tests passed");
