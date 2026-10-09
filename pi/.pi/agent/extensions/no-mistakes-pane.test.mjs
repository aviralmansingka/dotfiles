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
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules",
	process.env.NODE_PATH || "",
].filter(Boolean).join(":");
require("node:module").Module._initPaths();

// Resolve jiti the same way CI (JITI_PATH) and the local installs do.
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const { extractMarkedOutput, buildBackgroundScript, buildAttachScript, hasStartMarker, wantsTuiPane, TUI_SUBCOMMANDS } = jiti("./no-mistakes-pane/capture.ts");
const { parseDurationMs, parseNoMistakesRunId, parseNoMistakesStatus, observeNoMistakesTiming, isObservableNoMistakesRun, summarizeNoMistakesSnapshot, phaseProgress } = jiti("./no-mistakes-pane/status.ts");
const noMistakesPane = jiti("./no-mistakes-pane.ts").default;

function runIdAt(timestamp, suffix = "0".repeat(16)) {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let value = timestamp;
	let prefix = "";
	for (let index = 0; index < 10; index++) {
		prefix = alphabet[value % 32] + prefix;
		value = Math.floor(value / 32);
	}
	return prefix + suffix;
}

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
	// Reload teardown: a previous watch state (registered on globalThis by the
	// pre-reload module) is torn down — its timer is cleared, its status
	// controller aborted, and one cleared activity event is published for the
	// shared widget — and the legacy pre-async status keys are cleared too.
	const intervalKey = Symbol.for("pi-no-mistakes/status-interval");
	const abortKey = Symbol.for("pi-no-mistakes/status-abort-controller");
	const watchKey = Symbol.for("pi-no-mistakes/watch-state");
	const staleInterval = {};
	let clearedInterval;
	let aborted = false;
	const emitted = [];
	const savedClearInterval = globalThis.clearInterval;
	try {
		globalThis[intervalKey] = staleInterval;
		globalThis[abortKey] = { abort() { aborted = true; } };
		globalThis[watchKey] = {
			pi: { events: { emit(name, payload) { emitted.push({ name, payload }); } } },
			timer: staleInterval,
			statusController: { abort() { aborted = true; } },
			pollingStatus: false,
			queuedRefresh: undefined,
			calls: new Map(),
			observers: new Map(),
			trackedRunId: undefined,
			publishedRunId: "00000000000000000000000001",
		};
		globalThis.clearInterval = (interval) => { clearedInterval = interval; };
		createJiti(import.meta.url, { moduleCache: false })("./no-mistakes-pane.ts");
		assert.equal(clearedInterval, staleInterval, "the previous watch timer is cleared");
		assert.equal(aborted, true, "the previous status controller is aborted");
		assert.equal(globalThis[intervalKey], undefined);
		assert.equal(globalThis[abortKey], undefined);
		assert.equal(globalThis[watchKey], undefined, "the stale watch state slot is cleared");
		assert.equal(emitted.length, 1, "teardown publishes one cleared activity event");
		assert.equal(emitted[0].name, "no-mistakes:activity-update");
		assert.equal(emitted[0].payload.snapshot, undefined);
	} finally {
		globalThis.clearInterval = savedClearInterval;
		globalThis[intervalKey] = undefined;
		globalThis[abortKey] = undefined;
		globalThis[watchKey] = undefined;
	}
}

