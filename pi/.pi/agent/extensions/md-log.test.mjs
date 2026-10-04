import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const jiti = createJiti(import.meta.url);
const mdLog = jiti("./md-log.ts");
const {
	journalPathFor,
	formatLessonEntry,
	formatQuizEntry,
	formatExplainEntry,
} = mdLog;
const extension = mdLog.default;

// ── pure helpers ─────────────────────────────────────────────────────────────

assert.equal(journalPathFor("/a/b/xyz.jsonl"), "/a/b/xyz.md");
assert.equal(journalPathFor("/a/b/session"), "/a/b/session.md");
assert.equal(journalPathFor("/a/b.v2/xyz.jsonl"), "/a/b.v2/xyz.md");

const lesson = formatLessonEntry("Priority ladder", "blocked > working > idle");
assert.ok(lesson.includes("## "), lesson);
assert.ok(lesson.includes("Lesson: Priority ladder"));
assert.ok(lesson.includes("blocked > working > idle"));

const quizEntry = formatQuizEntry({
	status: "answered",
	question: "What state does desiredState() report?",
	mode: "single-select",
	options: [
		{ index: 1, label: "working" },
		{ index: 2, label: "blocked" },
	],
	answers: [{ index: 2, label: "blocked" }],
	correctIndices: [2],
	correct: true,
	explanation: "blockedCount > 0 takes priority.",
});
assert.ok(quizEntry.includes("Quiz: What state does desiredState() report?"));
assert.ok(quizEntry.includes("✓ Correct"));
assert.ok(quizEntry.includes("✓ **2. blocked**"), "correct option is marked and bolded");
assert.ok(quizEntry.includes("1. working"));
assert.ok(quizEntry.includes("blockedCount > 0 takes priority."));

const dontKnowEntry = formatQuizEntry({
	status: "answered",
	question: "Q?",
	answers: [],
	correctIndices: [1],
	dontKnow: true,
});
assert.ok(dontKnowEntry.includes("Other — I don't know"));

const explainEntry = formatExplainEntry({
	status: "answered",
	question: "Where does the chosen state go next?",
	answer: "over the socket to herdr",
	grading: {
		verdict: "partially_correct",
		grade: "C",
		summary: "missed the report method name",
		correctAnswer: "pane.report_agent over the Unix socket",
		refinements: [
			{ quote: "over the socket", issue: "no method named", correction: "pane.report_agent" },
		],
	},
});
assert.ok(explainEntry.includes("Explain: Where does the chosen state go next?"));
assert.ok(explainEntry.includes("partially_correct — grade C"));
assert.ok(explainEntry.includes("> over the socket to herdr"));
assert.ok(explainEntry.includes("pane.report_agent over the Unix socket"));
assert.ok(explainEntry.includes("“over the socket”"));

const emptyExplainEntry = formatExplainEntry({
	status: "answered",
	question: "What happens next?",
});
assert.ok(emptyExplainEntry.includes("honest \"I don't know\""));

for (const status of ["cancelled", "unavailable"]) {
	const incompleteEntry = formatExplainEntry({ status, question: "What happens next?" });
	assert.ok(incompleteEntry.includes(`— ${status}`));
	assert.ok(!incompleteEntry.includes("I don't know"));
}

// ── extension wiring ─────────────────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), "md-log-"));
const sessionFile = join(dir, "sub", "session-abc.jsonl");

const handlers = new Map();
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
};
extension(pi);

const ctx = {
	sessionManager: { getSessionFile: () => sessionFile },
};

// A lesson fires before its quiz — journal order must match conversation order.
handlers.get("session_start")({}, ctx);
handlers.get("tool_execution_start")(
	{ toolName: "lesson", args: { title: "Priority ladder", body: "blocked > working > idle" } },
	ctx,
);
// Non-journal tools are ignored.
handlers.get("tool_execution_start")(
	{ toolName: "bash", args: { command: "ls" } },
	ctx,
);
handlers.get("tool_execution_end")(
	{
		toolName: "quiz",
		result: {
			details: {
				status: "answered",
				question: "What state wins?",
				options: [{ index: 1, label: "blocked" }, { index: 2, label: "working" }],
				answers: [{ index: 1, label: "blocked" }],
				correctIndices: [1],
				correct: true,
				explanation: "blockedCount > 0 takes priority.",
			},
		},
	},
	ctx,
);
handlers.get("tool_execution_end")(
	{
		toolName: "explain",
		result: {
			details: {
				status: "answered",
				question: "Where does the state go?",
				answer: "the socket",
				grading: {
					verdict: "incorrect",
					grade: "D",
					summary: "no method name",
					correctAnswer: "pane.report_agent over the Unix socket",
					refinements: [],
				},
			},
		},
	},
	ctx,
);

const journal = journalPathFor(sessionFile);
assert.ok(existsSync(journal), "journal should be created beside the session file");
const contents = readFileSync(journal, "utf-8");

assert.ok(contents.startsWith("# Lesson journal"), "journal gets a header on first write");
assert.ok(contents.includes("Lesson: Priority ladder"));
assert.ok(contents.includes("blocked > working > idle"));
assert.ok(contents.includes("Quiz: What state wins?"));
assert.ok(contents.includes("✓ Correct"));
assert.ok(contents.includes("Explain: Where does the state go?"));
assert.ok(contents.includes("incorrect — grade D"));
// Conversation order preserved: lesson before quiz before explain.
assert.ok(
	contents.indexOf("Lesson: Priority ladder") <
		contents.indexOf("Quiz: What state wins?") &&
		contents.indexOf("Quiz: What state wins?") <
		contents.indexOf("Explain: Where does the state go?"),
	"entries must be appended in conversation order",
);
assert.ok(!contents.includes("bash"), "non-journal tools must not be logged");

// Without a session file and without PI_LESSON_JOURNAL, appends are no-ops.
const noSessionHandlers = new Map();
const pi2 = { on: (e, h) => noSessionHandlers.set(e, h) };
extension(pi2);
const noCtx = { sessionManager: { getSessionFile: () => undefined } };
noSessionHandlers.get("tool_execution_start")(
	{ toolName: "lesson", args: { title: "T", body: "B" } },
	noCtx,
); // must not throw

rmSync(dir, { recursive: true, force: true });

console.log("md-log tests passed");
