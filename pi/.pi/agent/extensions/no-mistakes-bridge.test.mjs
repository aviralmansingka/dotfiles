import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

const {
	deriveRunId,
	bridgeRunDir,
	splitAgentArgv,
	buildTabLauncher,
	probeSocket,
	SessionEventTranslator,
	ensureBridgeServer,
	teardownBridgeForRun,
} = jiti("./no-mistakes-pane/bridge.ts");
const {
	runPhaseLabel,
	isCiPhaseActive,
	PaneReportState,
} = jiti("./no-mistakes-pane/herdr-report.ts");

// ---------------------------------------------------------------------------
// Run discovery: the shim and the server must derive the same run id from
// the daemon-provided step worktree, and nothing else.
// ---------------------------------------------------------------------------
{
	const runId = "01M4KZ1QA7E1CSFXJM5B4W0240";
	assert.equal(deriveRunId(`/home/me/.no-mistakes/worktrees/e5cce92fbf21/${runId}`), runId);
	assert.equal(deriveRunId(`/home/me/.no-mistakes/worktrees/${runId}`), runId);
	assert.equal(deriveRunId("/home/me/.no-mistakes/worktrees/e5cce92fbf21"), undefined);
	assert.equal(deriveRunId("/home/me/dotfiles"), undefined);
	assert.equal(deriveRunId("/home/me/.no-mistakes/worktrees/not-a-ulid"), undefined);
	assert.equal(bridgeRunDir("/nm/home", runId), "/nm/home/herdr-bridge/" + runId);
}

// ---------------------------------------------------------------------------
// argv translation: interactive tab argv from the daemon's json-mode argv.
// The daemon's contract (upstream internal/agent/pi.go buildArgs): operator
// extras, then `--mode json`, then `--no-session` or `--session <uuid>`, and
// `--extension <file>` appended on the strict structured-output path.
// ---------------------------------------------------------------------------
{
	const daemonArgv = [
		"--provider", "fireworks",
		"--model", "accounts/fireworks/routers/glm-5p3-fast",
		"--mode", "json",
		"--no-session",
		"--extension", "/tmp/nm-output-abc.mjs",
	];
	const split = splitAgentArgv(daemonArgv);
	assert.deepEqual(
		split.interactive,
		[
			"--provider", "fireworks",
			"--model", "accounts/fireworks/routers/glm-5p3-fast",
			"--extension", "/tmp/nm-output-abc.mjs",
		],
	);
	assert.equal(split.sessionless, true);
	assert.equal(split.sessionId, undefined);
}
{
	const sessionId = "01a127f1-f447-7467-a86c-b2223710ba8e";
	const split = splitAgentArgv(["--mode", "json", "--session", sessionId]);
	assert.equal(split.sessionId, sessionId);
	assert.equal(split.sessionless, false);
	assert.deepEqual(split.interactive, ["--session", sessionId]);
}
{
	// A value that merely contains flag text must survive verbatim.
	const split = splitAgentArgv(["--append-system-prompt", "--no-session text", "--mode", "json"]);
	assert.deepEqual(split.interactive, ["--append-system-prompt", "--no-session text"]);
	assert.equal(split.sessionless, false);
}
{
	// Everything after `--` is positional and passes through untouched.
	const split = splitAgentArgv(["--mode", "json", "--", "positional", "--no-session"]);
	assert.deepEqual(split.interactive, ["--", "positional", "--no-session"]);
	assert.equal(split.sessionless, false);
}

