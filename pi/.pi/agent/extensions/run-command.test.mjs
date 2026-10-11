import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { stripVTControlCharacters } from "node:util";
import { HOMEBREW_JITI, jitiEnv } from "./test-lib/jiti.mjs";

// Optional real Pi helpers exercise ANSI/Unicode wrapping locally; CI's small
// dependency stub below still checks the renderer's wrapping contract.
const tuiUtils = process.env.PI_TUI_UTILS ? await import(process.env.PI_TUI_UTILS) : undefined;
globalThis.__runCommandTuiUtils = tuiUtils;

const require = createRequire(import.meta.url);
// Shared jiti resolution (test-lib): JITI_PATH/NODE_PATH or the pi-managed
// install, plus this file's historical macOS homebrew fallback. NODE_PATH is
// re-derived from the resolved jiti root exactly the way CI's prefix install
// provides it, so typebox resolves uniformly across hosts.
Object.assign(process.env, jitiEnv({ extraFallbacks: [HOMEBREW_JITI] }));
require("node:module").Module._initPaths();
const { createJiti } = require(process.env.JITI_PATH);
const jiti = createJiti(import.meta.url);
const { buildNvimTerminalScript, extractMarkedOutput } = jiti("./run-command/nvim-terminal.ts");

const token = "abc123";
const command = "printf 'a b\\n'; printf \"err & stuff\\n\" >&2; false";

