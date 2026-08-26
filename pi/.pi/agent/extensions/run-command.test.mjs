import assert from "node:assert/strict";
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
const { buildNvimTerminalScript, extractMarkedOutput } = jiti("./run-command-nvim-terminal.ts");

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

console.log("run-command helper tests passed");