// ---------------------------------------------------------------------------
// Tab launcher: daemon env subset exported, argv quoted, extensions explicit.
// ---------------------------------------------------------------------------
{
	const script = buildTabLauncher({
		realPi: "/home/me/.pi/agent/bin/pi",
		interactiveArgv: ["--provider", "fireworks", "--extension", "/tmp/nm-output.mjs"],
		env: { NO_MISTAKES_GATE: "1", GIT_EDITOR: ":", "BAD-KEY": "x", "1BAD": "y" },
		extraExtensions: ["/home/me/.pi/agent/extensions/herdr-agent-state.ts"],
	});
	const lines = script.split("\n");
	assert.equal(lines[0], "#!/bin/bash");
	assert.ok(lines.includes("export NO_MISTAKES_GATE='1'"), "gate evidence var is exported");
	assert.ok(lines.includes("export GIT_EDITOR=':'"), "git non-interactive discipline is exported");
	assert.ok(!script.includes("BAD-KEY") && !script.includes("1BAD"), "invalid env key names are skipped");
	const exec = lines.find((line) => line.startsWith("exec "));
	assert.ok(exec && exec.includes("'/home/me/.pi/agent/bin/pi'"));
	assert.ok(exec && exec.includes("'--no-extensions'"));
	assert.ok(exec && exec.includes("'--extension' '/tmp/nm-output.mjs'"));
	assert.ok(exec && exec.includes("'-e' '/home/me/.pi/agent/extensions/herdr-agent-state.ts'"));
	// A value with a single quote must round-trip through shell quoting.
	const tricky = buildTabLauncher({
		realPi: "pi",
		interactiveArgv: [],
		env: { GIT_MSG: "it's done" },
		extraExtensions: [],
	});
	assert.ok(tricky.includes("export GIT_MSG='it'\\''s done'"));
}

