import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
// Shared jiti resolution (test-lib): JITI_PATH/NODE_PATH or the pi-managed
// install; NODE_PATH is re-derived from the resolved jiti root exactly the
// way CI's prefix install provides it, so typebox resolves uniformly.
const { jitiPath, nodePath } = resolveJiti();
process.env.NODE_PATH = nodePath;
require("node:module").Module._initPaths();
const { createJiti } = require(jitiPath);
// CI installs only jiti and typebox, so @earendil-works/pi-tui (used by the
// pane's wrapping) must be stubbed through a jiti alias like the sibling
// extension tests do, never resolved from a machine-local install.
const stubRoot = mkdtempSync(join(tmpdir(), "nm-pane-test-"));
const stubTui = join(stubRoot, "pi-tui.cjs");
const NL = String.fromCharCode(10);
writeFileSync(stubTui, [
	"const NL = String.fromCharCode(10);",
	"exports.visibleWidth = (text) => [...String(text)].length;",
	"exports.wrapTextWithAnsi = (text, width) => {",
	"	const maxWidth = Math.max(1, width);",
	"	const out = [];",
	"	for (const paragraph of String(text).split(NL)) {",
	"		let line = \"\";",
	"		for (let word of paragraph.split(\" \")) {",
	"			while (word.length > maxWidth) {",
	"				if (line) { out.push(line); line = \"\"; }",
	"				out.push(word.slice(0, maxWidth));",
	"				word = word.slice(maxWidth);",
	"			}",
	"			if (line === \"\") line = word;",
	"			else if ((line + \" \" + word).length <= maxWidth) line += \" \" + word;",
	"			else { out.push(line); line = word; }",
	"		}",
	"		out.push(line);",
	"	}",
	"	return out;",
	"};",
].join(NL) + NL);
const tuiAlias = { "@earendil-works/pi-tui": stubTui };
const jiti = createJiti(import.meta.url, { alias: tuiAlias });
const { extractMarkedOutput, buildBackgroundScript, buildAttachScript, hasStartMarker, wantsTuiPane, TUI_SUBCOMMANDS } = jiti("./no-mistakes-pane/capture.ts");
const {
	orchestratorDelegationDecision,
	orchestratorSpawnSucceeded,
	buildOrchestratorTask,
	orchestratorAckMessage,
	orchestratorOwnedMessage,
	orchestratorSurfaceMessage,
	ORCHESTRATOR_AGENT,
} = jiti("./no-mistakes-pane/orchestrate.ts");
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
		createJiti(import.meta.url, { moduleCache: false, alias: tuiAlias })("./no-mistakes-pane.ts");
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

		// Bounded poll helper (25 ms sleeps): tick the watcher until a condition
		// holds — never a fixed multi-hundred-ms sleep.
		const pollUntil = async (condition, timeoutMs = 4000) => {
			const deadline = Date.now() + timeoutMs;
			while (!condition() && Date.now() < deadline) {
				await tick();
				await sleepReal(25);
			}
			assert.ok(condition(), "poll condition not reached in time");
		};

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
		await pollUntil(() => messages.length >= 1);
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
		await pollUntil(() => messages.length >= 2);
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
		await pollUntil(() => messages.length >= 3);
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

		// Bounded poll helper (25 ms sleeps): tick the watcher until a condition
		// holds — never a fixed multi-hundred-ms sleep.
		const pollUntil = async (condition, timeoutMs = 4000) => {
			const deadline = Date.now() + timeoutMs;
			while (!condition() && Date.now() < deadline) {
				await tick();
				await sleepReal(25);
			}
			assert.ok(condition(), "poll condition not reached in time");
		};

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
		await pollUntil(() => messages.length >= 1);
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
		await pollUntil(() => messages.length >= 2);
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

	// N7 echo-corruption guard: TUI progress noise (ANSI escapes, carriage
	// returns) between the markers never corrupts the capture — markers are
	// still found and the noise is stripped from the extracted output.
	const noisy = [
		"__NM_START_abc123__",
		"\x1b[2K\r\x1b[1mreview\x1b[0m in \x1b[32mprogress\x1b[0m\r",
		"gate: review",
		"__NM_END_abc123__:0",
	].join("\n");
	assert.deepEqual(extractMarkedOutput(noisy, token), {
		complete: true,
		output: "review in progress\ngate: review",
		exitCode: 0,
	}, "ANSI and CR noise is stripped, markers survive");
	assert.equal(hasStartMarker(noisy, token), true, "the START marker is found through ANSI noise");

	// A foreign token's markers never satisfy this capture.
	const foreign = ["__NM_START_zzz999__", "noise", "__NM_END_zzz999__:0"].join("\n");
	assert.deepEqual(extractMarkedOutput(foreign, token), { complete: false },
		"another call's markers are ignored");
	assert.equal(hasStartMarker(foreign, token), false);

	// A non-numeric exit code on the END marker degrades to -1, never NaN.
	assert.deepEqual(
		extractMarkedOutput("__NM_START_abc123__\nout\n__NM_END_abc123__:x", token),
		{ complete: true, output: "out", exitCode: -1 },
	);
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

