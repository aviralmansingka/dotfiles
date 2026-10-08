import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { stripVTControlCharacters } from "node:util";

// Optional real Pi helpers exercise ANSI/Unicode wrapping locally; CI's small
// dependency stub below still checks the renderer's wrapping contract.
const tuiUtils = process.env.PI_TUI_UTILS ? await import(process.env.PI_TUI_UTILS) : undefined;
globalThis.__runCommandTuiUtils = tuiUtils;

const require = createRequire(import.meta.url);
process.env.NODE_PATH = [
	"/opt/homebrew/lib/node_modules",
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules",
	process.env.NODE_PATH || "",
].filter(Boolean).join(":");
require("node:module").Module._initPaths();
// Allow CI / non-macOS hosts to supply jiti via JITI_PATH; fall back to the
// captain's macOS homebrew pi install (matches quiz-context-files.test.mjs).
const _jitiCjs =
	process.env.JITI_PATH ||
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(_jitiCjs);
const jiti = createJiti(import.meta.url);
const { buildNvimTerminalScript, extractMarkedOutput } = jiti("./run-command/nvim-terminal.ts");

const token = "abc123";
const command = "printf 'a b\\n'; printf \"err & stuff\\n\" >&2; false";

// Mirror runViaNvimTerminal's capture path: run the wrapper, detect completion
// + exit code from the END marker in the buffer, then read command output from
// the temp file (NOT the buffer). `shell` defaults to sh; the tee +
// trap-based exit-code wrapper is portable across sh/bash/zsh/dash.
function captureViaFile(cmd, tok, shell = "sh") {
	const outFile = join(tmpdir(), `pi-rc-out-${tok}.txt`);
	const statusFile = join(tmpdir(), `pi-rc-st-${tok}.txt`);
	rmSync(outFile, { force: true });
	rmSync(statusFile, { force: true });
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
	rmSync(statusFile, { force: true });
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

	async function drive(keys) {
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
						for (const key of keys) {
							panel.handleInput(key);
							renders.push(panel.render(80).join("\n"));
						}
					});
			},
		},
		};
		const result = await tool.execute(
			"test-call",
			{ command: "printf ready", prediction: "ready" },
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
} finally {
	delete globalThis.__runCommandClipboardCalls;
	delete globalThis.__runCommandTuiUtils;
	rmSync(stubDir, { recursive: true, force: true });
}

console.log("run-command helper, renderer, and UI workflow tests passed");