// ---------------------------------------------------------------------------
// Event translation: session records become the json-mode stream the
// daemon's piParser consumes (verified against a live `pi --mode json`
// capture and upstream's parser contract).
// ---------------------------------------------------------------------------
{
	const translator = new SessionEventTranslator();
	const fed = [
		...translator.feedRecord({ type: "session", id: "01a127f1-f447-7467-a86c-b2223710ba8e", version: "3" }),
		...translator.feedRecord({ type: "session", id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }),
		...translator.feedRecord({ type: "message", message: { role: "system", content: "", sections: {} } }),
		...translator.feedRecord({ type: "message", message: { role: "user", content: [{ type: "text", text: "review please" }] } }),
	];
	assert.deepEqual(fed.map((line) => JSON.parse(line)), [
		{ type: "session", id: "01a127f1-f447-7467-a86c-b2223710ba8e" },
		{ type: "message_end", message: { role: "user", content: [{ type: "text", text: "review please" }] } },
	]);

	// Strict output tool: the terminating toolCall plus its toolResult
	// synthesize the exact tool_execution_end envelope upstream parses.
	const toolCallId = "chatcmpl-tool-1";
	const strict = [
		...translator.feedRecord({
			type: "message",
			message: {
				role: "assistant",
				stopReason: "toolUse",
				model: "m", provider: "p", usage: { input: 10, output: 2 },
				content: [{ type: "toolCall", id: toolCallId, name: "no_mistakes_output", arguments: {} }],
			},
		}),
		...translator.feedRecord({
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: toolCallId,
				isError: false,
				content: [{ type: "text", text: JSON.stringify({ findings: [] }) }],
			},
		}),
	];
	const strictEvents = strict.map((line) => JSON.parse(line));
	assert.equal(strictEvents[0].type, "message_end");
	assert.equal(strictEvents[1].type, "message_end");
	assert.equal(strictEvents[1].message.role, "toolResult");
	assert.deepEqual(strictEvents[2], {
		type: "tool_execution_end",
		toolName: "no_mistakes_output",
		isError: false,
		toolCallId,
		result: { terminate: true, details: { output: { findings: [] } } },
	});

	// A different tool's result never synthesizes the output-tool envelope.
	const other = [
		...translator.feedRecord({
			type: "message",
			message: { role: "assistant", content: [{ type: "toolCall", id: "t2", name: "bash", arguments: {} }], stopReason: "toolUse" },
		}),
		...translator.feedRecord({
			type: "message",
			message: { role: "toolResult", toolCallId: "t2", isError: false, content: [{ type: "text", text: "ok" }] },
		}),
	];
	assert.ok(other.every((line) => JSON.parse(line).type !== "tool_execution_end"));

	// Unparseable output-tool text emits nothing (the daemon then rejects and
	// retries the turn, exactly as for a headless mis-call).
	const bad = translator.feedRecord({
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "t3", name: "no_mistakes_output", arguments: {} }],
			stopReason: "toolUse",
		},
	}).concat(
		translator.feedRecord({
			type: "message",
			message: { role: "toolResult", toolCallId: "t3", isError: false, content: [{ type: "text", text: "{not json" }] },
		}),
	);
	assert.ok(bad.every((line) => JSON.parse(line).type !== "tool_execution_end"));

	const final = translator.feedRecord({
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 1, output: 1 } },
	});
	assert.ok(final.length === 1);
	const finished = translator.finish().map((line) => JSON.parse(line));
	assert.equal(finished[0].type, "turn_end");
	assert.equal(finished[0].message.stopReason, "stop");
	assert.equal(finished[1].type, "agent_end");
	assert.equal(finished[1].messages[0].role, "system");
	assert.equal(finished[1].messages.at(-1).role, "assistant");
	assert.deepEqual(finished[2], { type: "agent_settled", aborted: false });
}
{
	// A resumed session seeds the header id from argv when no `session`
	// record is ever seen (the preface scan can miss a torn file head).
	const translator = new SessionEventTranslator("01aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
	translator.feedRecord({ type: "message", message: { role: "user", content: "fix" } });
	const finished = translator.finish().map((line) => JSON.parse(line));
	assert.equal(finished.length, 2, "no assistant turn means no turn_end line");
	assert.equal(finished[0].type, "agent_end");
	assert.equal(finished[0].messages.length, 1);
	assert.deepEqual(finished[1], { type: "agent_settled", aborted: false });
}

// ---------------------------------------------------------------------------
// Pane report: label and CI transitions fire once per change, release on
// run end, and the merge phase (checks already passed) is never CI-red.
// ---------------------------------------------------------------------------
function snapshot(currentPhase, phases) {
	return {
		id: "01M4KZ1QA7E1CSFXJM5B4W0240",
		status: "running",
		phases: phases ?? [{ name: currentPhase, status: "running" }],
		currentPhase,
		totalDurationMs: 1000,
		reviewFindings: [],
	};
}
{
	assert.equal(runPhaseLabel(snapshot("review")), "nm: review");
	assert.equal(runPhaseLabel(snapshot("starting")), "nm: starting");
	assert.ok(isCiPhaseActive(snapshot("ci")));
	assert.ok(!isCiPhaseActive(snapshot("merge")), "checks-passed monitoring is not CI-red");
	assert.ok(!isCiPhaseActive(snapshot("review", [
		{ name: "ci", status: "pending" },
		{ name: "review", status: "running" },
	])), "a pending CI phase behind review is not CI-red");
	assert.ok(isCiPhaseActive(snapshot("review", [
		{ name: "ci", status: "fixing" },
		{ name: "review", status: "running" },
	])), "an actively fixing CI phase is CI-red even when review holds the gate");

	const report = new PaneReportState();
	assert.deepEqual(report.next(snapshot("review")), { label: "nm: review" }, "no CI transition fires from the initial unblocked state");
	assert.deepEqual(
		report.next(snapshot("review")),
		{ label: "nm: review" },
		"an unconfirmed transition re-emits while Herdr never received it",
	);
	report.confirm({ label: "nm: review" });
	assert.deepEqual(report.next(snapshot("review")), {}, "no confirmed transition fires twice");
	assert.deepEqual(report.next(snapshot("ci")), { label: "nm: ci", ciBlocked: true });
	report.confirm({ label: "nm: ci", ciBlocked: true });
	assert.deepEqual(report.next(undefined), { clearLabels: true, ciBlocked: false });
	report.confirm({ clearLabels: true, ciBlocked: false });
	assert.deepEqual(report.next(undefined), {}, "release fires once");

	// A transition whose herdr application failed is never confirmed, so the
	// next poll must re-emit it instead of permanently swallowing it.
	const failedApply = new PaneReportState();
	assert.deepEqual(failedApply.next(snapshot("lint")), { label: "nm: lint" });
	assert.deepEqual(
		failedApply.next(snapshot("lint")),
		{ label: "nm: lint" },
		"the transition re-emits while its application keeps failing",
	);
	failedApply.confirm({ label: "nm: lint" });
	assert.deepEqual(failedApply.next(snapshot("lint")), {});

	// confirm is per-action: an applied CI transition must not advance a
	// label transition that never applied.
	const partial = new PaneReportState();
	assert.deepEqual(partial.next(snapshot("ci")), { label: "nm: ci", ciBlocked: true });
	partial.confirm({ ciBlocked: true });
	assert.deepEqual(
		partial.next(snapshot("ci")),
		{ label: "nm: ci" },
		"the unconfirmed label re-emits after a CI-only confirm",
	);
}

// ---------------------------------------------------------------------------
// Socket ownership probe: a live bridge server answers; a socket nobody
// answers is stale, whatever kind of file it is.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

await (async () => {
	const root = mkdtempSync(join(tmpdir(), "nm-probe-"));
	const livePath = join(root, "live.sock");
	const server = createServer((sock) => sock.destroy());
	await new Promise((done) => server.listen(livePath, done));
	assert.equal(await probeSocket(livePath), true, "a listening bridge server answers the probe");
	server.close();
	await new Promise((done) => server.close(done));
	assert.equal(
		await probeSocket(livePath),
		false,
		"a socket left behind by a closed server is stale",
	);
	const stalePath = join(root, "stale.sock");
	writeFileSync(stalePath, "not a server");
	assert.equal(await probeSocket(stalePath), false, "a socket file nobody answers is stale");
	assert.equal(await probeSocket(join(root, "missing.sock")), false, "no socket file is stale");
	rmSync(root, { recursive: true, force: true });
})();

// ---------------------------------------------------------------------------
// The shim itself, exercised against a fake bridge server: a step launched
// before the parent creates the bridge dir must still reach the bridge, and
// the daemon must receive every event line through the final agent_settled
// before the shim exits.
// ---------------------------------------------------------------------------
const shimPath = fileURLToPath(new URL("../../../bin/nm-herdr-pi.mjs", import.meta.url));
const TEST_RUN_ID = "01M4KZ1QA7E1CSFXJM5B4W0240";

function startFakeBridge(sockPath, onHello) {
	mkdirSync(join(sockPath, ".."), { recursive: true });
	const server = createServer((sock) => {
		let buffer = "";
		sock.on("data", (chunk) => {
			buffer += chunk.toString("utf-8");
			const index = buffer.indexOf("\n");
			if (index < 0) return;
			buffer = buffer.slice(index + 1);
			sock.removeAllListeners("data");
			onHello(sock);
		});
	});
	return new Promise((done) => server.listen(sockPath, () => done(server)));
}

function runShim({ root, extraEnv = {}, argv = [] }) {
	const child = spawn(process.execPath, [shimPath, ...argv], {
		cwd: join(root, TEST_RUN_ID),
		env: {
			...process.env,
			NM_HOME: root,
			NM_HERDR_REAL_PI: join(root, "stub-pi.sh"),
			NM_HERDR_BRIDGE_WAIT_MS: "4000",
			...extraEnv,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	const stdout = [];
	const stderr = [];
	child.stdout.on("data", (chunk) => stdout.push(chunk));
	child.stderr.on("data", (chunk) => stderr.push(chunk));
	return { child, stdout, stderr };
}

function awaitExit(child, timeoutMs) {
	return new Promise((done, fail) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			fail(new Error("shim did not exit in time"));
		}, timeoutMs);
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			done({ code, signal });
		});
	});
}

