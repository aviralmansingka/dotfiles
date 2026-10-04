import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	reviewerPaneCommand,
	manualReviewerCommand,
	isReviewerProcess,
	openReviewerWithHost,
} = core;

// ── core helpers ─────────────────────────────────────────────────────────────

assert.equal(shellQuote("plain"), "'plain'");
assert.equal(shellQuote("it's"), "'it'\\''s'");

// The pane command must shell-quote every value (journal paths and pane ids
// can contain spaces/quotes) and close the pane when the reviewer exits.
const cmd = reviewerPaneCommand("pane id", "/bin/reviewer", "/tmp/my journal.md", "agent pane");
assert.ok(cmd.startsWith("'/bin/reviewer' 'herdr' 'open' '/tmp/my journal.md'"));
assert.ok(cmd.includes("'--deliver-to' 'agent pane'"));
assert.ok(cmd.endsWith("herdr pane close 'pane id'"), cmd);
assert.ok(!cmd.includes("$(printf"), "no injection through unquoted interpolation");
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
	argv: [
		"/x/plannotator-tui",
		"herdr",
		"open",
		"/tmp/j.md",
		"--placement",
		"split",
		"--deliver-to",
		"agent",
	],
};
assert.equal(isReviewerProcess(reviewerProcess, "/tmp/j.md", "agent"), true);
assert.equal(isReviewerProcess(reviewerProcess, "/tmp/other.md", "agent"), false);
assert.equal(isReviewerProcess(reviewerProcess, "/tmp/j.md", "other-agent"), false);
assert.equal(
	isReviewerProcess(
		{ name: "plannotator-tui", argv: ["plannotator-tui", "herdr", "last"] },
		"/tmp/j.md",
		"agent",
	),
	false,
);
assert.equal(
	isReviewerProcess({ name: "hunk", argv: ["hunk", "diff", "--watch"] }, "/tmp/j.md", "agent"),
	false,
);

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

const { default: register } = jiti("./journal-review.ts");
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

rmSync(tempRoot, { recursive: true, force: true });
console.log("journal-review tests passed");
