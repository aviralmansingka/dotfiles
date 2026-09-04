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
const { buildPaneScript, extractMarkedOutput, buildBackgroundScript, buildAttachScript, hasStartMarker, wantsTuiPane, TUI_SUBCOMMANDS } = jiti("./no-mistakes-pane/capture.ts");
const { parseDurationMs, parseNoMistakesRunId, parseNoMistakesStatus, observeNoMistakesTiming, isObservableNoMistakesRun, summarizeNoMistakesSnapshot, phaseProgress } = jiti("./no-mistakes-pane/status.ts");
const noMistakesPane = jiti("./no-mistakes-pane.ts").default;

// ---------------------------------------------------------------------------
// AXI status observation: parse the daemon-owned run without changing it and
// expose the compact status + nine phase rows used by the shared activity UI.
// ---------------------------------------------------------------------------
{
	const output = [
		"run:",
		'  id: "00000000000000000000000000"',
		"  branch: feat/nm-ui",
		"  status: running",
		"  awaiting_agent: parked 12s",
		"  steps[3]{step,status,findings,duration_ms}:",
		"    intent,completed,0,2010",
		"    review,awaiting_approval,2,0",
		"    test,pending,0,0",
		"  gate:",
		"    step: review",
		"    findings[2]{id,severity,file,action,description}:",
		"      r1,error,src/a.ts,ask-user,Null value reaches renderer",
		"      r2,warning,src/b.ts,auto-fix,Missing cleanup",
	].join("\n");
	const snapshot = parseNoMistakesStatus(output, 14_010);
	assert.ok(snapshot, "current-branch AXI status parses into an observation snapshot");
	assert.equal(snapshot.id, "00000000000000000000000000");
	assert.equal(snapshot.branch, "feat/nm-ui");
	assert.equal(snapshot.gate, "review");
	assert.equal(snapshot.awaitingAgent, "parked 12s");
	assert.equal(snapshot.phases.length, 3);
	assert.deepEqual(snapshot.phases[1], {
		name: "review",
		status: "awaiting_approval",
		findings: 2,
		durationMs: 0,
		activeFor: undefined,
		lastActivity: undefined,
		round: undefined,
	});
	assert.equal(snapshot.currentPhase, "review");
	assert.equal(snapshot.phaseElapsedMs, 12000);
	assert.equal(snapshot.totalDurationMs, 14010);
	assert.deepEqual(snapshot.reviewFindings, [
		{ id: "r1", severity: "error", file: "src/a.ts", description: "Null value reaches renderer" },
		{ id: "r2", severity: "warning", file: "src/b.ts", description: "Missing cleanup" },
	]);
	assert.equal(summarizeNoMistakesSnapshot(snapshot), "review · 12s · 14s total");
	assert.equal(isObservableNoMistakesRun(snapshot), true);
	assert.equal(phaseProgress(snapshot)[1].preview, "❌ 1 · ⚠️ 1");
	assert.equal(parseDurationMs("12m34s"), 754000);
	assert.equal(parseDurationMs("1h2m"), 3720000);
	assert.equal(parseDurationMs("1d2h"), 93600000);
	assert.equal(parseDurationMs("1h2m3.5s"), 3723500);

	const checksPassedOutput = [
		"run:",
		'  id: "00000000000000000000000001"',
		"  status: running",
		"  outcome: checks-passed",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    test,completed,0,17000",
	].join("\n");
	const checksPassedSnapshot = parseNoMistakesStatus(checksPassedOutput, 17_000);
	assert.ok(checksPassedSnapshot);
	const checksPassed = observeNoMistakesTiming(checksPassedSnapshot, snapshot);
	assert.equal(checksPassed.currentPhase, "merge");
	assert.equal(summarizeNoMistakesSnapshot(checksPassed), "merge · 0ms · 17s total");
	const mergeLater = observeNoMistakesTiming(
		parseNoMistakesStatus(checksPassedOutput, 22_000),
		checksPassed,
	);
	assert.equal(summarizeNoMistakesSnapshot(mergeLater), "merge · 5s · 22s total");
	const reviewLater = observeNoMistakesTiming(
		parseNoMistakesStatus(output, 19_010),
		snapshot,
	);
	assert.equal(summarizeNoMistakesSnapshot(reviewLater), "review · 17s · 19s total");
	assert.equal(
		summarizeNoMistakesSnapshot({ ...snapshot, currentPhase: undefined, phaseElapsedMs: undefined }),
		"starting · — · 14s total",
	);
	assert.equal(phaseProgress({
		...snapshot,
		phases: [{ name: "review", status: "awaiting_approval", findings: 3 }],
		reviewFindings: [
			{ severity: "error", description: "error" },
			{ severity: "warning", description: "warning" },
			{ severity: "info", description: "info" },
		],
	})[0].preview, "❌ 1 · ⚠️ 1 · ℹ️ 1");

	const escapedFinding = parseNoMistakesStatus([
		"run:",
		'  id: "00000000000000000000000002"',
		"  status: running",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    review,fix_review,1,1000",
		"  gate:",
		"    step: review",
		"    findings[1]{id,severity,file,action,description}:",
		'      r1,error,src/a.ts,auto-fix,"The \\"run,respond\\" aliases bypass checks"',
	].join("\n"), 1000);
	assert.ok(escapedFinding);
	assert.deepEqual(escapedFinding.reviewFindings, [{
		id: "r1",
		severity: "error",
		file: "src/a.ts",
		description: 'The "run,respond" aliases bypass checks',
	}]);
	assert.equal(phaseProgress(escapedFinding)[0].preview, "❌ 1");

	assert.equal(parseNoMistakesRunId(output), "00000000000000000000000000");
	assert.equal(parseNoMistakesRunId("run:\n  id: invalid"), undefined);
	assert.equal(parseNoMistakesStatus("current_branch: main\nruns_on_current_branch: 0"), undefined);
	assert.equal(parseNoMistakesStatus([
		"run:",
		"  id: invalid",
		"  status: running",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    review,running,0,0",
	].join("\n")), undefined);
	assert.equal(isObservableNoMistakesRun({
		...snapshot,
		status: "completed",
		outcome: "passed-with-override",
	}), false);
	assert.equal(isObservableNoMistakesRun({
		...snapshot,
		status: "completed",
		outcome: "ci-monitor-interrupted",
	}), false);
}