// ---------------------------------------------------------------------------
// Orchestrator delegation policy: a Herdr captain delegates `run` to the
// nm-orchestrator subagent; everything else — and every fallback context —
// drives directly.
// ---------------------------------------------------------------------------
{
	const base = {
		subcommand: "run",
		helpOnly: false,
		insideSubagent: false,
		hasSpawnApi: true,
		hasTui: true,
		cwd: "/repo",
		orchestrators: new Map(),
		isRunning: () => false,
	};
	assert.deepEqual(orchestratorDelegationDecision(base), { delegate: true }, "a Herdr captain run delegates");
	assert.equal(
		orchestratorDelegationDecision({ ...base, subcommand: "respond" }).reason,
		"not-run-subcommand",
		"only run delegates; respond never does (the orchestrator itself drives it)",
	);
	assert.equal(
		orchestratorDelegationDecision({ ...base, subcommand: "status" }).reason,
		"not-run-subcommand",
		"read-only calls pass through",
	);
	assert.equal(
		orchestratorDelegationDecision({ ...base, helpOnly: true }).reason,
		"help-call",
		"`run --help` is documentation, never a delegated run",
	);
	assert.equal(
		orchestratorDelegationDecision({ ...base, insideSubagent: true }).reason,
		"inside-subagent",
		"delegation never nests: the orchestrator itself executes axi directly",
	);
	assert.equal(
		orchestratorDelegationDecision({ ...base, hasSpawnApi: false }).reason,
		"no-spawn-api",
		"without interactive-subagents the captain drives directly",
	);
	assert.equal(
		orchestratorDelegationDecision({ ...base, hasTui: false }).reason,
		"no-tui",
		"headless hosts drive directly",
	);

	const owned = new Map([["/repo", "nm-orchestrator"]]);
	assert.deepEqual(
		orchestratorDelegationDecision({ ...base, orchestrators: owned, isRunning: () => true }),
		{ delegate: false, reason: "already-owned", owner: "nm-orchestrator" },
		"a live orchestrator for the same cwd owns the run",
	);
	assert.equal(
		orchestratorDelegationDecision({ ...base, orchestrators: owned, isRunning: () => false }).delegate,
		true,
		"a dead registry entry is replaced, never treated as ownership",
	);
	assert.equal(
		orchestratorDelegationDecision({
			...base,
			orchestrators: new Map([["/other", "nm-orchestrator"]]),
			isRunning: () => true,
		}).delegate,
		true,
		"ownership is per-cwd: another worktree's orchestrator does not block this run",
	);
}

// ---------------------------------------------------------------------------
// Spawn-result classification: executeSubagent returns error results WITHOUT
// throwing (mux-unavailable, unknown/unallowlisted agent, no-session-file).
// Those must count as delegation failure — never as a "delegated" ack with a
// phantom registry owner.
// ---------------------------------------------------------------------------
{
	assert.equal(
		orchestratorSpawnSucceeded({ details: { name: "nm-orchestrator" } }),
		true,
		"a resolved result with a spawn name is a success",
	);
	assert.equal(
		orchestratorSpawnSucceeded({ isError: true, details: { name: "nm-orchestrator" } }),
		false,
		"an isError result is a failure even when it carries a name",
	);
	assert.equal(
		orchestratorSpawnSucceeded({ details: { error: "mux unavailable" } }),
		false,
		"a details.error result (mux-unavailable) is a failure",
	);
	assert.equal(
		orchestratorSpawnSucceeded({ details: {} }),
		false,
		"a result without details.name is a failure",
	);
	assert.equal(orchestratorSpawnSucceeded(undefined), false, "no result at all is a failure");
}

