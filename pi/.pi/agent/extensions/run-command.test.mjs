import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
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
const { createJiti } = require("/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs");
const jiti = createJiti(import.meta.url);
const { buildNvimTerminalScript, extractMarkedOutput } = jiti("./run-command/nvim-terminal.ts");

const token = "abc123";
const command = "printf 'a b\\n'; printf \"err & stuff\\n\" >&2; false";

// Mirror runViaNvimTerminal's capture path: run the wrapper, detect completion
// + exit code from the END marker in the buffer, then read command output from
// the temp file (NOT the buffer).
function captureViaFile(cmd, tok) {
	const outFile = join(tmpdir(), `pi-rc-out-${tok}.txt`);
	rmSync(outFile, { force: true });
	const res = spawnSync("sh", ["-c", buildNvimTerminalScript(cmd, tok, outFile)], {
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
	return { parsed, output: output.trim(), status: res.status };
}

// A real interactive Neovim `:term` echoes the bulk-pasted wrapper before the
// shell executes it, so the buffer contains echoed printf command lines (which
// embed the START marker text) alongside the real END marker line. Output must
// come from the temp file, so extractMarkedOutput reports only completion +
// exit code from the END marker and never echo-corrupted buffer text. This
// fails against the old buffer-scraping implementation (which matched the
// echoed START printf line and returned the echoed script lines as `output`).
const echoed = [
	"$ printf '%s\\n' '__PI_RUN_COMMAND_START_abc123__'",
	"__PI_RUN_COMMAND_START_abc123__",
	"$ (",
	"$ printf 'a b\\n'; printf \"err & stuff\\n\" >&2; false",
	"$ ) >'/tmp/pi-rc-out-abc123.txt' 2>&1",
	"$ __pi_status=$?",
	"$ printf '%s:%s\\n' '__PI_RUN_COMMAND_END_abc123__' \"$__pi_status\"",
	"__PI_RUN_COMMAND_END_abc123__:1",
].join("\n");

assert.deepEqual(extractMarkedOutput(echoed, token), { complete: true, exitCode: 1 });

// Full capture path: stdout+stderr land in the temp file; exit status rides
// the END marker; the wrapper shell exits with the command's status.
const full = captureViaFile(command, token);
assert.deepEqual(full.parsed, { complete: true, exitCode: 1 });
assert.equal(full.output, "a b\nerr & stuff");
assert.equal(full.status, 1);

// `exit N` builtin is isolated in the subshell so the wrapper regains control
// and still emits the END marker; output is empty.
const exited = captureViaFile("exit 7", "ex");
assert.deepEqual(exited.parsed, { complete: true, exitCode: 7 });
assert.equal(exited.output, "");
assert.equal(exited.status, 7);

const ok = captureViaFile("printf 'hi\\n'; true", "ok");
assert.deepEqual(ok.parsed, { complete: true, exitCode: 0 });
assert.equal(ok.output, "hi");
assert.equal(ok.status, 0);

// No END marker yet → not complete.
assert.deepEqual(extractMarkedOutput("only partial", token), { complete: false });

console.log("run-command helper tests passed");