{
	const intervalKey = Symbol.for("pi-no-mistakes/status-interval");
	const abortKey = Symbol.for("pi-no-mistakes/status-abort-controller");
	const staleInterval = {};
	let clearedInterval;
	let aborted = false;
	const savedClearInterval = globalThis.clearInterval;
	try {
		globalThis[intervalKey] = staleInterval;
		globalThis[abortKey] = { abort() { aborted = true; } };
		globalThis.clearInterval = (interval) => { clearedInterval = interval; };
		createJiti(import.meta.url, { moduleCache: false })("./no-mistakes-pane.ts");
		assert.equal(clearedInterval, staleInterval);
		assert.equal(aborted, true);
		assert.equal(globalThis[intervalKey], undefined);
		assert.equal(globalThis[abortKey], undefined);
	} finally {
		globalThis.clearInterval = savedClearInterval;
		globalThis[intervalKey] = undefined;
		globalThis[abortKey] = undefined;
	}
}

{
	const handlers = new Map();
	const events = [];
	const activeStatus = [
		"run:",
		'  id: "00000000000000000000000003"',
		"  status: running",
		"  awaiting_agent: parked 1s",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    review,awaiting_approval,0,0",
		"  gate:",
		"    step: review",
	].join("\n");
	const terminalStatus = [
		"run:",
		'  id: "00000000000000000000000003"',
		"  status: failed",
		"  outcome: test-failed",
		"  steps[2]{step,status,findings,duration_ms}:",
		"    review,completed,0,2000",
		"    test,failed,0,1000",
	].join("\n");
	const staleStatus = [
		"run:",
		'  id: "00000000000000000000000005"',
		"  status: running",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    review,running,0,1000",
	].join("\n");
	const noRunStatus = { code: 0, stdout: "current_branch: main\nruns_on_current_branch: 0" };
	const statusResults = [
		{ code: 0, stdout: activeStatus },
		{ code: 0, stdout: terminalStatus },
		{ code: 0, stdout: staleStatus },
		{ code: 1, stdout: "temporary failure" },
		{ code: 1, stdout: "temporary failure" },
		noRunStatus,
	];
	let releaseInitialStatus;
	let statusCalls = 0;
	let tool;
	let poll;
	const savedSetInterval = globalThis.setInterval;
	const savedClearInterval = globalThis.clearInterval;
	const savedPath = process.env.PATH;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-observer-"));
	try {
		globalThis.setInterval = (callback) => {
			poll = callback;
			return { unref() {} };
		};
		globalThis.clearInterval = () => {};
		writeFileSync(join(stubDir, "no-mistakes"), "#!/bin/sh\nsleep 0.05\nprintf 'run:\\n  id: \"00000000000000000000000003\"\\n  status: failed\\n  outcome: test-failed\\n'\nexit 1\n");
		chmodSync(join(stubDir, "no-mistakes"), 0o755);
		process.env.PATH = `${stubDir}:${savedPath}`;

		noMistakesPane({
			on(name, handler) { handlers.set(name, handler); },
			registerTool(value) { tool = value; },
			events: { emit(name, payload) { events.push({ name, payload }); } },
			exec() {
				if (statusCalls++ > 0) return Promise.resolve(statusResults.shift());
				return new Promise((resolve) => {
					releaseInitialStatus = () => resolve(noRunStatus);
				});
			},
		});
		handlers.get("session_start")({}, { mode: "tui", cwd: "/repo/a" });
		await new Promise(setImmediate);
		assert.equal(events.length, 0);

		const updates = [];
		const pipelinePromise = tool.execute(
			"pipeline",
			{ args: "run", timeoutMs: 1 },
			undefined,
			(update) => updates.push(update),
			{ cwd: "/repo/a", hasUI: false },
		);
		await new Promise(setImmediate);
		releaseInitialStatus();
		const pipelineResult = await pipelinePromise;
		assert.equal(events.length, 3);
		assert.equal(events[0].payload.snapshot, undefined);
		assert.equal(events[1].payload.snapshot.currentPhase, "review");
		assert.equal(events[2].payload.snapshot, undefined);
		assert.equal(updates.length, 0);
		assert.equal(pipelineResult.details.snapshot.status, "failed");
		assert.equal(pipelineResult.details.progress.recentTools.length, 2);
		assert.equal(pipelineResult.details.progress.recentTools[1].status, "failed");
		assert.equal(pipelineResult.details.progress.status, "failed");

		writeFileSync(join(stubDir, "no-mistakes"), [
			"#!/bin/sh",
			"printf '%s\\n' 'run:' '  id: \"00000000000000000000000004\"' '  status: failed' '  outcome: test-failed' '  steps[1]{step,status,findings,duration_ms}:' '    test,failed,0,1000'",
			"exit 1",
			"",
		].join("\n"));
		const foreignUpdates = [];
		const statusCallsBeforeForeign = statusCalls;
		const foreignResult = await tool.execute(
			"foreign",
			{ args: "run", cwd: stubDir, timeoutMs: 1 },
			undefined,
			(update) => foreignUpdates.push(update),
			{ cwd: "/repo/a", hasUI: false },
		);
		assert.equal(foreignUpdates.length, 0);
		assert.equal(statusCalls, statusCallsBeforeForeign);
		assert.equal(events.length, 3);
		assert.match(foreignResult.content[0].text, /outcome: test-failed/);
		assert.equal(foreignResult.details.progress, undefined);
		assert.equal(foreignResult.details.snapshot, undefined);

		const logsResult = await tool.execute(
			"logs",
			{ args: "logs", timeoutMs: 1 },
			undefined,
			undefined,
			{ cwd: "/repo/a", hasUI: false },
		);
		assert.equal(logsResult.details.progress, undefined);
		const invalidResult = await tool.execute(
			"invalid",
			{ args: "" },
			undefined,
			undefined,
			{ cwd: "/repo/a", hasUI: false },
		);
		assert.equal(invalidResult.details.progress, undefined);
		assert.equal(statusResults.length, 4);

		poll();
		await new Promise(setImmediate);
		assert.equal(events.length, 4);
		assert.equal(events[3].payload.snapshot.id, "00000000000000000000000005");

		writeFileSync(join(stubDir, "no-mistakes"), "#!/bin/sh\nprintf 'outcome: test-failed\\n'\nexit 1\n");
		const staleResult = await tool.execute(
			"stale",
			{ args: "run", timeoutMs: 1 },
			undefined,
			undefined,
			{ cwd: "/repo/a", hasUI: false },
		);
		assert.match(staleResult.content[0].text, /outcome: test-failed/);
		assert.equal(staleResult.details.progress, undefined);
		assert.equal(staleResult.details.snapshot, undefined);
		assert.equal(events.length, 4);

		poll();
		await new Promise(setImmediate);
		assert.equal(events.length, 5);
		assert.equal(events[4].payload.snapshot, undefined);
		handlers.get("session_shutdown")();
	} finally {
		globalThis.setInterval = savedSetInterval;
		globalThis.clearInterval = savedClearInterval;
		process.env.PATH = savedPath;
		rmSync(stubDir, { recursive: true, force: true });
	}
}

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