// ---------------------------------------------------------------------------
// Orchestrator task and messages: verbatim args carried, boundary rules
// stated, and every user-facing text names the owner.
// ---------------------------------------------------------------------------
{
	const args = 'run --intent "ship the feature safely"';
	const task = buildOrchestratorTask({ args, cwd: "/repo" });
	assert.ok(task.includes(args), "the task carries the verbatim axi args");
	assert.ok(task.includes("/repo"), "the task names the repository");
	for (const rule of [
		"no_mistakes_axi",
		"GATE DECISION",
		"respond --yes",
		"--wait 27m",
		"never edit code",
		"outcome:",
		"summary",
	]) {
		assert.ok(task.toLowerCase().includes(rule.toLowerCase()), `task covers: ${rule}`);
	}

	const ack = orchestratorAckMessage("nm-orchestrator-2");
	assert.ok(ack.includes("nm-orchestrator-2"), "the ack names the actual spawned name");
	assert.ok(ack.includes("summary"), "the ack tells the captain a summary steers back");

	const owned = orchestratorOwnedMessage("nm-orchestrator", "respond");
	assert.ok(owned.includes("subagent_message"), "the refusal points at steering, not double-driving");
	assert.ok(owned.includes("abort"), "the refusal keeps abort as the escape hatch");

	assert.ok(orchestratorSurfaceMessage("nm-orchestrator", false).includes("Focus"), "the /no-mistakes pointer directs the human to the orchestrator tab");
	assert.ok(
		orchestratorSurfaceMessage("nm-orchestrator", true).includes("yolo"),
		"the yolo pointer explains consent lives in the orchestrator session",
	);
	assert.equal(ORCHESTRATOR_AGENT, "nm-orchestrator");
}

