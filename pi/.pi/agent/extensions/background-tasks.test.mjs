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

const { OutputBuffer, TaskManager, TaskManagerError, formatUptime, stripAnsi } = jiti("./background-tasks/tasks.ts");

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
	buf.push("no newline yet");
	assert.equal(buf.tail(5).lines.length, 0, "partial line is not returned before close");
	buf.close();
	assert.deepEqual(buf.tail(5).lines, ["no newline yet"]);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const manager = new TaskManager({ shell: "/bin/sh" });

{
	const task = manager.start({ command: "echo hello; sleep 0.3; echo done; exit 7" });
	assert.equal(task.state, "running");
	assert.ok(task.pid > 0);
	await sleep(700);
	const result = manager.read(task.id, { tail: 10 });
	assert.equal(result.task.state, "exited");
	assert.equal(result.task.exitCode, 7);
	assert.deepEqual(result.lines, ["hello", "done"]);
}

{
	// steering: send stdin to a waiting process without killing it
	const task = manager.start({ command: "read x; echo got:$x" });
	await sleep(200);
	manager.send(task.id, "steer-me");
	await sleep(300);
	const result = manager.read(task.id, { tail: 10 });
	assert.equal(result.task.state, "exited");
	assert.deepEqual(result.lines, ["got:steer-me"], "stdin input reaches the process");
}

{
	// incremental read via sinceLine
	const task = manager.start({ command: "echo l1; echo l2; sleep 0.2; echo l3; echo l4" });
	await sleep(100);
	const first = manager.read(task.id, { tail: 40 });
	assert.deepEqual(first.lines, ["l1", "l2"]);
	await sleep(400);
	const next = manager.read(task.id, { sinceLine: first.toLine });
	assert.deepEqual(next.lines, ["l3", "l4"], "sinceLine returns only new lines");
}

{
	// kill a stuck task
	const task = manager.start({ command: "sleep 30" });
	await sleep(100);
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
	assert.throws(() => manager.send("t999", "x"), TaskManagerError);
}

// onExit fires once with the finished task
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

	// exit wake-up: an unobserved exit sends a bg-task-exit message with triggerTurn
	const quick = await run({ action: "start", command: "echo bye", name: "quick" });
	const quickId = quick.details.task.id;
	await new Promise((resolve) => setTimeout(resolve, 800));
	assert.equal(registered.sent.length, 1, "unobserved exit wakes the agent");
	const wake = registered.sent[0];
	assert.equal(wake.message.customType, EXIT_MESSAGE_TYPE);
	assert.equal(wake.options.triggerTurn, true);
	assert.equal(wake.options.deliverAs, "nextTurn");
	assert.match(String(wake.message.content[0].text), /exited with code 0[\s\S]*bye/);

	// observed exits (via wait) are not re-reported as wake messages
	const observed = await run({ action: "start", command: "exit 3" });
	await run({ action: "wait", taskId: observed.details.task.id, timeoutMs: 5000 });
	assert.equal(registered.sent.length, 1, "tool-observed exit does not double-report");

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

rmSync(tempRoot, { recursive: true, force: true });
