import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
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
	buildExtractionPrompt,
	resolveVaultDir,
	buildOverview,
	lastLessonFromJournal,
	openJournalInEditor,
	openProbesInEditor,
	openNodeView,
	presentLesson,
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

// L1: the override is read PER EVENT — an absolute override wins verbatim,
// and clearing it restores session-file resolution on the next call.
const savedOverrideForL1 = process.env.PI_LESSON_JOURNAL;
try {
	process.env.PI_LESSON_JOURNAL = "/abs/course.md";
	assert.equal(
		resolveJournalPath({ cwd: "/workspace/project" }),
		"/abs/course.md",
		"an absolute override wins verbatim, whatever the cwd",
	);
	delete process.env.PI_LESSON_JOURNAL;
	assert.equal(
		resolveJournalPath({ sessionManager: { getSessionFile: () => "/tmp/s/x.jsonl" } }),
		"/tmp/s/x.md",
		"clearing the override restores session resolution on the very next call",
	);
	// Guards: a relative session file is not a journal; a failing session
	// manager means no journal, never a throw.
	assert.equal(
		resolveJournalPath({ sessionManager: { getSessionFile: () => "relative.jsonl" } }),
		undefined,
		"a relative session file yields no journal",
	);
	assert.equal(
		resolveJournalPath({ sessionManager: { getSessionFile: () => { throw new Error("boom"); } } }),
		undefined,
		"a failing session manager yields no journal, not a throw",
	);
} finally {
	if (savedOverrideForL1 === undefined) delete process.env.PI_LESSON_JOURNAL;
	else process.env.PI_LESSON_JOURNAL = savedOverrideForL1;
}

