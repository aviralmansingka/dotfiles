import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "practice-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubAgent, "exports.defineTool = (tool) => tool;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(
	stubTui,
	`
class Editor {
	constructor() { this.text = ""; }
	getText() { return this.text; }
	handleInput(data) { this.text += data; }
	render(width) { return [this.text.slice(0, width)]; }
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
exports.Text = class Text {
	constructor(text = "", paddingX = 0, paddingY = 0) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
	}
	setText(text) { this.text = text; }
	invalidate() {}
	render(width) { return [this.text.slice(0, width)]; }
};
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = (text) => text.length;
exports.wrapTextWithAnsi = (text) => [text];
`,
);

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const { default: registerPractice, __resetPracticeState } = jiti("./practice.ts");
let problemTool;
let concludeTool;
registerPractice({
	registerTool(tool) {
		if (tool.name === "problem") problemTool = tool;
		else if (tool.name === "conclude") concludeTool = tool;
	},
});
assert.equal(problemTool?.name, "problem");
assert.equal(concludeTool?.name, "conclude");
assert.equal(typeof __resetPracticeState, "function", "the test seam is exported");

const theme = { fg: (_color, text) => text, bold: (text) => text };
const signal = new AbortController().signal;

// Every panel render is captured BEFORE the scripted keystrokes run, so a test
// can assert what the learner actually saw when the panel opened.
function contextFor(sessionFile, inputs) {
	const panels = [];
	const ctx = {
		hasUI: true,
		sessionManager: { getSessionFile: () => sessionFile },
		ui: {
			custom(factory) {
				return new Promise((done) => {
					const component = factory({ requestRender() {} }, theme, {}, done);
					panels.push(component.render(80).join("\n"));
					for (const input of inputs) component.handleInput(input);
				});
			},
		},
	};
	return { ctx, panels };
}

// A context that FAILS if any panel opens: rejection guards must decide before
// a single keystroke reaches the learner.
function noPanelContext(sessionFile) {
	const ctx = {
		hasUI: true,
		sessionManager: { getSessionFile: () => sessionFile },
		ui: {
			custom() {
				throw new Error("no panel may open on a rejected call");
			},
		},
	};
	return ctx;
}

const solution = "Kindle the lamp, then read the latch spring tension.";
const statement = "The latch is jammed and the household is out. Get through.";
const params = {
	title: "Locked door",
	statement,
	modelSolution: solution,
	targets: ["latch-spring", "service-key"],
	mode: "recall",
};
const otherParams = {
	title: "Fenwick prefix sums",
	statement: "A different situation entirely: update index 4, then sum 1..7.",
	modelSolution: "Walk the tree upward from 4, then downward from 7.",
	targets: ["fenwick-update", "fenwick-query"],
	mode: "composition",
};

// ── first pose ──────────────────────────────────────────────────────────────
__resetPracticeState();
const sessionA = "/tmp/practice-a/session.jsonl";
let run = contextFor(sessionA, ["l", "e", "v", "e", "r", "enter"]);
const first = await problemTool.execute("pose-1", params, signal, undefined, run.ctx);