function makeShimRoot(prefix, stubBody) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	writeFileSync(join(root, "stub-pi.sh"), stubBody);
	chmodSync(join(root, "stub-pi.sh"), 0o755);
	mkdirSync(join(root, TEST_RUN_ID));
	return root;
}

await (async () => {
	// The parent creates the bridge dir only after it first observes the run:
	// it appears 500ms after the shim starts, and the shim must wait for it
	// instead of falling back to headless pi.
	const root = makeShimRoot("nm-shim-late-", "#!/bin/sh\necho PASSTHROUGH-MARKER\nexit 0\n");
	const lines = [
		'{"type":"session","id":"01late-dir-test-000000000000000"}',
		'{"type":"agent_settled","aborted":false}',
	];
	const { child, stdout, stderr } = runShim({ root });
	child.stdin.end("do the step");
	const exited = awaitExit(child, 15000);
	await sleep(500);
	const server = await startFakeBridge(join(root, "herdr-bridge", TEST_RUN_ID, "sock"), (sock) => {
		sock.write(JSON.stringify({ type: "events", lines }) + "\n");
		sock.end();
	});
	const result = await exited;
	const out = Buffer.concat(stdout).toString("utf-8");
	const err = Buffer.concat(stderr).toString("utf-8");
	assert.equal(result.code, 0, `shim stderr: ${err}`);
	assert.ok(!out.includes("PASSTHROUGH-MARKER"), `the step must not run headless; stderr: ${err}`);
	assert.equal(out, lines.map((line) => line + "\n").join(""), `shim stderr: ${err}`);
	server.close();
	rmSync(root, { recursive: true, force: true });
})();

