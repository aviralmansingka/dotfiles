import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		exec() { return Promise.resolve(options.execResult ?? { code: 0, stdout: "" }); },
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

// Yolo shortcut grants standing consent for the run.
{
	const { api } = registerGateExtension({ panelInputs: ["y"] });
	assert.deepEqual(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		{ type: "yolo" },
	);
	assert.equal(api.yoloActive("/repo"), true, "pressing y arms standing consent");
	assert.equal(api.yoloActive("/other"), false, "consent is scoped to the worktree");
	clearApi();
}

// Esc dismisses without a decision.
{
	const { api } = registerGateExtension({ panelInputs: ["\x1b"] });
	assert.deepEqual(
		await api.handleGate({ output: GATE_OUTPUT, cwd: "/repo", subcommand: "run" }),
		{ type: "dismissed" },
	);
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
	assert.match(flat, /y yolo this run/, "the yolo shortcut is advertised");
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
	const idleStatus = { code: 0, stdout: "current_branch: feat/x" };
	const activeStatus = {
		code: 0,
		stdout: [
			"run:",
			'  id: "00000000000000000000000000"',
			"  branch: feat/x",
			"  status: running",
			"  steps[2]{step,status,findings,duration_ms}:",
			"    intent,completed,0,10",
			"    review,running,0,0",
		].join("\n"),
	};

	// Armed while idle → binds to the next run → retires on the run after it.
	// The options getter keeps pi.exec reading the current stub status.
	let execResult = idleStatus;
	const { api } = registerGateExtension({ get execResult() { return execResult; } });
	assert.deepEqual(await api.setYolo("/repo", true), { on: true, activeRun: false });
	assert.equal(api.yoloActive("/repo"), true);
	api.runStarted("/repo");
	assert.equal(api.yoloActive("/repo"), true, "idle-armed consent binds to the next run");
	api.runFinished("/repo");
	assert.equal(api.yoloActive("/repo"), false, "a terminal outcome retires consent");

	// Earned during a run → a fresh run does not inherit it.
	execResult = activeStatus;
	assert.deepEqual(await api.setYolo("/repo", true), { on: true, activeRun: true });
	assert.equal(api.yoloActive("/repo"), true);
	api.runStarted("/repo");
	assert.equal(api.yoloActive("/repo"), false, "consent earned in one run never leaks into the next");

	// Explicit off.
	execResult = activeStatus;
	await api.setYolo("/repo", true);
	assert.deepEqual(await api.setYolo("/repo", false), { on: false, activeRun: false });
	assert.equal(api.yoloActive("/repo"), false);
	clearApi();
}

// ---------------------------------------------------------------------------
// Pane integration: the deferred steer carries the decision / yolo state
// ---------------------------------------------------------------------------
const GATE_API = Symbol.for("pi-no-mistakes/gate-api");

async function paneRunWithGateApi(fakeApi) {
	const messages = [];
	let tick;
	const stubDir = mkdtempSync(join(tmpdir(), "pi-nm-gate-"));
	const savedSetInterval = globalThis.setInterval;
	const savedClearInterval = globalThis.clearInterval;
	const savedPath = process.env.PATH;
	const sleepReal = (ms) => new Promise((done) => setTimeout(done, ms));
	const gateOutput = GATE_OUTPUT.replace(/'/g, `'\\''`);
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
			events: { emit() {} },
			exec() { return Promise.resolve({ code: 0, stdout: "current_branch: feat/x" }); },
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
		return messages;
	} finally {
		globalThis.setInterval = savedSetInterval;
		globalThis.clearInterval = savedClearInterval;
		process.env.PATH = savedPath;
		globalThis[GATE_API] = undefined;
		rmSync(stubDir, { recursive: true, force: true });
	}
}

// A decided gate: one steer carrying the TOON plus the exact respond call.
{
	const messages = await paneRunWithGateApi({
		handleGate: async () => ({ type: "fix", findings: ["r1", "r2"], instructions: "keep the prompt" }),
		yoloActive: () => false,
		setYolo: async () => ({ on: false, activeRun: false }),
		runStarted() {},
		runFinished() {},
	});
	assert.equal(messages.length, 1, "the parked gate steers exactly once, after the decision");
	const { message, options } = messages[0];
	assert.equal(message.customType, "no_mistakes_axi_result");
	assert.equal(options.triggerTurn, true);
	assert.match(message.content, /the user decided at the gate panel/);
	assert.match(message.content, /GATE DECISION \(user\): fix findings r1,r2/);
	assert.match(message.content, /respond --action fix --findings r1,r2 --instructions "keep the prompt"/);
	assert.equal(message.details.gate, true);
	assert.deepEqual(message.details.gateDecision, {
		type: "fix",
		findings: ["r1", "r2"],
		instructions: "keep the prompt",
	});
}

// Standing consent: no panel, the steer instructs --yes directly.
{
	const messages = await paneRunWithGateApi({
		handleGate: async () => { throw new Error("must not open a panel under yolo"); },
		yoloActive: () => true,
		setYolo: async () => ({ on: true, activeRun: true }),
		runStarted() {},
		runFinished() {},
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
	const messages = await paneRunWithGateApi(undefined);
	assert.equal(messages.length, 1);
	const { message } = messages[0];
	assert.match(message.content, /parked at this gate/);
	assert.match(message.content, /relay them verbatim/);
	assert.equal(message.details.gateDecision, undefined);
	assert.equal(message.details.yolo, undefined);
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("no-mistakes-gate tests passed");
