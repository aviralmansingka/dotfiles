import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// journal-review.ts imports typebox and md-log (which only type-imports its
// peers), so only typebox needs a stub.
const tempRoot = mkdtempSync(join(tmpdir(), "journal-review-test-"));
const stubTypes = join(tempRoot, "types.cjs");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");

const jiti = createJiti(import.meta.url, {
	alias: { typebox: stubTypes },
});

const core = jiti("./journal-review-core.mjs");
const {
	shellQuote,
	reviewerPaneTitle,
	reviewerPluginPaneArgs,
	manualReviewerCommand,
	isReviewerProcess,
	isReviewerPane,
	openReviewerWithHost,
} = core;

// ── core helpers ─────────────────────────────────────────────────────────────

assert.equal(shellQuote("plain"), "'plain'");
assert.equal(shellQuote("it's"), "'it'\\''s'");

const pluginArgs = reviewerPluginPaneArgs("/tmp/my journal.md", "agent pane");
assert.deepEqual(pluginArgs.slice(0, 7), [
	"plugin", "pane", "open", "--plugin", "annotate-review", "--entrypoint", "doc",
]);
assert.ok(pluginArgs.includes("PLANNOTATOR_TUI_FILE=/tmp/my journal.md"));
assert.ok(pluginArgs.includes("PLANNOTATOR_TUI_DELIVER_TO=agent pane"));
assert.ok(pluginArgs.includes("--target-pane"));
assert.equal(
	manualReviewerCommand("/path with/reviewer", "/tmp/my journal.md"),
	"'/path with/reviewer' 'herdr' 'open' '/tmp/my journal.md'",
);
assert.equal(
	manualReviewerCommand("/path with/reviewer", "/tmp/my journal.md", "agent pane"),
	"'/path with/reviewer' 'herdr' 'open' '/tmp/my journal.md' '--deliver-to' 'agent pane'",
);

const reviewerProcess = {
	name: "plannotator-tui",
	argv: ["/x/plannotator-tui", "herdr", "pane"],
};
assert.equal(isReviewerProcess(reviewerProcess), true);
assert.equal(
	isReviewerProcess({ name: "plannotator-tui", argv: ["plannotator-tui", "herdr", "open"] }),
	false,
);
assert.equal(isReviewerProcess({ name: "hunk", argv: ["hunk", "diff", "--watch"] }), false);
const matchingPane = {
	terminal_title_stripped: reviewerPaneTitle("/tmp/j.md", "agent"),
};
assert.equal(isReviewerPane(matchingPane, [reviewerProcess], "/tmp/j.md", "agent"), true);
assert.equal(isReviewerPane(matchingPane, [reviewerProcess], "/tmp/other.md", "agent"), false);
assert.equal(isReviewerPane(matchingPane, [reviewerProcess], "/tmp/j.md", "other-agent"), false);
assert.equal(isReviewerPane(matchingPane, [{ name: "shell", argv: ["fish"] }], "/tmp/j.md", "agent"), false);

// ── focus-or-launch host flow ────────────────────────────────────────────────

function fakeHost(overrides = {}) {
	const calls = [];
	return {
		calls,
		currentPane: () => ({ pane_id: "agent", tab_id: "tab" }),
		findReviewerPane: () => ({ status: "absent" }),
		focusPane: (...args) => {
			calls.push(["focus", ...args]);
			return true;
		},
		launchPane: (...args) => {
			calls.push(["launch", ...args]);
			return "reviewer-pane";
		},
		manualCommand: () => "manual fallback",
		...overrides,
	};
}

// Existing reviewer pane is focused, not duplicated.
const focusHost = fakeHost({
	findReviewerPane: (...args) => {
		focusHost.calls.push(["find", ...args]);
		return { status: "found", paneId: "existing" };
	},
});
let focused = await openReviewerWithHost(focusHost, "/bin/reviewer", "j.md", "agent");
assert.equal(focused.launched, false);
assert.ok(focused.message.includes("Focused existing"));
assert.deepEqual(focusHost.calls, [
	["find", "tab", "j.md", "agent"],
	["focus", "existing", "agent"],
]);