// Mirror runViaNvimTerminal's capture path: run the wrapper, detect completion
// + exit code from the END marker in the buffer, then read command output from
// the temp file (NOT the buffer). `shell` defaults to sh; the tee +
// trap-based exit-code wrapper is portable across sh/bash/zsh/dash.
function captureViaFile(cmd, tok, shell = "sh", statusFileOverride) {
	const outFile = join(tmpdir(), `pi-rc-out-${tok}.txt`);
	const statusFile = statusFileOverride ?? join(tmpdir(), `pi-rc-st-${tok}.txt`);
	rmSync(outFile, { force: true });
	// An override statusFile may be a deliberately-unwritable stub (a
	// directory); leave it in place for the run.
	if (!statusFileOverride) rmSync(statusFile, { force: true, recursive: true });
	const res = spawnSync(shell, ["-c", buildNvimTerminalScript(cmd, tok, outFile, statusFile)], {
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	const parsed = extractMarkedOutput(res.stdout ?? "", tok);
	let output = "";
	if (parsed.complete) {
		try {
			output = readFileSync(outFile, "utf8");
		} catch {
			output = "";
		}
	}
	rmSync(outFile, { force: true });
	rmSync(statusFile, { force: true, recursive: true });
	return { parsed, output: output.trim(), status: res.status, raw: res.stdout ?? "" };
}

// A real interactive Neovim `:term` echoes the bulk-pasted wrapper before the
// shell executes it, so the buffer contains echoed printf command lines (which
// embed the START/END marker text) alongside the real END marker line. Output
// must come from the temp file, so extractMarkedOutput reports only completion
// + exit code from the real END marker line and never echo-corrupted buffer
// text. This fails against the old buffer-scraping implementation (which
// matched the echoed START printf line and returned the echoed script lines as
// `output`). The echoed lines below mirror the current tee + trap wrapper.
const echoed = [
	"$ printf '%s\\n' '__PI_RUN_COMMAND_START_abc123__'",
	"__PI_RUN_COMMAND_START_abc123__",
	"$ (",
	"$ trap 'printf %s \"$?\" > \"/tmp/pi-rc-st-abc123.txt\"' EXIT",
	"$ printf 'a b\\n'; printf \"err & stuff\\n\" >&2; false",
	"$ ) 2>&1 | tee '/tmp/pi-rc-out-abc123.txt' >/dev/null",
	"$ __pi_pipeline_status=$?",
	"$ __pi_status=$(cat \"/tmp/pi-rc-st-abc123.txt\" 2>/dev/null)",
	"$ [ -z \"$__pi_status\" ] && __pi_status=$__pi_pipeline_status",
	"$ printf '%s:%s\\n' '__PI_RUN_COMMAND_END_abc123__' \"$__pi_status\"",
	"__PI_RUN_COMMAND_END_abc123__:1",
].join("\n");

assert.deepEqual(extractMarkedOutput(echoed, token), { complete: true, exitCode: 1 });

// Full capture path: stdout+stderr land in the temp file; exit status rides
// the END marker; the wrapper shell exits with the command's status. The tee
// wrapper must keep START/END markers OUT of the captured file (the file holds
// only the command's stdout+stderr).
const full = captureViaFile(command, token);
assert.deepEqual(full.parsed, { complete: true, exitCode: 1 });
assert.equal(full.output, "a b\nerr & stuff");
assert.equal(full.status, 1);
assert.ok(!/__PI_RUN_COMMAND_(START|END)_/.test(full.output), "markers must not leak into the captured file");

// `exit N` builtin is isolated in the subshell so the EXIT trap still records
// its status and the wrapper emits the END marker; output is empty.
const exited = captureViaFile("exit 7", "ex");
assert.deepEqual(exited.parsed, { complete: true, exitCode: 7 });
assert.equal(exited.output, "");
assert.equal(exited.status, 7);

const ok = captureViaFile("printf 'hi\\n'; true", "ok");
assert.deepEqual(ok.parsed, { complete: true, exitCode: 0 });
assert.equal(ok.output, "hi");
assert.equal(ok.status, 0);

// A non-zero exit from deep inside the subshell (after producing output) must
// be recovered as the command's real status, not tee's 0.
const deep = captureViaFile("printf 'deep\\n'; exit 42", "dp");
assert.deepEqual(deep.parsed, { complete: true, exitCode: 42 });
assert.equal(deep.output, "deep");
assert.equal(deep.status, 42);

// The tee + EXIT-trap exit-code recovery is portable: the captain's `dm` is
// zsh-based, so verify the wrapper behaves identically under sh, bash, zsh,
// and dash (whichever are installed) — no reliance on bash-only PIPESTATUS.
const multiCmd = "printf 'x y\\n'; printf \"z w\\n\" >&2; false";
for (const shell of ["sh", "bash", "zsh", "dash"]) {
	if (spawnSync(shell, ["-c", "exit 0"], { stdio: "ignore" }).status !== 0) continue;
	const r = captureViaFile(multiCmd, `ms-${shell}`, shell);
	assert.deepEqual(r.parsed, { complete: true, exitCode: 1 }, `${shell}: exit code`);
	assert.equal(r.output, "x y\nz w", `${shell}: captured stdout+stderr`);
	assert.equal(r.status, 1, `${shell}: wrapper exit`);
	assert.ok(!/__PI_RUN_COMMAND_(START|END)_/.test(r.output), `${shell}: markers excluded from file`);
}

// No END marker yet → not complete.
assert.deepEqual(extractMarkedOutput("only partial", token), { complete: false });
// Partial END marker (truncated token, or no `:` status suffix) → not
// complete; a full marker line with a non-numeric status → complete, -1.
assert.deepEqual(extractMarkedOutput(`__PI_RUN_COMMAND_END_${token.slice(0, 4)}`, token), { complete: false });
assert.deepEqual(extractMarkedOutput(`__PI_RUN_COMMAND_END_${token}__ no colon`, token), { complete: false });
assert.deepEqual(extractMarkedOutput(`__PI_RUN_COMMAND_END_${token}__:oops`, token), { complete: true, exitCode: -1 });

// Trap-failure fallback: when the EXIT trap cannot write statusFile (here:
// the path is a directory), the wrapper falls back to the pipeline status —
// tee's 0 — so the END marker still fires and the run stays completable. The
// trap's own stderr leaks into the capture (it runs inside the 2>&1 pipe);
// it never blocks completion and never carries markers.
{
	const stDir = mkdtempSync(join(tmpdir(), "rc-st-dir-"));
	const fallback = captureViaFile("false", "fb", "sh", stDir);
	assert.deepEqual(fallback.parsed, { complete: true, exitCode: 0 }, "trap failure falls back to the pipeline status");
	assert.equal(fallback.status, 0);
	assert.ok(!/__PI_RUN_COMMAND_(START|END)_/.test(fallback.output), "markers stay out of the captured file");
}

// Exercise the registered tool through its public execute/UI boundary. The
// lightweight dependency stub keeps this deterministic and prevents an
// automated test from changing the machine clipboard; the extension's real
// panel event handler and renderer still process every key below.
const stubDir = mkdtempSync(join(tmpdir(), "run-command-ui-test-"));
const stubPath = join(stubDir, "deps.cjs");
writeFileSync(
	stubPath,
	String.raw`
class Editor {
  constructor() { this.focused = false; this.disableSubmit = false; this.text = ""; this.expandedText = null; }
  getText() { return this.text; }
  getExpandedText() { return this.expandedText ?? this.text; }
  handleInput(data) {
    if (!this.focused) return;
    const paste = data.match(/^\x1b\[200~([\s\S]*)\x1b\[201~$/);
    if (!paste) { this.text += data; return; }
    const content = paste[1];
    const lines = content.split("\n");
    if (lines.length > 10 || content.length > 1000) {
      this.text = "[paste #1 +" + lines.length + " lines]";
      this.expandedText = content;
    } else {
      this.text += content;
    }
  }
  invalidate() {}
  render() { return [this.focused ? this.text + "▌" : this.text]; }
}
class Text { constructor(text) { this.text = text; } }
const Key = { enter: "\r", tab: "\t", escape: "\x1b" };
const Type = { Object: x => x, String: x => x, Optional: x => x };
const stripAnsi = require("node:util").stripVTControlCharacters;
function wrapTextWithAnsi(text, width) {
  if (globalThis.__runCommandTuiUtils) return globalThis.__runCommandTuiUtils.wrapTextWithAnsi(text, width);
  const lines = [""];
  let columns = 0;
  for (const token of text.match(/\x1b\[[0-9;]*m|[^]/gu) ?? []) {
    if (token === "\n") { lines.push(""); columns = 0; continue; }
    const size = stripAnsi(token).length;
    if (size && columns + size > width) { lines.push(""); columns = 0; }
    lines[lines.length - 1] += token;
    columns += size;
  }
  return lines;
}
module.exports = {
  Editor, Text, Key, Type,
  copyToClipboard: async text => { globalThis.__runCommandClipboardCalls.push(text); },
  matchesKey: (data, key) => data === key,
  truncateToWidth: (text, width, ellipsis = "…") => {
    if (globalThis.__runCommandTuiUtils) return globalThis.__runCommandTuiUtils.truncateToWidth(text, width, ellipsis);
    if (stripAnsi(text).length <= width) return text;
    return wrapTextWithAnsi(text, Math.max(1, width - ellipsis.length))[0] + ellipsis;
  },
  visibleWidth: text => globalThis.__runCommandTuiUtils?.visibleWidth(text) ?? stripAnsi(text).length,
  wrapTextWithAnsi,
};
`,
);

// Fake nvim + herdr binaries (house pattern: stubs on PATH before any
// spawn, staged responses, env saved/restored — nothing touches a live
// nvim, herdr, or multiplexer). They drive the real `r` auto-capture path
// (runViaNvimTerminal -> discoverExistingNvim -> openFloatTerminal/
// openSplitPaneTerminal) end to end, offline.
const fakeBinDir = mkdtempSync(join(tmpdir(), "rc-fake-bin-"));
writeFileSync(
	join(fakeBinDir, "nvim"),
	String.raw`#!/usr/bin/env node
// Fake nvim for the run-command auto-capture tests. Answers
// --server SOCK --remote-expr EXPR with staged replies, decodes the
// Vim double-quoted luaeval payloads exactly like the real RPC transport,
// and records everything it sees under FAKE_NVIM_DIR.
const fs = require("node:fs");
const spawnSync = require("node:child_process").spawnSync;
const dir = process.env.FAKE_NVIM_DIR;
const args = process.argv.slice(2);
let server, expr;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--server") server = args[++i];
	else if (args[i] === "--remote-expr") expr = args[++i];
}
fs.appendFileSync(dir + "/expr.log", JSON.stringify({ server, expr }) + "\n");
const dead = fs.existsSync(dir + "/dead") ? fs.readFileSync(dir + "/dead", "utf8").split("\n").filter(Boolean) : [];
if (expr === "1") process.exit(dead.includes(server) ? 1 : 0);
if (expr === "bufnr('%')") { console.log("1"); process.exit(0); }
if (!expr.startsWith("luaeval(")) { console.log("nil"); process.exit(0); }
function vimDecode(body) {
	const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", e: "\x1b", '"': '"', "\\": "\\" };
	let out = "";
	for (let i = 0; i < body.length; i++) {
		if (body[i] === "\\" && i + 1 < body.length) { out += map[body[i + 1]] ?? body[i + 1]; i++; }
		else out += body[i];
	}
	return out;
}
function luaevalArgs(src) {
	const out = [];
	let i = src.indexOf('"');
	while (i !== -1) {
		let j = i + 1, literal = "";
		while (j < src.length && src[j] !== '"') {
			if (src[j] === "\\") { literal += src[j] + src[j + 1]; j += 2; }
			else { literal += src[j]; j++; }
		}
		out.push(vimDecode(literal));
		i = src.indexOf('"', j + 1);
	}
	return out;
}
const pair = luaevalArgs(expr);
if (pair[0].includes("nvim_chan_send")) {
	const script = pair[1];
	const echo = script.split("\n").map(function (l) { return "$ " + l; }).join("\n") + "\n";
	fs.writeFileSync(dir + "/script", script);
	if (process.env.FAKE_NVIM_DELAYED === "1") {
		fs.writeFileSync(dir + "/buffer", echo); // echoed wrapper only: no END marker yet
	} else {
		const r = spawnSync("sh", ["-c", script], { encoding: "utf8" });
		fs.writeFileSync(dir + "/buffer", echo + (r.stdout ?? ""));
		fs.writeFileSync(dir + "/done", "");
	}
	console.log(String(script.length));
	process.exit(0);
}
if (pair[0] !== "load(...)()") { console.log("nil"); process.exit(0); }
const chunk = pair[1];
if (chunk.includes("nvim_create_buf")) { console.log(process.env.FAKE_NVIM_FLOAT_REPLY || "9|101|5"); process.exit(0); }
if (chunk.includes("terminal_job_id")) { console.log("9"); process.exit(0); }
if (chunk.includes("nvim_win_close") || chunk.includes("nvim_buf_delete")) {
	fs.appendFileSync(dir + "/cleanup.log", chunk + "\n");
	console.log("nil");
	process.exit(0);
}
if (chunk.includes("nvim_buf_get_lines")) {
	if (!fs.existsSync(dir + "/done")) {
		if (process.env.FAKE_NVIM_DELAYED === "1" && !fs.existsSync(dir + "/ran")) {
			fs.writeFileSync(dir + "/ran", ""); // first poll stays partial
		} else {
			fs.writeFileSync(dir + "/done", "");
			const r = spawnSync("sh", ["-c", fs.readFileSync(dir + "/script", "utf8")], { encoding: "utf8" });
			fs.appendFileSync(dir + "/buffer", r.stdout ?? "");
		}
	}
	console.log(fs.readFileSync(dir + "/buffer", "utf8"));
	process.exit(0);
}
console.log("nil");
`,
	{ mode: 0o755 },
);
writeFileSync(
	join(fakeBinDir, "herdr"),
	String.raw`#!/usr/bin/env node
// Fake herdr for the run-command discovery tests. Stages pane responses
// from FAKE_HERDR_DIR/scenario.json and records every invocation in
// FAKE_HERDR_DIR/log.
const fs = require("node:fs");
const dir = process.env.FAKE_HERDR_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(dir + "/log", JSON.stringify(args) + "\n");
const sc = JSON.parse(fs.readFileSync(dir + "/scenario.json", "utf8"));
const reply = function (x) { console.log(JSON.stringify(x)); process.exit(0); };
if (args[0] === "pane") {
	if (args[1] === "current") {
		if (typeof sc.current === "string") { console.log(sc.current); process.exit(0); } // raw, non-JSON stdout
		reply(sc.current);
	} else if (args[1] === "list") reply(sc.list);
	else if (args[1] === "process-info") reply(sc.info[args[3]] || { result: { process_info: { foreground_processes: [] } } });
	else if (args[1] === "split") reply(sc.split);
	else if (args[1] === "run") {
		const i = args.indexOf("--listen");
		if (i !== -1) fs.writeFileSync(args[i + 1], ""); // nvim is now "listening"
		process.exit(0);
	} else if (args[1] === "close") process.exit(0);
}
process.exit(1);
`,
	{ mode: 0o755 },
);

try {
	globalThis.__runCommandClipboardCalls = [];
	const uiJiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": stubPath,
			"@earendil-works/pi-tui": stubPath,
			typebox: stubPath,
		},
		moduleCache: false,
	});
	const runCommandExtension = uiJiti("./run-command.ts").default;
	let tool;
	runCommandExtension({ registerTool(value) { tool = value; } });
	assert.ok(tool, "extension must register run-command");

