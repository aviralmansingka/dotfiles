import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const { buildPaneScript, extractMarkedOutput } = jiti("./no-mistakes-pane/capture.ts");

// ---------------------------------------------------------------------------
// buildPaneScript: run the generated script under bash with a stub
// no-mistakes on PATH and assert the observable capture behavior — stdout
// lands in the capture file, stderr is excluded from the file but streams
// live to the terminal, the exit code rides the END marker, and every arg
// round-trips verbatim (including a multi-word --intent value).
// ---------------------------------------------------------------------------
{
	const token = `behav${process.pid}`;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-stub-"));
	try {
		const outFile = join(stubDir, "capture.out");
		const scriptFile = join(stubDir, "run.sh");
		const stubPath = join(stubDir, "no-mistakes");
		const exitCode = 42;
		writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				'printf "arg=%s\\n" "$@"', // round-trip every arg to stdout
				'printf "STDERR_NOISE\\n" 1>&2', // stderr — must stream live, never reach the file
				'printf "STDOUT_LINE\\n"', // stdout — must land in the file
				`exit ${exitCode}`,
				"",
			].join("\n"),
		);
		chmodSync(stubPath, 0o755);

		const args = ["run", "--intent", "ship the no-mistakes visible pane feature"];
		writeFileSync(scriptFile, buildPaneScript(args, token, outFile));

		const ran = spawnSync("bash", [scriptFile], {
			encoding: "utf-8",
			env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
		});
		assert.equal(
			ran.status,
			0,
			`bash should exit 0 (the exit code rides the END marker, not the script); stderr: ${ran.stderr}`,
		);
		assert.ok(existsSync(outFile), "capture file was created by tee");

		const fileContents = readFileSync(outFile, "utf-8");
		const parsed = extractMarkedOutput(fileContents, token);

		assert.equal(parsed.complete, true, "END marker landed in the capture file");
		assert.equal(parsed.exitCode, exitCode, "exit code rides the END marker");
		assert.ok(parsed.output, "captured stdout is non-empty");

		// stdout lands in the file; args round-trip verbatim as separate argv entries.
		assert.match(parsed.output, /arg=axi/, "subcommand arg round-trips");
		assert.match(parsed.output, /arg=run/, "positional arg round-trips");
		assert.match(parsed.output, /arg=--intent/, "flag round-trips");
		assert.ok(
			parsed.output.includes("arg=ship the no-mistakes visible pane feature"),
			"multi-word --intent value survives as a single argv entry",
		);
		assert.match(parsed.output, /STDOUT_LINE/, "command stdout is captured");

		// stderr is excluded from the capture file but streamed live to the terminal.
		assert.doesNotMatch(fileContents, /STDERR_NOISE/, "stderr never reaches the capture file");
		assert.match(ran.stdout, /STDERR_NOISE/, "stderr streams live to the terminal via fd 3");
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// extractMarkedOutput: completion + clean stdout + exit code, with stderr
// excluded from the capture.
// ---------------------------------------------------------------------------
{
	const token = "abc123";
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
		output: "running…",
	});

	// No START marker at all (e.g. empty file before the command prints).
	assert.deepEqual(extractMarkedOutput("", token), { complete: false });
}

console.log("no-mistakes-pane capture tests passed");