// Probes stay separate whatever the journal is named (PI_LESSON_JOURNAL can
// name a non-.md file): the probe log is a sibling file, never the journal.
assert.equal(probesPathFor("/a/b/xyz.md"), "/a/b/xyz-probes.md");
assert.equal(
	probesPathFor("/a/b/course.markdown"),
	"/a/b/course.markdown-probes.md",
	"a non-.md journal still gets a separate probe log",
);
assert.equal(probesPathFor("/a/b/notes"), "/a/b/notes-probes.md");

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
// Demotion caps at ###### — a level-6 body heading stays level 6, and no
// seventh hash is ever produced.
const cappedLesson = formatLessonEntry("T", "# Top\n##### Deep\n###### Max");
assert.ok(cappedLesson.includes("\n## Top\n"), "a body H1 demotes under the ## entry heading");
assert.ok(cappedLesson.includes("\n###### Deep\n"), cappedLesson);
assert.ok(cappedLesson.includes("\n###### Max\n"), "a level-6 body heading stays level 6");
assert.ok(!/#{7}/.test(cappedLesson), "demotion never creates a seventh hash");
assert.ok(
	formatLessonEntry("T", "####### Not a heading").includes("\n####### Not a heading\n"),
	"seven hashes are not a heading and stay verbatim",
);

// Entry stamps carry the DATE, and each entry is stamped from the clock at
// its own format call — next-day entries must not read as same-day.
const RealDate = Date;
let fakeNow = Date.UTC(2026, 9, 8, 23, 59);
globalThis.Date = class extends RealDate {
	constructor(...args) { super(...(args.length ? args : [fakeNow])); }
};
try {
	const lateNight = formatLessonEntry("T", "B");
	fakeNow = Date.UTC(2026, 9, 9, 0, 1);
	const nextDay = formatQuizEntry({ status: "answered", question: "Q?" });
	assert.match(lateNight, /_Lesson · 2026-10-08 23:59 UTC_/);
	assert.match(nextDay, /_Quiz · [✓✗] [A-Za-z —']+ · 2026-10-09 00:01 UTC_/);
} finally {
	globalThis.Date = RealDate;
}

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
// The learner's optional thinking is journaled verbatim as a blockquote,
// between the option list and the explanation.
const thinkingQuiz = formatQuizEntry({
	status: "answered",
	title: "Node A — state priority",
	question: "What state does desiredState() report?",
	options: [
		{ index: 1, label: "working" },
		{ index: 2, label: "blocked" },
	],
	answers: [{ index: 2, label: "blocked" }],
	correctIndices: [2],
	correct: true,
	thinking: "blocked wins because the counter is non-zero\nso it takes priority",
	explanation: "blockedCount > 0 takes priority.",
});
assert.ok(thinkingQuiz.includes("\n**Your thinking:**\n\n> blocked wins"), thinkingQuiz);
assert.ok(thinkingQuiz.includes("\n> so it takes priority"), "every thinking line is quoted");
assert.ok(
	thinkingQuiz.indexOf("**Your thinking:**") > thinkingQuiz.indexOf("- ✓ **2.** blocked"),
	"thinking sits after the option list",
);
assert.ok(
	thinkingQuiz.indexOf("**Your thinking:**") < thinkingQuiz.indexOf("**Why:**"),
	"thinking sits before the explanation",
);
// An empty or missing thinking field adds nothing to the entry.
assert.ok(!quizEntry.includes("**Your thinking:**"));
assert.ok(
	!formatQuizEntry({ status: "answered", question: "Q?", thinking: "   " }).includes("**Your thinking:**"),
	"blank thinking is never journaled",
);
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
// Underscores are the same italics bug class: word underscores in option
// labels (state_machine) must be escaped, not rendered as emphasis.
const underscoredQuiz = formatQuizEntry({
	status: "answered",
	question: "Q?",
	options: [{ index: 1, label: "state_machine" }],
	answers: [{ index: 1, label: "state_machine" }],
	correctIndices: [1],
	correct: true,
});
assert.ok(underscoredQuiz.includes("state\\_machine"), underscoredQuiz);
assert.ok(!underscoredQuiz.includes("state_machine"), "unescaped _ would render as emphasis");
// Inline-code backticks in labels are escaped too.
const backtickedQuiz = formatQuizEntry({
	status: "answered",
	question: "Q?",
	options: [{ index: 1, label: "a`b`c" }],
	answers: [{ index: 1, label: "a`b`c" }],
	correctIndices: [1],
	correct: true,
});
assert.ok(backtickedQuiz.includes("a\\`b\\`c"), backtickedQuiz);
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

// L2: verdict glyphs and option marks across the multi-select matrix.
const multiSelect = formatQuizEntry({
	status: "answered",
	mode: "multi-select",
	question: "Pick every state that wins over idle",
	options: [
		{ index: 1, label: "blocked" },
		{ index: 2, label: "working" },
		{ index: 3, label: "dreaming" },
	],
	answers: [
		{ index: 1, label: "blocked" },
		{ index: 3, label: "dreaming" },
	],
	correctIndices: [1, 2],
});
assert.ok(multiSelect.startsWith("## multi-select\n"), "an untitled multi-select falls back to the mode heading");
assert.ok(multiSelect.includes("_multi-select · "), multiSelect);
assert.ok(multiSelect.includes("- ✓ **1.** blocked"), "selected-and-correct keeps its mark and bold index");
assert.ok(multiSelect.includes("\n- ✓ 2. working"), "correct-but-unselected is marked, never bolded as chosen");
assert.ok(multiSelect.includes("- ✗ **3.** dreaming"), "selected-but-incorrect carries the wrong mark");
// Without `options`, the answers list is what was displayed.
const answersOnly = formatQuizEntry({
	status: "answered",
	question: "Q?",
	answers: [{ index: 1, label: "journal" }],
	correctIndices: [1],
	correct: true,
});
assert.ok(answersOnly.includes("- ✓ **1.** journal"), answersOnly);
// A non-answered quiz passes its status through as the verdict.
assert.ok(
	formatQuizEntry({ status: "cancelled", question: "Q?" }).includes("Quiz · cancelled"),
	"a cancelled quiz records the status, not a verdict glyph",
);
// The steering field is journaled as a labeled line.
assert.ok(
	formatQuizEntry({ status: "answered", question: "Q?", followUp: "rebuild the ladder" })
		.includes("**Steering:** rebuild the ladder"),
);

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
assert.ok(
	formatExplainEntry({
		status: "answered",
		question: "Q?",
		grading: { verdict: "correct", grade: "A", summary: "s", correctAnswer: "ca" },
	}).includes("Explain · ✓ correct — grade A"),
	"a correct explain carries the ✓ glyph",
);
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

// The any-time commands: /lessons opens the journal, /probes the probe log,
// /extract hands the journal to the vault extraction contract.
assert.equal(commands.size, 3);
assert.ok(commands.has("lessons"), "/lessons command should be registered");
assert.equal(typeof commands.get("lessons").handler, "function");
assert.ok(commands.has("probes"), "/probes command should be registered");
assert.equal(typeof commands.get("probes").handler, "function");
assert.ok(commands.has("extract"), "/extract command should be registered");
assert.equal(typeof commands.get("extract").handler, "function");

// /extract's prompt is self-contained: the journal to read, the propositions
// directory to link or create in, and the skill section that owns the format.
{
	const prompt = buildExtractionPrompt("/sessions/session-abc.md", "/home/learner/vault");
	assert.ok(prompt.includes("/sessions/session-abc.md"), "the prompt names the journal");
	assert.ok(
		prompt.includes("/home/learner/vault/2_knowledge/propositions"),
		"the prompt names the propositions directory",
	);
	assert.ok(
		prompt.includes(join(homedir(), ".agents", "skills", "professor", "SKILL.md")),
		"the prompt names the professor skill",
	);
	assert.ok(prompt.includes("Knowledge extraction"), "the prompt names the contract section");
	assert.match(prompt, /Read the journal fully/i);
	assert.match(prompt, /review fields of an existing note/i);
}

// The vault root follows PI_VAULT_DIR, else ~/vault.
{
	const savedVault = process.env.PI_VAULT_DIR;
	try {
		delete process.env.PI_VAULT_DIR;
		assert.equal(resolveVaultDir(), join(homedir(), "vault"));
		process.env.PI_VAULT_DIR = "/tmp/other-vault";
		assert.equal(resolveVaultDir(), "/tmp/other-vault", "PI_VAULT_DIR wins");
	} finally {
		if (savedVault === undefined) delete process.env.PI_VAULT_DIR;
		else process.env.PI_VAULT_DIR = savedVault;
	}
}

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
// A journal that exists but carries no lessons yields the same pre-lesson
// view (isolated directory, so no arc fallback can kick in).
const lessonlessDir = mkdtempSync(join(tmpdir(), "md-log-empty-"));
const lessonless = join(lessonlessDir, "e.md");
writeFileSync(lessonless, "# Lesson journal\n\n");
assert.ok(
	buildOverview(lessonless).includes("No lesson history yet"),
	"a lesson-free journal yields the pre-lesson overview",
);
rmSync(lessonlessDir, { recursive: true, force: true });

// The durable current-node fallback: the LAST lesson's node title, read
// from the journal — what a fresh process or a resumed session uses.
assert.equal(lastLessonFromJournal(undefined), undefined);
assert.equal(lastLessonFromJournal(join(dir, "nope.md")), undefined);
assert.equal(
	lastLessonFromJournal(journal),
	"Priority ladder",
	"the last lesson entry names the current node",
);
const multiLessonDir = mkdtempSync(join(tmpdir(), "md-log-multi-"));
const multiLesson = join(multiLessonDir, "m.md");
writeFileSync(
	multiLesson,
	"# Lesson journal\n\n---\n\n## First node\n\n_Lesson · 2026-10-08 10:00 UTC_\n\nbody\n\n---\n\n## Quiz title\n\n_Quiz · ✓ Correct · 2026-10-08 10:05 UTC_\n\n**Question:** q\n\n---\n\n## Last node\n\n_Lesson · 2026-10-08 11:00 UTC_\n\nbody\n",
);
assert.equal(
	lastLessonFromJournal(multiLesson),
	"Last node",
	"the newest lesson wins when a journal has several",
);
rmSync(multiLessonDir, { recursive: true, force: true });

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

// L1 regression class: after a session switch (/resume, /new, /fork), every
// LATER event resolves the journal again — quizzes land in the NEW session's
// journal and probes in the NEW session's probe log, never the old ones.
handlers.get("tool_execution_end")(
	{
		toolCallId: "def-quiz",
		toolName: "quiz",
		result: {
			details: {
				status: "answered",
				title: "Def quiz",
				question: "Fresh session?",
				options: [{ index: 1, label: "yes" }],
				answers: [{ index: 1, label: "yes" }],
				correctIndices: [1],
				correct: true,
			},
		},
	},
	ctx,
);
assert.ok(
	readFileSync(nextJournal, "utf-8").includes("## Def quiz"),
	"a quiz after the session switch lands in the new journal",
);
assert.ok(
	!readFileSync(journal, "utf-8").includes("## Def quiz"),
	"a quiz after the session switch must not reach the old journal",
);
handlers.get("tool_execution_start")(
	{ toolCallId: "def-probe", toolName: "explain", args: { stage: "probe" } },
	ctx,
);
handlers.get("tool_execution_end")(
	{
		toolCallId: "def-probe",
		toolName: "explain",
		result: {
			details: {
				status: "answered",
				question: "Fresh probe?",
				answer: "a",
				grading: { verdict: "correct", grade: "A", summary: "s", correctAnswer: "ca" },
			},
		},
	},
	ctx,
);
const defProbes = probesPathFor(nextJournal);
assert.ok(existsSync(defProbes), "a probe after the switch creates the new session's probe log");
assert.ok(readFileSync(defProbes, "utf-8").includes("**Question:** Fresh probe?"));
assert.ok(
	!readFileSync(defProbes, "utf-8").includes("**Question:** What does the window limit?"),
	"the old session's probes must never reach the new probe log",
);
assert.ok(
	!readFileSync(probes, "utf-8").includes("**Question:** Fresh probe?"),
	"the new session's probes must never reach the old probe log",
);

// A non-.md journal override still keeps probes out of the journal itself.
const savedOverrideForProbes = process.env.PI_LESSON_JOURNAL;
const overrideJournal = join(dir, "ovr", "course.txt");
try {
	process.env.PI_LESSON_JOURNAL = overrideJournal;
	handlers.get("tool_execution_start")(
		{ toolCallId: "ovr-probe", toolName: "quiz", args: { stage: "probe" } },
		ctx,
	);
	handlers.get("tool_execution_end")(
		{
			toolCallId: "ovr-probe",
			toolName: "quiz",
			result: {
				details: {
					status: "answered",
					title: "Ovr probe",
					question: "Where do probes go?",
						options: [{ index: 1, label: "separate file" }],
						answers: [{ index: 1, label: "separate file" }],
						correctIndices: [1],
						correct: true,
					},
				},
			},
		ctx,
	);
	assert.ok(
		existsSync(`${overrideJournal}-probes.md`),
		"a non-.md journal override still routes probes to a separate file",
	);
	assert.ok(
		!existsSync(overrideJournal),
		"a probe must never create or append the journal itself",
	);
} finally {
	if (savedOverrideForProbes === undefined) delete process.env.PI_LESSON_JOURNAL;
	else process.env.PI_LESSON_JOURNAL = savedOverrideForProbes;
}

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
// Regression: journals written in quick succession can share an mtime (the
// kernel records inode timestamps on a coarse tick grid, so a restarted
// professor's second journal can land in the same tick as the first — this
// exact tie flaked CI nondeterministically). The fallback must stay
// deterministic on a tie: name order, never readdirSync hash order. The tie
// is pinned one second into the past so a later writeFileSync (whose mtime
// comes from the coarse clock) is always strictly newer.
const tieDir = mkdtempSync(join(tmpdir(), "md-log-tie-"));
const tieAbc = join(tieDir, "session-abc.md");
const tieDef = join(tieDir, "session-def.md");
const tieFresh = join(tieDir, "session-fresh.md");
writeFileSync(tieAbc, "# Lesson journal\n\n---\n\n## Old arc node\n\n_Lesson · 2026-10-09 12:00 UTC_\n\nbody\n");
writeFileSync(tieDef, "# Lesson journal\n\n---\n\n## New session\n\n_Lesson · 2026-10-09 12:00 UTC_\n\nbody\n");
writeFileSync(tieFresh, "# Lesson journal\n\n");
const tieTime = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000);
for (const tied of [tieAbc, tieDef, tieFresh]) utimesSync(tied, tieTime, tieTime);
const tiedOverview = buildOverview(tieFresh);
assert.ok(
	tiedOverview.includes("Current position: New session"),
	"an mtime tie falls back deterministically, never by readdir order",
);
rmSync(tieDir, { recursive: true, force: true });
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

// ── L3: openJournalInEditor / presentLesson / openNodeView against a fake editor ─
// House pattern: fake herdr/nvim shell binaries on PATH before the calls; a
// real spawned listener process carries --listen in /proc/<pid>/cmdline so
// editorSocketPath resolves its socket exactly as in production. The fake
// herdr models #294's nvim-open per pane: only panes whose `pane run`
// command started nvim report an nvim foreground process, so the launch
// path is observable in a fresh tab: exactly ONE split, then the retry.
const hasProc = existsSync("/proc");
if (hasProc) {
	const binDir = join(tempRoot, "bin");
	const stateDir = join(tempRoot, "state");
	const runDir = join(tempRoot, "run");
	const harnessTmp = join(tempRoot, "hr-tmp");
	mkdirSync(join(stateDir), { recursive: true });
	mkdirSync(binDir, { recursive: true });
	mkdirSync(runDir, { recursive: true });
	mkdirSync(harnessTmp, { recursive: true });
	const readState = (name, fallback) => {
		try { return readFileSync(join(stateDir, name), "utf-8").trim(); } catch { return fallback; }
	};
	writeFileSync(join(binDir, "nvim"), [
		"#!/usr/bin/env node",
		"const fs = require('node:fs');",
		"const args = process.argv.slice(2);",
		"if (args[0] === '--listen') {",
		"	// Listener mode: stay alive so /proc/<pid>/cmdline keeps --listen.",
		"	setInterval(() => {}, 1 << 30);",
		"} else {",
		"	if (args[0] === '--server') {",
		"		const i = args.indexOf('--remote-expr');",
		"		if (i !== -1) {",
		"			if (args[i + 1] === '1') process.exit(0);",
		"			const state = process.env.FAKE_NVIM_STATE;",
		"			if (state && fs.existsSync(state + '/nvim-fail')) process.exit(1);",
		"			const m = args[i + 1].match(/readfile\\(\"([^\"]+)\"\\)/);",
		"			let lua = '';",
		"			try { lua = m ? fs.readFileSync(m[1], 'utf-8') : ''; } catch {}",
		"			console.log(lua.indexOf('return \"missing\"') === -1 ? 'ok' : 'missing');",
		"		}",
		"	}",
		"	process.exit(0);",
		"}",
	].join("\n"), "utf-8");
	chmodSync(join(binDir, "nvim"), 0o755);
	// Fake herdr answering #294's nvim-open call shapes: pane current, pane
	// list (including split-created panes, per tab), pane process-info (the
	// registry liveness probe AND the editor scan), pane split, pane run (the
	// pane command starts nvim, so the editor arrives in that pane), pane
	// close, pane neighbor, pane focus, pane send-text. State files drive
	// it: tab-id, nvim-panes.json, split-panes.json, split-count,
	// send-text.log, editor-pid.
	writeFileSync(join(binDir, "herdr"), [
		"#!/usr/bin/env node",
		"const fs = require('node:fs');",
		"const path = require('node:path');",
		"const state = process.env.FAKE_HERDR_STATE;",
		"const args = process.argv.slice(2);",
		"const cmd = args.join(' ');",
		"const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };",
		"const read = (f, d) => { try { return fs.readFileSync(f, 'utf-8').trim(); } catch { return d; } };",
		"const readJson = (f, d) => { try { const v = JSON.parse(read(f, 'null')); return v === null ? d : v; } catch { return d; } };",
		"const tab = () => read(path.join(state, 'tab-id'), 't1');",
		"const nvimPanes = () => readJson(path.join(state, 'nvim-panes.json'), []);",
		"if (cmd === 'pane current') {",
		"	out({ result: { pane: { pane_id: 'w1:p1', tab_id: tab(), cwd: '/tmp' } } });",
		"} else if (cmd.startsWith('pane list')) {",
		"	const panes = [",
		"		{ pane_id: 'w1:p1', tab_id: tab(), cwd: '/tmp' },",
		"		{ pane_id: 'w1:p2', tab_id: tab(), cwd: '/tmp' },",
		"	];",
		"	for (const sp of readJson(path.join(state, 'split-panes.json'), [])) {",
		"		panes.push({ pane_id: sp.pane_id, tab_id: sp.tab_id, cwd: '/tmp' });",
		"	}",
		"	out({ result: { panes } });",
		"} else if (cmd.startsWith('pane process-info')) {",
		"	const pane = args[args.indexOf('--pane') + 1];",
		"	const pid = Number(read(path.join(state, 'editor-pid'), '0'));",
		"	if (nvimPanes().includes(pane) && pid) {",
		"		out({ result: { process_info: { pane_id: pane, foreground_processes: [{ name: 'nvim', pid, argv: ['nvim'] }] } } });",
		"	} else {",
		"		out({ result: { process_info: { pane_id: pane, foreground_processes: [{ name: 'zsh', pid: 4242, argv: ['zsh'] }] } } });",
		"	}",
		"} else if (cmd.startsWith('pane split')) {",
		"	const splits = readJson(path.join(state, 'split-panes.json'), []);",
		"	const paneId = 'w1:p' + (9 + splits.length);",
		"	splits.push({ pane_id: paneId, tab_id: tab() });",
		"	fs.writeFileSync(path.join(state, 'split-panes.json'), JSON.stringify(splits));",
		"	fs.writeFileSync(path.join(state, 'split-count'), String(Number(read(path.join(state, 'split-count'), '0')) + 1));",
		"	out({ result: { pane: { pane_id: paneId } } });",
		"} else if (cmd.startsWith('pane run')) {",
		"	// The pane command starts nvim with --listen: the editor arrives.",
		"	if (args.slice(3).join(' ').includes('nvim')) {",
		"		const nvim = nvimPanes();",
		"		nvim.push(args[2]);",
		"		fs.writeFileSync(path.join(state, 'nvim-panes.json'), JSON.stringify(nvim));",
		"	}",
		"	process.exit(0);",
		"} else if (cmd.startsWith('pane send-text')) {",
		"	fs.appendFileSync(path.join(state, 'send-text.log'), args.slice(2).join(' ') + '\\n');",
		"	process.exit(0);",
		"} else if (cmd.startsWith('pane neighbor')) {",
		"	const nvim = nvimPanes();",
		"	if (nvim.length) out({ result: { neighbor: { neighbor_pane_id: nvim[0] } } });",
		"	else process.exit(1);",
		"} else if (cmd.startsWith('pane close')) {",
		"	const pane = args[2];",
		"	fs.writeFileSync(path.join(state, 'split-panes.json'),",
		"		JSON.stringify(readJson(path.join(state, 'split-panes.json'), []).filter((s) => s.pane_id !== pane)));",
		"	fs.writeFileSync(path.join(state, 'nvim-panes.json'),",
		"		JSON.stringify(nvimPanes().filter((p) => p !== pane)));",
		"	process.exit(0);",
		"}",
		"process.exit(0);",
	].join("\n"), "utf-8");
	chmodSync(join(binDir, "herdr"), 0o755);

	const listener = spawn(join(binDir, "nvim"), ["--listen", join(stateDir, "listener.sock")], {
		stdio: "ignore",
	});
	const waitForListen = (pid, budgetMs = 3000) => {
		const deadline = Date.now() + budgetMs;
		for (;;) {
			try {
				if (readFileSync(`/proc/${pid}/cmdline`, "utf-8").includes("--listen")) return true;
			} catch {}
			if (Date.now() >= deadline) return false;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	};
	const savedPath = process.env.PATH;
	const savedTmpdir = process.env.TMPDIR;
	const savedXdg = process.env.XDG_RUNTIME_DIR;
	const savedLaunchLog = process.env.PI_NVIM_LAUNCH_LOG;
	try {
		process.env.PATH = `${binDir}:${savedPath}`;
		process.env.TMPDIR = harnessTmp;
		process.env.XDG_RUNTIME_DIR = runDir;
		process.env.FAKE_HERDR_STATE = stateDir;
		process.env.FAKE_NVIM_STATE = stateDir;
		// #294 provenance logging must never touch the real ~/.cache.
		process.env.PI_NVIM_LAUNCH_LOG = join(stateDir, "launches.log");
		assert.ok(waitForListen(listener.pid), "the fake nvim listener must expose --listen");
		writeFileSync(join(stateDir, "editor-pid"), String(listener.pid));
		// Tab t1 already has an editor pane (w1:p2); the launch scenario
		// below switches to a fresh tab t2 with no editor, so the per-tab
		// editor registry starts clean there.
		writeFileSync(join(stateDir, "tab-id"), "t1");
		writeFileSync(join(stateDir, "nvim-panes.json"), JSON.stringify(["w1:p2"]));

		const defCtx = {
			cwd: tempRoot,
			sessionManager: { getSessionFile: () => sessionFile },
		};

		// An existing editor pane receives the journal — no new split.
		const sent = await openJournalInEditor(defCtx);
		assert.equal(sent.ok, true, sent.message);
		assert.equal(sent.launched, false, "an existing editor pane is reused, not launched");
		assert.ok(sent.message.includes(nextJournal), sent.message);
		assert.ok(
			readState("send-text.log", "").includes(nextJournal),
			"the journal file is what reached the editor pane",
		);
		assert.equal(
			Number(readState("split-count", "0")),
			0,
			"an existing editor pane means no split at all",
		);

		// The missing-journal and not-yet-written guards keep the {ok, launched}
		// contract even with an editor available.
		const noJournalResult = await openJournalInEditor({ sessionManager: { getSessionFile: () => undefined } });
		assert.deepEqual(
			{ ok: noJournalResult.ok, launched: noJournalResult.launched },
			{ ok: false, launched: false },
		);
		assert.ok(noJournalResult.message.includes("No lesson journal"));
		const notWritten = await openJournalInEditor({
			cwd: tempRoot,
			sessionManager: { getSessionFile: () => join(dir, "sub", "never-written.jsonl") },
		});
		assert.equal(notWritten.ok, false);
		assert.equal(notWritten.launched, false);
		assert.ok(notWritten.message.includes("not written yet"));

		// presentLesson is focus-buffer-first: the node buffer wins outright.
		const presented = await presentLesson(defCtx, "Def node", "Fresh content");
		assert.equal(presented.mode, "buffer", presented.message);
		assert.ok(presented.message.includes("only this node"), presented.message);

		// openNodeView: the node buffer is gone (the fake nvim answers
		// "missing" for pure-focus lua) — it is REBUILT from the journal.
		const nodeView = await openNodeView(defCtx);
		assert.equal(nodeView.mode, "node", nodeView.message);
		assert.ok(nodeView.message.includes("(rebuilt from the journal)"), nodeView.message);

		// openNodeView before the first lesson shows the overview buffer —
		// never the whole journal file.
		const freshDir = mkdtempSync(join(tmpdir(), "md-log-fresh-"));
		const overviewView = await openNodeView({
			cwd: freshDir,
			sessionManager: { getSessionFile: () => join(freshDir, "s.jsonl") },
		});
		assert.equal(overviewView.mode, "overview", overviewView.message);
		assert.ok(overviewView.message.includes("current position"), overviewView.message);
		rmSync(freshDir, { recursive: true, force: true });

		// No editor pane in a FRESH tab (t2): the registry-first lookup finds
		// nothing, the scan says absent, openEditor splits ONCE and `pane run`
		// brings nvim up in the new pane, and the retry lands in the node
		// buffer — never an unbounded series of editor splits.
		writeFileSync(join(stateDir, "tab-id"), "t2");
		writeFileSync(join(stateDir, "nvim-panes.json"), "[]");
		const launchDir = mkdtempSync(join(tmpdir(), "md-log-launch-"));
		const launchedLesson = await presentLesson({
			cwd: launchDir,
			sessionManager: { getSessionFile: () => join(launchDir, "s.jsonl") },
		}, "Launched node", "Body");
		assert.equal(launchedLesson.mode, "buffer", launchedLesson.message);
		assert.equal(
			Number(readState("split-count", "0")),
			1,
			"the editor launches with exactly one split",
		);
		rmSync(launchDir, { recursive: true, force: true });
		// #294 provenance: every launch decision leaves an attributable line.
		const launchLog = readState("launches.log", "");
		assert.ok(launchLog.includes("outcome=existing"), launchLog);
		assert.ok(launchLog.includes("outcome=split"), launchLog);
		assert.ok(launchLog.includes("route="), launchLog);
		// Back to tab t1 (its editor pane) for the command/shortcut scenarios.
		writeFileSync(join(stateDir, "tab-id"), "t1");
		writeFileSync(join(stateDir, "nvim-panes.json"), JSON.stringify(["w1:p2"]));

		// The /lessons, /probes, and ctrl+h registrations drive the same paths.
		const notes = [];
		const ui = { notify: (message, level) => notes.push([message, level]) };
		await commands.get("lessons").handler("", { ...defCtx, ui });
		assert.equal(notes[notes.length - 1][1], "info");
		// The old session still owns a written probe log.
		const abcCtx = {
			cwd: tempRoot,
			sessionManager: { getSessionFile: () => join(dir, "sub", "session-abc.jsonl") },
		};
		const openProbes = await openProbesInEditor(abcCtx);
		assert.equal(openProbes.ok, true, openProbes.message);
		await commands.get("probes").handler("", { ...abcCtx, ui });
		assert.equal(notes[notes.length - 1][1], "info");
		await commands.get("probes").handler("", {
			cwd: tempRoot,
			sessionManager: { getSessionFile: () => join(dir, "sub", "session-fresh.jsonl") },
			ui,
		});
		assert.equal(notes[notes.length - 1][1], "warning", "an unwritten probe log warns, never throws");
		const noProbes = await openProbesInEditor({ sessionManager: { getSessionFile: () => undefined } });
		assert.equal(noProbes.ok, false);
		assert.equal(noProbes.launched, false);
		assert.ok(noProbes.message.includes("No probe log"));
		await shortcuts.get("ctrl+h").handler({ ...defCtx, ui });
		assert.equal(notes[notes.length - 1][1], "info");
		// The unavailable path — no editor surface at all — warns, never throws.
		const fakeBinPath = process.env.PATH;
		process.env.PATH = "";
		try {
			await shortcuts.get("ctrl+h").handler({ ...defCtx, ui });
			assert.equal(
				notes[notes.length - 1][1],
				"warning",
				"with no editor and no fallback, ctrl+h must warn",
			);
			await commands.get("lessons").handler("", { ...defCtx, ui });
			assert.equal(notes[notes.length - 1][1], "warning", "a failed editor open warns, never throws");
		} finally {
			process.env.PATH = fakeBinPath;
		}
	} finally {
		listener.kill();
		if (savedPath === undefined) delete process.env.PATH;
		else process.env.PATH = savedPath;
		if (savedTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = savedTmpdir;
		if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = savedXdg;
		if (savedLaunchLog === undefined) delete process.env.PI_NVIM_LAUNCH_LOG;
		else process.env.PI_NVIM_LAUNCH_LOG = savedLaunchLog;
		delete process.env.FAKE_HERDR_STATE;
		delete process.env.FAKE_NVIM_STATE;
	}
} else {
	console.log("skip fake-editor L3 scenarios (no /proc — cannot fake the nvim listener)");
}

rmSync(dir, { recursive: true, force: true });
rmSync(tempRoot, { recursive: true, force: true });

console.log("md-log tests passed");
