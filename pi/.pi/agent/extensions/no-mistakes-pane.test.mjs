import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.NODE_PATH = [
	"/opt/homebrew/lib/node_modules",
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules",
	process.env.NODE_PATH || "",
].filter(Boolean).join(":");
require("node:module").Module._initPaths();

// Resolve jiti the same way CI (JITI_PATH) and the local Mac install do.
const jitiPath = process.env.JITI_PATH
	? process.env.JITI_PATH
	: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const { buildPaneScript, extractMarkedOutput } = jiti("./no-mistakes-pane-capture.ts");

const token = "abc123";
const outFile = "/tmp/pi-nm-abc123.out";
const args = ["run", "--intent", "ship the no-mistakes visible pane feature"];
const script = buildPaneScript(args, token, outFile);

// Script shape: stdout teed to the capture file, stderr to the terminal via
// fd 3, markers bracketing the command, exit status carried on the END marker.
assert.match(script, /tee "\$OUT"/, "stdout is teed to the capture file");
assert.match(script, /2>&3/, "stderr is routed to fd 3 (terminal only)");
assert.match(script, /3>&1/, "fd 3 is anchored to the terminal");
assert.match(script, /__NM_START_abc123__/, "START marker present");
assert.match(script, /__NM_END_abc123__/, "END marker present");
// Every arg is single-quoted (safe shell), so the intent text survives intact
// and the no-mistakes argv is exactly the args we passed.
assert.ok(
	script.includes("'ship the no-mistakes visible pane feature'"),
	"intent text is shell-quoted and preserved verbatim",
);
assert.match(script, /'no-mistakes' 'axi' 'run' '--intent' /, "subcommand and flags are quoted into the command line");

// Completion + clean stdout + exit code, with stderr excluded from the capture.
const captured = [
	"__NM_START_abc123__",
	"gate: review",
	"findings[1]{id,severity,file,action,description}:",
	"  r1,warning,foo.ts,auto-fix,Error from os.Remove is ignored",
	"__NM_END_abc123__:0",
	"progress noise that should not be captured",
].join("\n");

assert.deepEqual(extractMarkedOutput(captured, token), {
	complete: true,
	output:
		"gate: review\nfindings[1]{id,severity,file,action,description}:\n  r1,warning,foo.ts,auto-fix,Error from os.Remove is ignored",
	exitCode: 0,
});

// A non-zero exit code (failed/cancelled outcome) is surfaced.
const failed = ["__NM_START_abc123__", "outcome: failed", "__NM_END_abc123__:1"].join("\n");
assert.deepEqual(extractMarkedOutput(failed, token), {
	complete: true,
	output: "outcome: failed",
	exitCode: 1,
});

// Partial / still-running: no END marker yet.
assert.deepEqual(extractMarkedOutput("__NM_START_abc123__\nrunning…", token), {
	complete: false,
});

// No START marker at all (e.g. empty file before the command prints).
assert.deepEqual(extractMarkedOutput("", token), { complete: false });

console.log("no-mistakes-pane capture tests passed");
