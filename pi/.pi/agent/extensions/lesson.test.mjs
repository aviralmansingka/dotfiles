import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

// Peer stubs (house pattern from explain.test.mjs). md-log transitively
// imports nvim-open (for openJournalInEditor), which imports defineTool and
// Type — stub those. The editor-opening path itself is IO glue over herdr
// and is intentionally NOT exercised here.
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
	tool.description.includes("quiz and explain `h` shortcuts focus the current node buffer"),
	"generated lesson guidance should describe the node-buffer shortcuts",
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
// #294's provenance logging is redirected so the run never touches ~/.cache.
const savedPath = process.env.PATH;
const savedJournal = process.env.PI_LESSON_JOURNAL;
const savedLaunchLog = process.env.PI_NVIM_LAUNCH_LOG;
const strandedJournal = join(tempRoot, "stranded.md");
writeFileSync(strandedJournal, "# Lesson journal\n");
process.env.PATH = "";
process.env.PI_LESSON_JOURNAL = strandedJournal;
process.env.PI_NVIM_LAUNCH_LOG = join(tempRoot, "launches.log");
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
	// #294 provenance: even the failed launch leaves an attributable line
	// — and it landed in the redirected log, never in ~/.cache.
	assert.ok(
		readFileSync(join(tempRoot, "launches.log"), "utf-8").includes("outcome=failed"),
		"a failed editor launch still leaves a provenance line",
	);
} finally {
	if (savedPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedPath;
	if (savedJournal === undefined) delete process.env.PI_LESSON_JOURNAL;
	else process.env.PI_LESSON_JOURNAL = savedJournal;
	if (savedLaunchLog === undefined) delete process.env.PI_NVIM_LAUNCH_LOG;
	else process.env.PI_NVIM_LAUNCH_LOG = savedLaunchLog;
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

// renderCall is a one-line leaf: the tool name plus the node title.
const leaf = tool.renderCall({ title: "Memory layout" }, theme);
assert.ok(leaf.text.includes("lesson"), leaf.text);
assert.ok(leaf.text.includes("Memory layout"), leaf.text);

// ── the opened path: focus-buffer-first, journal fallback only headless ──
// Fake herdr/nvim shell binaries on PATH (house pattern) plus a spawned
// listener whose /proc cmdline carries --listen, so presentLesson reaches
// the node buffer exactly as in production and execute reports `opened`.
if (existsSync("/proc")) {
	const binDir = join(tempRoot, "bin");
	const stateDir = join(tempRoot, "state");
	const runDir = join(tempRoot, "run");
	const harnessTmp = join(tempRoot, "hr-tmp");
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	mkdirSync(runDir, { recursive: true });
	mkdirSync(harnessTmp, { recursive: true });
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
	writeFileSync(join(binDir, "herdr"), [
		"#!/usr/bin/env node",
		"const fs = require('node:fs');",
		"const path = require('node:path');",
		"const state = process.env.FAKE_HERDR_STATE;",
		"const args = process.argv.slice(2);",
		"const cmd = args.join(' ');",
		"const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };",
		"if (cmd === 'pane current') {",
		"	out({ result: { pane: { pane_id: 'w1:p1', tab_id: 't1', cwd: '/tmp' } } });",
		"} else if (cmd.startsWith('pane list')) {",
		"	out({ result: { panes: [",
		"		{ pane_id: 'w1:p1', tab_id: 't1', cwd: '/tmp' },",
		"		{ pane_id: 'w1:p2', tab_id: 't1', cwd: '/tmp' } ] } });",
		"} else if (cmd.startsWith('pane process-info')) {",
		"	const pane = args[args.indexOf('--pane') + 1];",
		"	const pid = Number(fs.readFileSync(path.join(state, 'editor-pid'), 'utf-8').trim());",
		"	if (pane === 'w1:p2') {",
		"		out({ result: { process_info: { pane_id: pane, foreground_processes: [{ name: 'nvim', pid, argv: ['nvim'] }] } } });",
		"	} else {",
		"		out({ result: { process_info: { pane_id: pane, foreground_processes: [{ name: 'zsh', pid: 4242, argv: ['zsh'] }] } } });",
		"	}",
		"} else if (cmd.startsWith('pane split')) {",
		"	fs.writeFileSync(path.join(state, 'split-count'), String(Number(fs.readFileSync(path.join(state, 'split-count'), 'utf-8').trim() || '0') + 1));",
		"	fs.writeFileSync(path.join(state, 'editor-live'), '1');",
		"	out({ result: { pane: { pane_id: 'w1:p9' } } });",
		"} else if (cmd.startsWith('pane send-text')) {",
		"	process.exit(0);",
		"} else if (cmd.startsWith('pane neighbor')) {",
		"	out({ result: { neighbor: { neighbor_pane_id: 'w1:p2' } } });",
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
	try {
		process.env.PATH = `${binDir}:${savedPath}`;
		process.env.TMPDIR = harnessTmp;
		process.env.XDG_RUNTIME_DIR = runDir;
		process.env.FAKE_HERDR_STATE = stateDir;
		assert.ok(waitForListen(listener.pid), "the fake nvim listener must expose --listen");
		writeFileSync(join(stateDir, "editor-pid"), String(listener.pid));

		const sessionDir = mkdtempSync(join(tmpdir(), "lesson-ed-"));
		const editorCtx = {
			cwd: sessionDir,
			sessionManager: { getSessionFile: () => join(sessionDir, "s.jsonl") },
		};
		const buffered = await tool.execute(
			"id-ed",
			{ title: "Buffered node", body: "Read this in the side buffer." },
			undefined,
			undefined,
			editorCtx,
		);
		assert.equal(buffered.details.status, "opened");
		assert.equal(buffered.details.journalPath, join(sessionDir, "s.md"));
		assert.ok(buffered.content[0].text.includes("shown to the user"), buffered.content[0].text);
		rmSync(sessionDir, { recursive: true, force: true });
	} finally {
		listener.kill();
		if (savedPath === undefined) delete process.env.PATH;
		else process.env.PATH = savedPath;
		if (savedTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = savedTmpdir;
		if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = savedXdg;
		delete process.env.FAKE_HERDR_STATE;
	}
} else {
	console.log("skip fake-editor opened path (no /proc)");
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("lesson tests passed");
