import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const script = buildNvimTerminalScript(command, token);

assert.match(script, /stty -echo/);
assert.match(script, /PS1=/);
assert.ok(script.includes(command), "script preserves the displayed command verbatim");
assert.match(script, /__PI_RUN_COMMAND_START_abc123__/);
assert.match(script, /__PI_RUN_COMMAND_END_abc123__/);

const captured = [
	"sh-3.2$ stty -echo",
	"sh-3.2$ __PI_RUN_COMMAND_START_abc123__",
	"a b",
	"err & stuff",
	"__PI_RUN_COMMAND_END_abc123__:1",
	"exit \"$__pi_status\"",
].join("\n");

assert.deepEqual(extractMarkedOutput(captured, token), {
	complete: true,
	output: "a b\nerr & stuff",
	exitCode: 1,
});

assert.deepEqual(extractMarkedOutput("only partial", token), { complete: false });

function runWrapper(cmd, tok) {
	const res = spawnSync("sh", ["-c", buildNvimTerminalScript(cmd, tok)], {
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	return { stdout: res.stdout ?? "", status: res.status };
}

const exited = runWrapper("exit 7", "ex");
assert.deepEqual(extractMarkedOutput(exited.stdout, "ex"), {
	complete: true,
	output: "",
	exitCode: 7,
});
assert.equal(exited.status, 7, "wrapper exits with the command's status");

const ok = runWrapper("printf 'hi\\n'; true", "ok");
assert.deepEqual(extractMarkedOutput(ok.stdout, "ok"), {
	complete: true,
	output: "hi",
	exitCode: 0,
});
assert.equal(ok.status, 0);

console.log("run-command helper tests passed");
