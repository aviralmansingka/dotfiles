// `remote` extension tests — offline, deterministic, no real herdr.
//
// A fake `herdr` binary goes on PATH BEFORE the module import (house rule:
// no test may reach a real multiplexer or SSH target). It records every
// call and answers each subcommand from env knobs, so the handler paths —
// spawn happy path, name collision, unreachable host, start failure,
// prompt failure, status — are exercised against recorded-live JSON
// shapes without network or remote state.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "remote-test-"));

// --- fake herdr -------------------------------------------------------------

const fakeBin = join(tempRoot, "fakebin");
const capture = join(tempRoot, "herdr-calls");
const listJsonPath = join(tempRoot, "list.json");
mkdirSync(fakeBin, { recursive: true });
writeFileSync(capture, "");
writeFileSync(
	join(fakeBin, "herdr"),
	`#!/bin/sh
[ -n "$REMOTE_TEST_CAPTURE" ] && { printf '%s\\n' "$@" >> "$REMOTE_TEST_CAPTURE"; printf '%s\\n' --call-- >> "$REMOTE_TEST_CAPTURE"; }
case "$3:$4" in
	agent:list)
		[ "$REMOTE_TEST_LIST_FAIL" = 1 ] && { echo "ssh: connect to host devbox port 22: Operation timed out" >&2; exit 255; }
		if [ -n "$REMOTE_TEST_LIST_JSON" ]; then cat "$REMOTE_TEST_LIST_JSON"; else printf '%s\\n' '{"id":"cli:agent:list","result":{"agents":[],"type":"agent_list"}}'; fi
		;;
	tab:create)
		[ "$REMOTE_TEST_TAB_FAIL" = 1 ] && { echo "tab create failed" >&2; exit 1; }
		printf '%s\\n' '{"result":{"tab":{"tab_id":"w1:t9","label":"x"},"root_pane":{"pane_id":"w1:p9","cwd":"/root"}}}'
		;;
	agent:start)
		[ "$REMOTE_TEST_START_FAIL" = 1 ] && { echo "pane is not at an interactive shell prompt" >&2; exit 1; }
		printf '%s\\n' '{"result":{"agent":{"name":"started","agent_status":"idle","interactive_ready":true}}}'
		;;
	agent:prompt)
		[ "$REMOTE_TEST_PROMPT_FAIL" = 1 ] && { echo "agent_blocked" >&2; exit 1; }
		printf '%s\\n' '{"result":{"type":"agent_prompted"}}'
		;;
	tab:close)
		printf '%s\\n' '{"result":{"type":"ok"}}'
		;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
	{ mode: 0o755 },
);
process.env.REMOTE_TEST_CAPTURE = capture;
process.env.PATH = `${fakeBin}:${process.env.PATH}`;

const knobs = ["REMOTE_TEST_LIST_JSON", "REMOTE_TEST_LIST_FAIL", "REMOTE_TEST_TAB_FAIL", "REMOTE_TEST_START_FAIL", "REMOTE_TEST_PROMPT_FAIL"];
const reset = () => {
	for (const key of knobs) delete process.env[key];
	truncateSync(capture);
};

// --- module under test ------------------------------------------------------

const stubAgent = join(tempRoot, "agent.cjs");
writeFileSync(stubAgent, "exports.defineTool = (tool) => tool;\n");
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": stubAgent },
});
const remote = jiti("./remote.ts");

const commands = {};
remote.default({
	registerCommand: (name, definition) => {
		commands[name] = definition;
	},
	registerTool: () => {},
	on: () => {},
});
assert.deepEqual(Object.keys(commands), ["remote"]);
assert.match(commands.remote.description, /^Spawn a subagent on devbox/);

const notifications = [];
const ctx = () => ({ ui: { notify: (message, level) => notifications.push({ message, level }) } });
const run = async (args) => {
	notifications.length = 0;
	await commands.remote.handler(args, ctx());
};
const calls = () =>
	readFileSync(capture, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"));

// --- pure helpers -----------------------------------------------------------

assert.equal(remote.slugifyAgentName("Fix the login bug in auth.ts NOW!!"), "fix-the-login-bug-in");
assert.equal(remote.slugifyAgentName("a b c d e f g h"), "a-b-c-d-e");
assert.equal(remote.slugifyAgentName("x".repeat(60)), "x".repeat(24));
assert.equal(remote.slugifyAgentName("trailing hyphens end in -------"), "trailing-hyphens-end-in");
assert.equal(remote.slugifyAgentName("??? !!!"), "remote");
assert.equal(remote.pickAgentName("deploy the dashboard", []), "deploy-the-dashboard");
assert.equal(remote.pickAgentName("deploy the dashboard", ["deploy-the-dashboard"]), "deploy-the-dashboard-2");
assert.equal(remote.pickAgentName("deploy the dashboard", ["deploy-the-dashboard", "deploy-the-dashboard-2"]), "deploy-the-dashboard-3");
// A name at the 24-char cap still gets a fitting suffix, never a silent re-truncation to the taken base.
assert.equal(remote.pickAgentName("x".repeat(24), ["x".repeat(24)]), `${"x".repeat(22)}-2`);

const goodTab = '{"result":{"tab":{"tab_id":"w1:t2"},"root_pane":{"pane_id":"w1:p2"}}}';
assert.deepEqual(remote.parseTabCreate(goodTab), { tabId: "w1:t2", paneId: "w1:p2" });
assert.throws(() => remote.parseTabCreate("not json"), /invalid JSON/);
assert.throws(() => remote.parseTabCreate('{"result":{"tab":{}}}'), /tab_id/);
assert.throws(() => remote.parseTabCreate('{"result":{"tab":{"tab_id":"w1:t2"}}}'), /pane_id/);

assert.deepEqual(remote.parseAgentList('{"result":{"agents":[],"type":"agent_list"}}'), []);
const listBody = JSON.stringify({
	result: {
		agents: [
			{ name: "fix-login", agent_status: "working" },
			{ name: "", agent_status: "idle" },
			{ agent_status: "blocked" },
			{ name: "deploy", agent_status: "done" },
		],
	},
});
assert.deepEqual(remote.parseAgentList(listBody), [
	{ name: "fix-login", state: "working" },
	{ name: "deploy", state: "done" },
]);
assert.deepEqual(remote.parseAgentList('{"result":{}}'), []);
assert.equal(remote.formatAgentList([]), "No agents running on devbox.");
assert.equal(remote.formatAgentList([{ name: "fix-login", state: "working" }]), "fix-login — working");

// --- spawn: happy path ------------------------------------------------------

reset();
await run("deploy the new dashboard to staging");
assert.deepEqual(calls(), [
	["--machine", "devbox", "agent", "list"],
	["--machine", "devbox", "tab", "create", "--label", "deploy-the-new-dashboard", "--cwd", "~", "--no-focus"],
	["--machine", "devbox", "agent", "start", "deploy-the-new-dashboard", "--kind", "pi", "--pane", "w1:p9", "--timeout", "60000"],
	["--machine", "devbox", "agent", "prompt", "deploy-the-new-dashboard", "deploy the new dashboard to staging"],
]);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].level, "info");
assert.match(notifications[0].message, /"deploy-the-new-dashboard" spawned on devbox/);
assert.match(notifications[0].message, /herdr --remote devbox/);
assert.match(notifications[0].message, /Check status: \/remote/);

// --- spawn: name collision gets a suffix ------------------------------------

reset();
writeFileSync(listJsonPath, JSON.stringify({ result: { agents: [{ name: "fix-the-login-page", agent_status: "idle" }] } }));
process.env.REMOTE_TEST_LIST_JSON = listJsonPath;
await run("fix the login page");
const collisionCalls = calls();
assert.deepEqual(collisionCalls[2], [
	"--machine", "devbox", "agent", "start", "fix-the-login-page-2", "--kind", "pi", "--pane", "w1:p9", "--timeout", "60000",
]);
assert.deepEqual(collisionCalls[3], ["--machine", "devbox", "agent", "prompt", "fix-the-login-page-2", "fix the login page"]);
assert.match(notifications[0].message, /"fix-the-login-page-2" spawned/);

// --- spawn: unreachable host stops before any tab exists --------------------

reset();
process.env.REMOTE_TEST_LIST_FAIL = 1;
await run("deploy the new dashboard to staging");
assert.deepEqual(calls(), [["--machine", "devbox", "agent", "list"]]);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].level, "error");
assert.match(notifications[0].message, /unreachable/);
assert.match(notifications[0].message, /herdr machine status devbox/);

// --- spawn: agent start failure closes the tab this run created -------------

reset();
process.env.REMOTE_TEST_START_FAIL = 1;
await run("deploy the new dashboard to staging");
assert.deepEqual(calls(), [
	["--machine", "devbox", "agent", "list"],
	["--machine", "devbox", "tab", "create", "--label", "deploy-the-new-dashboard", "--cwd", "~", "--no-focus"],
	["--machine", "devbox", "agent", "start", "deploy-the-new-dashboard", "--kind", "pi", "--pane", "w1:p9", "--timeout", "60000"],
	["--machine", "devbox", "tab", "close", "w1:t9"],
]);
assert.equal(notifications[0].level, "error");
assert.match(notifications[0].message, /agent start failed/);
assert.match(notifications[0].message, /fresh tab was closed/);

// --- spawn: prompt failure keeps the live agent ------------------------------

reset();
process.env.REMOTE_TEST_PROMPT_FAIL = 1;
await run("deploy the new dashboard to staging");
const promptFailCalls = calls();
assert.ok(!promptFailCalls.some((call) => call[3] === "close"), "no tab close may happen while the agent is up");
assert.equal(notifications[0].level, "error");
assert.match(notifications[0].message, /agent prompt failed/);
assert.match(notifications[0].message, /"deploy-the-new-dashboard" is up on devbox/);
assert.match(notifications[0].message, /task was not submitted/);
assert.match(notifications[0].message, /herdr --remote devbox/);

// --- status -----------------------------------------------------------------

reset();
writeFileSync(listJsonPath, listBody);
process.env.REMOTE_TEST_LIST_JSON = listJsonPath;
await run("");
assert.deepEqual(calls(), [["--machine", "devbox", "agent", "list"]]);
assert.equal(notifications[0].level, "info");
assert.match(notifications[0].message, /fix-login — working/);
assert.match(notifications[0].message, /deploy — done/);
assert.match(notifications[0].message, /herdr --remote devbox/);

reset();
process.env.REMOTE_TEST_LIST_JSON = listJsonPath;
await run("status");
assert.match(notifications[0].message, /fix-login — working/);

reset();
await run("   ");
assert.match(notifications[0].message, /No agents running on devbox/);

reset();
process.env.REMOTE_TEST_LIST_FAIL = 1;
await run("");
assert.equal(notifications[0].level, "error");
assert.match(notifications[0].message, /unreachable/);
assert.match(notifications[0].message, /herdr machine status devbox/);

// --- teardown ---------------------------------------------------------------

reset();
delete process.env.REMOTE_TEST_CAPTURE;
rmSync(tempRoot, { recursive: true, force: true });
console.log("remote.test.mjs: all assertions passed");