await (async () => {
	// A turn far larger than the stdout pipe buffer: every event line must
	// land on stdout, through the final agent_settled, before the shim exits.
	const root = makeShimRoot("nm-shim-drain-", "#!/bin/sh\nexit 0\n");
	const settled = '{"type":"agent_settled","aborted":false}';
	const payload = [];
	const expected = [];
	for (let i = 0; i < 1200; i++) {
		const line = `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"${"x".repeat(80)} chunk ${i}"}]}}`;
		payload.push(JSON.stringify({ type: "events", lines: [line] }) + "\n");
		expected.push(line + "\n");
	}
	payload.push(JSON.stringify({ type: "events", lines: [settled] }) + "\n");
	expected.push(settled + "\n");
	const server = await startFakeBridge(join(root, "herdr-bridge", TEST_RUN_ID, "sock"), (sock) => {
		for (const message of payload) sock.write(message);
		sock.end();
	});
	const { child, stdout, stderr } = runShim({ root });
	child.stdin.end("big turn");
	const result = await awaitExit(child, 30000);
	const out = Buffer.concat(stdout).toString("utf-8");
	const err = Buffer.concat(stderr).toString("utf-8");
	assert.equal(result.code, 0, `shim stderr: ${err}`);
	assert.equal(out, expected.join(""), `the daemon must receive the full stream; stderr: ${err}`);
	server.close();
	rmSync(root, { recursive: true, force: true });
})();

// ---------------------------------------------------------------------------
// The real bridge server (the exported module) hosting real shim connections.
// Herdr and the tab's pi are stubbed at the process boundary with real pi's
// verified write ordering: a fresh (cold) tab boots idle with NO session
// file; pi creates the session file only when `agent prompt` starts the
// first turn. These scenarios drive the public surface end to end —
// ensureBridgeServer, the socket protocol, the shim executable — and pin
// the two live failures found against the real product:
//   1. a cold step must bridge (prompt submitted BEFORE session discovery),
//   2. the stream must carry the leading session event headless pi emits.
// ---------------------------------------------------------------------------
const COLD_SESSION_ID = "01cccccc-dddd-4ddd-8ddd-eeeeeeeeeeee";
const STUB_ASSISTANT = {
	role: "assistant",
	stopReason: "stop",
	model: "stub-m",
	provider: "stub-p",
	usage: { input: 3, output: 1 },
	content: [{ type: "text", text: "stub tab turn done" }],
};

