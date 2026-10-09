import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "nm-gate-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubAgent, "exports.defineTool = (tool) => tool;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; this.focused = false; }
	getText() { return this.text; }
	setText(text) { this.text = text; }
	handleInput(data) { this.text += data; }
	render() { return [this.text]; }
	invalidate() {}
}
exports.Editor = Editor;
exports.Key = {
	enter: "\\r",
	escape: "\\x1b",
	up: "up",
	down: "down",
	space: " ",
	tab: "tab",
	ctrl: (key) => "ctrl-" + key,
};
exports.Text = class Text {};
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = (text) => text.length;
exports.wrapTextWithAnsi = (text, width) => (text.length > width ? [text.slice(0, width), text.slice(width)] : [text]);
`);

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const { parseNoMistakesGate } = jiti("./no-mistakes-pane/status.ts");
const { default: noMistakesGate, GATE_API_KEY } = jiti("./no-mistakes-gate.ts");
const noMistakesPane = jiti("./no-mistakes-pane.ts").default;

const GATE_OUTPUT = [
	"gate: review",
	"note: Review auto-fix is disabled by default, so findings park for your decision.",
	"findings[3]{id,severity,file,line,action,description}:",
	"  r1,error,src/a.go,42,ask-user,New --force flag bypasses the confirm prompt",
	"  r2,warning,src/b.go,,auto-fix,Error from os.Remove is ignored",
	"  r3,info,docs/README.md,,no-op,Docs mention the old flag",
	"help[2]:",
	"  Run `no-mistakes axi respond --action approve` to accept this step",
	"  Run `no-mistakes axi respond --action fix --findings <ids>` to fix findings",
].join("\n");

// ---------------------------------------------------------------------------
// Gate parsing
// ---------------------------------------------------------------------------
{
	const gate = parseNoMistakesGate(GATE_OUTPUT);
	assert.ok(gate, "a parked-gate result parses");
	assert.equal(gate.step, "review");
	assert.match(gate.note, /^Review auto-fix is disabled/);
	assert.equal(gate.findings.length, 3);
	assert.deepEqual(
		gate.findings.map((finding) => [finding.id, finding.severity, finding.action]),
		[
			["r1", "error", "ask-user"],
			["r2", "warning", "auto-fix"],
			["r3", "info", "no-op"],
		],
	);
	assert.equal(gate.findings[0].file, "src/a.go");
	assert.equal(gate.findings[0].line, "42");
	assert.equal(gate.findings[0].description, "New --force flag bypasses the confirm prompt");
}

{
	assert.equal(parseNoMistakesGate("outcome: checks-passed\n"), undefined, "no gate: line means no gate");
	const gate = parseNoMistakesGate('gate: lint\nfindings[2]{severity,description}:\n  error,Unused import\n  warning,Long line');
	assert.ok(gate, "a gate without id/action columns still parses");
	assert.deepEqual(
		gate.findings.map((finding) => finding.id),
		["f1", "f2"],
	);
	assert.equal(gate.findings[0].action, "", "absent action column defaults to empty (actionable)");
}

// ---------------------------------------------------------------------------
// Extension registration + panel decisions
// ---------------------------------------------------------------------------
function registerGateExtension(options = {}) {
	const handlers = new Map();
	let api;
	const pi = {
		on(name, handler) { handlers.set(name, handler); },
		exec(command) {
			if (command === "git") {
				return Promise.resolve({ code: 0, stdout: options.worktreeRoot ?? "/repo" });
			}
			return Promise.resolve(options.execResult ?? { code: 0, stdout: "" });
		},
	};
	noMistakesGate(pi);
	api = globalThis[GATE_API_KEY];
	assert.ok(api, "the extension registers its api on globalThis");

	// Fire session_start with a TUI ctx whose custom() drives the panel with
	// the given inputs and resolves with the decision.
	const decisions = [];
	const theme = { fg: (_color, text) => text, bold: (text) => text };
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			custom(factory) {
				return new Promise((done) => {
					const component = factory({ requestRender() {} }, theme, {}, done);
					for (const input of options.panelInputs ?? []) component.handleInput(input);
				});
			},
		},
	};
	handlers.get("session_start")({}, ctx);
	return { api, decisions, ctx };
}

// Reset both the api registration and the module state between blocks: a
// fresh factory call must not inherit a previously stashed ctx.
const GATE_STATE_KEY = Symbol.for("pi-no-mistakes/gate-state");
const clearApi = () => {
	globalThis[GATE_API_KEY] = undefined;
	globalThis[GATE_STATE_KEY] = undefined;
};

// Approve via number shortcut.
{
	const { api } = registerGateExtension({ panelInputs: ["1"] });
	assert.deepEqual(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		{ type: "approve" },
	);
	clearApi();
}

// Skip via number shortcut (third option with actionable findings present).
{
	const { api } = registerGateExtension({ panelInputs: ["3"] });
	assert.deepEqual(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		{ type: "skip" },
	);
	clearApi();
}

// Yolo shortcut grants standing consent for the exact run.
{
	const { api } = registerGateExtension({ panelInputs: ["y"] });
	assert.deepEqual(
		await api.handleGate({
			output: GATE_OUTPUT,
			cwd: "/repo/subdir",
			subcommand: "run",
			runId: "00000000000000000000000001",
		}),
		{ type: "yolo" },
	);
	assert.equal(api.yoloActive("00000000000000000000000001"), true,
		"pressing y arms consent for the current run");
	assert.equal(api.yoloActive("00000000000000000000000002"), false,
		"another run cannot consume consent");
	clearApi();
}

// Fix flow: enter selection, toggle two findings, Space on the no-op row is
// ignored, submit, then submit non-empty fix guidance from the editor.
{
	const inputs = [
		"2", // Fix -> selection phase
		"1", // toggle r1
		"2", // toggle r2
		"j", // to the no-op row (r3)
		" ", // Space on a no-op finding does not select it
		"j", // to the submit row
		"\r", // submit -> instructions phase
		"also check callers",
		"\r", // submit guidance
	];
	const { api } = registerGateExtension({ panelInputs: inputs });
	assert.deepEqual(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		{ type: "fix", findings: ["r1", "r2"], instructions: "also check callers" },
	);
	clearApi();
}

// Fix flow with empty guidance submits without instructions.
{
	const { api } = registerGateExtension({ panelInputs: ["2", "2", "j", "j", "\r", "\r"] });
	assert.deepEqual(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		{ type: "fix", findings: ["r2"], instructions: undefined },
	);
	clearApi();
}

// Panel rendering highlights severity and action classification.
{
	let rendered;
	const handlers = new Map();
	noMistakesGate({
		on(name, handler) { handlers.set(name, handler); },
		exec() { return Promise.resolve({ code: 0, stdout: "" }); },
	});
	const theme = { fg: (_color, text) => text, bold: (text) => text };
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			custom(factory) {
				return new Promise((done) => {
					const component = factory({ requestRender() {} }, theme, {}, done);
					rendered = component.render(80);
				});
			},
		},
	};
	handlers.get("session_start")({}, ctx);
	// Fire without awaiting: the panel never resolves (no decision input),
	// which is fine — this block only asserts what it renders.
	void globalThis[GATE_API_KEY].handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" });
	await new Promise(setImmediate); // the panel factory runs on the next microtask
	const flat = rendered.join("\n");
	assert.match(flat, /no-mistakes gate — review/, "the panel names the gated step");
	assert.match(flat, /3 findings — 1 ask-user · 1 auto-fix · 1 no-op/, "the summary counts action classes");
	assert.match(flat, /ask-user/, "the ask-user classification is surfaced");
	assert.match(flat, /auto-fix/, "the auto-fix classification is surfaced");
	assert.match(flat, /no-op/, "the no-op classification is surfaced");
	assert.match(flat, /src\/a\.go:42/, "file and line are surfaced");
	assert.match(flat, /New --force flag bypasses the confirm prompt/, "descriptions are relayed verbatim");
	assert.match(flat, /y +yolo this run/, "the yolo shortcut is advertised");
	assert.match(flat, /1\. Approve — accept this step as-is and continue/, "the decide options are visible and numbered");
	assert.match(flat, /2\. Fix — select findings for the pipeline to fix/, "the fix option is visible");
	assert.match(flat, /3\. Skip — skip this step/, "the skip option is visible");
	assert.match(flat, /keys +↑↓\/jk +move/, "the legend labels the navigation keys");
	assert.match(flat, /1-3 +select option/, "the legend advertises number selection");
	clearApi();
}

// handleGate guards: no ctx, no TUI, no gate block.
{
	assert.equal(
		await globalThis[GATE_API_KEY]?.handleGate?.({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		undefined,
		"no registered api after clearApi",
	);

	const handlers = new Map();
	noMistakesGate({
		on(name, handler) { handlers.set(name, handler); },
		exec() { return Promise.resolve({ code: 0, stdout: "" }); },
	});
	const api = globalThis[GATE_API_KEY];
	assert.equal(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		null,
		"no stashed ctx means no panel",
	);

	const ui = { custom() { throw new Error("must not open"); } };
	handlers.get("session_start")({}, { hasUI: false, mode: "tui", ui });
	assert.equal(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		null,
		"headless sessions get no panel",
	);

	handlers.get("session_start")({}, { hasUI: true, mode: "rpc", ui });
	assert.equal(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		null,
		"rpc mode cannot host custom panels",
	);

	handlers.get("session_start")({}, { hasUI: true, mode: "tui", ui });
	assert.equal(
		await api.handleGate({ output: "outcome: passed", cwd: "/repo", subcommand: "run" }),
		null,
		"a result without a gate block is not a panel case",
	);
	clearApi();
}

// ---------------------------------------------------------------------------
// Yolo consent lifecycle
// ---------------------------------------------------------------------------
{
	const firstRun = "00000000000000000000000001";
	const secondRun = "00000000000000000000000002";
	const idleStatus = { code: 0, stdout: "current_branch: feat/x" };
	const activeStatus = {
		code: 0,
		stdout: [
			"run:",
			`  id: "${firstRun}"`,
			"  branch: feat/x",
			"  status: running",
			"  steps[2]{step,status,findings,duration_ms}:",
			"    intent,completed,0,10",
			"    review,running,0,0",
		].join("\n"),
	};

	let execResult = idleStatus;
	const { api } = registerGateExtension({
		get execResult() { return execResult; },
		worktreeRoot: "/repo",
	});
	assert.deepEqual(await api.setYolo("/repo/subdir", true), { on: true, activeRun: false });
	assert.equal(api.yoloActive(firstRun), false, "idle consent is not valid before a run binds it");
	await api.runObserved("/repo/", firstRun);
	assert.equal(api.yoloActive(firstRun), true, "idle consent binds across worktree path spellings");
	await api.runObserved("/repo/subdir", firstRun);
	assert.equal(api.yoloActive(firstRun), true, "reattaching the same run keeps its consent");
	await api.runFinished("/repo/subdir", secondRun);
	assert.equal(api.yoloActive(firstRun), true, "another run cannot retire this run's consent");
	await api.runFinished("/repo/", firstRun);
	assert.equal(api.yoloActive(firstRun), false, "the matching terminal outcome retires consent");

	execResult = activeStatus;
	assert.deepEqual(await api.setYolo("/repo/subdir", true), { on: true, activeRun: true });
	assert.equal(api.yoloActive(firstRun), true);
	await api.runObserved("/repo/", secondRun);
	assert.equal(api.yoloActive(firstRun), false, "a different run never inherits consent");
	assert.equal(api.yoloActive(secondRun), false, "the new run requires fresh consent");

	await api.setYolo("/repo/subdir", true);
	assert.deepEqual(await api.setYolo("/repo/", false), { on: false, activeRun: false });
	assert.equal(api.yoloActive(firstRun), false, "off uses canonical worktree identity");
	clearApi();
}

// ---------------------------------------------------------------------------
// Pane integration: the deferred steer carries the decision / yolo state
// ---------------------------------------------------------------------------
const GATE_API = Symbol.for("pi-no-mistakes/gate-api");

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

const PANE_RUN_ID = runIdAt(Date.now() + 1000, "1".repeat(16));

async function paneRunWithGateApi(fakeApi, roundTrip = false) {
	const messages = [];
	let capturedArgs;
	let tick;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-gate-"));
	const savedSetInterval = globalThis.setInterval;
	const savedClearInterval = globalThis.clearInterval;
	const savedPath = process.env.PATH;
	const sleepReal = (ms) => new Promise((done) => setTimeout(done, ms));
	const gateOutput = GATE_OUTPUT.replace(/'/g, `'\\''`);
	globalThis[Symbol.for("pi-no-mistakes/watch-state")] = undefined;
	writeFileSync(
		join(stubDir, "no-mistakes"),
		["#!/bin/sh", "sleep 0.1", `printf '%s\\n' '${gateOutput}'`, ""].join("\n"),
	);
	chmodSync(join(stubDir, "no-mistakes"), 0o755);
	globalThis[GATE_API] = fakeApi;
	try {
		globalThis.setInterval = (callback) => {
			tick = callback;
			return { unref() {} };
		};
		globalThis.clearInterval = () => {};
		process.env.PATH = `${stubDir}:${savedPath}`;
		let tool;
		noMistakesPane({
			on() {},
			registerTool(value) { tool = value; },
			registerCommand() {},
			registerMessageRenderer() {},
			events: {
				emit() {},
				// no-mistakes-pane subscribes to NM_TOGGLE_EVENT (Ctrl+Q toggle
				// from tool-call-renderer-public); the fake just accepts it.
				on() { return () => {}; },
			},
			exec() {
				return Promise.resolve({
					code: 0,
					stdout: [
						"run:",
						`  id: "${PANE_RUN_ID}"`,
						"  status: running",
						"  steps[1]{step,status,findings,duration_ms}:",
						"    review,awaiting_approval,1,0",
					].join("\n"),
				});
			},
			sendMessage(message, options) { messages.push({ message, options }); },
		});
		const ack = await tool.execute(
			"gate-run-1",
			{ args: 'run --intent "gate decisions"', timeoutMs: 60 },
			undefined,
			undefined,
			{ cwd: stubDir, hasUI: false },
		);
		assert.equal(ack.details.status, "started");
		await sleepReal(400);
		await tick();
		await new Promise(setImmediate);
		if (roundTrip) {
			const exactCall = /Submit through no_mistakes_axi: `([^`]+)`/.exec(messages[0].message.content)?.[1];
			assert.ok(exactCall, "the gate result includes an executable respond call");
			const argsLog = join(stubDir, "args.log");
			writeFileSync(
				join(stubDir, "no-mistakes"),
				["#!/bin/sh", `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}`, "printf '%s\\n' 'outcome: checks-passed'", ""].join("\n"),
			);
			const respondAck = await tool.execute(
				"gate-respond-1",
				{ args: exactCall, timeoutMs: 60 },
				undefined,
				undefined,
				{ cwd: stubDir, hasUI: false },
			);
			assert.equal(respondAck.details.status, "started");
			await sleepReal(400);
			await tick();
			capturedArgs = readFileSync(argsLog, "utf-8").trimEnd().split("\n");
		}
		return { messages, capturedArgs };
	} finally {
		globalThis.setInterval = savedSetInterval;
		globalThis.clearInterval = savedClearInterval;
		process.env.PATH = savedPath;
		globalThis[GATE_API] = undefined;
		globalThis[Symbol.for("pi-no-mistakes/watch-state")] = undefined;
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// A decided gate: one steer carrying an exact respond call whose guidance
// round-trips through the executable tool interface.
{
	const guidance = 'check C:\\tmp, say "go", then leave \\';
	const { messages, capturedArgs } = await paneRunWithGateApi({
		handleGate: async () => ({ type: "fix", findings: ["r1", "r2"], instructions: guidance }),
		yoloActive: () => false,
		setYolo: async () => ({ on: false, activeRun: false }),
		runObserved: async (_cwd, runId) => runId,
		runFinished: async () => {},
	}, true);
	assert.equal(messages.filter(({ message }) => message.details.gate).length, 1,
		"the parked gate steers exactly once, after the decision");
	const { message, options } = messages[0];
	assert.equal(message.customType, "no_mistakes_axi_result");
	assert.equal(options.triggerTurn, true);
	assert.match(message.content, /the user decided at the gate panel/);
	assert.match(message.content, /GATE DECISION \(user\): fix findings r1,r2/);
	assert.deepEqual(capturedArgs, [
		"axi",
		"respond",
		"--action",
		"fix",
		"--findings",
		"r1,r2",
		"--instructions",
		guidance,
	], "the emitted respond call preserves quotes and backslashes");
	assert.equal(message.details.gate, true);
	assert.deepEqual(message.details.gateDecision, {
		type: "fix",
		findings: ["r1", "r2"],
		instructions: guidance,
	});
}

// Standing consent: no panel, the steer instructs --yes directly.
{
	const { messages } = await paneRunWithGateApi({
		handleGate: async () => { throw new Error("must not open a panel under yolo"); },
		yoloActive: () => true,
		setYolo: async () => ({ on: true, activeRun: true }),
		runObserved: async (_cwd, runId) => runId,
		runFinished: async () => {},
	});
	assert.equal(messages.length, 1);
	const { message } = messages[0];
	assert.match(message.content, /yolo standing consent is active/);
	assert.match(message.content, /respond --yes/);
	assert.equal(message.details.yolo, true);
	assert.equal(message.details.gateDecision, undefined);
}

// No gate extension loaded: the result steers immediately with the plain
// relay guidance, exactly as before.
{
	const { messages } = await paneRunWithGateApi(undefined);
	assert.equal(messages.length, 1);
	const { message } = messages[0];
	assert.match(message.content, /parked at this gate/);
	assert.match(message.content, /relay them verbatim/);
	assert.equal(message.details.gateDecision, undefined);
	assert.equal(message.details.yolo, undefined);
}

// The command accepts only the documented yolo and yolo off forms.
{
	let command;
	const toggles = [];
	const notifications = [];
	globalThis[Symbol.for("pi-no-mistakes/watch-state")] = undefined;
	globalThis[GATE_API] = {
		handleGate: async () => null,
		yoloActive: () => false,
		setYolo: async (_cwd, on) => {
			toggles.push(on);
			return { on, activeRun: false };
		},
		runObserved: async () => {},
		runFinished: async () => {},
	};
	noMistakesPane({
		on() {},
		registerTool() {},
		registerCommand(_name, value) { command = value; },
		registerMessageRenderer() {},
		events: {
			emit() {},
			on() { return () => {}; },
		},
		exec() { return Promise.resolve({ code: 0, stdout: "current_branch: main\nruns_on_current_branch: 0" }); },
		sendMessage() {},
	});
	const ctx = { cwd: "/repo", ui: { notify(message) { notifications.push(message); } } };
	await command.handler("yolo on", ctx);
	assert.deepEqual(toggles, [], "the unsupported yolo on alias does not toggle consent");
	assert.match(notifications.at(-1), /No active no-mistakes run/);
	await command.handler("yolo", ctx);
	await command.handler("yolo off", ctx);
	assert.deepEqual(toggles, [true, false], "the documented command forms toggle consent");
	globalThis[GATE_API] = undefined;
	globalThis[Symbol.for("pi-no-mistakes/watch-state")] = undefined;
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("no-mistakes-gate tests passed");