// #196 self-description contract: every self-description surface carries the
// learning-only clause, so agents never reach for the panel during ordinary work.
	assert.match(tool.description, /ONLY when the user has explicitly asked to learn/);
	assert.match(tool.promptSnippet, /ONLY when the user has asked to learn/);
	assert.match(tool.promptGuidelines[0], /ONLY in learning contexts/);

	const theme = { fg: (_color, text) => text, bold: text => text };
	const { splitCommand, outputLines } = uiJiti("./run-command/render.ts");
	const call = (args, width = 100, colors = theme) => tool.renderCall(args, colors).render(width);
	const result = (details, width = 100, colors = theme, expanded = false) => tool.renderResult({
		content: [], details: { status: "answered", command: "printf ready", context: "why", prediction: "ready", ...details },
	}, { expanded, isPartial: false }, colors).render(width);
	assert.deepEqual(call({ details: "why", prediction: "ready", command: "printf ready && echo done || false | cat" }), [
		"├─ §  why", "├─ ¶  ready", "├─ $  printf ready", "│  && echo done", "│  || false", "│  |  cat",
	]);
	assert.deepEqual(call({}), []);
	assert.deepEqual(call({ prediction: "par" }), ["├─ ¶  par"]);
	assert.deepEqual(call({ details: "first\nsecond", prediction: "x".repeat(120) }).map(stripVTControlCharacters), [
		"├─ §  first…", `├─ ¶  ${"x".repeat(93)}…`,
	]);
	assert.deepEqual(call({ command: "echo x &&" }), ["├─ $  echo x", "│  && "]);
	assert.deepEqual(splitCommand(`echo 'a && b' "c || d" | cat`), [
		{ text: `echo 'a && b' "c || d"`, op: "$" }, { text: "cat", op: "|" },
	]);
	assert.deepEqual(splitCommand(String.raw`echo a\|b \&\& "c\"||d" && done`), [
		{ text: String.raw`echo a\|b \&\& "c\"||d"`, op: "$" }, { text: "done", op: "&&" },
	]);
	assert.deepEqual(splitCommand("(a && (b || c)) | echo $(x | y) && z"), [
		{ text: "(a && (b || c))", op: "$" }, { text: "echo $(x | y)", op: "|" }, { text: "z", op: "&&" },
	]);
	assert.deepEqual(splitCommand("(a\n| b) || c"), [
		{ text: "(a", op: "$" }, { text: "| b)", op: "" }, { text: "c", op: "||" },
	]);
	assert.deepEqual(call({ command: "echo one \\\ntwo" }), ["├─ $  echo one \\" , "│     two"]);
	assert.deepEqual(call({ command: "echo 'one\ntwo | three' && done" }), [
		"├─ $  echo 'one", "│     two | three'", "│  && done",
	]);
	assert.deepEqual(call({ command: "cat <<'EOF' | wc\na && b\nEOF\necho done" }), [
		"├─ $  cat <<'EOF'", "│  |  wc", "│     a && b", "│     EOF", "│     echo done",
	]);
	assert.deepEqual(splitCommand("echo x &&\necho y"), [
		{ text: "echo x", op: "$" }, { text: "echo y", op: "&&" },
	]);
	assert.deepEqual(splitCommand("echo x && \\\necho y"), [
		{ text: "echo x", op: "$" }, { text: "echo y", op: "&&" },
	]);
	assert.deepEqual(call({ command: "echo x \\\n  --flag" }), ["├─ $  echo x \\", "│       --flag"]);
	assert.deepEqual(splitCommand("cat <<-EOF <<'END'\n\ta | b\n\tEOF\nc && d\nEND"), [
		{ text: "cat <<-EOF <<'END'", op: "$" }, { text: "\ta | b", op: "" },
		{ text: "\tEOF", op: "" }, { text: "c && d", op: "" }, { text: "END", op: "" },
	]);
	assert.deepEqual(splitCommand("printf 'a  \n\nb'"), [
		{ text: "printf 'a  ", op: "$" }, { text: "", op: "" }, { text: "b'", op: "" },
	]);
	assert.deepEqual(splitCommand(`echo "unfinished ||`), [{ text: `echo "unfinished ||`, op: "$" }]);
	assert.deepEqual(splitCommand("cat <<< word | wc"), [
		{ text: "cat <<< word", op: "$" }, { text: "wc", op: "|" },
	]);

	assert.deepEqual(outputLines("> printf ready\r\n❯ ready\r\n>   indented\r\nplain\r\n", "printf ready"), ["ready", "  indented", "plain"]);
	assert.deepEqual(outputLines("$ printf ready\nprintf ready\nready\nprintf ready", "printf ready"), ["ready", "printf ready"]);
	assert.deepEqual(outputLines("\x1b[32m❯ printf ready\x1b[0m\nready", "printf ready"), ["ready"]);
	assert.deepEqual(outputLines("\x1b[32m> ready\x1b[0m", "printf ready"), ["\x1b[32mready\x1b[0m"]);
	assert.deepEqual(outputLines("\x1b[32m❯\x1b[0m printf ready\nready", "printf ready"), ["ready"]);
	assert.deepEqual(outputLines("> echo one \\\n> two\nresult", "echo one \\\ntwo"), ["result"]);
	assert.deepEqual(outputLines("echo one\nactual output", "echo one\necho two"), ["echo one", "actual output"]);
	assert.deepEqual(outputLines("x > y\n❯not-a-gutter\n>actual", "cmd"), ["x > y", "❯not-a-gutter", ">actual"]);

	assert.deepEqual(result({ output: "> printf ready\n❯ ready", copied: true }), [
		"├─ §  why", "├─ ¶  ready", "├─ $  printf ready", "└─ ✓ output pasted · 1 lines · y-copied", "  ready",
	]);
	assert.equal(result({ output: "ready" })[3], "└─ ✓ output pasted · 1 lines");
	assert.equal(result({})[3], "└─ ● no output submitted");
	assert.equal(result({ output: "printf ready" })[3], "└─ ● no output submitted");
	assert.equal(result({ autoRun: true, exitCode: 0 })[3], "└─ ✓ via :term dm · exit 0 · 0 lines");
	assert.equal(result({ autoRun: true, exitCode: 7, output: "err" })[3], "└─ ✗ via :term dm · exit 7 · 1 lines");
	assert.equal(result({ autoRun: true })[3], "└─ ✓ via :term dm · exit unknown · 0 lines");
	const styled = [];
	const recordingTheme = { ...theme, fg: (color, text) => { styled.push([color, text]); return text; } };
	result({ autoRun: true, exitCode: 2 }, 100, recordingTheme);
	assert.ok(styled.some(([color, text]) => color === "error" && text === "✗"));
	for (const status of ["cancelled", "unavailable"]) {
		styled.length = 0;
		assert.deepEqual(result({ status, message: "reason", output: "stale" }, 100, recordingTheme).slice(3), [`└─ ● ${status} · reason`]);
		assert.ok(styled.some(([color, text]) => color === "dim" && text === `└─ ● ${status} · reason`));
		assert.equal(result({ status })[3], `└─ ● ${status}`);
	}
	styled.length = 0;
	call({ details: "why", prediction: "what", command: "a && b\nc" }, 100, recordingTheme);
	for (const text of ["├─ §  ", "├─ ¶  ", "├─ $  ", "│  && ", "c"]) {
		assert.ok(styled.some(([color, value]) => color === "dim" && value === text), `${text}: dim marker/continuation`);
	}

	for (const count of [0, 1, 59, 60, 61, 62, 100]) {
		const output = Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");
		const rendered = result({ output });
		const body = rendered.slice(4);
		if (count <= 60) assert.deepEqual(body, output ? output.split("\n").map(line => `  ${line}`) : []);
		else {
			assert.equal(body.length, 61);
			assert.equal(body[29], "  line 30");
			assert.equal(body[30], `  … ${count - 60} lines hidden …`);
			assert.equal(body[31], `  line ${count - 29}`);
			assert.equal(body[60], `  line ${count}`);
			assert.match(rendered[3], new RegExp(` · ${count} lines$`));
		}
		assert.ok(body.every(line => !line.includes("│")), "output has no copy-hostile rails");
		assert.deepEqual(result({ output }, 100, theme, true), rendered, "result renders full content regardless of expanded flag");
	}
	const longBody = "\x1b[31m" + "word ".repeat(30) + "\x1b[0m\nlast line";
	const wrapped = result({ context: longBody, prediction: longBody }, 40);
	assert.ok(wrapped.every(line => (tuiUtils?.visibleWidth(line) ?? stripVTControlCharacters(line).length) <= 40));
	assert.ok(wrapped.some(line => line.includes("\x1b[31m")), "ANSI styling survives wrapping");
	assert.ok(wrapped.every(line => !stripVTControlCharacters(line).includes("\x1b")), "no broken ANSI sequences");
	const paragraph = wrapped.slice(0, wrapped.findIndex(line => line.startsWith("├─ ¶")));
	assert.equal(paragraph.map(line => stripVTControlCharacters(line).slice(6)).join("").replace(/\s/g, ""), stripVTControlCharacters(longBody).replace(/\s/g, ""), "full body retained");
	assert.ok(result({ context: "x".repeat(220) }).filter(line => line.includes("x")).length >= 3, "default wrap is around 100 columns");
	assert.equal(tool.renderResult({ content: [{ type: "text", text: "legacy" }] }, {}, theme).text, "legacy");

	// The chat resolver shadows renderCall and delegates only expanded results.
	// Exercise that boundary without changing or stubbing the renderer itself.
	let resolveRenderer;
	uiJiti("./tool-call-renderer-public.ts").default({
		on() {}, events: { on: () => () => {} },
		registerToolRenderer(resolver) { resolveRenderer = resolver; },
		registerShortcut() {},
	});
	const chatRenderer = resolveRenderer("run-command", () => tool);
	const chatContext = { toolCallId: "render-check", args: {}, executionStarted: false, isError: false };
	const chatResult = { content: [{ type: "text", text: "User ran the command and pasted output." }], details: {
		status: "answered", context: "Check the working tree", prediction: "A clean checkout",
		command: "git status --short && git branch --show-current", copied: true, output: "❯ feat/example",
	} };
	const expandedRows = chatRenderer.renderResult(chatResult, { expanded: true, isPartial: false }, theme, chatContext).render(100);
	assert.deepEqual(expandedRows, [
		"├─ §  Check the working tree", "├─ ¶  A clean checkout", "├─ $  git status --short",
		"│  && git branch --show-current", "└─ ✓ output pasted · 1 lines · y-copied", "  feat/example",
	]);
	assert.notEqual(chatRenderer.renderCall, tool.renderCall, "chat still owns collapsed calls");
	assert.equal(chatRenderer.renderResult(chatResult, { expanded: false, isPartial: false }, theme, chatContext).render(100).length, 1);
	if (process.env.RUN_COMMAND_SHOW_RENDERERS === "1") console.log("EXPANDED CHAT RESULT\n" + expandedRows.join("\n"));

	async function drive(keys, command = "printf ready", prediction = "ready") {
		let panel;
		const renders = [];
		const theme = { fg: (_color, text) => text, bold: text => text };
		const tui = { requestRender: () => renders.push(panel.render(80).join("\n")) };
		const ctx = {
			hasUI: true,
			cwd: process.cwd(),
			ui: {
				custom(factory) {
					return new Promise(resolve => {
						panel = factory(tui, theme, {}, resolve);
						renders.push(panel.render(80).join("\n"));
						(async () => {
							for (const key of keys) {
								// A RegExp key waits (event-loop turns only, bounded) until
								// the panel shows that state — no real sleeps.
								if (key instanceof RegExp) {
									for (let i = 0; i < 600 && !key.test(renders[renders.length - 1] ?? ""); i++) {
										await new Promise(r => setTimeout(r, 2));
									}
								} else {
									panel.handleInput(key);
								}
								renders.push(panel.render(80).join("\n"));
							}
						})();
					});
			},
		},
		};
		const result = await tool.execute(
			"test-call",
			{ command, prediction },
			undefined,
			undefined,
			ctx,
		);
		return { result, renders };
	}

	const yanked = await drive(["y", "received through leader-at", "\r"]);
	assert.deepEqual(globalThis.__runCommandClipboardCalls, ["printf ready"]);
	assert.equal(yanked.result.details.output, "received through leader-at");
	assert.equal(yanked.result.details.copied, true);
	assert.match(yanked.renders[1], /Output \(paste what you saw below\):/);
	assert.match(yanked.renders[1], /Enter — submit · Tab — unfocus/);
	assert.doesNotMatch(yanked.renders[1], /Tab to focus/);
	if (process.env.RUN_COMMAND_SHOW_PANEL === "1") {
		console.log([
			"INITIAL PANEL",
			yanked.renders[0],
			"",
			"AFTER PRESSING Y (NO TAB)",
			yanked.renders[1],
			"",
			"OUTPUT RECEIVED DIRECTLY",
			yanked.renders[2],
		].join("\n"));
	}

	const tabbed = await drive(["\t", "manual paste", "\r"]);
	assert.equal(tabbed.result.details.output, "manual paste");
	assert.equal(tabbed.result.details.copied, false);

	const smallOutput = "small line 1\nsmall line 2";
	const smallPaste = await drive(["\t", `\x1b[200~${smallOutput}\x1b[201~`, "\r"]);
	assert.equal(smallPaste.result.details.output, smallOutput);
	assert.doesNotMatch(smallPaste.renders[2], /\[paste #/);

	const largeOutput = Array.from({ length: 18 }, (_, i) => `output line ${i + 1}`).join("\n");
	const largePaste = await drive(["\t", `\x1b[200~${largeOutput}\x1b[201~`, "\r"]);
	assert.match(largePaste.renders[2], /\[paste #1 \+18 lines\]/);
	assert.equal(largePaste.result.details.output, largeOutput);
	assert.match(largePaste.result.content[0].text, /output line 9/);
	assert.doesNotMatch(largePaste.result.content[0].text, /\[paste #1/);

	// ── execute() guards ────────────────────────────────────────────────
	assert.equal(
		(await tool.execute("t", { command: "   ", prediction: "p" }, undefined, undefined, { hasUI: true })).details.status,
		"unavailable",
		"empty command → unavailable",
	);
	assert.equal(
		(await tool.execute("t", { command: "x", prediction: "p" }, undefined, undefined, { hasUI: false })).details.status,
		"unavailable",
		"no UI → unavailable",
	);
	const preAborted = new AbortController();
	preAborted.abort();
	assert.equal(
		(await tool.execute("t", { command: "x", prediction: "p" }, preAborted.signal, undefined, undefined, { hasUI: true })).details.status,
		"cancelled",
		"pre-aborted signal → cancelled",
	);

	// C4: the unfocused Enter submission path also expands the compact paste
	// marker; the visible editor keeps the marker until submit.
	const unfocusedPaste = await drive(["\t", `\x1b[200~${largeOutput}\x1b[201~`, "\t", "\r"]);
	assert.equal(unfocusedPaste.result.details.output, largeOutput, "unfocused Enter submits the expanded paste");
	assert.match(unfocusedPaste.renders[3], /\[paste #1 \+18 lines\]/, "visible editor keeps the compact marker");

	// C5: the Tab path reaches the same focused state and hints as the y path.
	assert.match(tabbed.renders[1], /Output \(paste what you saw below\):/);
	assert.match(tabbed.renders[1], /Enter — submit · Tab — unfocus/);

	// Enter while unfocused with an empty field focuses the field instead of
	// submitting nothing; the next Enter submits the (still empty) output.
	const emptyGuard = await drive(["\r", "\r"]);
	assert.match(emptyGuard.renders[1], /Tab — unfocus/, "first Enter focused the output field");
	assert.match(emptyGuard.result.content[0].text, /submitted WITHOUT output/);

	// ── Neovim auto-capture (C2/C3) over the fake nvim + herdr binaries ──
	// Mirror of the fake nvim's Vim double-quoted-string decoding: this is
	// the JS template → JSON.stringify → Vim string → nvim transport.
	function vimDecode(body) {
		const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", e: "\x1b", '"': '"', "\\": "\\" };
		let out = "";
		for (let i = 0; i < body.length; i++) {
			if (body[i] === "\\" && i + 1 < body.length) { out += map[body[i + 1]] ?? body[i + 1]; i++; }
			else out += body[i];
		}
		return out;
	}
	function luaevalArgs(expr) {
		const args = [];
		let i = expr.indexOf('"');
		while (i !== -1) {
			let j = i + 1, literal = "";
			while (j < expr.length && expr[j] !== '"') {
				if (expr[j] === "\\") { literal += expr[j] + expr[j + 1]; j += 2; }
				else { literal += expr[j]; j++; }
			}
			args.push(vimDecode(literal));
			i = expr.indexOf('"', j + 1);
		}
		return args;
	}
	function analyzeExprs(exprs) {
		const chunks = [], scripts = [];
		for (const { expr } of exprs) {
			assert.ok(!expr.includes("\n"), "every --remote-expr argument stays newline-free at the transport layer");
			if (!expr.startsWith("luaeval(")) continue; // liveness probe 1 and bufnr('%')
			const pair = luaevalArgs(expr);
			assert.equal(pair.length, 2, "luaeval carries exactly two string arguments");
			if (pair[0] === "load(...)()") chunks.push(pair[1]);
			else if (pair[0].includes("nvim_chan_send")) scripts.push(pair[1]);
			else assert.fail(`unrecognized luaeval expression: ${pair[0]}`);
		}
		return { chunks, scripts };
	}
	// #185: a raw newline inside a Lua string literal makes load() return nil,
	// so load(...)() throws and the auto-capture result is never submitted.
	function assertLoadableLua(chunk) {
		for (const m of chunk.matchAll(/(['"])(?:\\.|(?!\1)[\s\S])*\1/g)) {
			assert.ok(!m[0].includes("\n"), `raw newline inside a Lua string literal breaks load(): ${m[0]}`);
		}
	}
	function assertRpcRoundTrip(exprs) {
		const { chunks, scripts } = analyzeExprs(exprs);
		for (const payload of [...chunks, ...scripts]) {
			const json = JSON.stringify(payload);
			assert.ok(exprs.some(({ expr }) => expr.includes(json)), "the JSON form of every payload appears verbatim in its expr");
			assert.equal(vimDecode(json.slice(1, -1)), payload, "JS → JSON.stringify → Vim double-quoted string round trip is lossless");
		}
		for (const chunk of chunks) assertLoadableLua(chunk);
		return { chunks, scripts };
	}

	const parseLog = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map(JSON.parse) : []);
	const pane = (pane_id, tab_id, focused = false) => ({ pane_id, tab_id, focused });
	const procInfo = (name, pid, argv) => ({ result: { process_info: { foreground_processes: [{ name, pid, argv }] } } });
	async function driveAuto({ keys = ["r"], command = "printf 'auto ok\\n'; exit 3", prediction = "auto ok", setup }) {
		const nvimDir = mkdtempSync(join(tmpdir(), "rc-fake-nvim-"));
		const herdrDir = mkdtempSync(join(tmpdir(), "rc-fake-herdr-"));
		const staged = setup ? setup({ nvimDir, herdrDir }) : {};
		if (staged.scenario) writeFileSync(join(herdrDir, "scenario.json"), JSON.stringify(staged.scenario));
		const envKeys = ["PATH", "NVIM_LISTEN_ADDRESS", "XDG_RUNTIME_DIR", "FAKE_NVIM_DIR", "FAKE_HERDR_DIR", "FAKE_NVIM_DELAYED", "FAKE_NVIM_FLOAT_REPLY"];
		const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
		const apply = (env) => {
			for (const [k, v] of Object.entries(env)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		};
		apply({
			PATH: `${fakeBinDir}:${process.env.PATH}`,
			NVIM_LISTEN_ADDRESS: undefined,
			XDG_RUNTIME_DIR: undefined,
			FAKE_NVIM_DIR: nvimDir,
			FAKE_HERDR_DIR: herdrDir,
			FAKE_NVIM_DELAYED: undefined,
			FAKE_NVIM_FLOAT_REPLY: undefined,
			...staged.env,
		});
		try {
			const driven = await drive(keys, command, prediction);
			return {
				...driven,
				staged,
				exprs: parseLog(join(nvimDir, "expr.log")),
				herdrCalls: parseLog(join(herdrDir, "log")),
				cleanup: existsSync(join(nvimDir, "cleanup.log")) ? readFileSync(join(nvimDir, "cleanup.log"), "utf8") : "",
			};
		} finally {
			apply(saved);
			rmSync(nvimDir, { recursive: true, force: true });
			rmSync(herdrDir, { recursive: true, force: true });
		}
	}

	// C3 flagship: discovery finds the focused pane's nvim (`--listen PATH`
	// form), the float opens over its socket, output + exit status come back
	// through the capture file, and the float is closed + wiped while the
	// host pane is never closed. The staged partial first poll also exercises
	// the output wait loop (C1 partial/no END marker on the consumer side).
	const floatRun = await driveAuto({
		setup: ({ nvimDir }) => {
			const sock = join(nvimDir, "sock-a");
			writeFileSync(sock, "");
			return {
				sock,
				env: { FAKE_NVIM_DELAYED: "1" },
				scenario: {
					current: { result: { pane: { tab_id: "T1", pane_id: "P0" } } },
					list: { result: { panes: [pane("P1", "T1", true), pane("P2", "T1"), pane("P3", "T2")] } },
					info: {
						P1: procInfo("nvim", 111, ["nvim", "--listen", sock]),
						P2: procInfo("zsh", 222, ["zsh"]),
						P3: procInfo("nvim", 333, ["nvim", "--listen", join(nvimDir, "unused-sock")]),
					},
				},
			};
		},
	});
	assert.equal(floatRun.result.details.status, "answered");
	assert.equal(floatRun.result.details.autoRun, true);
	assert.equal(floatRun.result.details.exitCode, 3);
	assert.equal(floatRun.result.details.output, "auto ok");
	assert.match(floatRun.result.content[0].text, /Exit status: 3/);
	assert.match(floatRun.renders[1], /Esc cancels/, "running banner is visible right after r");
	assert.ok(
			floatRun.exprs.some(({ server, expr }) => server === floatRun.staged.sock && expr === "1"),
			"liveness probe hit the discovered socket",
	);
	for (const { server, expr } of floatRun.exprs) {
		if (expr.startsWith("luaeval(")) assert.equal(server, floatRun.staged.sock, "all RPC goes to the discovered socket");
	}
	assert.equal(floatRun.exprs.filter(({ expr }) => expr.includes("nvim_buf_get_lines")).length, 2, "one partial poll, then the complete buffer");
	assert.ok(
			!floatRun.herdrCalls.some(c => ["close", "split", "run"].includes(c[1])),
			"the float path never splits, runs, or closes a pane",
	);
	assert.match(floatRun.cleanup, /nvim_win_close\(101, true\)/, "float window is closed");
	assert.match(floatRun.cleanup, /nvim_buf_delete\(5, \{force=true, unload=true\}\)/, "float scratch buffer is wiped");
	const floatPayloads = assertRpcRoundTrip(floatRun.exprs);
	assert.equal(floatPayloads.scripts.length, 1);
	assert.ok(
			floatPayloads.scripts[0].split("\n").includes("printf 'auto ok\\n'; exit 3"),
			"the exact command rides the pasted wrapper",
	);
	const readChunk = floatPayloads.chunks.find(c => c.includes("nvim_buf_get_lines"));
	assert.ok(readChunk.includes("nvim_buf_get_lines(5, 0, -1, false)"), "the float buffer id flows into the read chunk");
	assert.ok(
			readChunk.includes(String.raw`), "\n")`),
			"the join separator is the Lua \\n escape, never a raw newline (#185)",
	);

	// C3: a dead focused socket is skipped; the same-tab pane wins over the
	// other-tab pane; the joined `--listen=PATH` argv form parses; raw
	// non-JSON `pane current` stdout degrades to a null tab id; a
	// NVIM_LISTEN_ADDRESS that does not exist is ignored.
	const joinedRun = await driveAuto({
		command: "printf 'joined ok\\n'",
		setup: ({ nvimDir }) => {
			const deadSock = join(nvimDir, "sock-dead");
			const sock = join(nvimDir, "sock-joined");
			writeFileSync(deadSock, "");
			writeFileSync(sock, "");
			writeFileSync(join(nvimDir, "dead"), `${deadSock}\n`);
			return {
				sock,
				deadSock,
				env: { NVIM_LISTEN_ADDRESS: join(nvimDir, "missing.sock") },
				scenario: {
					current: "herdr: raw non-json stdout",
					list: { result: { panes: [pane("P1", "T1", true), pane("P2", "T1"), pane("P3", "T2")] } },
					info: {
						P1: procInfo("nvim", 111, ["nvim", `--listen=${deadSock}`]),
						P2: procInfo("nvim", 222, ["nvim", "--listen", sock]),
						P3: procInfo("nvim", 333, ["nvim", "--listen", join(nvimDir, "unused-sock")]),
					},
				},
			};
		},
	});
	assert.equal(joinedRun.result.details.status, "answered");
	assert.equal(joinedRun.result.details.exitCode, 0);
	assert.equal(joinedRun.result.details.output, "joined ok");
	assert.ok(
			joinedRun.exprs.some(({ server, expr }) => server === joinedRun.staged.deadSock && expr === "1"),
			"the dead focused socket was probed and skipped (joined --listen= form parsed)",
	);
	for (const { server, expr } of joinedRun.exprs) {
		if (expr.startsWith("luaeval(")) assert.equal(server, joinedRun.staged.sock, "RPC lands on the live same-tab socket");
	}
	assert.ok(
			!joinedRun.herdrCalls.some(c => c[1] === "process-info" && c[3] === "P3"),
			"the other-tab pane is never consulted",
	);
	assertRpcRoundTrip(joinedRun.exprs);

	// C3: the NVIM_LISTEN_ADDRESS override short-circuits pane discovery.
	const envRun = await driveAuto({
		command: "printf 'env ok\\n'",
		setup: ({ nvimDir }) => {
			const sock = join(nvimDir, "sock-env");
			writeFileSync(sock, "");
			return { sock, env: { NVIM_LISTEN_ADDRESS: sock } };
		},
	});
	assert.equal(envRun.result.details.status, "answered");
	assert.equal(envRun.result.details.output, "env ok");
	assert.equal(envRun.herdrCalls.length, 0, "the env override skips herdr entirely");
	for (const { server, expr } of envRun.exprs) {
		if (expr.startsWith("luaeval(")) assert.equal(server, envRun.staged.sock);
	}
	assertRpcRoundTrip(envRun.exprs);

	// C3: no drivable nvim anywhere → null → split fallback. The owned pane is
	// closed on completion; the launch argv is recorded.
	const splitRun = await driveAuto({
		command: "printf 'split ok\\n'; false",
		setup: () => ({
			scenario: {
				current: { result: { pane: { tab_id: "T1" } } },
				list: { result: { panes: [] } },
				split: { result: { pane: { pane_id: "P-NEW" } } },
			},
		}),
	});
	assert.equal(splitRun.result.details.status, "answered");
	assert.equal(splitRun.result.details.autoRun, true);
	assert.equal(splitRun.result.details.exitCode, 1);
	assert.equal(splitRun.result.details.output, "split ok");
	const runCall = splitRun.herdrCalls.find(c => c[1] === "run");
	assert.ok(runCall, "the fallback launches nvim through herdr pane run");
	assert.equal(runCall[2], "P-NEW");
	assert.equal(runCall[3], "nvim");
	assert.equal(runCall[4], "--listen");
	assert.ok(runCall.includes("-n") && runCall.includes("+term dm") && runCall.includes("+startinsert"));
	const closes = splitRun.herdrCalls.filter(c => c[1] === "close");
	assert.equal(closes.length, 1, "exactly the owned pane is closed");
	assert.equal(closes[0][2], "P-NEW");
	assert.ok(splitRun.exprs.some(({ expr }) => expr === "bufnr('%')"), "the split path resolves its terminal buffer");
	const splitPayloads = assertRpcRoundTrip(splitRun.exprs);
	assert.ok(
		splitPayloads.chunks.some(c => c.includes("nvim_buf_get_lines(1, 0, -1, false)")),
		"the split buffer id flows into the read chunk",
	);
	assert.ok(!splitRun.cleanup.includes("nvim_win_close"), "no float cleanup on the split path");

	// C3: an nvim without --listen falls back to the pid-based default socket
	// under XDG_RUNTIME_DIR.
	const pidRun = await driveAuto({
		command: "printf 'pid ok\\n'",
		setup: ({ nvimDir }) => {
			const xdg = join(nvimDir, "xdg");
			mkdirSync(xdg);
			const sock = join(xdg, "nvim.4242.0");
			writeFileSync(sock, "");
			return {
				sock,
				env: { XDG_RUNTIME_DIR: xdg },
				scenario: {
					current: { result: { pane: { tab_id: "T1" } } },
					list: { result: { panes: [pane("P1", "T1", true)] } },
					info: { P1: procInfo("nvim", 4242, ["nvim", "-n"]) },
				},
			};
		},
	});
	assert.equal(pidRun.result.details.status, "answered");
	assert.equal(pidRun.result.details.output, "pid ok");
	for (const { server, expr } of pidRun.exprs) {
		if (expr.startsWith("luaeval(")) assert.equal(server, pidRun.staged.sock, "the pid-derived default socket is used");
	}
	assertRpcRoundTrip(pidRun.exprs);

	// Esc while the auto-run is in flight cancels the panel; the run aborts
	// without surfacing an error result.
	const cancelledRun = await driveAuto({
		keys: ["r", "\x1b"],
		command: "printf 'never\\n'",
		setup: ({ nvimDir }) => {
			const sock = join(nvimDir, "sock-f");
			writeFileSync(sock, "");
			return {
				sock,
				scenario: {
					current: { result: { pane: { tab_id: "T1" } } },
					list: { result: { panes: [pane("P1", "T1", true)] } },
					info: { P1: procInfo("nvim", 111, ["nvim", "--listen", sock]) },
				},
			};
		},
	});
	assert.equal(cancelledRun.result.details.status, "cancelled");
	assert.match(cancelledRun.result.content[0].text, /User cancelled run-command/);

	// A float that cannot open (garbage RPC reply) degrades to an error notice
	// on the panel; manual paste still submits afterwards.
	const floatFail = await driveAuto({
		keys: ["r", /Neovim run failed/, "\t", "\x1b[200~fallback paste\x1b[201~", "\r"],
		command: "printf 'never\\n'",
		setup: ({ nvimDir }) => {
			const sock = join(nvimDir, "sock-g");
			writeFileSync(sock, "");
			return {
				sock,
				env: { FAKE_NVIM_FLOAT_REPLY: "nil|nil|nil" },
				scenario: {
					current: { result: { pane: { tab_id: "T1" } } },
					list: { result: { panes: [pane("P1", "T1", true)] } },
					info: { P1: procInfo("nvim", 111, ["nvim", "--listen", sock]) },
				},
			};
		},
	});
	assert.equal(floatFail.result.details.status, "answered");
	assert.equal(floatFail.result.details.output, "fallback paste");
	assert.notEqual(floatFail.result.details.autoRun, true);
	assert.ok(floatFail.renders.some(r => /Neovim run failed/.test(r)), "the panel shows the auto-run failure");
	assert.ok(floatFail.renders.some(r => /Manual copy\/paste still works/.test(r)), "the panel keeps the manual path");

	// Optional real-Lua gate: when a Lua interpreter is installed, every Lua
	// chunk recorded above must compile under load() (skip-if-absent matrix).
	const allChunks = [floatRun, joinedRun, envRun, splitRun, pidRun].flatMap(r => analyzeExprs(r.exprs).chunks);
	const luaBin = ["lua5.4", "lua5.3", "lua5.1", "luajit", "lua"].find(
		b => spawnSync(b, ["-e", ""], { stdio: "ignore" }).status === 0,
	);
	if (luaBin) {
		const chunkFile = join(tmpdir(), `rc-lua-chunk-${process.pid}.lua`);
		for (const chunk of allChunks) {
			writeFileSync(chunkFile, chunk);
			const compiled = spawnSync(luaBin, ["-e", `assert(loadfile(${JSON.stringify(chunkFile)}))`], { encoding: "utf8" });
			assert.equal(compiled.status, 0, `Lua chunk must compile under load(): ${compiled.stderr}`);
			rmSync(chunkFile, { force: true });
		}
	}
} finally {
	delete globalThis.__runCommandClipboardCalls;
	delete globalThis.__runCommandTuiUtils;
	rmSync(stubDir, { recursive: true, force: true });
	rmSync(fakeBinDir, { recursive: true, force: true });
}

console.log("run-command helper, renderer, UI workflow, and Neovim auto-capture tests passed");