// The stub herdr CLI: exactly the command subset the bridge server drives
// (pane get, tab create, pane run, pane close, agent get, agent prompt).
// Written with plain string concatenation only, so the surrounding template
// literal stays interpolation-free.
const HERDR_STUB = `
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const stateDir = process.env.HERDR_STUB_STATE;
const sessionsRoot = join(process.env.PI_CODING_AGENT_DIR, "sessions");
const parentPane = process.env.HERDR_PANE_ID;
const argv = process.argv.slice(2);

function log(op, pane) {
	appendFileSync(join(stateDir, "calls.log"), JSON.stringify({ op, pane }) + "\\n");
}
function paneFile(pane) { return join(stateDir, "pane-" + pane + ".json"); }
function booted(pane) { return existsSync(join(stateDir, "pane-" + pane + ".booted")); }
function readPane(pane) {
	try { return JSON.parse(readFileSync(paneFile(pane), "utf-8")); } catch { return null; }
}
function mangled(cwd) { return "--" + cwd.split("/").join("-") + "--"; }
function sessionFileOf(cwd) {
	const dir = join(sessionsRoot, mangled(cwd));
	try {
		const names = readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort();
		return names.length ? join(dir, names[0]) : undefined;
	} catch { return undefined; }
}
function emit(result) { process.stdout.write(JSON.stringify({ result })); }

const command = argv[0];
const sub = argv[1];

if (command === "pane" && sub === "get") {
	const pane = argv[2];
	if (pane === parentPane) { emit({ pane: { workspace_id: "ws-stub" } }); process.exit(0); }
	if (readPane(pane)) { emit({ pane: { pane_id: pane } }); process.exit(0); }
	process.exit(1);
}
if (command === "tab" && sub === "create") {
	const cwd = argv[argv.indexOf("--cwd") + 1];
	const label = argv[argv.indexOf("--label") + 1];
	const counterFile = join(stateDir, "counter");
	let counter = 0;
	try { counter = Number(readFileSync(counterFile, "utf-8")); } catch {}
	counter += 1;
	writeFileSync(counterFile, String(counter));
	const pane = "w1:p" + counter;
	writeFileSync(paneFile(pane), JSON.stringify({ pane, cwd, label }));
	log("tab create", pane);
	emit({ root_pane: { pane_id: pane } });
	process.exit(0);
}
if (command === "pane" && sub === "run") {
	const pane = argv[2];
	const script = argv[4];
	const rec = readPane(pane);
	if (!rec) process.exit(1);
	// The pane's process: the launcher execs the stub tab pi, which idles.
	// Like real pi on a cold tab, no session file exists until the first
	// turn starts.
	writeFileSync(join(stateDir, "pane-" + pane + ".booted"), "");
	spawn("bash", [script], { stdio: "ignore", detached: true }).unref();
	process.exit(0);
}
if (command === "pane" && sub === "close") {
	const pane = argv[2];
	rmSync(paneFile(pane), { force: true });
	rmSync(join(stateDir, "pane-" + pane + ".booted"), { force: true });
	log("pane close", pane);
	process.exit(0);
}
if (command === "agent" && sub === "get") {
	const pane = argv[2];
	const rec = readPane(pane);
	const agent = {};
	if (!rec || !booted(pane)) {
		agent.agent_status = "booting";
	} else {
		agent.agent_status = "idle";
		const session = sessionFileOf(rec.cwd);
		if (session) agent.agent_session = { value: session };
	}
	emit({ agent });
	process.exit(0);
}
if (command === "agent" && sub === "prompt") {
	const pane = argv[2];
	const prompt = argv[3];
	const rec = readPane(pane);
	if (!rec) process.exit(1);
	// The turn: pi creates the session file for a fresh tab (this is the
	// moment real pi first writes it) or appends to the resumed one, then
	// writes this turn's records.
	let file = sessionFileOf(rec.cwd);
	const records = [];
	if (!file) {
		const dir = join(sessionsRoot, mangled(rec.cwd));
		mkdirSync(dir, { recursive: true });
		file = join(dir, Date.now() + "_" + "${COLD_SESSION_ID}" + ".jsonl");
		records.push({ type: "session", id: "${COLD_SESSION_ID}", version: "3" });
		records.push({ type: "message", message: { role: "system", content: "", sections: {} } });
	}
	records.push({ type: "message", message: { role: "user", content: [{ type: "text", text: prompt }] } });
	records.push({ type: "message", message: ${JSON.stringify(STUB_ASSISTANT)} });
	appendFileSync(file, records.map((record) => JSON.stringify(record) + "\\n").join(""));
	log("agent prompt", pane);
	process.exit(0);
}
process.exit(1);
`;