assert.equal(first.details.status, "submitted");
assert.equal(first.details.attempt, 1);
assert.equal(run.panels.length, 1, "the first pose opens exactly one panel");
// The panel shows the demand and never the committed solution.
assert.match(run.panels[0], /Locked door/);
assert.match(run.panels[0], /The latch is jammed and the household is out\./);
assert.match(run.panels[0], /your working/);
assert.match(run.panels[0], /Enter submit · Esc close/);
assert.ok(!run.panels[0].includes(solution), "the panel never shows the committed solution");
// The tool result carries the working, never the solution.
assert.equal(first.details.work, "lever");
assert.match(first.content[0].text, /Attempt 1 — the learner's working:\nlever/);
assert.match(first.content[0].text, /Targets: latch-spring, service-key/);
assert.ok(!first.content[0].text.includes(solution), "the result never leaks the solution");
// The streaming-time render must not leak it either: the commitment is in the
// tool-call arguments, so renderCall has to drop it.
const callView = problemTool.renderCall(params, theme).text;
assert.match(callView, /problem /);
assert.match(callView, /Locked door/);
assert.match(callView, /\[recall\]/);
assert.match(callView, /\(2 targets\)/);
assert.ok(!callView.includes(solution), "renderCall must not leak the committed solution");

// ── second pose, same problem: a new attempt keeps the commitment ────────────
run = contextFor(sessionA, ["a", "g", "a", "i", "n", "enter"]);
const second = await problemTool.execute("pose-2", params, signal, undefined, run.ctx);
assert.equal(second.details.status, "submitted");
assert.equal(second.details.attempt, 2, "the attempt counter advances");
assert.equal(second.details.work, "again");
assert.match(second.content[0].text, /Attempt 2 — the learner's working:/);
assert.deepEqual(second.details.targets, ["latch-spring", "service-key"]);

// ── a changed commitment is rejected, and no panel opens ────────────────────
const changed = await problemTool.execute(
	"pose-changed",
	{ ...params, modelSolution: "A different, freshly invented commitment." },
	signal,
	undefined,
	noPanelContext(sessionA),
);
assert.equal(changed.isError, true, "a changed commitment is an error result");
assert.match(changed.content[0].text, /commitment cannot change/);
assert.equal(changed.details.status, "error");

// ── a different problem while one is active is rejected ─────────────────────
const blocked = await problemTool.execute("pose-other", otherParams, signal, undefined, noPanelContext(sessionA));
assert.equal(blocked.isError, true);
assert.equal(blocked.content[0].text, "A problem is already active (Locked door). Call conclude before posing another.");

// ── conclude reveals the solution, clears the state, reports attempts ───────
run = contextFor(sessionA, ["enter"]);
const concluded = await concludeTool.execute(
	"conclude-1",
	{ outcome: "solved", verdict: "Clean: the spring gave on the first lift." },
	signal,
	undefined,
	run.ctx,
);
assert.equal(concluded.details.status, "concluded");
assert.deepEqual(concluded.details, {
	status: "concluded",
	title: "Locked door",
	outcome: "solved",
	solution,
	attempts: 2,
	targets: ["latch-spring", "service-key"],
	mode: "recall",
	verdict: "Clean: the spring gave on the first lift.",
});
assert.match(concluded.content[0].text, /Outcome: solved\./);
assert.match(concluded.content[0].text, /Model solution \(committed before posing\):/);
assert.ok(concluded.content[0].text.includes(solution), "conclude returns the committed solution");
assert.match(concluded.content[0].text, /Attempts: 2/);
assert.match(concluded.content[0].text, /Verdict: Clean/);
assert.ok(
	concluded.content[0].text.indexOf(solution) > concluded.content[0].text.indexOf("Model solution"),
	"the solution follows its label",
);
// The reveal panel shows the committed solution to the learner.
assert.equal(run.panels.length, 1, "conclude opens the reveal panel");
assert.ok(run.panels[0].includes(solution), "the reveal panel shows the committed solution");
assert.match(run.panels[0], /Locked door/);
assert.match(run.panels[0], /solved/);

// The state is cleared: a different problem is accepted again, at attempt 1.
run = contextFor(sessionA, ["4", "2", "enter"]);
const fresh = await problemTool.execute("pose-fresh", otherParams, signal, undefined, run.ctx);
assert.equal(fresh.details.status, "submitted");
assert.equal(fresh.details.attempt, 1, "a concluded problem gives the next one a clean attempt count");
assert.equal(fresh.details.title, "Fenwick prefix sums");
assert.deepEqual(fresh.details, {
	status: "submitted",
	title: "Fenwick prefix sums",
	statement: otherParams.statement,
	mode: "composition",
	targets: ["fenwick-update", "fenwick-query"],
	attempt: 1,
	work: "42",
});

// ── conclude with nothing active is rejected ───────────────────────────────
const nothing = await concludeTool.execute(
	"conclude-none",
	{ outcome: "unsolved" },
	signal,
	undefined,
	noPanelContext("/tmp/practice-b/session.jsonl"),
);
assert.equal(nothing.isError, true);
assert.match(nothing.content[0].text, /No problem is active/);

// ── cancel keeps the problem active ────────────────────────────────────────
const sessionC = "/tmp/practice-c/session.jsonl";
run = contextFor(sessionC, ["escape"]);
const cancelled = await problemTool.execute("pose-cancel", params, signal, undefined, run.ctx);
assert.equal(cancelled.details.status, "cancelled");
assert.deepEqual(cancelled.details, { status: "cancelled", title: "Locked door", attempt: 1 });
assert.equal(
	cancelled.content[0].text,
	"The learner closed the problem without submitting. It is still active.",
);

// Still active: another problem stays refused …
const stillBlocked = await problemTool.execute(
	"pose-blocked-after-cancel",
	otherParams,
	signal,
	undefined,
	noPanelContext(sessionC),
);
assert.equal(stillBlocked.isError, true);
assert.equal(
	stillBlocked.content[0].text,
	"A problem is already active (Locked door). Call conclude before posing another.",
);
// … and a re-pose continues the same problem at attempt 2.
run = contextFor(sessionC, ["x", "enter"]);
const secondAttempt = await problemTool.execute("pose-2-after-cancel", params, signal, undefined, run.ctx);
assert.equal(secondAttempt.details.attempt, 2, "a cancelled pose still counted as the first attempt");

// Concluding the cancelled problem reports its attempts and no verdict.
run = contextFor(sessionC, ["escape"]);
const dismissed = await concludeTool.execute("conclude-cancel", { outcome: "dismissed" }, signal, undefined, run.ctx);
assert.equal(dismissed.details.status, "concluded");
assert.equal(dismissed.details.attempts, 2);
assert.equal(dismissed.details.verdict, undefined);
assert.deepEqual(dismissed.details, {
	status: "concluded",
	title: "Locked door",
	outcome: "dismissed",
	solution,
	attempts: 2,
	targets: ["latch-spring", "service-key"],
	mode: "recall",
	verdict: undefined,
});

// ── state is keyed per session ─────────────────────────────────────────────
const sessionD = "/tmp/practice-d/session.jsonl";
run = contextFor(sessionD, ["escape"]);
await problemTool.execute("pose-d", params, signal, undefined, run.ctx);
const isolated = await concludeTool.execute(
	"conclude-isolated",
	{ outcome: "unsolved" },
	signal,
	undefined,
	contextFor("/tmp/practice-e/session.jsonl", ["enter"]).ctx,
);
assert.equal(isolated.isError, true, "a problem posed in one session is not active in another");

// ── guard paths ────────────────────────────────────────────────────────────
// An already-aborted turn never poses: nothing is stored, no panel opens, and
// the attempt count does not advance.
const aborted = new AbortController();
aborted.abort();
const abortedPose = await problemTool.execute(
	"pose-aborted",
	params,
	aborted.signal,
	undefined,
	noPanelContext("/tmp/practice-abort/session.jsonl"),
);
assert.equal(abortedPose.details.status, "cancelled");
assert.equal(abortedPose.details.attempt, 1);
const afterAbort = await concludeTool.execute(
	"conclude-after-abort",
	{ outcome: "dismissed" },
	signal,
	undefined,
	noPanelContext("/tmp/practice-abort/session.jsonl"),
);
assert.equal(afterAbort.isError, true, "an aborted pose stores nothing");

for (const [label, bad] of [
	["title", { ...params, title: "   " }],
	["statement", { ...params, statement: "" }],
	["modelSolution", { ...params, modelSolution: "  " }],
	["targets", { ...params, targets: [] }],
]) {
	const guard = await problemTool.execute(`guard-${label}`, bad, signal, undefined, noPanelContext("/tmp/practice-guard/session.jsonl"));
	assert.equal(guard.isError, true, `an empty ${label} is rejected`);
	assert.match(guard.content[0].text, new RegExp(label === "targets" ? "at least one target" : label));
}
const noUi = await problemTool.execute(
	"guard-ui",
	params,
	signal,
	undefined,
	{ hasUI: false, sessionManager: { getSessionFile: () => "/tmp/practice-guard/ui.jsonl" } },
);
assert.equal(noUi.isError, true);
assert.match(noUi.content[0].text, /interactive mode UI/);

// The cwd, then "anon", key the state when there is no session file.
__resetPracticeState();
const cwdRun = contextFor(undefined, ["c", "enter"]);
cwdRun.ctx.cwd = "/tmp/practice-cwd";
cwdRun.ctx.sessionManager = { getSessionFile: () => undefined };
await problemTool.execute("pose-cwd", params, signal, undefined, cwdRun.ctx);
const anonGuard = await concludeTool.execute(
	"conclude-anon",
	{ outcome: "solved" },
	signal,
	undefined,
	{ hasUI: false },
);
assert.equal(anonGuard.isError, true, "a cwd-keyed problem is not active under anon");
const cwdConclude = await concludeTool.execute(
	"conclude-cwd",
	{ outcome: "solved" },
	signal,
	undefined,
	{ hasUI: false, cwd: "/tmp/practice-cwd", sessionManager: { getSessionFile: () => undefined } },
);
assert.equal(cwdConclude.details.status, "concluded", "a cwd-keyed problem concludes without a session file");
assert.equal(cwdConclude.details.attempts, 1);

// ── transcript renders ─────────────────────────────────────────────────────
const render = (tool, result) => tool.renderResult(result, {}, theme).text;
const submittedRow = render(problemTool, first);
assert.match(submittedRow, /problem /);
assert.match(submittedRow, /Locked door/);
assert.match(submittedRow, /attempt 1/);
assert.match(submittedRow, /lever/);
assert.ok(!submittedRow.includes(solution), "the submitted row never leaks the solution");
assert.match(render(problemTool, cancelled), /still active/);
assert.match(render(problemTool, blocked), /A problem is already active/);
assert.match(render(concludeTool, concluded), /concluded /);
assert.match(render(concludeTool, concluded), /solved/);
assert.ok(render(concludeTool, concluded).includes(solution), "the concluded row shows the solution");
assert.match(render(concludeTool, nothing), /No problem is active/);
// A result with no structured details falls back to its text content.
assert.equal(render(problemTool, { content: [{ type: "text", text: "plain" }] }), "plain");
assert.equal(render(concludeTool, { content: [{ type: "text", text: "plain" }] }), "plain");

// Empty working is still a submission, and renders as such.
__resetPracticeState();
run = contextFor("/tmp/practice-f/session.jsonl", ["enter"]);
const emptyWork = await problemTool.execute(
	"pose-empty-work",
	{ ...params, title: "Empty" },
	signal,
	undefined,
	run.ctx,
);
assert.equal(emptyWork.details.status, "submitted");
assert.equal(emptyWork.details.work, "");
assert.match(render(problemTool, emptyWork), /submitted empty working/);

__resetPracticeState();
rmSync(tempRoot, { recursive: true, force: true });
console.log("practice tests passed");
