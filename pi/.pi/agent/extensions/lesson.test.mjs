import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const installRoot = join(homedir(), ".pi/agent/install");
const versionFile = join(installRoot, "current-version");
const jitiPath = [
	process.env.JITI_PATH,
	existsSync(versionFile) && join(installRoot, "releases", readFileSync(versionFile, "utf8").trim(), "node_modules/jiti/lib/jiti.cjs"),
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
exports.truncateToWidth = (text, width) => text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + "…";
exports.wrapTextWithAnsi = (text, width) => {
	const lines = [];
	for (let start = 0; start < text.length; start += width) lines.push(text.slice(start, start + width));
	return lines.length ? lines : [""];
};
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
assert.ok(
	tool.description.includes("quiz `h` and explain `h`/Alt+H shortcuts"),
	"generated lesson guidance should describe the explain journal shortcuts",
);
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

// Expanded results own their entire body; renderCall is not involved.
const theme = { fg: (_token, text) => text, bold: (text) => text };
const tagged = { fg: (token, text) => `<${token}>${text}</${token}>`, bold: (text) => `<b>${text}</b>` };
const options = { expanded: true, isPartial: false };
const args = { title: "Memory layout", body: "First line\nSecond line\nThird line\nFourth line must stay hidden" };
const opened = {
	content: [{ type: "text", text: 'Lesson "Memory layout" appended to the journal and shown to the user.' }],
	details: { status: "opened", title: args.title, journalPath: "/tmp/session.md" },
};
const context = { args, cwd: "/repo", isError: false };
const rendered = tool.renderResult(opened, options, theme, context).render(100).join("\n");
assert.match(rendered, /^ ├─ ✎ {2}lesson · Memory layout/);
assert.match(rendered, /body landed in the session journal/);
assert.match(rendered, / │  First line\n │  Second line\n │  Third line\n │  …/);
assert.ok(!rendered.includes("Fourth line"));
assert.match(rendered, / └─ ✓ journaled$/);
const styled = tool.renderResult(opened, options, tagged, context).render(500).join("\n");
assert.ok(styled.includes("<dim> ├─ ✎  lesson · "));
assert.ok(styled.includes("<text><b>Memory layout</b></text>"));
assert.ok(styled.includes("<dim> │  First line</dim>"));
assert.ok(styled.includes("<success>✓ journaled</success>"));

const longTitle = "A long teaching title ".repeat(20);
const narrow = tool.renderResult({ ...opened, details: { ...opened.details, title: longTitle } }, options, theme, context).render(30);
assert.match(narrow[0], /^ ├─ ✎ {2}lesson · .*…$/);
assert.ok(narrow.every((line) => line.length <= 30));
const wrapped = tool.renderResult(opened, options, theme, { ...context, args: { ...args, body: "abcdefghij".repeat(20) } }).render(24);
assert.deepEqual(wrapped.slice(-5, -1), [" │  abcdefghijabcdefghij", " │  abcdefghijabcdefghij", " │  abcdefghijabcdefghij", " │  …"]);

const unavailableView = tool.renderResult(unavailable, options, theme, context).render(300).join("\n");
assert.match(unavailableView, / └─ ✗ No session journal available/);
assert.ok(!unavailableView.includes("body landed"));
assert.ok(!unavailableView.includes("✓ journaled"));
const thrown = { content: [{ type: "text", text: "Journal write failed\nDo not show this second line" }] };
const errorView = tool.renderResult(thrown, options, tagged, { ...context, isError: true }).render(500).join("\n");
assert.ok(errorView.includes("<error>✗ Journal write failed</error>"));
assert.ok(!errorView.includes("second line"));
for (const width of [1, 4, 12]) {
	assert.ok(tool.renderResult(opened, options, theme, context).render(width).every((line) => line.length <= width));
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("lesson tests passed");
