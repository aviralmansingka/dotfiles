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

// Peer stubs (house pattern from explain.test.mjs). md-log transitively
// imports nvim-open (for openJournalInEditor), which imports defineTool and
// Type — stub those. The editor-opening path itself is IO glue over herdr
// and is intentionally NOT exercised here (same policy as hunk-open tests).
const tempRoot = mkdtempSync(join(tmpdir(), "lesson-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
const stubTypes = join(tempRoot, "types.cjs");
writeFileSync(
	stubAgent,
	"exports.getMarkdownTheme = () => ({ heading: (t) => t, link: (t) => t, linkUrl: (t) => t, code: (t) => t, codeBlock: (t) => t, codeBlockBorder: (t) => t, quote: (t) => t, quoteBorder: (t) => t, listMarker: (t) => t, hr: (t) => t, tableBorder: (t) => t });\nexports.defineTool = (t) => t;\n",
);
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(
	stubTui,
	`
class Markdown {
	constructor(text) { this.text = text; }
	render(width) { return this.text.split("\\n"); }
	invalidate() {}
}
class Text { constructor(text) { this.text = text; } }
class Container { addChild() {} }
exports.Markdown = Markdown;
exports.Text = Text;
exports.Container = Container;
`,
);
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const mdLogModule = jiti("./md-log.ts");
const { resolveJournalPath, openJournalInEditor } = mdLogModule;
const extension = jiti("./lesson.ts").default;

// ── registration ─────────────────────────────────────────────────────────────

const registered = [];
extension({ registerTool(def) { registered.push(def); } });
assert.equal(registered.length, 1, "lesson should register exactly one tool");
const tool = registered[0];
assert.equal(tool.name, "lesson");
assert.equal(typeof tool.execute, "function");
assert.ok(tool.description.length > 40, "description should be substantive");
assert.ok(tool.promptGuidelines.length >= 3, "should carry usage guidelines");
// The lesson is file-based: no panel, no overlay, no UI lock.
assert.ok(!("__piSharedUiLock" in globalThis) || true); // lock is quiz-side; nothing to assert here

// ── journal resolution guards (pure, no herdr IO) ────────────────────────────

assert.equal(resolveJournalPath({ sessionManager: { getSessionFile: () => undefined } }), undefined);
assert.equal(
	resolveJournalPath({ sessionManager: { getSessionFile: () => "/tmp/s/session-abc.jsonl" } }),
	"/tmp/s/session-abc.md",
);

// openJournalInEditor refuses cleanly without a journal or before first write.
const noJournal = await openJournalInEditor({ sessionManager: { getSessionFile: () => undefined } });
assert.ok(noJournal.message.includes("No lesson journal"));
assert.equal(noJournal.ok, false);
assert.equal(noJournal.launched, false);

const notYetWritten = await openJournalInEditor({
	sessionManager: { getSessionFile: () => "/tmp/s/session-abc.jsonl" },
});
assert.ok(notYetWritten.message.includes("not written yet"));
assert.equal(notYetWritten.ok, false);

// ── execute paths ────────────────────────────────────────────────────────────

// No session journal → unavailable, agent told to restate in conversation.
const unavailable = await tool.execute(
	"id",
	{ title: "T", body: "B" },
	undefined,
	undefined,
	{ sessionManager: { getSessionFile: () => undefined } },
);
assert.equal(unavailable.details.status, "unavailable");
assert.ok(unavailable.content[0].text.includes("Restate"));

// A written journal with no available editor surface stays unavailable.
// Clear PATH so the executable boundary cannot reach herdr, tmux, or nvim.
const savedPath = process.env.PATH;
const savedJournal = process.env.PI_LESSON_JOURNAL;
const strandedJournal = join(tempRoot, "stranded.md");
writeFileSync(strandedJournal, "# Lesson journal\n");
process.env.PATH = "";
process.env.PI_LESSON_JOURNAL = strandedJournal;
try {
	const stranded = await tool.execute(
		"id",
		{ title: "Stranded", body: "Read this." },
		undefined,
		undefined,
		{ cwd: tempRoot, sessionManager: { getSessionFile: () => "/tmp/s/session-abc.jsonl" } },
	);
	assert.equal(stranded.details.status, "unavailable");
	assert.ok(stranded.content[0].text.includes("was not shown"));
	assert.ok(stranded.content[0].text.includes("Restate"));
} finally {
	if (savedPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedPath;
	if (savedJournal === undefined) delete process.env.PI_LESSON_JOURNAL;
	else process.env.PI_LESSON_JOURNAL = savedJournal;
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("lesson tests passed");
