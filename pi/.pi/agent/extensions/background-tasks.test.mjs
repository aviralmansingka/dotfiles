import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// Allow CI to supply its own jiti via JITI_PATH; fall back to the host pi install.
const jitiPath = [
	process.env.JITI_PATH,
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "bg-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
const stubTypes = join(tempRoot, "types.cjs");
writeFileSync(stubAgent, "exports.ExtensionAPI = class {};\n");
writeFileSync(stubAi, "exports.StringEnum = (values) => ({ type: 'string', enum: values });\n");
writeFileSync(
	stubTui,
	"exports.Text = class Text { constructor(text) { this.text = text; } };\nexports.truncateToWidth = (text) => String(text);\n",
);
writeFileSync(stubTypes, "exports.Type = { Object: (props) => ({ type: 'object', properties: props }), Optional: (s) => s, String: (o = {}) => ({ type: 'string', ...o }), Boolean: (o = {}) => ({ type: 'boolean', ...o }), Number: (o = {}) => ({ type: 'number', ...o }) };\n");
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const { MAX_LINE_LENGTH, OutputBuffer, TaskManager, TaskManagerError, formatUptime, stripAnsi } = jiti("./background-tasks/tasks.ts");

// ─── OutputBuffer ────────────────────────────────────────────────────────────

{
	const buf = new OutputBuffer(3);
	buf.push("one\ntwo\nthree\n");
	let snap = buf.tail(10);
	assert.deepEqual(snap.lines, ["one", "two", "three"]);
	assert.equal(snap.fromLine, 1);
	assert.equal(snap.toLine, 3);
	assert.equal(snap.truncated, false);

	buf.push("four\nfive\n");
	snap = buf.tail(10);
	assert.deepEqual(snap.lines, ["three", "four", "five"], "ring keeps the newest lines");
	assert.equal(snap.fromLine, 3);
	assert.equal(snap.toLine, 5);
	assert.equal(snap.truncated, true, "dropped older lines are reported");
	assert.equal(buf.totalLines, 5);
}

{
	const buf = new OutputBuffer(10);
	buf.push("a\nb\nc\n");
	let snap = buf.since(2);
	assert.deepEqual(snap.lines, ["c"], "since(n) returns lines after n");
	assert.equal(snap.fromLine, 3);
	snap = buf.since(3);
	assert.deepEqual(snap.lines, [], "since(toLine) returns nothing");
	snap = buf.since(99);
	assert.deepEqual(snap.lines, [], "since beyond the end returns nothing");
	buf.push("d");
	buf.close();
	snap = buf.since(3);
	assert.deepEqual(snap.lines, ["d"], "close() flushes the partial trailing line");
}

{
	const buf = new OutputBuffer(10);
	buf.push("first\nno newline yet");
	const partial = buf.since(1);
	assert.deepEqual(partial.lines, []);
	assert.deepEqual(partial.partialLines, [{ lineNumber: 2, text: "no newline yet", source: "stdout" }]);
	assert.equal(partial.toLine, 1, "partial output does not advance the incremental cursor");
	buf.push(" done\n");
	const complete = buf.since(partial.toLine);
	assert.deepEqual(complete.lines, ["no newline yet done"]);
	assert.deepEqual(complete.partialLines, []);
	assert.equal(complete.toLine, 2);
}

{
	const buf = new OutputBuffer(10);
	buf.push(`${"x".repeat(MAX_LINE_LENGTH * 5)}Continue? `);
	const partial = buf.since(0);
	assert.equal(partial.toLine, 0);
	assert.equal(partial.partialLines[0].text.length, MAX_LINE_LENGTH);
	assert.ok(partial.partialLines[0].text.endsWith("Continue? "));
	buf.push("yes\n");
	const complete = buf.since(partial.toLine);
	assert.equal(complete.toLine, 1);
	assert.ok(complete.lines[0].endsWith("Continue? yes"));
}

{
	const buf = new OutputBuffer(10);
	buf.push("Continue? ", "stdout");
	buf.push("warning\n", "stderr");
	const snapshot = buf.since(0);
	assert.deepEqual(snapshot.lines, ["warning"]);
	assert.deepEqual(snapshot.partialLines, [{ lineNumber: 2, text: "Continue? ", source: "stdout" }]);
	buf.push("yes\n", "stdout");
	assert.deepEqual(buf.since(snapshot.toLine).lines, ["Continue? yes"]);
}

{
	assert.equal(stripAnsi("\x1b[31mred\x1b[0m plain \x1b[?25lcursor"), "red plain cursor");
}

// ─── formatUptime ─────────────────────────────────────────────────────────────

assert.equal(formatUptime(0, 0), "0s");
assert.equal(formatUptime(0, 59_000), "59s");
assert.equal(formatUptime(0, 65_000), "1m5s");
assert.equal(formatUptime(0, 3_780_000), "1h3m");

// ─── TaskManager with real processes ──────────────────────────────────────────

const waitFor = async (condition, message, timeoutMs = 5000) => {
	const deadline = Date.now() + timeoutMs;
	while (!(await condition())) {
		if (Date.now() >= deadline) assert.fail(message);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};
const manager = new TaskManager({ shell: "/bin/sh" });

{
	const task = manager.start({ command: "echo hello; sleep 0.3; echo done; exit 7" });
	assert.equal(task.state, "running");
	assert.ok(task.pid > 0);
	const exited = await manager.wait(task.id, 5000);
	const result = manager.read(task.id, { tail: 10 });
	assert.equal(exited.exitCode, 7);
	assert.deepEqual(result.lines, ["hello", "done"]);
}

{
	const task = manager.start({ command: "printf 'Continue? '; read x; echo got:$x" });
	await waitFor(
		() => manager.read(task.id).partialLines[0]?.text === "Continue? ",
		"waiting prompt was not exposed",
	);
	const prompt = manager.read(task.id, { sinceLine: 0 });
	assert.equal(prompt.toLine, 0);
	assert.deepEqual(prompt.partialLines, [{ lineNumber: 1, text: "Continue? ", source: "stdout" }]);
	await manager.send(task.id, "steer-me");
	await manager.wait(task.id, 5000);
	const result = manager.read(task.id, { sinceLine: prompt.toLine });
	assert.deepEqual(result.lines, ["Continue? got:steer-me"], "stdin reaches the waiting process");
	assert.equal(result.toLine, 1, "the completed prompt retains its original line number");
}

{
	const task = manager.start({ command: "echo l1; echo l2; read x; echo l3; echo l4" });
	await waitFor(() => manager.read(task.id).task.totalLines >= 2, "initial output was not captured");
	const first = manager.read(task.id, { tail: 40 });
	assert.deepEqual(first.lines, ["l1", "l2"]);
	await manager.send(task.id, "continue");
	await manager.wait(task.id, 5000);
	const next = manager.read(task.id, { sinceLine: first.toLine });
	assert.deepEqual(next.lines, ["l3", "l4"], "sinceLine returns only new lines");
}

{
	const task = manager.start({ command: "sleep 30" });
	manager.kill(task.id, "SIGKILL");
	const summary = manager.list().find((t) => t.id === task.id);
	assert.equal(summary.state, "exited");
	assert.equal(summary.exitSignal, "SIGKILL");
}

{
	// wait returns early on exit
	const task = manager.start({ command: "sleep 0.2" });
	const exited = await manager.wait(task.id, 5000);
	assert.equal(exited.state, "exited");
	// wait times out but never rejects
	const stuck = manager.start({ command: "sleep 30" });
	const stillRunning = await manager.wait(stuck.id, 200);
	assert.equal(stillRunning.state, "running");
	manager.kill(stuck.id, "SIGKILL");
}

{
	assert.throws(() => manager.read("t999"), TaskManagerError);
	await assert.rejects(manager.send("t999", "x"), TaskManagerError);
}

{
	const m = new TaskManager({ shell: "/bin/sh", maxTasks: 1 });
	const first = m.start({ command: "exit 0" });
	await m.wait(first.id, 5000);
	const second = m.start({ command: "sleep 30" });
	assert.equal(second.state, "running", "exited history does not consume the running-task limit");
	m.kill(second.id, "SIGKILL");
}

{
	const m = new TaskManager({ shell: "/bin/sh" });
	const task = m.start({ command: "sleep 30" });
	assert.throws(() => m.kill(task.id, "NOT_A_SIGNAL"), /unsupported signal/);
	assert.equal(m.get(task.id).suppressExitNotify, false);
	m.kill(task.id, "SIGKILL");
}

{
	const m = new TaskManager({ shell: "/bin/sh" });
	const task = m.start({ command: "sleep 30 >/dev/null 2>&1 & echo $!" });
	await m.wait(task.id, 5000);
	const descendantPid = Number(m.read(task.id).lines[0]);
	assert.ok(descendantPid > 0);
	await waitFor(() => {
		try {
			process.kill(descendantPid, 0);
			return false;
		} catch (error) {
			return error.code === "ESRCH";
		}
	}, "detached descendant survived its shell");
}

{
	const m = new TaskManager({ shell: "/bin/sh" });
	const task = m.start({ command: "exec 0<&-; echo ready; sleep 30" });
	await waitFor(() => m.read(task.id).lines.includes("ready"), "child did not close stdin");
	await assert.rejects(m.send(task.id, "input"), /failed to send input.*EPIPE|failed to send input.*closed/i);
	m.kill(task.id, "SIGKILL");
}

{
	const exits = [];
	const m = new TaskManager({ shell: "/bin/sh", onExit: (t) => exits.push(t.id) });
	const task = m.start({ command: "exit 0" });
	await m.wait(task.id, 5000);
	assert.deepEqual(exits, [task.id]);
}

// ─── extension wiring smoke test ─────────────────────────────────────────────

const { default: register, EXIT_MESSAGE_TYPE } = jiti("./background-tasks/index.ts");

const registered = { tools: [], commands: [], messages: [], sent: [], handlers: {} };
const pi = {
	registerTool: (tool) => registered.tools.push(tool),
	registerCommand: (name, opts) => registered.commands.push({ name, ...opts }),
	registerMessageRenderer: (type) => registered.messages.push(type),
	sendMessage: (message, options) => registered.sent.push({ message, options }),
	on: (event, handler) => {
		registered.handlers[event] = handler;
	},
};
register(pi);

assert.equal(registered.tools.length, 1);
const tool = registered.tools[0];
assert.equal(tool.name, "background_task");
assert.ok(tool.description.length > 100, "model-facing description must teach the tool");
assert.match(tool.description, /more than a few seconds/, "description carries the duration decision rule");
assert.ok(tool.promptSnippet.length > 0 && tool.promptSnippet.length < 200, "snippet is a single prompt line");
assert.equal(tool.promptGuidelines.length, 3);
assert.match(tool.promptGuidelines[0], /more than a few seconds.*background_task/s);
assert.match(tool.promptGuidelines[1], /finish in about a second/);
assert.match(tool.promptGuidelines[2], /prompt for input/);
assert.equal(registered.commands.length, 1);
assert.equal(registered.commands[0].name, "bg");
assert.equal(registered.messages[0], EXIT_MESSAGE_TYPE);

const ctx = { cwd: process.cwd(), ui: undefined };
const run = (params) => tool.execute("call-1", params, undefined, undefined, ctx);
const out = (result) => result.content[0].text;

const started = await run({ action: "start", command: "sleep 60", name: "stuck" });
assert.match(out(started), /Started task t\d+ "stuck"/);
	const id = started.details.task.id;

	const listed = await run({ action: "list" });
	assert.match(out(listed), new RegExp(`${id} "stuck" — running, pid \\d+`));

	const read = await run({ action: "read", taskId: id });
	assert.match(out(read), new RegExp(`task ${id} "stuck" \\(sleep 60\\) — running, pid \\d+, uptime \\d+s?m?`));

	const sent = await run({ action: "send", taskId: id, input: "hello" });
	assert.match(out(sent), /Sent input to task/);

	const killed = await run({ action: "kill", taskId: id, signal: "SIGKILL" });
	assert.match(out(killed), /killed \(SIGKILL\)/);
	assert.equal(registered.sent.length, 0, "tool-initiated kill does not wake the agent");

	const bad = await run({ action: "read", taskId: "t999" });
	assert.match(out(bad), /^Error: unknown task/);

	const quick = await run({ action: "start", command: "echo bye", name: "quick" });
	const quickId = quick.details.task.id;
	await waitFor(() => registered.sent.length === 1, "unobserved exit did not wake the agent");
	assert.match(quickId, /^t\d+$/);
	const wake = registered.sent[0];
	assert.equal(wake.message.customType, EXIT_MESSAGE_TYPE);
	assert.deepEqual(wake.options, { triggerTurn: true });
	assert.match(String(wake.message.content[0].text), /exited with code 0[\s\S]*bye/);

	const observed = await run({ action: "start", command: "exit 3" });
	const observedResult = await run({ action: "wait", taskId: observed.details.task.id, timeoutMs: 5000 });
	assert.match(out(observedResult), /exited \(code 3\)/);

	// /bg command smoke: list and send through notify
	const notes = [];
	const commandCtx = { mode: "tui", ui: { notify: (m) => notes.push(m) } };
	await registered.commands[0].handler("", commandCtx);
	assert.match(notes[0], /Background tasks:/);
	assert.match(notes[0], /"stuck" — exited/, "exited tasks stay listed for reading");
	await registered.commands[0].handler(`${id} extra`, commandCtx);
	assert.match(notes[1], /already exited/, "sending to an exited task notifies, not throws");
	await registered.commands[0].handler("t999", commandCtx);
	assert.match(notes[2], /No such task/);

{
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	const timers = [];
	globalThis.setTimeout = (callback, delay, ...args) => {
		if (delay !== 400) return realSetTimeout(callback, delay, ...args);
		const timer = { active: true, run: () => callback(...args) };
		timers.push(timer);
		return timer;
	};
	globalThis.clearTimeout = (timer) => {
		if (timers.includes(timer)) timer.active = false;
		else realClearTimeout(timer);
	};
	try {
		const isolated = { tools: [], sent: [], handlers: {} };
		register({
			registerTool: (registeredTool) => isolated.tools.push(registeredTool),
			registerCommand: () => {},
			registerMessageRenderer: () => {},
			sendMessage: (message) => isolated.sent.push(message),
			on: (event, handler) => {
				isolated.handlers[event] = handler;
			},
		});
		const isolatedRun = (params) => isolated.tools[0].execute("call-2", params, undefined, undefined, ctx);
		const task = await isolatedRun({ action: "start", command: "exit 0" });
		await waitFor(async () => {
			const listed = await isolatedRun({ action: "list" });
			return listed.details.tasks.find((item) => item.id === task.details.task.id)?.state === "exited";
		}, "isolated task did not exit");
		await isolated.handlers.session_shutdown();
		for (const timer of timers) if (timer.active) timer.run();
		assert.equal(isolated.sent.length, 0, "shutdown cancels pending exit notifications");
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	}
}

rmSync(tempRoot, { recursive: true, force: true });