// ---------------------------------------------------------------------------
// wantsTuiPane: only run/respond (and not their --help) get the TUI pane;
// status/logs/sync/abort keep the text pane.
// ---------------------------------------------------------------------------
{
	assert.equal(wantsTuiPane(["run", "--intent", "ship it"], "run"), true, "run gets the TUI pane");
	assert.equal(wantsTuiPane(["respond", "--action", "fix", "--findings", "r1"], "respond"), true, "respond gets the TUI pane");
	assert.equal(wantsTuiPane(["run", "--yes"], "run"), true, "run --yes still gets the TUI pane");

	// --help / -h are quick introspections that never start a pipeline run.
	assert.equal(wantsTuiPane(["run", "--help"], "run"), false, "run --help stays on the text pane");
	assert.equal(wantsTuiPane(["respond", "-h"], "respond"), false, "respond -h stays on the text pane");

	// Quick inspections never get the TUI pane.
	for (const sub of ["status", "logs", "sync", "abort", "axi"]) {
		assert.equal(wantsTuiPane([sub], sub), false, `${sub} stays on the text pane`);
	}

	// The TUI set is exactly run + respond.
	assert.deepEqual([...TUI_SUBCOMMANDS].sort(), ["respond", "run"]);
}

// ---------------------------------------------------------------------------
// buildBackgroundScript: run the generated background script under bash with
// a stub no-mistakes on PATH and assert the TUI-pane capture behavior — the
// TOON stdout (between START/END markers, exit code on END) lands in outFile,
// progress stderr goes to errFile (NOT the capture file, since there is no
// visible terminal for it), and a done sentinel is touched when the run ends.
// ---------------------------------------------------------------------------
{
	const token = `bg${process.pid}`;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-bg-"));
	try {
		const outFile = join(stubDir, "capture.out");
		const errFile = join(stubDir, "capture.err");
		const doneFile = join(stubDir, "capture.done");
		const scriptFile = join(stubDir, "run.sh");
		const stubPath = join(stubDir, "no-mistakes");
		const exitCode = 7;
		writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				'printf "arg=%s\n" "$@"', // TOON-ish stdout -> capture file
				'printf "PROGRESS_NOISE\n" 1>&2', // stderr -> errFile, NOT outFile
				`exit ${exitCode}`,
				"",
			].join("\n"),
		);
		chmodSync(stubPath, 0o755);

		const args = ["run", "--intent", "ship the TUI pane feature"];
		writeFileSync(scriptFile, buildBackgroundScript(args, token, outFile, errFile, doneFile));

		const ran = spawnSync("bash", [scriptFile], {
			encoding: "utf-8",
			env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
		});
		assert.equal(ran.status, 0, `background script should exit 0; stderr: ${ran.stderr}`);

		// The done sentinel is touched once the run ends.
		assert.ok(existsSync(doneFile), "done sentinel is touched after the background run ends");

		const fileContents = readFileSync(outFile, "utf-8");
		const parsed = extractMarkedOutput(fileContents, token);
		assert.equal(parsed.complete, true, "END marker lands in the background capture file");
		assert.equal(parsed.exitCode, exitCode, "exit code rides the END marker");
		assert.ok(parsed.output.includes("arg=ship the TUI pane feature"), "multi-word intent survives as one argv entry");
		assert.match(parsed.output, /arg=axi/, "subcommand arg round-trips");

		// stdout-only capture: stderr progress never reaches outFile.
		assert.doesNotMatch(fileContents, /PROGRESS_NOISE/, "stderr never reaches the background capture file");
		assert.match(readFileSync(errFile, "utf-8"), /PROGRESS_NOISE/, "stderr is redirected to errFile");

		// START marker is detectable for the pre-attach wait.
		assert.equal(hasStartMarker(fileContents, token), true, "START marker is detectable");
		assert.equal(hasStartMarker("", token), false, "empty buffer has no START marker");
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// buildAttachScript: the attach wrapper retries `no-mistakes attach` until
// the background run's done sentinel appears, then stops. Verify the
// retry-until-done behavior with a stub `no-mistakes` that records each attach
// attempt and a done file written after the first attempt.
// ---------------------------------------------------------------------------
{
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-attach-"));
	try {
		const doneFile = join(stubDir, "capture.done");
		const scriptFile = join(stubDir, "attach.sh");
		const logFile = join(stubDir, "attach.log");
		const stubPath = join(stubDir, "no-mistakes");
		// Stub `no-mistakes attach`: log the attempt, then touch the done file on
		// the first call so the wrapper stops retrying after one iteration.
		writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				'echo "attach-call" >> "$ATTACH_LOG"',
				'if [ ! -f "$DONE" ]; then touch "$DONE"; fi',
				"exit 0",
				"",
			].join("\n"),
		);
		chmodSync(stubPath, 0o755);

		// Bounded to a small retry count so the test is fast; the real extension
		// uses 240 × 0.5s. Use a tiny interval via a stub `sleep`.
		writeFileSync(join(stubDir, "sleep"), ["#!/bin/sh", "exit 0", ""].join("\n"));
		chmodSync(join(stubDir, "sleep"), 0o755);

		writeFileSync(scriptFile, buildAttachScript(doneFile, 240, "0.001"));
		const ran = spawnSync("bash", [scriptFile], {
			encoding: "utf-8",
			env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, DONE: doneFile, ATTACH_LOG: logFile },
		});
		assert.equal(ran.status, 0, `attach wrapper should exit 0; stderr: ${ran.stderr}`);
		assert.ok(existsSync(doneFile), "done sentinel was created by the stub attach");

		const calls = readFileSync(logFile, "utf-8").trim().split("\n");
		// The wrapper calls attach once; the done file appears, so it stops without
		// spinning through all 240 retries.
		assert.equal(calls.length, 1, `attach is retried only until done appears (got ${calls.length} calls)`);
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// buildAttachScript: when the done sentinel already exists (background run
// finished before attach even started), the wrapper skips calling attach
// entirely — no retry noise, no daemon contact.
// ---------------------------------------------------------------------------
{
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-attach-pre-"));
	try {
		const doneFile = join(stubDir, "capture.done");
		const scriptFile = join(stubDir, "attach.sh");
		const logFile = join(stubDir, "attach.log");
		const stubPath = join(stubDir, "no-mistakes");
		writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				'echo "attach-call" >> "$ATTACH_LOG"',
				"exit 0",
				"",
			].join("\n"),
		);
		chmodSync(stubPath, 0o755);
		writeFileSync(join(stubDir, "sleep"), ["#!/bin/sh", "exit 0", ""].join("\n"));
		chmodSync(join(stubDir, "sleep"), 0o755);

		// Done file already exists before the wrapper starts.
		writeFileSync(doneFile, "");
		writeFileSync(scriptFile, buildAttachScript(doneFile, 240, "0.001"));
		const ran = spawnSync("bash", [scriptFile], {
			encoding: "utf-8",
			env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, DONE: doneFile, ATTACH_LOG: logFile },
		});
		assert.equal(ran.status, 0, `attach wrapper should exit 0 when done already exists; stderr: ${ran.stderr}`);
		assert.ok(!existsSync(logFile) || readFileSync(logFile, "utf-8").trim() === "", "attach is not called when done already exists");
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
}

console.log("no-mistakes-pane capture tests passed");