// ---------------------------------------------------------------------------
// Async submission: every axi call returns immediately with an ack, runs its
// capture script detached in the background, and the watcher later steers the
// captured TOON back as a no_mistakes_axi_result message that triggers a turn.
// ---------------------------------------------------------------------------
{
	const activeRunId = runIdAt(Date.now() + 1000, "3".repeat(16));
	const gateStatus = [
		"run:",
		`  id: "${activeRunId}"`,
		"  status: running",
		"  awaiting_agent: parked 1s",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    review,awaiting_approval,0,0",
		"  gate:",
		"    step: review",
	].join("\n");
	const gateOutput = [
		"gate: review",
		"findings[1]{id,severity,file,action,description}:",
		"  r1,warning,foo.ts,auto-fix,Error from os.Remove is ignored",
		"help[1]:",
		"  Run `no-mistakes axi respond --action approve` to accept this step and continue",
	].join("\n");
	const outcomeOutput = "outcome: checks-passed";

	const handlers = new Map();
	const events = [];
	const messages = [];
	let tool;
	let tick;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-async-"));
	const savedSetInterval = globalThis.setInterval;
	const savedClearInterval = globalThis.clearInterval;
	const savedPath = process.env.PATH;
	const sleepReal = (ms) => new Promise((done) => setTimeout(done, ms));
	const writeStub = (body) => {
		writeFileSync(join(stubDir, "no-mistakes"), ["#!/bin/sh", ...body, ""].join("\n"));
		chmodSync(join(stubDir, "no-mistakes"), 0o755);
	};
	try {
		globalThis.setInterval = (callback) => {
			tick = callback;
			return { unref() {} };
		};
		globalThis.clearInterval = () => {};
		// Background axi stub: short delay, then a gate TOON on stdout.
		writeStub(["sleep 0.1", `printf '%s\\n' '${gateOutput.replace(/'/g, `'\\''`)}'`]);
		process.env.PATH = `${stubDir}:${savedPath}`;

		let statusStdout = gateStatus;
		noMistakesPane({
			on(name, handler) { handlers.set(name, handler); },
			registerTool(value) { tool = value; },
			registerCommand() {},
			registerMessageRenderer() {},
			events: {
				emit(name, payload) { events.push({ name, payload }); },
				on() { return () => {}; },
			},
			exec() { return Promise.resolve({ code: 0, stdout: statusStdout }); },
			sendMessage(message, options) { messages.push({ message, options }); },
		});

		// 1. The call returns immediately with a "started" ack — never the TOON.
		const startedAt = Date.now();
		const ack = await tool.execute(
			"run-1",
			{ args: 'run --intent "ship the async feature"', timeoutMs: 60 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: false },
		);
		assert.ok(Date.now() - startedAt < 500, "the tool call returns immediately");
		assert.equal(ack.details.status, "started");
		assert.equal(ack.details.subcommand, "run");
		assert.equal(ack.details.pipeline, true);
		assert.match(ack.content[0].text, /running in the background/);
		assert.match(ack.content[0].text, /no_mistakes_axi_result/);

		// 2. While the call is in flight, the status monitor feeds the shared
		//    activity UI exactly as before (read-only axi status polling).
		await tick();
		await new Promise(setImmediate);
		await sleepReal(50);
		assert.ok(events.some((e) => e.payload.snapshot && e.payload.snapshot.id === activeRunId),
			"the widget receives live snapshots while the call is in flight");

		// 3. Once the background capture completes, the watcher steers the TOON
		//    back as a result message that triggers a new turn.
		assert.equal(messages.length, 0, "no result before the background run completes");
		await sleepReal(400);
		await tick();
		assert.equal(messages.length, 1, "the completed run steers exactly one result");
		const { message, options } = messages[0];
		assert.equal(message.customType, "no_mistakes_axi_result");
		assert.equal(options.triggerTurn, true, "the result triggers a new agent turn");
		assert.equal(options.deliverAs, "steer");
		const baselineSteerContent = [
			"no-mistakes axi run finished (exit 0).",
			gateOutput,
			"The run is parked at this gate. Read the findings table, decide, and submit the next call through no_mistakes_axi: `respond --action approve|fix|skip` with `--findings <ids>` and `--instructions` as needed. Findings marked ask-user belong to the user — relay them verbatim and wait for their decision. Never edit the code yourself while the run is active; the pipeline owns findings and fixes.",
		].join("\n");
		assert.equal(message.content, baselineSteerContent,
			"the extension tool preserves every byte of the baseline gate steer contract");
		assert.equal(message.details.subcommand, "run");
		assert.equal(message.details.gate, true);
		assert.equal(message.details.paneClosed, false);
		assert.equal(message.details.exitCode, 0);

		// 4. A settled watcher tick is a no-op — no duplicate steers.
		await tick();
		assert.equal(messages.length, 1);

		// 5. A quick non-pipeline call (status) is also async and steers its
		//    result without gate guidance.
		writeStub(["sleep 0.05", "printf '%s\\n' 'current_branch: feat/x'", "exit 0"]);
		const statusAck = await tool.execute(
			"status-1",
			{ args: "status", timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: false },
		);
		assert.equal(statusAck.details.status, "started");
		assert.equal(statusAck.details.pipeline, false);
		await sleepReal(300);
		await tick();
		assert.equal(messages.length, 2);
		assert.equal(messages[1].message.details.subcommand, "status");
		assert.equal(messages[1].message.details.pipeline, false);
		assert.doesNotMatch(messages[1].message.content, /parked at this gate/);

		// 6. Timeout: a stuck background client is disconnected and the timeout
		//    is steered, never silently dropped.
		writeStub(["sleep 5", "exit 0"]);
		const stuckAck = await tool.execute(
			"stuck-1",
			{ args: "run", timeoutMs: 0.2 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: false },
		);
		assert.equal(stuckAck.details.status, "started");
		await sleepReal(400);
		await tick();
		assert.equal(messages.length, 3);
		assert.equal(messages[2].message.details.timedOut, true);
		assert.match(messages[2].message.content, /timed out after 0s/);
		assert.match(messages[2].message.content, /inspect with no_mistakes_axi `status`/);

		handlers.get("session_shutdown")();
		assert.equal(messages.length, 3, "shutdown stops the watcher without stray steers");
	} finally {
		globalThis.setInterval = savedSetInterval;
		globalThis.clearInterval = savedClearInterval;
		process.env.PATH = savedPath;
		rmSync(stubDir, { recursive: true, force: true });
		globalThis[Symbol.for("pi-no-mistakes/watch-state")] = undefined;
	}
}

// ---------------------------------------------------------------------------
// Watch pane + /no-mistakes: run/respond open the attach TUI pane beside the
// agent, the pane survives a gate and closes on a terminal outcome, and the
// /no-mistakes command focuses the live pane or re-opens one for the active
// daemon run (or reports that no run is active).
// ---------------------------------------------------------------------------
{
	const activeRunId = runIdAt(Date.now() + 1000, "7".repeat(16));
	const activeStatus = [
		"run:",
		`  id: "${activeRunId}"`,
		"  status: running",
		"  awaiting_agent: parked 1s",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    review,awaiting_approval,0,0",
		"  gate:",
		"    step: review",
	].join("\n");
	const gateOutput = "gate: review";
	const outcomeOutput = "outcome: checks-passed";

	const handlers = new Map();
	const messages = [];
	const notifies = [];
	const herdrLog = [];
	let tool;
	let command;
	let renderer;
	let toggleRows;
	let tick;
	let statusStdout = activeStatus;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-pane-"));
	const savedSetInterval = globalThis.setInterval;
	const savedClearInterval = globalThis.clearInterval;
	const savedPath = process.env.PATH;
	const sleepReal = (ms) => new Promise((done) => setTimeout(done, ms));
	const writeNmStub = (body) => {
		writeFileSync(join(stubDir, "no-mistakes"), ["#!/bin/sh", ...body, ""].join("\n"));
		chmodSync(join(stubDir, "no-mistakes"), 0o755);
	};
	const herdrLogPath = join(stubDir, "herdr-calls.log");
	const syncHerdrLog = () => {
		herdrLog.length = 0;
		if (existsSync(herdrLogPath)) herdrLog.push(...readFileSync(herdrLogPath, "utf-8").split("\n").filter(Boolean));
	};
	try {
		globalThis.setInterval = (callback) => {
			tick = callback;
			return { unref() {} };
		};
		globalThis.clearInterval = () => {};

		// Herdr stub: logs every call, answers the JSON endpoints the
		// extension uses, and makes the watch pane the right-hand neighbor of
		// the agent pane so the focus-by-neighbor path is exercised.
		writeFileSync(join(stubDir, "herdr"), [
			"#!/bin/sh",
			`echo "$*" >> ${JSON.stringify(herdrLogPath)}`,
			'case "$1 $2" in',
			'  "pane current") echo \'{"result":{"pane":{"pane_id":"agent:p1","tab_id":"tab:t1"}}}\';;',
			'  "pane split") echo \'{"result":{"pane":{"pane_id":"nm:p2","tab_id":"tab:t1"}}}\';;',
			'  "pane neighbor")',
			'    if [ "$4" = "right" ]; then echo \'{"result":{"neighbor":{"pane_id":"nm:p2"}}}\';',
			'    else echo \'{"result":{"neighbor":{"pane_id":"other:p9"}}}\'; fi;;',
			`  "pane get") if [ -f ${JSON.stringify(join(stubDir, "pane-gone"))} ]; then exit 1; fi; echo '{"result":{"pane":{}}}';;`,
			"esac",
			"exit 0",
			"",
		].join("\n"));
		chmodSync(join(stubDir, "herdr"), 0o755);
		// no-mistakes stub: attach --help succeeds (attach is available), and
		// the axi subcommands print the TOON the phase under test needs.
		writeNmStub([
			'if [ "$1" = "attach" ]; then exit 0; fi',
			"sleep 0.05",
			`printf '%s\\n' '${gateOutput}'`,
			"exit 0",
		]);
		process.env.PATH = `${stubDir}:${savedPath}`;

		noMistakesPane({
			on(name, handler) { handlers.set(name, handler); },
			registerTool(value) { tool = value; },
			registerCommand(name, value) { command = value; },
			registerMessageRenderer(type, value) { renderer = { type, value }; },
			events: {
				emit() {},
				on(name, handler) {
					if (name === "no-mistakes:toggle-rows") toggleRows = handler;
					return () => {};
				},
			},
			exec() { return Promise.resolve({ code: 0, stdout: statusStdout }); },
			sendMessage(message, options) { messages.push({ message, options }); },
		});

		// 1. run opens the attach pane beside the agent pane.
		const ack = await tool.execute(
			"run-1",
			{ args: "run --intent \"ship it\"", timeoutMs: 60 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: true },
		);
		assert.equal(ack.details.status, "started");
		assert.equal(ack.details.paneId, "nm:p2");
		assert.match(ack.content[0].text, /pane nm:p2/);
		await sleepReal(300);
		await tick();
		syncHerdrLog();

		// 2. The gate result keeps the pane open for the captain to watch.
		assert.equal(messages.length, 1);
		assert.equal(messages[0].message.details.gate, true);
		assert.equal(messages[0].message.details.paneClosed, false);
		assert.ok(!herdrLog.includes("pane close nm:p2"), "the pane stays open at a gate");

		// 3. /no-mistakes focuses the live pane across the right-hand split.
		await command.handler("", { cwd: stubDir, ui: { notify: (m, l) => notifies.push({ m, l }) } });
		syncHerdrLog();
		assert.ok(herdrLog.includes("pane focus --pane agent:p1 --direction right"),
			"focus targets the watch pane as the agent pane's right neighbor");
		assert.ok(notifies.some((n) => /Focused the no-mistakes pane/.test(n.m)));

		// 4. respond reuses the same pane (no second split).
		writeNmStub([
			'if [ "$1" = "attach" ]; then exit 0; fi',
			"sleep 0.05",
			`printf '%s\\n' '${outcomeOutput}'`,
			"exit 0",
		]);
		const respondAck = await tool.execute(
			"respond-1",
			{ args: "respond --action approve", timeoutMs: 60 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: true },
		);
		assert.equal(respondAck.details.paneId, "nm:p2");
		syncHerdrLog();
		assert.equal(herdrLog.filter((line) => line === "pane split --current --direction right --cwd " + stubDir + " --no-focus").length, 1,
			"the existing pane is reused, not split again");
		await sleepReal(300);
		await tick();
		syncHerdrLog();

		// 5. The terminal outcome closes the pane.
		assert.equal(messages.length, 2);
		assert.equal(messages[0].message.details.gate, true);
		assert.match(messages[1].message.content, /outcome: checks-passed/);
		assert.equal(messages[1].message.details.outcome, "checks-passed");
		assert.equal(messages[1].message.details.paneClosed, true);
		assert.ok(herdrLog.includes("pane close nm:p2"), "the pane closes on a terminal outcome");

		// 6. /no-mistakes with the pane closed but the run still active re-opens
		//    a pane attached to the daemon's active run.
		notifies.length = 0;
		await command.handler("", { cwd: stubDir, ui: { notify: (m, l) => notifies.push({ m, l }) } });
		assert.ok(notifies.some((n) => new RegExp(`Re-opened the no-mistakes TUI for run ${activeRunId}`).test(n.m)),
			"the command re-opens a pane for the active run");
		syncHerdrLog();
		assert.ok(herdrLog.filter((line) => line === "pane rename nm:p2 no-mistakes: attach re-open").length === 1,
			"the re-opened pane is labeled");

		// 7. /no-mistakes with the pane gone and no active run reports instead
		//    of opening a pane.
		writeFileSync(join(stubDir, "pane-gone"), "");
		statusStdout = "current_branch: main\nruns_on_current_branch: 0";
		notifies.length = 0;
		syncHerdrLog();
		const logBeforeNoRun = herdrLog.length;
		await command.handler("", { cwd: stubDir, ui: { notify: (m, l) => notifies.push({ m, l }) } });
		syncHerdrLog();
		assert.ok(notifies.some((n) => /No active no-mistakes run/.test(n.m)));
		assert.ok(!herdrLog.slice(logBeforeNoRun).some((line) => line.startsWith("pane split")), "no pane is opened without an active run");

		// 8. The result message renderer produces a structured transcript row:
		//    a summary header, finding chips, and no raw TOON schema lines.
		assert.equal(renderer.type, "no_mistakes_axi_result");
		const theme = {
			fg: (_name, text) => text,
			bold: (text) => text,
		};
		const initiallyHidden = renderer.value(
			{ content: messages[1].message.content, details: messages[1].message.details },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(initiallyHidden.join("\n"), /▹ no-mistakes · respond/);
		toggleRows(false);
		const rendered = renderer.value(
			{ content: messages[1].message.content, details: messages[1].message.details },
			{ expanded: false },
			theme,
		);
		const lines = rendered.render(200);
		assert.match(lines.join("\n"), /no-mistakes · respond/);
		assert.match(lines.join("\n"), /outcome: checks-passed/);
		const outcomeExpanded = renderer.value(
			{ content: messages[1].message.content, details: messages[1].message.details },
			{ expanded: true },
			theme,
		).render(200);
		assert.ok(!outcomeExpanded.some((line) => line.includes("finished (exit")), "an outcome never renders raw steer prose");
		// A gate result renders chips and the expand hint, never raw TOON or
		// the agent-facing guidance prose.
		const gateBody = [
			"no-mistakes axi run finished (exit 0).",
			"gate: review",
			"findings[2]{id,severity,file,action,description}:",
			"  r1,error,pi/no-mistakes-pane.ts,ask-user,Null value reaches renderer",
			"  r2,warning,pi/status.ts,auto-fix,Missing cleanup",
			"help[1]:",
			"  Run `no-mistakes axi respond --action approve` to accept this step and continue",
			"The run is parked at this gate. Read the findings table, decide, and submit the next call.",
		].join("\n");
		const gateDetails = { subcommand: "run", gate: true };
		const gateLines = renderer.value(
			{ content: gateBody, details: gateDetails },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(gateLines.join("\n"), /no-mistakes · run/);
		assert.match(gateLines.join("\n"), /gate: review · !1 ▲1 \?1/);
		assert.equal(gateLines.filter((line) => line.trim()).length, 1, "the collapsed row is a single line");
		assert.ok(!gateLines.some((line) => line.includes("findings[2]{")), "no raw TOON schema renders");
		assert.ok(!gateLines.some((line) => line.includes("parked at this gate")), "agent guidance prose never renders");
		assert.ok(!gateLines.some((line) => line.includes("Null value reaches")), "finding details stay behind Ctrl+O");
		assert.match(gateLines.join("\n"), /Ctrl\+O/);
		// Expanded: the framed report with finding rows, severity, and help.
		const gateExpanded = renderer.value(
			{ content: gateBody, details: gateDetails },
			{ expanded: true },
			theme,
		).render(200);
		assert.match(gateExpanded.join("\n"), /┌ findings/);
		assert.match(gateExpanded.join("\n"), /r1 +error +ask-user +pi\/no-mistakes-pane\.ts/);
		assert.match(gateExpanded.join("\n"), /Null value reaches renderer/);
		assert.match(gateExpanded.join("\n"), /Missing cleanup/);
		assert.match(gateExpanded.join("\n"), /└ help:/);
		assert.match(gateExpanded.join("\n"), /respond --action approve/);
		assert.match(gateExpanded.join("\n"), /Ctrl\+Q hide all nm rows/);
		const bareGateExpanded = renderer.value(
			{ content: "gate: review\nThe run is parked at this gate.", details: gateDetails },
			{ expanded: true },
			theme,
		).render(200);
		assert.ok(!bareGateExpanded.some((line) => line.includes("parked at this gate")), "a gate without findings never renders guidance prose");
		const nestedGateBody = [
			"run:",
			'  id: "00000000000000000000000000"',
			"  status: running",
			"  steps[1]{step,status,findings,duration_ms}:",
			"    review,awaiting_approval,0,0",
			"  gate:",
			"    step: review",
		].join("\n");
		const nestedGateLines = renderer.value(
			{ content: nestedGateBody, details: { subcommand: "status", exitCode: 0 } },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(nestedGateLines.join("\n"), /gate: review/);
		const nestedOutcomeBody = [
			"run:",
			'  id: "00000000000000000000000000"',
			"  status: completed",
			"  outcome: checks-passed",
			"  steps[1]{step,status,findings,duration_ms}:",
			"    test,completed,0,1000",
		].join("\n");
		const nestedOutcomeLines = renderer.value(
			{ content: nestedOutcomeBody, details: { subcommand: "status", exitCode: 0 } },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(nestedOutcomeLines.join("\n"), /outcome: checks-passed/);
		const errorBody = 'error: "daemon unavailable after connection timeout"\nTell the agent to retry the call.';
		const errorLines = renderer.value(
			{ content: errorBody, details: { subcommand: "status", exitCode: 1 } },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(errorLines.join("\n"), /daemon unavailable after connection timeout/);
		const errorExpanded = renderer.value(
			{ content: errorBody, details: { subcommand: "status", exitCode: 1 } },
			{ expanded: true },
			theme,
		).render(32);
		assert.match(errorExpanded.join("\n"), /┌ error/);
		assert.match(errorExpanded.join("\n"), /connection timeout/);
		assert.ok(!errorExpanded.some((line) => line.includes("retry the call")), "an error never renders agent guidance");
		const wrappedBody = [
			"gate: review",
			"findings[1]{id,severity,file,action,description}:",
			"  r1,error,src/component-name.ts,ask-user,Every word in this long finding description remains visible after wrapping",
			"help[1]:",
			"  Run the next command with every required argument after reviewing all findings",
			"run:",
			'  id: "00000000000000000000000000"',
			"  status: running",
			"  steps[2]{step,status,findings,duration_ms}:",
			"    review-phase-name,completed,1,1000",
			"    verification-phase-name,running,0,2000",
		].join("\n");
		const wrappedLines = renderer.value(
			{ content: wrappedBody, details: gateDetails },
			{ expanded: true },
			theme,
		).render(32);
		assert.ok(wrappedLines.every((line) => [...line].length <= 32), "expanded report lines fit the viewport");
		for (const text of [
			"component-name.ts", "Every", "word", "finding", "description", "remains", "visible", "wrapping",
			"review-phase-name", "verification-phase-name", "required", "argument", "reviewing", "findings",
		]) {
			assert.match(wrappedLines.join("\n"), new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		}
		const longBody = Array.from({ length: 10 }, (_, i) => `daemon log ${i}`).join("\n");
		const longRendered = renderer.value(
			{ content: longBody, details: { subcommand: "status", exitCode: 0 } },
			{ expanded: false },
			theme,
		);
		const longLines = longRendered.render(200);
		assert.match(longLines.join("\n"), /daemon log 0/);
		assert.ok(!longLines.some((line) => line.includes("daemon log 9")), "the collapsed raw fallback limits the body");
		assert.match(longLines.join("\n"), /Ctrl\+O full report/);
		const expandedLines = renderer.value(
			{ content: longBody, details: { subcommand: "status", exitCode: 0 } },
			{ expanded: true },
			theme,
		).render(20);
		assert.ok(expandedLines.some((line) => line.includes("daemon log 9")), "the expanded raw fallback shows the full body");
		assert.equal(typeof toggleRows, "function", "the renderer subscribes to the ctrl+q toggle event");
		toggleRows(true);
		const hiddenLines = renderer.value(
			{ content: gateBody, details: gateDetails },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(hiddenLines.join("\n"), /▹ no-mistakes · run — gate: review · !1 ▲1 \?1/);
		assert.equal(hiddenLines.filter((line) => line.trim()).length, 1, "the hidden row is a single ghost line");
		toggleRows(false);
		const restoredLines = renderer.value(
			{ content: gateBody, details: gateDetails },
			{ expanded: false },
			theme,
		).render(200);
		assert.match(restoredLines.join("\n"), /Ctrl\+O/, "toggling back restores the row");

		handlers.get("session_shutdown")();
	} finally {
		globalThis.setInterval = savedSetInterval;
		globalThis.clearInterval = savedClearInterval;
		process.env.PATH = savedPath;
		rmSync(stubDir, { recursive: true, force: true });
		globalThis[Symbol.for("pi-no-mistakes/watch-state")] = undefined;
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
// wantsTuiPane: only run/respond (and not their --help) get the watch pane;
// status/logs/sync/abort run headless.
// ---------------------------------------------------------------------------
{
	assert.equal(wantsTuiPane(["run", "--intent", "ship it"], "run"), true, "run gets the TUI pane");
	assert.equal(wantsTuiPane(["respond", "--action", "fix", "--findings", "r1"], "respond"), true, "respond gets the TUI pane");
	assert.equal(wantsTuiPane(["run", "--yes"], "run"), true, "run --yes still gets the TUI pane");

	// --help / -h are quick introspections that never start a pipeline run.
	assert.equal(wantsTuiPane(["run", "--help"], "run"), false, "run --help runs headless");
	assert.equal(wantsTuiPane(["respond", "-h"], "respond"), false, "respond -h runs headless");

	// Quick inspections never get the TUI pane.
	for (const sub of ["status", "logs", "sync", "abort", "axi"]) {
		assert.equal(wantsTuiPane([sub], sub), false, `${sub} runs headless`);
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
		// Stub `no-mistakes`: `axi status` reports a branch-scoped run id;
		// `attach` logs its arguments, then touches the done file on the first
		// call so the wrapper stops retrying after one iteration.
		writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				'if [ "$1" = "axi" ]; then printf \u0027  id: "RUN123"\\n\u0027; exit 0; fi',
				'if [ "$1" = "attach" ]; then echo "$*" >> "$ATTACH_LOG"; if [ ! -f "$DONE" ]; then touch "$DONE"; fi; exit 0; fi',
				"exit 1",
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
		// attach is branch-scoped: it always receives the resolved run id.
		assert.equal(calls[0], "attach --run RUN123", `attach receives the branch-scoped run id (got: ${calls[0]})`);
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
				'if [ "$1" = "axi" ]; then printf \u0027  id: "RUN123"\\n\u0027; exit 0; fi',
				'if [ "$1" = "attach" ]; then echo "$*" >> "$ATTACH_LOG"; exit 0; fi',
				"exit 1",
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

// ---------------------------------------------------------------------------
// buildAttachScript: while axi status resolves no run id (the background run
// has not registered with the daemon yet), attach is NEVER invoked — and
// in particular never without an explicit --run id, which would latch onto
// any active run in the shared repo mirror.
// ---------------------------------------------------------------------------
{
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-attach-noid-"));
	try {
		const doneFile = join(stubDir, "capture.done");
		const scriptFile = join(stubDir, "attach.sh");
		const logFile = join(stubDir, "attach.log");
		const statusCalls = join(stubDir, "status.calls");
		const stubPath = join(stubDir, "no-mistakes");
		writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				'if [ "$1" = "axi" ]; then echo "status" >> "' + statusCalls + '"; printf "no run\\n"; exit 1; fi',
				'if [ "$1" = "attach" ]; then echo "$*" >> "$ATTACH_LOG"; exit 0; fi',
				"exit 1",
				"",
			].join("\n"),
		);
		chmodSync(stubPath, 0o755);
		writeFileSync(join(stubDir, "sleep"), ["#!/bin/sh", "exit 0", ""].join("\n"));
		chmodSync(join(stubDir, "sleep"), 0o755);

		// Small retry budget: resolution never succeeds, so the wrapper exhausts
		// it and exits without a single attach call.
		writeFileSync(scriptFile, buildAttachScript(doneFile, 3, "0.001"));
		const ran = spawnSync("bash", [scriptFile], {
			encoding: "utf-8",
			env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, DONE: doneFile, ATTACH_LOG: logFile },
		});
		assert.equal(ran.status, 0, `attach wrapper should exit 0; stderr: ${ran.stderr}`);
		assert.ok(!existsSync(logFile), "attach is never called when no run id resolves");
		assert.equal(
			readFileSync(statusCalls, "utf-8").trim().split("\n").length,
			3,
			"run-id resolution is retried for every attempt",
		);
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
}

console.log("no-mistakes-pane capture tests passed");