// ---------------------------------------------------------------------------
// Orchestrator delegation wiring (N5): from a Herdr captain TUI session a
// `run` acks "delegated", the registry owns the cwd, and every later driving
// call refuses; a spawn that resolves an error result is never acked
// "delegated" and never registers a phantom owner — the run drives directly.
// ---------------------------------------------------------------------------
{
	const SPAWN_KEY = "__pi_interactive_subagents";
	const REG_KEY = Symbol.for("pi-no-mistakes/orchestrators");
	const WATCH_KEY = Symbol.for("pi-no-mistakes/watch-state");
	const savedSpawn = globalThis[SPAWN_KEY];
	const savedRegistry = globalThis[REG_KEY];
	const savedWatch = globalThis[WATCH_KEY];
	const savedSubagentName = process.env.PI_SUBAGENT_NAME;
	const savedPath = process.env.PATH;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-delegate-"));
	// Two real worktree dirs: the tool spawns its background script with the
	// call cwd, so the cwd must exist. Ownership keys are these resolved paths.
	const dirA = join(stubDir, "repo-a");
	const dirB = join(stubDir, "repo-b");
	mkdirSync(dirA);
	mkdirSync(dirB);
	const sleepReal = (ms) => new Promise((done) => setTimeout(done, ms));
	const notifications = [];
	let tool;
	let command;
	let spawnResult;
	let running = false;
	try {
		delete process.env.PI_SUBAGENT_NAME;
		globalThis[REG_KEY] = new Map();
		globalThis[WATCH_KEY] = undefined;
		// Stub no-mistakes: `attach --help` fails, so the direct-driving
		// fallback path stays headless (no pane wait); the axi call sleeps long
		// enough that the watcher never steers during this block.
		writeFileSync(join(stubDir, "no-mistakes"), [
			"#!/bin/sh",
			'if [ "$1" = "attach" ]; then exit 1; fi',
			"sleep 5",
			"exit 0",
			"",
		].join("\n"));
		chmodSync(join(stubDir, "no-mistakes"), 0o755);
		process.env.PATH = `${stubDir}:${savedPath}`;
		globalThis[SPAWN_KEY] = {
			executeSubagent: async () => spawnResult,
			isSubagentRunning: () => running,
		};

		const handlers = new Map();
		noMistakesPane({
			on(name, handler) { handlers.set(name, handler); },
			registerTool(value) { tool = value; },
			registerCommand(_name, value) { command = value; },
			registerMessageRenderer() {},
			events: { emit() {}, on() { return () => {}; } },
			exec() { return Promise.resolve({ code: 0, stdout: "" }); },
			sendMessage() {},
		});
		// The captain is an interactive Herdr TUI session.
		handlers.get("session_start")({}, { mode: "tui" });

		// 1. A successful spawn acks "delegated" and registers the owner.
		spawnResult = { details: { name: "nm-orchestrator" } };
		running = true;
		const ack = await tool.execute(
			"del-run-1",
			{ args: 'run --intent "delegate it"', timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: dirA, hasUI: true },
		);
		assert.equal(ack.details.status, "started");
		assert.match(ack.content[0].text, /delegated to the nm-orchestrator subagent/);
		assert.equal(globalThis[REG_KEY].get(dirA), "nm-orchestrator",
			"the registry records the spawned owner for the resolved cwd");

		// 2. Driving calls from the captain refuse to double-drive the owned run.
		const refusal = await tool.execute(
			"del-respond-1",
			{ args: "respond --action approve", timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: dirA, hasUI: false },
		);
		assert.equal(refusal.details.status, "error");
		assert.match(refusal.content[0].text, /owned by the nm-orchestrator subagent/);
		assert.match(refusal.content[0].text, /subagent_message/);
		const second = await tool.execute(
			"del-run-2",
			{ args: "run", timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: dirA, hasUI: true },
		);
		assert.equal(second.details.status, "error");
		assert.match(second.content[0].text, /owned by the nm-orchestrator subagent/);

		// 3. /no-mistakes points the human at the orchestrator's tab instead of
		//    opening a second attach pane here.
		await command.handler("", { cwd: dirA, ui: { notify: (m) => notifications.push(m) } });
		assert.ok(notifications.some((m) => /Focus "subagent: nm-orchestrator"/.test(m)),
			"the command points at the orchestrator tab");

		// 4. A spawn that resolves an error result (mux unavailable) is never
		//    acked "delegated" and leaves no phantom registry owner: the run
		//    drives directly here, and respond still works.
		spawnResult = { isError: true, details: { error: "mux unavailable" } };
		const fallbackAck = await tool.execute(
			"del2-run-1",
			{ args: 'run --intent "fallback"', timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: dirB, hasUI: true },
		);
		assert.equal(fallbackAck.details.status, "started");
		assert.ok(!/delegated to the/.test(fallbackAck.content[0].text),
			"a failed spawn is never acked delegated");
		assert.match(fallbackAck.content[0].text, /Orchestrator delegation failed \(mux unavailable\)/);
		assert.match(fallbackAck.content[0].text, /driving the run directly here instead/);
		assert.equal(globalThis[REG_KEY].has(dirB), false, "no phantom owner is registered");
		const respondAck = await tool.execute(
			"del2-respond-1",
			{ args: "respond --action approve", timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: dirB, hasUI: false },
		);
		assert.equal(respondAck.details.status, "started",
			"respond is not refused by a phantom registry owner (#286)");

		handlers.get("session_shutdown")();
	} finally {
		if (savedSubagentName === undefined) delete process.env.PI_SUBAGENT_NAME;
		else process.env.PI_SUBAGENT_NAME = savedSubagentName;
		process.env.PATH = savedPath;
		globalThis[SPAWN_KEY] = savedSpawn;
		globalThis[REG_KEY] = savedRegistry;
		globalThis[WATCH_KEY] = savedWatch;
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Herdr pane-state wiring (#285): while a tracked run is live in an
// interactive Herdr TUI session, phase labels go through `pane
// report-metadata`, the CI phase drives a balanced `herdr:blocked` pair, the
// checks-passed merge monitor never sets red, and run end clears both.
// ---------------------------------------------------------------------------
{
	const WATCH_KEY = Symbol.for("pi-no-mistakes/watch-state");
	const activeRunId = runIdAt(Date.now() + 1000, "9".repeat(16));
	const snapshotWith = (step) => [
		"run:",
		`  id: "${activeRunId}"`,
		"  status: running",
		"  steps[1]{step,status,findings,duration_ms}:",
		`    ${step}`,
	].join("\n");
	const reviewStatus = snapshotWith("review,running,0,1000");
	const ciStatus = snapshotWith("ci,running,1,500");
	// The post-checks-passed monitor: outcome set, ci step still running.
	const mergeMonitorStatus = [
		"run:",
		`  id: "${activeRunId}"`,
		"  status: running",
		"  outcome: checks-passed",
		"  steps[1]{step,status,findings,duration_ms}:",
		"    ci,running,0,5000",
	].join("\n");
	const noRunStatus = "current_branch: main\nruns_on_current_branch: 0";

	const handlers = new Map();
	const events = [];
	let tool;
	let tick;
	let statusStdout = reviewStatus;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-report-"));
	const nmHome = join(stubDir, "nm-home");
	const herdrLogPath = join(stubDir, "herdr-calls.log");
	const savedSetInterval = globalThis.setInterval;
	const savedClearInterval = globalThis.clearInterval;
	const savedPath = process.env.PATH;
	const savedEnv = {};
	for (const key of ["HERDR_ENV", "HERDR_PANE_ID", "NM_HOME"]) savedEnv[key] = process.env[key];
	const sleepReal = (ms) => new Promise((done) => setTimeout(done, ms));
	const herdrLog = () =>
		existsSync(herdrLogPath) ? readFileSync(herdrLogPath, "utf-8").split("\n").filter(Boolean) : [];
	try {
		globalThis.setInterval = (callback) => {
			tick = callback;
			return { unref() {} };
		};
		globalThis.clearInterval = () => {};
		// Stub herdr: logs every call, answers nothing else (only
		// report-metadata is driven here).
		writeFileSync(join(stubDir, "herdr"), [
			"#!/bin/sh",
			`echo "$*" >> ${JSON.stringify(herdrLogPath)}`,
			"exit 0",
			"",
		].join("\n"));
		chmodSync(join(stubDir, "herdr"), 0o755);
		// Stub no-mistakes: attach unavailable, axi sleeps long.
		writeFileSync(join(stubDir, "no-mistakes"), [
			"#!/bin/sh",
			'if [ "$1" = "attach" ]; then exit 1; fi',
			"sleep 5",
			"exit 0",
			"",
		].join("\n"));
		chmodSync(join(stubDir, "no-mistakes"), 0o755);
		process.env.PATH = `${stubDir}:${savedPath}`;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "w1:p0";
		process.env.NM_HOME = nmHome; // never the real ~/.no-mistakes
		globalThis[WATCH_KEY] = undefined;

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
			sendMessage() {},
		});
		handlers.get("session_start")({}, { mode: "tui" });

		const ack = await tool.execute(
			"report-run-1",
			{ args: 'run --intent "report wiring"', timeoutMs: 30 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: true },
		);
		assert.equal(ack.details.status, "started");
		await sleepReal(25); // drain the initial status refresh
		const drivePoll = async () => {
			const state = globalThis[WATCH_KEY];
			state.lastStatusPoll = 0; // deterministic poll cadence, no real waits
			await tick();
			await new Promise(setImmediate);
			await sleepReal(25);
		};

		// review running: phase label applied, nothing blocked.
		await drivePoll();
		assert.ok(herdrLog().includes(
			"pane report-metadata w1:p0 --source user:no-mistakes --applies-to-source herdr:pi --state-label idle=nm: review --state-label working=nm: review",
		), "the review phase label goes through the sanctioned metadata surface");
		assert.ok(!events.some((e) => e.name === "herdr:blocked" && e.payload.active === true),
			"a review phase never sets the red state");

		// CI phase: red state on, label moves, exactly one balanced pair.
		statusStdout = ciStatus;
		await drivePoll();
		assert.ok(herdrLog().includes(
			"pane report-metadata w1:p0 --source user:no-mistakes --applies-to-source herdr:pi --state-label idle=nm: ci --state-label working=nm: ci",
		), "the CI phase label moves with the phase");
		const blockedEvents = () => events.filter((e) => e.name === "herdr:blocked");
		assert.deepEqual(blockedEvents().map((e) => e.payload), [
			{ active: true, label: "no-mistakes: ci" },
		], "the CI phase sets the red state exactly once");

		// The checks-passed merge monitor (ci still running, outcome set) is
		// NOT red: it releases the blocked state and keeps the label.
		statusStdout = mergeMonitorStatus;
		await drivePoll();
		assert.deepEqual(blockedEvents().map((e) => e.payload), [
			{ active: true, label: "no-mistakes: ci" },
			{ active: false, label: undefined },
		], "the checks-passed monitor releases red and never re-sets it (#285)");

		// No observable run: labels clear, the pair stays balanced.
		statusStdout = noRunStatus;
		await drivePoll();
		assert.ok(herdrLog().includes(
			"pane report-metadata w1:p0 --source user:no-mistakes --applies-to-source herdr:pi --clear-state-labels",
		), "run end clears the pane labels");
		assert.equal(blockedEvents().length, 2, "no further blocked event fires");

		handlers.get("session_shutdown")();
		await sleepReal(100);
		assert.equal(existsSync(join(nmHome, "herdr-bridge", activeRunId)), false,
			"shutdown tears the bridge dir down so later shims passthrough");
	} finally {
		globalThis.setInterval = savedSetInterval;
		globalThis.clearInterval = savedClearInterval;
		process.env.PATH = savedPath;
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		globalThis[WATCH_KEY] = undefined;
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Every execFileSync site in no-mistakes-pane.ts keeps child stderr off the
// terminal (#291): a probe child imports the module and drives a pipeline
// call against a herdr/no-mistakes pair that both splatter stderr. The probe
// process's own stderr must stay byte-clean.
// ---------------------------------------------------------------------------
{
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-leak-"));
	try {
		// Stub herdr: answers the JSON endpoints the pane uses, writes noise
		// to stderr on EVERY call, and fails `pane run` so openWatchPane walks
		// the whole rename → run → close give-up path.
		writeFileSync(join(stubDir, "herdr"), [
			"#!/bin/sh",
			'echo "HERDR_NOISE $*" 1>&2',
			'case "$1 $2" in',
			'  "pane current") echo \'{"result":{"pane":{"pane_id":"agent:p1","tab_id":"tab:t1"}}}\';;',
			'  "pane split") echo \'{"result":{"pane":{"pane_id":"nm:p2","tab_id":"tab:t1"}}}\';;',
			'  "pane run") echo \'{"error":{"code":"pane_not_running"}}\' 1>&2; exit 1;;',
			"esac",
			"exit 0",
			"",
		].join("\n"));
		chmodSync(join(stubDir, "herdr"), 0o755);
		// Stub no-mistakes: `attach --help` succeeds WITH stderr noise (the
		// attachAvailable site); the axi call finishes quickly.
		writeFileSync(join(stubDir, "no-mistakes"), [
			"#!/bin/sh",
			'if [ "$1" = "attach" ]; then echo "ATTACH_NOISE" 1>&2; exit 0; fi',
			"sleep 0.1",
			"printf '%s\\n' 'outcome: checks-passed'",
			"exit 0",
			"",
		].join("\n"));
		chmodSync(join(stubDir, "no-mistakes"), 0o755);

		const probe = join(stubDir, "probe.cjs");
		writeFileSync(probe, [
			"const { createRequire } = require('node:module');",
			"const req = createRequire(__filename);",
			"const { createJiti } = req(process.env.JITI_PATH);",
			"const jiti = createJiti(__filename, { alias: { '@earendil-works/pi-tui': process.env.TUI_STUB } });",
			"const mod = jiti(process.env.PANE_MODULE);",
			"const handlers = new Map();",
			"let tool;",
			"mod.default({",
			"  on(name, handler) { handlers.set(name, handler); },",
			"  registerTool(value) { tool = value; },",
			"  registerCommand() {},",
			"  registerMessageRenderer() {},",
			"  events: { emit() {}, on() { return () => {}; } },",
			"  exec() { return Promise.resolve({ code: 0, stdout: '' }); },",
			"  sendMessage() {},",
			"});",
			"(async () => {",
			"const ack = await tool.execute('probe-1', { args: 'run --intent \"leak\"', timeoutMs: 20 }, undefined, undefined, { cwd: process.env.PROBE_CWD, hasUI: true });",
			"handlers.get('session_shutdown')();",
			"console.log('ACK=' + ack.details.status);",
			"console.log('PANE_NOTE=' + String(ack.content[0].text.includes('No Herdr pane could be opened')));",
			"})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });",
			"",
		].join("\n"));
		const ran = spawnSync(process.execPath, [probe], {
			encoding: "utf-8",
			timeout: 30_000,
			env: {
				...process.env,
				PATH: `${stubDir}:${process.env.PATH}`,
				JITI_PATH: jitiPath,
				TUI_STUB: stubTui,
				PANE_MODULE: fileURLToPath(new URL("./no-mistakes-pane.ts", import.meta.url)),
				PROBE_CWD: stubDir,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		assert.equal(ran.status, 0, `probe child failed: ${ran.stderr}`);
		assert.match(ran.stdout, /ACK=started/);
		assert.match(ran.stdout, /PANE_NOTE=true/,
			"the pane give-up path ran (current/split/rename/run/close all hit)");
		assert.equal(ran.stderr, "",
			"no stderr byte from any pane execFileSync site reaches the terminal");
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Keep-open slot composition: the shared pi-subagents/keep-open-count slot
// has multiple publishers (tuicr.ts owns it too, and the nm-orchestrator
// loads both extensions in one session). The pane module must ADD to any
// previous owner's count, never replace it — whichever extension loads
// last, both sources must be able to keep the session open.
// ---------------------------------------------------------------------------
{
	const KEY = Symbol.for("pi-subagents/keep-open-count");
	const WATCH_STATE = Symbol.for("pi-no-mistakes/watch-state");
	const savedSlot = globalThis[KEY];
	const savedState = globalThis[WATCH_STATE];
	try {
		// A previous owner (e.g. tuicr's watcher) already holds the slot.
		let fakeOwnerCount = 2;
		globalThis[KEY] = () => fakeOwnerCount;
		globalThis[WATCH_STATE] = undefined;
		// Fresh import of the pane module (caching disabled so module scope
		// re-runs): it must capture the previous owner and compose, not clobber.
		const freshJiti = createJiti(import.meta.url, { alias: tuiAlias, moduleCache: false, fsCache: false });
		freshJiti("./no-mistakes-pane.ts");

		const slot = globalThis[KEY];
		assert.equal(typeof slot, "function", "the pane module publishes the slot function");
		assert.equal(slot(), 2, "the previous owner's count survives the pane module's load");

		// Additive: when both sides report, the slot returns the sum.
		globalThis[WATCH_STATE] = { trackedRunId: "01TEST", calls: new Map() };
		assert.equal(slot(), 3, "the pane's own run-tracking count adds to the previous owner's count");

		// The pane side alone still keeps the session open.
		fakeOwnerCount = 0;
		assert.equal(slot(), 1, "the pane's own count parks the session on its own");
	} finally {
		globalThis[KEY] = savedSlot;
		globalThis[WATCH_STATE] = savedState;
	}
}

// N3 composition edges: a previous owner whose function THROWS must never
// mask this module's count — a broken tuicr side cannot silently disable the
// pane's keep-open.
{
	const KEY = Symbol.for("pi-subagents/keep-open-count");
	const WATCH_STATE = Symbol.for("pi-no-mistakes/watch-state");
	const savedSlot = globalThis[KEY];
	const savedState = globalThis[WATCH_STATE];
	try {
		globalThis[WATCH_STATE] = undefined;
		globalThis[KEY] = () => { throw new Error("broken owner"); };
		createJiti(import.meta.url, { alias: tuiAlias, moduleCache: false })("./no-mistakes-pane.ts");
		globalThis[WATCH_STATE] = { trackedRunId: "01TEST", calls: new Map() };
		assert.equal(globalThis[KEY](), 1,
			"a broken previous owner never masks this module's count");
	} finally {
		globalThis[KEY] = savedSlot;
		globalThis[WATCH_STATE] = savedState;
	}
}

// A previous slot value that is not a function counts as zero: the pane side
// still publishes and parks the session on its own.
{
	const KEY = Symbol.for("pi-subagents/keep-open-count");
	const WATCH_STATE = Symbol.for("pi-no-mistakes/watch-state");
	const savedSlot = globalThis[KEY];
	const savedState = globalThis[WATCH_STATE];
	try {
		globalThis[WATCH_STATE] = undefined;
		globalThis[KEY] = 5; // a clobbered/legacy slot value
		createJiti(import.meta.url, { alias: tuiAlias, moduleCache: false })("./no-mistakes-pane.ts");
		globalThis[WATCH_STATE] = { trackedRunId: "01TEST", calls: new Map() };
		assert.equal(typeof globalThis[KEY], "function", "the slot is a function again");
		assert.equal(globalThis[KEY](), 1,
			"a non-function previous value counts as zero, so this module parks alone");
	} finally {
		globalThis[KEY] = savedSlot;
		globalThis[WATCH_STATE] = savedState;
	}
}

// ---------------------------------------------------------------------------
// Cross-load-order composition (C28): both writers publish through the one
// shared keep-open-slot.mjs, so either load order sums both counts, repeated
// loads replace (never stack) their own entry, and each side releases exactly
// its own slot. This block drives the REAL pane module's run-tracking count
// and a REAL tuicr watcher (minimal fake tuicr CLI on PATH) in one process —
// both load orders.
// ---------------------------------------------------------------------------
{
	const KEY = Symbol.for("pi-subagents/keep-open-count");
	const HOLDER_KEY = Symbol.for("pi-subagents/keep-open-slot-holder");
	const WATCH_STATE = Symbol.for("pi-no-mistakes/watch-state");
	const crossRoot = mkdtempSync(join(tmpdir(), "nm-keepopen-cross-"));
	const crossBin = join(crossRoot, "bin");
	const crossStubs = join(crossRoot, "stubs");
	const crossRepo = join(crossRoot, "repo");
	mkdirSync(crossBin, { recursive: true });
	mkdirSync(crossStubs, { recursive: true });
	mkdirSync(crossRepo, { recursive: true });
	// Minimal fake tuicr CLI: one active session, no comments. The watcher's
	// tick only reads list/comments; everything else answers empty.
	writeFileSync(
			join(crossBin, "tuicr"),
			`#!/bin/sh
case "$2" in
  list) printf '%s\\n' '[{"slug":"watched-s1","active":true}]' ;;
  comments) printf '%s\\n' '[]' ;;
  *) printf '%s\\n' '{}' ;;
esac
`,
			{ mode: 0o755 },
	);
	// Stub the three packages tuicr.ts imports (same shapes the tuicr suite
	// uses); typebox resolves from NODE_PATH like everywhere else here.
	writeFileSync(join(crossStubs, "agent.cjs"), "exports.defineTool = (t) => t;\n");
	writeFileSync(
			join(crossStubs, "ai.cjs"),
			"exports.Type = new Proxy({}, { get: () => (...a) => ({ args: a }) });\n",
	);
	writeFileSync(
			join(crossStubs, "tui.cjs"),
			[
				"class Text { constructor(t) { this.text = String(t); } }",
				"class Box { constructor() { this.children = []; } addChild(c) { this.children.push(c); } render() { return []; } }",
				"exports.Box = Box;",
				"exports.Text = Text;",
				"exports.truncateToWidth = (t) => String(t);",
			].join("\n"),
	);
	const loadPane = () =>
		createJiti(import.meta.url, { alias: tuiAlias, moduleCache: false })("./no-mistakes-pane.ts");
	const loadTuicr = () =>
		createJiti(import.meta.url, {
			moduleCache: false,
			alias: {
				"@earendil-works/pi-coding-agent": join(crossStubs, "agent.cjs"),
				"@earendil-works/pi-ai": join(crossStubs, "ai.cjs"),
				"@earendil-works/pi-tui": join(crossStubs, "tui.cjs"),
			},
		})("./tuicr.ts");
	const makeTuicrHarness = () => {
		const tools = [];
		const commands = new Map();
		const pi = {
			registerTool: (def) => tools.push(def),
			registerCommand: (name, def) => commands.set(name, def),
			registerMessageRenderer: () => {},
			sendMessage: () => {},
			on: () => {},
		};
		return { tools, commands, pi, ctx: { cwd: crossRepo, ui: { notify: () => {} } } };
	};
	const paneTracking = (on) => {
		globalThis[WATCH_STATE] = on ? { trackedRunId: "01XX", calls: new Map() } : undefined;
	};
	const restoreKey = (key, value) => {
		if (value === undefined) delete globalThis[key];
		else globalThis[key] = value;
	};
	const savedSlot = globalThis[KEY];
	const savedHolder = globalThis[HOLDER_KEY];
	const savedWatchState = globalThis[WATCH_STATE];
	const savedPath = process.env.PATH;
	const savedPoll = process.env.TUICR_BG_POLL_MS;
	const savedHerdrEnv = process.env.HERDR_ENV;
	const savedHerdrPane = process.env.HERDR_PANE_ID;
	// attach never launches a pane, but the mux gate reads these; keep them set
	// so the only thing under test is the keep-open composition.
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "wX:p1";
	process.env.TUICR_BG_POLL_MS = "20";
	process.env.PATH = `${crossBin}:${savedPath}`;
	try {
		const slotFn = () => {
			const fn = globalThis[KEY];
			assert.equal(typeof fn, "function", "keep-open slot must stay a function");
			return fn();
		};

		// Order A: the pane module loads FIRST, tuicr second.
		restoreKey(KEY, undefined);
		paneTracking(false);
		loadPane();
		paneTracking(true);
		assert.equal(slotFn(), 1, "pane-first: the pane side counts alone");
		const tuicrA = loadTuicr();
		assert.equal(slotFn(), 1, "pane-first: tuicr's load composes, never clobbers");
		const harnessA = makeTuicrHarness();
		tuicrA.default(harnessA.pi);
		const toolA = harnessA.tools.find((tool) => tool.name === "tuicr");
		const attachA = await toolA.execute("c28-a", { repo: crossRepo, sessionSlug: "watched-s1" }, undefined, undefined, harnessA.ctx);
		assert.equal(attachA.isError, undefined);
		assert.equal(slotFn(), 2, "pane-first: a running watcher sums with the pane's count");
		harnessA.commands.get("tuicr").handler("stop", harnessA.ctx);
		assert.equal(slotFn(), 1, "pane-first: stopping releases exactly the watcher's slot");
		// Repeated pane loads replace their own entry — the old
		// capture-and-wrap design stacked a layer per reload; the shared
		// module cannot. (Reload tears the previous watch state down first,
		// so drive the count off/on around the reloads, like a real reload.)
		paneTracking(false);
		loadPane();
		loadPane();
		paneTracking(true);
		assert.equal(slotFn(), 1, "repeated pane loads never stack their own count");
		paneTracking(false);
		assert.equal(slotFn(), 0, "the pane side releases with its watch state");

		// Order B: tuicr loads FIRST, the pane module second.
		restoreKey(KEY, undefined);
		restoreKey(HOLDER_KEY, undefined); // fresh holder for the fresh composition
		const tuicrB = loadTuicr();
		const harnessB = makeTuicrHarness();
		tuicrB.default(harnessB.pi);
		const toolB = harnessB.tools.find((tool) => tool.name === "tuicr");
		const attachB = await toolB.execute("c28-b", { repo: crossRepo, sessionSlug: "watched-s1" }, undefined, undefined, harnessB.ctx);
		assert.equal(attachB.isError, undefined);
		assert.equal(slotFn(), 1, "tuicr-first: the watcher counts alone");
		paneTracking(false);
		loadPane();
		paneTracking(true);
		assert.equal(slotFn(), 2, "tuicr-first: the pane's load composes, never clobbers");
		paneTracking(false);
		assert.equal(slotFn(), 1, "tuicr-first: the pane side releases exactly its own count");
		harnessB.commands.get("tuicr").handler("stop", harnessB.ctx);
		assert.equal(slotFn(), 0, "tuicr-first: both sides released");
	} finally {
		restoreKey(KEY, savedSlot);
		restoreKey(HOLDER_KEY, savedHolder);
		restoreKey(WATCH_STATE, savedWatchState);
		process.env.PATH = savedPath;
		if (savedPoll === undefined) delete process.env.TUICR_BG_POLL_MS;
		else process.env.TUICR_BG_POLL_MS = savedPoll;
		if (savedHerdrEnv === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = savedHerdrEnv;
		if (savedHerdrPane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = savedHerdrPane;
		rmSync(crossRoot, { recursive: true, force: true });
	}
}

console.log("no-mistakes-pane capture tests passed");
