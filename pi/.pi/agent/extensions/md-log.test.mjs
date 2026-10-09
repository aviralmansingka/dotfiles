import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// md-log imports nvim-open (value imports from the peers), so stub them.
const tempRoot = mkdtempSync(join(tmpdir(), "md-log-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubTui, "module.exports = {};\n"); // nvim-open rendering is not exercised here.
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
	},
});
const mdLog = jiti("./md-log.ts");
const {
	journalPathFor,
	probesPathFor,
	resolveJournalPath,
	formatLessonEntry,
	formatQuizEntry,
	formatExplainEntry,
	buildOverview,
} = mdLog;
const extension = mdLog.default;

// ── pure helpers ─────────────────────────────────────────────────────────────

assert.equal(journalPathFor("/a/b/xyz.jsonl"), "/a/b/xyz.md");
assert.equal(probesPathFor("/a/b/xyz.md"), "/a/b/xyz-probes.md");
assert.equal(journalPathFor("/a/b/session"), "/a/b/session.md");
assert.equal(journalPathFor("/a/b.v2/xyz.jsonl"), "/a/b.v2/xyz.md");

const savedJournalOverride = process.env.PI_LESSON_JOURNAL;
process.env.PI_LESSON_JOURNAL = "notes/course.md";
assert.equal(
	resolveJournalPath({ cwd: "/workspace/project" }),
	"/workspace/project/notes/course.md",
	"relative overrides resolve against the agent cwd",
);
if (savedJournalOverride === undefined) delete process.env.PI_LESSON_JOURNAL;
else process.env.PI_LESSON_JOURNAL = savedJournalOverride;

