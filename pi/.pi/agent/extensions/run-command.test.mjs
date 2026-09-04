import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

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
function wrapTextWithAnsi(text, width) {
  const lines = [];
  for (let rest = text; rest.length > width; rest = rest.slice(width)) lines.push(rest.slice(0, width));
  lines.push(text.slice(lines.length * width));
  return lines;
}
module.exports = {
  Editor, Text, Key, Type,
  copyToClipboard: async text => { globalThis.__runCommandClipboardCalls.push(text); },
  matchesKey: (data, key) => data === key,
  truncateToWidth: (text, width) => text.slice(0, width),
  visibleWidth: text => text.length,
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
	rmSync(stubDir, { recursive: true, force: true });
}

console.log("run-command helper and UI workflow tests passed");
