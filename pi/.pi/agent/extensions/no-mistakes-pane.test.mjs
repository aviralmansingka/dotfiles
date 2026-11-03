import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
// Resolve jiti the way CI (JITI_PATH) and a local Mac install do.
function findJiti() {
	const candidates = [
		process.env.JITI_PATH,
		"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	];
	const releases = join(process.env.HOME ?? "/tmp", ".pi/agent/install/releases");
	if (existsSync(releases)) {
		for (const release of readdirSync(releases).sort().reverse()) {
			candidates.push(join(releases, release, "node_modules/jiti/lib/jiti.cjs"));
		}
	}
	return candidates.find((candidate) => candidate && existsSync(candidate));
}
const jitiPath = findJiti();
if (!jitiPath) throw new Error("no jiti found; set JITI_PATH");
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const {
	buildPaneScript,
	extractMarkedOutput,
	NM_PANE_LABEL,
	paneLabel,
	paneStateFromResponse,
	QUICK_SUBCOMMANDS,
	subcommandOf,
	wantsPane,
} = jiti("./no-mistakes-pane/capture.ts");

// ---------------------------------------------------------------------------
// buildPaneScript — run the generated script under bash with a stub
// no-mistakes on PATH and assert the observable contract the agent and the
// pane both depend on: stdout is teed to the capture file and the pane,
// stderr streams only to the pane, the exit code rides the END marker, the
// script itself exits 0, every argument round-trips as its own argv entry,
// and the command runs in the caller's directory even when the pane shell is
// elsewhere.
// ---------------------------------------------------------------------------
function runScript(axiArgs, token, stubExit, runCwd, stubLines) {
	const dir = mkdtempSync(join(tmpdir(), "pi-nm-stub-"));
	const outFile = join(dir, "capture.out");
	const scriptFile = join(dir, "run.sh");
	const stubPath = join(dir, "no-mistakes");
	const cwd = runCwd ?? dir;
	writeFileSync(
		stubPath,
		(stubLines ?? [
			"#!/bin/sh",
			'printf "arg=%s\\n" "$@"',
			'printf "PWD=%s\\n" "$PWD"',
			'printf "STDERR_NOISE\\n" 1>&2',
			'printf "STDOUT_LINE\\n"',
			`exit ${stubExit}`,
			"",
		]).join("\n"),
	);
	chmodSync(stubPath, 0o755);
	writeFileSync(scriptFile, buildPaneScript(axiArgs, token, outFile, cwd));
	const ran = spawnSync("bash", [scriptFile], {
		encoding: "utf-8",
		env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
	});
	const captured = existsSync(outFile) ? readFileSync(outFile, "utf-8") : "";
	rmSync(dir, { recursive: true, force: true });
	return { ran, captured, cwd };
}

{
	// Apostrophe and spaces must survive quoting as one argv entry.
	const intent = "visible pane for the captain's no-mistakes run";
	const token = `t${process.pid}`;
	const { ran, captured, cwd } = runScript(["run", "--intent", intent], token, 42);

	assert.equal(
		ran.status,
		0,
		"the wrapper exits 0: the pipeline status rides the END marker, not the pane",
	);
	const parsed = extractMarkedOutput(captured, token);
	assert.equal(parsed.complete, true, "END marker landed in the capture file");
	assert.equal(parsed.exitCode, 42, "the pipeline exit status rides the END marker");
	assert.match(parsed.output, /arg=axi/, "the axi subcommand reaches the CLI");
	assert.match(parsed.output, /arg=run/, "the subcommand round-trips");
	assert.match(parsed.output, /arg=--intent/, "flags round-trip");
	assert.ok(
		parsed.output.includes(`arg=${intent}`),
		"a multi-word intent with an apostrophe stays one argv entry",
	);
	assert.ok(parsed.output.includes(`PWD=${cwd}`), "the command runs in the caller's directory");
	assert.match(parsed.output, /STDOUT_LINE/, "stdout is captured for the agent");

	assert.doesNotMatch(captured, /STDERR_NOISE/, "stderr never pollutes the captured TOON");
	assert.match(ran.stdout, /STDERR_NOISE/, "stderr streams live to the pane terminal");
	assert.match(ran.stdout, /STDOUT_LINE/, "stdout is teed to the pane so the captain sees it live");
	assert.match(ran.stdout, /arg=run/, "the pane shows the gate output, not just progress");
}

{
	// Shell metacharacters in an argument are data, never expansions.
	const token = `inject${process.pid}`;
	const intent = "keep $HOME and `date` and $(whoami) literal";
	const { captured } = runScript(["run", "--intent", intent], token, 0);
	const parsed = extractMarkedOutput(captured, token);
	assert.ok(
		parsed.output.includes(`arg=${intent}`),
		"the pane script must not expand $, backticks, or $(...) in arguments",
	);
}

{
	// A pipeline outcome of 1 (failed) is data, not a pane error.
	const token = "failed1";
	const { ran, captured } = runScript(["run"], token, 1);
	assert.equal(ran.status, 0);
	assert.equal(extractMarkedOutput(captured, token).exitCode, 1);
}

{
	// A stdout tail without a trailing newline lands on the END-marker line,
	// because tee's last write and the marker printf share that line; the
	// tail is still stdout and must reach the agent.
	const token = `notrail${process.pid}`;
	const { captured } = runScript(["run"], token, 0, undefined, [
		"#!/bin/sh",
		'printf "outcome: passed"',
		"exit 0",
		"",
	]);
	const parsed = extractMarkedOutput(captured, token);
	assert.equal(parsed.complete, true, "the END marker landed");
	assert.equal(
		parsed.output,
		"outcome: passed",
		"the last stdout line before the END marker must not be dropped",
	);
	assert.equal(parsed.exitCode, 0);
}

{
	// A bad cwd completes the capture with 127 instead of hanging the pane.
	const token = "badcwd1";
	const missing = join(tmpdir(), `pi-nm-missing-${process.pid}-${Date.now()}`);
	const { ran, captured } = runScript(["run"], token, 0, missing);
	assert.equal(ran.status, 0, "the wrapper still exits 0");
	const parsed = extractMarkedOutput(captured, token);
	assert.equal(parsed.complete, true, "the failure is reported on the END marker");
	assert.equal(parsed.exitCode, 127);
	assert.match(ran.stdout, /cannot enter/, "the pane shows the directory error");
}

// ---------------------------------------------------------------------------
// extractMarkedOutput — completion, clean stdout, exit code.
// ---------------------------------------------------------------------------
{
	const captured = [
		"__NM_START_abc123__",
		"gate: review",
		"findings[1]{id,severity,file,action,description}:",
		"  r1,warning,foo.ts,auto-fix,Error from os.Remove is ignored",
		"__NM_END_abc123__:0",
		"progress noise that must not be captured",
	].join("\n");

	assert.deepEqual(extractMarkedOutput(captured, "abc123"), {
		complete: true,
		output:
			"gate: review\nfindings[1]{id,severity,file,action,description}:\n  r1,warning,foo.ts,auto-fix,Error from os.Remove is ignored",
		exitCode: 0,
	});

	// Still running: START present, no END yet, partial stdout surfaced.
	assert.deepEqual(extractMarkedOutput("__NM_START_abc123__\nrunning…", "abc123"), {
		complete: false,
		output: "running…",
	});

	// Nothing written yet: no START marker, so no output key at all.
	assert.deepEqual(extractMarkedOutput("", "abc123"), { complete: false });

	// A different call's markers never satisfy this call.
	assert.equal(extractMarkedOutput("__NM_START_other__\nx\n__NM_END_other__:0", "abc123").complete, false);

	// A stdout tail without a trailing newline shares the END-marker's line;
	// the text before the marker is still captured stdout.
	assert.deepEqual(
		extractMarkedOutput("__NM_START_abc123__\noutcome: passed__NM_END_abc123__:0", "abc123"),
		{ complete: true, output: "outcome: passed", exitCode: 0 },
	);
}

// ---------------------------------------------------------------------------
// Pane routing: pipeline drivers and state views open the pane; pure
// introspection and the bare home view do not.
// ---------------------------------------------------------------------------
{
	assert.equal(wantsPane(["run", "--intent", "x"]), true);
	assert.equal(wantsPane(["respond", "--action", "approve"]), true);
	assert.equal(wantsPane(["status"]), true);
	assert.equal(wantsPane([]), false, "the bare home view is cheap enough to run inline");
	assert.equal(wantsPane(["run", "--help"]), false);
	assert.equal(wantsPane(["--help"]), false);
	assert.equal(subcommandOf(["run", "--intent", "x"]), "run");
	assert.equal(subcommandOf(["--help"]), "");
	assert.equal(paneLabel(["run", "--intent", "x"]), `${NM_PANE_LABEL}: run`);
	assert.equal(paneLabel([]), NM_PANE_LABEL);
	assert.equal(QUICK_SUBCOMMANDS.has("status"), true);
	assert.equal(QUICK_SUBCOMMANDS.has("handoff"), true);
	assert.equal(
		QUICK_SUBCOMMANDS.has("answer"),
		true,
		"a reviewer question can arrive mid-run, so answer must not wait for the pane",
	);
	assert.equal(
		QUICK_SUBCOMMANDS.has("respond"),
		false,
		"respond owns the pane: it advances the gate and must stay visible",
	);
}

// ---------------------------------------------------------------------------
// paneStateFromResponse — only a definite pane_not_found cancels a run.
// A transient Herdr failure must be unknown (null), never "closed".
// ---------------------------------------------------------------------------
{
	assert.equal(paneStateFromResponse({ result: { pane: { pane_id: "w1:p2" } } }), true);
	assert.equal(paneStateFromResponse({ error: { code: "pane_not_found", message: "gone" } }), false);
	assert.equal(paneStateFromResponse({ error: { code: "internal", message: "boom" } }), null);
	assert.equal(paneStateFromResponse({}), null);
	assert.equal(paneStateFromResponse(null), null);
}

console.log("no-mistakes-pane capture tests passed");