const lesson = formatLessonEntry("Priority ladder", "blocked > working > idle");
// The heading is the lesson's own title — no timestamp in headings. The
// stamp and entry type ride a metadata line under the heading.
assert.ok(lesson.startsWith("## Priority ladder\n"), lesson);
assert.ok(lesson.includes("_Lesson · "), lesson);
assert.ok(lesson.includes(" UTC_"), lesson);
assert.ok(lesson.includes("blocked > working > idle"));
// The stamp still carries the date, not just the time (arcs span days).
assert.match(lesson, /_Lesson · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC_/m);
// No timestamp in the heading itself.
assert.doesNotMatch(lesson, /^## \d{4}/m);

// A lesson body's own headings are demoted one level under the entry heading.
const nestedLesson = formatLessonEntry("T", "## Section\nbody");
assert.ok(nestedLesson.includes("\n### Section\n"), nestedLesson);

const quizEntry = formatQuizEntry({
	status: "answered",
	title: "Node A — state priority",
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
// The heading is the quiz's own short title (node + teaching goal).
assert.ok(quizEntry.startsWith("## Node A — state priority\n"), quizEntry);
assert.ok(quizEntry.includes("_Quiz · ✓ Correct · "), quizEntry);
assert.ok(!/^## \d{4}/m.test(quizEntry), "no timestamp in the heading");
assert.ok(quizEntry.includes("**Question:** What state does desiredState() report?"));
assert.ok(quizEntry.includes("- ✓ **2.** blocked"), "selected-and-correct option is marked and bolded");
assert.ok(quizEntry.includes("\n- 1. working"), "unselected incorrect option stays plain, no mark");
assert.ok(quizEntry.includes("**Why:** blockedCount > 0 takes priority."));
// Emphasis metacharacters in option labels are escaped (M*K is multiplication).
const starredQuiz = formatQuizEntry({
	status: "answered",
	question: "Q?",
	options: [{ index: 1, label: "M*K + K*N" }],
	answers: [{ index: 1, label: "M*K + K*N" }],
	correctIndices: [1],
	correct: true,
});
assert.ok(starredQuiz.includes("M\\*K"), starredQuiz);
assert.ok(!starredQuiz.includes("M*K +"), "unescaped * would render as emphasis");
// The quiz context/details field is journaled too.
assert.ok(
	formatQuizEntry({ status: "answered", question: "Q?", context: "use the ladder" })
		.includes("**Context:** use the ladder"),
);

const dontKnowEntry = formatQuizEntry({
	status: "answered",
	question: "Q?",
	answers: [],
	correctIndices: [1],
	dontKnow: true,
});
assert.ok(dontKnowEntry.includes("Quiz · ◐ Other — I don't know"));
assert.ok(dontKnowEntry.startsWith("## Quiz\n"), "untitled quiz falls back to a plain heading");

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
assert.ok(explainEntry.includes("Explain · ◐ partially correct — grade C"));
assert.ok(!/^## \d{4}/m.test(explainEntry), "no timestamp in the heading");
const titledExplain = formatExplainEntry({
	status: "answered",
	title: "Node F — control vs data plane",
	question: "Where does the chosen state go next?",
});
assert.ok(titledExplain.startsWith("## Node F — control vs data plane\n"), titledExplain);
assert.ok(explainEntry.includes("**Question:** Where does the chosen state go next?"));
assert.ok(explainEntry.includes("**Your answer:**"));
assert.ok(explainEntry.includes("> over the socket to herdr"));
assert.ok(explainEntry.includes("**Correct answer:** pane.report_agent over the Unix socket"));
assert.ok(explainEntry.includes("“over the socket”"));

const emptyExplainEntry = formatExplainEntry({
	status: "answered",
	question: "What happens next?",
});
assert.ok(emptyExplainEntry.includes("honest \"I don't know\""));

for (const status of ["cancelled", "unavailable"]) {
	const incompleteEntry = formatExplainEntry({ status, question: "What happens next?" });
	assert.ok(incompleteEntry.includes(`Explain · ${status}`));
	assert.ok(!incompleteEntry.includes("I don't know"));
}

// ── extension wiring ─────────────────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), "md-log-"));
let sessionFile = join(dir, "sub", "session-abc.jsonl");

const handlers = new Map();
const commands = new Map();
const shortcuts = new Map();
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
	registerCommand(name, def) {
		commands.set(name, def);
	},
	registerShortcut(key, def) {
		shortcuts.set(key, def);
	},
};
extension(pi);

// The any-time commands: /lessons opens the journal, /probes the probe log.
assert.equal(commands.size, 2);
assert.ok(commands.has("lessons"), "/lessons command should be registered");
assert.equal(typeof commands.get("lessons").handler, "function");
assert.ok(commands.has("probes"), "/probes command should be registered");
assert.equal(typeof commands.get("probes").handler, "function");

// The global shortcut: ctrl+h focuses the current view (node buffer, else
// overview) — never the whole journal file.
assert.equal(shortcuts.size, 1);
assert.ok(shortcuts.has("ctrl+h"), "ctrl+h global shortcut should be registered");
assert.equal(typeof shortcuts.get("ctrl+h").handler, "function");

const ctx = {
	sessionManager: { getSessionFile: () => sessionFile },
};

assert.equal(handlers.has("session_start"), false, "journal logging is event-only");

// A lesson fires before its quiz — journal order must match conversation order.
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
assert.ok(contents.includes("## Priority ladder"));
assert.ok(contents.includes("_Lesson · "));
assert.ok(contents.includes("blocked > working > idle"));
assert.ok(contents.includes("Quiz · ✓ Correct"));
assert.ok(contents.includes("**Question:** What state wins?"));
assert.ok(contents.includes("Explain · ✗ incorrect — grade D"));
// Entries are separated by horizontal rules.
assert.ok(contents.includes("\n---\n\n## "), "entries are rule-separated");
// Conversation order preserved: lesson before quiz before explain.
const lessonIndex = contents.indexOf("## Priority ladder");
const quizIndex = contents.indexOf("**Question:** What state wins?");
const explainIndex = contents.indexOf("**Question:** Where does the state go?");
assert.notEqual(lessonIndex, -1, "lesson entry marker must exist");
assert.notEqual(quizIndex, -1, "quiz entry marker must exist");
assert.notEqual(explainIndex, -1, "explain entry marker must exist");
assert.ok(
	lessonIndex < quizIndex && quizIndex < explainIndex,
	"entries must be appended in conversation order",
);
assert.ok(!contents.includes("bash"), "non-journal tools must not be logged");

// Probe-stage checks land in the probe log, never the journal.
const journalBeforeProbe = readFileSync(journal, "utf-8");
handlers.get("tool_execution_start")(
	{ toolCallId: "probe-1", toolName: "quiz", args: { stage: "probe" } },
	ctx,
);
handlers.get("tool_execution_end")(
	{
		toolCallId: "probe-1",
		toolName: "quiz",
		result: {
			details: {
				status: "answered",
				title: "Probe — window model",
				question: "What does the window limit?",
				options: [{ index: 1, label: "bytes in flight" }, { index: 2, label: "packet rate" }],
				answers: [{ index: 1, label: "bytes in flight" }],
				correctIndices: [1],
				correct: false,
				explanation: "It limits unacknowledged bytes.",
			},
		},
	},
	ctx,
);
const probes = probesPathFor(journal);
assert.equal(probes, join(dir, "sub", "session-abc-probes.md"), "probe log sits beside the journal");
assert.ok(existsSync(probes), "probe log should be created");
const probeContents = readFileSync(probes, "utf-8");
assert.ok(probeContents.startsWith("# Probe log"), "probe log gets its own header");
assert.ok(probeContents.includes("## Probe — window model"));
assert.ok(probeContents.includes("Quiz · ✗ Incorrect"));
assert.equal(
	readFileSync(journal, "utf-8"),
	journalBeforeProbe,
	"a probe must not append to the teaching journal",
);

// A quiz whose start event was never seen defaults to the journal.
handlers.get("tool_execution_end")(
	{
		toolCallId: "unseen-1",
		toolName: "quiz",
		result: {
			details: {
				status: "answered",
				title: "Missed start",
				question: "Defaults where?",
				options: [{ index: 1, label: "journal" }],
				answers: [{ index: 1, label: "journal" }],
				correctIndices: [1],
				correct: true,
				explanation: "Stage unknown means teaching.",
			},
		},
	},
	ctx,
);
assert.ok(
	readFileSync(journal, "utf-8").includes("## Missed start"),
	"an untagged end event defaults to the journal",
);
assert.ok(
	!readFileSync(probes, "utf-8").includes("## Missed start"),
	"the untagged entry must not reach the probe log",
);

// The overview rebuilds the arc from the journal: current position and
// per-node verdicts — the resumable view h/ctrl+h show before a live node.
const overview = buildOverview(journal);
assert.ok(overview.includes("Current position: Priority ladder"), "overview names the current node");
assert.ok(overview.includes("- Priority ladder ✓✗"), "overview carries per-node verdict marks");
assert.ok(overview.includes("session-abc-probes.md"), "overview points at the probe log");
const emptyOverview = buildOverview(join(dir, "nope.md"));
assert.ok(
	emptyOverview.includes("No lesson history yet"),
	"an absent journal yields the pre-lesson overview",
);

sessionFile = join(dir, "sub", "session-def.jsonl");
handlers.get("tool_execution_start")(
	{ toolName: "lesson", args: { title: "New session", body: "fresh journal" } },
	ctx,
);
const nextJournal = journalPathFor(sessionFile);
assert.ok(existsSync(nextJournal), "a changed session gets its own journal");
assert.ok(readFileSync(nextJournal, "utf-8").includes("## New session"));
assert.ok(
	!readFileSync(journal, "utf-8").includes("## New session"),
	"a changed session must not append to the previous journal",
);

// Without a session file and without PI_LESSON_JOURNAL, appends are no-ops.
const noSessionHandlers = new Map();
const pi2 = {
	on: (e, h) => noSessionHandlers.set(e, h),
	registerCommand: () => {},
	registerShortcut: () => {},
};
extension(pi2);
const noCtx = { sessionManager: { getSessionFile: () => undefined } };
noSessionHandlers.get("tool_execution_start")(
	{ toolName: "lesson", args: { title: "T", body: "B" } },
	noCtx,
); // must not throw

// ── cross-session continuity ───────────────────────────────────────
// A fresh session's journal has no lessons; the overview must fall back to
// the most recent lesson-bearing journal in the same session directory, so
// a restarted or resumed professor still sees the arc.
const emptyJournal = journalPathFor(join(dir, "sub", "session-fresh.jsonl"));
writeFileSync(emptyJournal, "# Lesson journal\n\n");
const resumedOverview = buildOverview(emptyJournal);
// session-def.md is the most recently written lesson-bearing journal in
// the directory at this point, so the arc position is its last lesson.
assert.ok(
	resumedOverview.includes("Current position: New session"),
	"a fresh session's overview falls back to the arc journal",
);
assert.ok(
	resumedOverview.includes("Node progress:"),
	"the fallback overview carries the arc's node list",
);
// The fallback prefers the NEWEST lesson-bearing journal in the directory.
const newerArc = journalPathFor(join(dir, "sub", "session-newer.jsonl"));
writeFileSync(
	newerArc,
	"# Lesson journal\n\n---\n\n## Later arc node\n\n_Lesson · 2026-10-09 12:00 UTC_\n\nbody\n",
);
const newestOverview = buildOverview(emptyJournal);
assert.ok(
	newestOverview.includes("Current position: Later arc node"),
	"continuity prefers the most recent lesson-bearing journal",
);

rmSync(dir, { recursive: true, force: true });
rmSync(tempRoot, { recursive: true, force: true });

console.log("md-log tests passed");