// No existing pane → launch with deliver-to.
const launchHost = fakeHost();
const launched = await openReviewerWithHost(launchHost, "/bin/reviewer", "j.md", "agent");
assert.equal(launched.launched, true);
assert.ok(launched.message.includes("delivered back"));
assert.deepEqual(launchHost.calls, [["launch", "/bin/reviewer", "j.md", "agent"]]);

// Herdr unavailable → manual fallback, never a crash.
const manualHost = fakeHost({
	currentPane: () => null,
});
const manual = await openReviewerWithHost(manualHost, "/bin/reviewer", "j.md", "agent");
assert.equal(manual.launched, false);
assert.equal(manual.message, "manual fallback");

// ── extension registration ───────────────────────────────────────────────────

const { default: register, openJournalReviewer } = jiti("./journal-review.ts");
const tools = [];
const commands = new Map();
register({
	registerTool: (tool) => tools.push(tool),
	registerCommand: (name, def) => commands.set(name, def),
});
assert.equal(tools.length, 1);
assert.equal(tools[0].name, "journal_review");
assert.equal(commands.size, 1);
assert.ok(commands.has("journal"));
assert.equal(typeof commands.get("journal").handler, "function");

// The tool reports gracefully outside Herdr / without a journal.
const noJournal = await tools[0].execute("id", {}, undefined, undefined, {
	sessionManager: { getSessionFile: () => undefined },
});
assert.ok(noJournal.content[0].text.includes("No lesson journal"));

// A globally focused Herdr pane must not be mistaken for this process's pane.
const fakeBin = join(tempRoot, "bin");
const fakeHerdr = join(fakeBin, "herdr");
const dataHome = join(tempRoot, "data");
const reviewer = join(dataHome, "herdr", "annotate-review", "plannotator-tui");
const journal = join(tempRoot, "session.md");
mkdirSync(fakeBin, { recursive: true });
mkdirSync(join(dataHome, "herdr", "annotate-review"), { recursive: true });
writeFileSync(journal, "# Lesson journal\n");
writeFileSync(reviewer, "");
writeFileSync(fakeHerdr, `#!/bin/sh
case "$1 $2" in
  "pane current") printf '%s\\n' '{"result":{"pane":{"pane_id":"unrelated","tab_id":"tab","cwd":"/tmp"}}}' ;;
  "pane list") printf '%s\\n' '{"result":{"panes":[]}}' ;;
  "plugin pane") printf '%s\\n' '{"result":{"pane_id":"wrong-reviewer"}}' ;;
  *) printf '%s\\n' '{}' ;;
esac
`);
chmodSync(fakeHerdr, 0o755);
const savedEnv = {
	HERDR_ENV: process.env.HERDR_ENV,
	HERDR_PANE_ID: process.env.HERDR_PANE_ID,
	PI_LESSON_JOURNAL: process.env.PI_LESSON_JOURNAL,
	XDG_DATA_HOME: process.env.XDG_DATA_HOME,
	PATH: process.env.PATH,
};
try {
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	process.env.PI_LESSON_JOURNAL = journal;
	process.env.XDG_DATA_HOME = dataHome;
	process.env.PATH = `${fakeBin}:${savedEnv.PATH ?? ""}`;
	const outsideHerdr = await openJournalReviewer({ cwd: tempRoot });
	assert.equal(outsideHerdr.launched, false);
	assert.ok(outsideHerdr.message.startsWith("Not inside Herdr."));

	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "agent";
	const mismatchedPane = await openJournalReviewer({ cwd: tempRoot });
	assert.equal(mismatchedPane.launched, false);
	assert.ok(mismatchedPane.message.startsWith("Not inside Herdr."));
} finally {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("journal-review tests passed");