function makeBridgeRoot(prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const stubDir = join(root, "stub-bin");
	mkdirSync(stubDir);
	// stub herdr: an sh wrapper execing the node stub with the absolute
	// interpreter path (no PATH lookup, so CI hosts without a global herdr
	// or node on PATH run this too)
	writeFileSync(
		join(stubDir, "herdr"),
		"#!/bin/sh\nexec \"" + process.execPath + "\" \"" + join(stubDir, "herdr.mjs") + "\" \"$@\"\n",
		{ mode: 0o755 },
	);
	writeFileSync(join(stubDir, "herdr.mjs"), HERDR_STUB.trimStart() + "\n");
	// stub tab pi: the pane's interactive process; it idles and writes
	// nothing (the stub herdr models pi's session-file timing instead)
	writeFileSync(join(root, "stub-pi.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	mkdirSync(join(root, "pihome", "sessions"), { recursive: true });
	mkdirSync(join(root, TEST_RUN_ID));
	mkdirSync(join(root, "stub-state"));
	return root;
}

/** Point the loaded bridge module at the stub world: a stub herdr first on
 *  PATH, the Herdr pane env, and an isolated NM/pi home. Returns a restore
 *  function so later scenarios in this file see the real environment. */
function enterBridgeEnv(root) {
	const saved = {};
	for (const key of ["PATH", "HERDR_ENV", "HERDR_PANE_ID", "NM_HOME", "PI_CODING_AGENT_DIR", "NM_HERDR_REAL_PI", "HERDR_STUB_STATE"]) {
		saved[key] = process.env[key];
	}
	process.env.PATH = join(root, "stub-bin") + ":" + (process.env.PATH ?? "");
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w1:p0";
	process.env.NM_HOME = root;
	process.env.PI_CODING_AGENT_DIR = join(root, "pihome");
	process.env.NM_HERDR_REAL_PI = join(root, "stub-pi.sh");
	process.env.HERDR_STUB_STATE = join(root, "stub-state");
	return () => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

function readCalls(root) {
	const path = join(root, "stub-state", "calls.log");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

await (async () => {
	// A session-free (cold) step: the daemon launches the shim with
	// `--mode json --no-session`. The tab's pi writes its session file only
	// when the first turn starts, so the bridge must submit the daemon's
	// prompt BEFORE it demands the session file — the opposite order never
	// discovers a file and the step falls back headless (the live failure).
	const root = makeBridgeRoot("nm-bridge-cold-");
	const restore = enterBridgeEnv(root);
	try {
		ensureBridgeServer(TEST_RUN_ID);
		const prompt = "cold step: review the widget";
		const { child, stdout, stderr } = runShim({
			root,
			argv: ["--mode", "json", "--no-session"],
		});
		child.stdin.end(prompt);
		const result = await awaitExit(child, 30000);
		const out = Buffer.concat(stdout).toString("utf-8");
		const err = Buffer.concat(stderr).toString("utf-8");
		assert.equal(result.code, 0, `shim stderr: ${err}`);
		const events = out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
		assert.deepEqual(events, [
			{ type: "session", id: COLD_SESSION_ID },
			{ type: "message_end", message: { role: "user", content: [{ type: "text", text: prompt }] } },
			{ type: "message_end", message: STUB_ASSISTANT },
			{ type: "turn_end", message: STUB_ASSISTANT },
			{
				type: "agent_end",
				messages: [
					{ role: "system", content: "", sections: {} },
					{ role: "user", content: [{ type: "text", text: prompt }] },
					STUB_ASSISTANT,
				],
			},
			{ type: "agent_settled", aborted: false },
		], `cold step stream; shim stderr: ${err}`);
		assert.equal(events[0].type, "session", "the stream starts with the session event, like headless pi");
		const calls = readCalls(root);
		const created = calls.find((call) => call.op === "tab create");
		assert.ok(created, "a visible tab was created for the cold step");
		assert.ok(
			calls.some((call) => call.op === "agent prompt" && call.pane === created.pane),
			"the daemon's prompt was submitted to the tab",
		);
		assert.ok(
			calls.some((call) => call.op === "pane close" && call.pane === created.pane),
			"the cold tab closed after the turn settled",
		);
	} finally {
		teardownBridgeForRun(TEST_RUN_ID);
		restore();
		rmSync(root, { recursive: true, force: true });
	}
})();

await (async () => {
	// A fixer round resuming a durable session (`--mode json --session
	// <uuid>`): the bridge seeds the translator from the file head and must
	// emit the leading session event that headless pi prints — the prior
	// conversation is never re-emitted, only this round's records stream.
	const root = makeBridgeRoot("nm-bridge-resumed-");
	const fixerId = "01aaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
	const runCwd = join(root, TEST_RUN_ID);
	const sessionDir = join(root, "pihome", "sessions", "--" + runCwd.split("/").join("-") + "--");
	const sessionFile = join(sessionDir, "1700000000_" + fixerId + ".jsonl");
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(sessionFile, [
		JSON.stringify({ type: "session", id: fixerId, version: "3" }),
		JSON.stringify({ type: "message", message: { role: "system", content: "", sections: {} } }),
		JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "prior round prompt" }] } }),
		JSON.stringify({ type: "message", message: { role: "assistant", stopReason: "stop", model: "stub-m", provider: "stub-p", usage: { input: 9, output: 9 }, content: [{ type: "text", text: "prior round done" }] } }),
	].join("\n") + "\n");
	const restore = enterBridgeEnv(root);
	try {
		ensureBridgeServer(TEST_RUN_ID);
		const prompt = "fixer round 2: apply the remedy";
		const { child, stdout, stderr } = runShim({
			root,
			argv: ["--mode", "json", "--session", fixerId],
		});
		child.stdin.end(prompt);
		const result = await awaitExit(child, 30000);
		const out = Buffer.concat(stdout).toString("utf-8");
		const err = Buffer.concat(stderr).toString("utf-8");
		assert.equal(result.code, 0, `shim stderr: ${err}`);
		const events = out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
		assert.deepEqual(events, [
			{ type: "session", id: fixerId },
			{ type: "message_end", message: { role: "user", content: [{ type: "text", text: prompt }] } },
			{ type: "message_end", message: STUB_ASSISTANT },
			{ type: "turn_end", message: STUB_ASSISTANT },
			{
				type: "agent_end",
				messages: [
					{ role: "system", content: "", sections: {} },
					{ role: "user", content: [{ type: "text", text: prompt }] },
					STUB_ASSISTANT,
				],
			},
			{ type: "agent_settled", aborted: false },
		], `resumed round stream; shim stderr: ${err}`);
		assert.ok(!out.includes("prior round"), "the prior conversation is never re-emitted");
		const calls = readCalls(root);
		const created = calls.find((call) => call.op === "tab create");
		assert.ok(created, "a visible tab was created for the fixer round");
		assert.ok(
			!calls.some((call) => call.op === "pane close" && call.pane === created.pane),
			"the fixer tab stays open across rounds",
		);
		teardownBridgeForRun(TEST_RUN_ID);
		assert.ok(
			readCalls(root).some((call) => call.op === "pane close" && call.pane === created.pane),
			"teardown closes the live fixer tab",
		);
		assert.ok(!existsSync(join(root, "herdr-bridge", TEST_RUN_ID)), "teardown removed the bridge dir");
	} finally {
		teardownBridgeForRun(TEST_RUN_ID);
		restore();
		rmSync(root, { recursive: true, force: true });
	}
})();
