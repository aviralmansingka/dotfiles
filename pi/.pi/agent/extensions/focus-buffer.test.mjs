import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
const { createJiti } = require(jitiPath);

// Peer stubs (house pattern). focus-buffer imports nvim-open, which imports
// defineTool and Type — stub those. The herdr/nvim IO paths are intentionally
// NOT exercised here (same policy as lesson tests).
const tempRoot = mkdtempSync(join(tmpdir(), "focus-buffer-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubTui, "module.exports = {};\n"); // nvim-open rendering is not exercised here.
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
		"@earendil-works/pi-tui": stubTui,
	},
});
const {
	editorSocketPath,
	ensureEditorReady,
	focusNodeBuffer,
	isEditorMissing,
	nodeBufferName,
	nodeSlug,
	overviewBufferName,
	showNodeBuffer,
	showOverviewBuffer,
} = jiti("./focus-buffer.ts");

// ── buffer naming (pure) ─────────────────────────────────────────────

// One stable buffer per node: the slug collapses separators and case, so
// the same node always lands in the same buffer.
assert.equal(nodeSlug("Node E — ROV drop scope"), "node-e-rov-drop-scope");
assert.equal(nodeSlug("Node E — ROV drop  scope!"), "node-e-rov-drop-scope");
assert.equal(nodeSlug("  "), "node");
assert.equal(nodeBufferName("session-abc", "Node E — ROV drop scope"), "pi-focus://session-abc/node-e-rov-drop-scope");
assert.equal(overviewBufferName("session-abc"), "pi-focus://session-abc/overview");
assert.equal(nodeBufferName("a b", "x"), nodeBufferName("a-b", "x"), "session keys sanitize to the same buffer family");
// Slug edges: disallowed runs collapse to single dashes, edges trim, keys
// and slugs cap at 64 chars, non-ASCII falls away, empty never yields "".
assert.equal(nodeSlug("Node_A/B: C!"), "node_a-b-c");
assert.equal(nodeSlug("--trim me--"), "trim-me");
assert.equal(nodeSlug("x".repeat(80)), "x".repeat(64), "node slugs cap at 64 chars");
assert.equal(nodeSlug("Ünïcode node"), "n-code-node", "non-ASCII collapses without killing the slug");
assert.equal(nodeBufferName("a:b/c d", "x"), "pi-focus://a-b-c-d/x", "session keys sanitize separators");
assert.equal(
	nodeBufferName("k".repeat(80), "x").length,
	"pi-focus://".length + 64 + "/x".length,
	"session keys cap at 64 chars",
);
assert.equal(nodeBufferName("", "x"), "pi-focus://session/x", "an empty session key still names a family");

// ── socket resolution (pure) ─────────────────────────────────────────────────

// A pid with no /proc entry and no default socket resolves to undefined.
assert.equal(editorSocketPath(999_999_999), undefined);

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalTmpdir = process.env.TMPDIR;
const originalUser = process.env.USER;
const macPid = 999_999_998;
const macUser = "focus-test";
const socketDir = join(tempRoot, `nvim.${macUser}`, "session");
const macSocket = join(socketDir, `nvim.${macPid}.0`);
const binDir = join(tempRoot, "bin");
mkdirSync(socketDir, { recursive: true });
mkdirSync(binDir);
writeFileSync(macSocket, "");
writeFileSync(
	join(binDir, "nvim"),
	`#!/bin/sh\n[ "$2" = "${macSocket}" ] && exit 0\nexit 1\n`,
);
chmodSync(join(binDir, "nvim"), 0o755);
try {
	Object.defineProperty(process, "platform", { value: "darwin" });
	process.env.TMPDIR = `${tempRoot}/`;
	process.env.USER = macUser;
	process.env.PATH = binDir;
	assert.equal(editorSocketPath(macPid), macSocket);
} finally {
	Object.defineProperty(process, "platform", { value: originalPlatform });
	if (originalTmpdir === undefined) delete process.env.TMPDIR;
	else process.env.TMPDIR = originalTmpdir;
	if (originalUser === undefined) delete process.env.USER;
	else process.env.USER = originalUser;
	process.env.PATH = originalPath;
}

// ── hard off-switch ──────────────────────────────────────────────────────────

// PI_DISABLE_FOCUS_BUFFER=1 must never touch a live editor pane: it returns
// before any herdr/nvim call. This is what keeps tests and headless runs safe.
process.env.PI_DISABLE_FOCUS_BUFFER = "1";
const disabled = showNodeBuffer("session-abc", "Node A", "Node A", "body");
assert.equal(disabled.ok, false);
assert.ok(disabled.message.includes("disabled"));
const disabledFocus = focusNodeBuffer("session-abc", "Node A");
assert.equal(disabledFocus.ok, false);
assert.ok(disabledFocus.message.includes("disabled"));
delete process.env.PI_DISABLE_FOCUS_BUFFER;

// Without the guard, the very first step is editor detection; with herdr
// unavailable on PATH this fails cleanly rather than throwing. (On a machine
// WITH herdr the call is safe: it only lists panes and would proceed to the
// buffer update — which is the production behavior under test elsewhere.)
process.env.PATH = "/nonexistent";
const noEditor = showNodeBuffer("session-abc", "Node A", "Node A", "body");
assert.equal(noEditor.ok, false);
assert.ok(noEditor.message.length > 0);
const noEditorFocus = focusNodeBuffer("session-abc", "Node A");
assert.equal(noEditorFocus.ok, false);
assert.ok(noEditorFocus.message.length > 0);
process.env.PATH = originalPath;

// ── editor-missing classification ──────────────────────────────────
// Only the four no-editor classes count as "launch one": a missing node
// buffer or a failed RPC must NOT trigger an editor launch.
assert.equal(isEditorMissing("no editor pane found"), true);
assert.equal(isEditorMissing("editor pane is not nvim (no RPC socket)"), true);
assert.equal(isEditorMissing("no live nvim RPC socket for the editor pane"), true);
assert.equal(isEditorMissing("focus buffer disabled (PI_DISABLE_FOCUS_BUFFER=1)"), true);
assert.equal(isEditorMissing('no node "Node A" buffer yet'), false, "a missing buffer is not a missing editor");
assert.equal(isEditorMissing('node "A" buffer update failed: boom'), false, "a failed update is not a missing editor");

// ── readiness poll under the off-switch ─────────────────────────────
// With the buffer disabled there is never a usable editor: the poll must
// return false within its own budget, not hang or throw.
const savedDisable = process.env.PI_DISABLE_FOCUS_BUFFER;
try {
	process.env.PI_DISABLE_FOCUS_BUFFER = "1";
	const before = Date.now();
	assert.equal(await ensureEditorReady(300), false);
	assert.ok(Date.now() - before < 2000, "the readiness poll respects its timeout");
} finally {
	if (savedDisable === undefined) delete process.env.PI_DISABLE_FOCUS_BUFFER;
	else process.env.PI_DISABLE_FOCUS_BUFFER = savedDisable;
}

// ── Linux runtime-dir socket fallback ───────────────────────────────────
const uid = process.getuid?.();
if (typeof uid === "number" && existsSync(`/run/user/${uid}`)) {
	const fakePid = 987_654_321;
	const fallbackSock = join(`/run/user/${uid}`, `nvim.${fakePid}.0`);
	writeFileSync(fallbackSock, "");
	try {
		assert.equal(
			editorSocketPath(fakePid),
			fallbackSock,
			"the runtime-dir socket is the Linux fallback",
		);
	} finally {
		rmSync(fallbackSock, { force: true });
	}
} else {
	console.log("skip /run/user socket fallback (no runtime dir)");
}
assert.equal(editorSocketPath(987_654_320), undefined, "no socket anywhere means no editor socket");

// ── live fake editor: show/focus round trip ─────────────────────────
// Fake herdr/nvim shell binaries on PATH (house pattern); a real spawned
// listener carries --listen in /proc/<pid>/cmdline so editorSocketPath
// resolves its socket exactly as in production. The fake nvim answers
// "missing" for pure-focus lua and "ok" otherwise, and a state marker
// makes it fail to cover RPC-failure handling.
if (existsSync("/proc")) {
	const binDir = join(tempRoot, "bin");
	const stateDir = join(tempRoot, "state");
	const runDir = join(tempRoot, "run");
	const harnessTmp = join(tempRoot, "hr-tmp");
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	mkdirSync(runDir, { recursive: true });
	mkdirSync(harnessTmp, { recursive: true });
	writeFileSync(join(binDir, "nvim"), [
		"#!/usr/bin/env node",
		"const fs = require('node:fs');",
		"const args = process.argv.slice(2);",
		"if (args[0] === '--listen') {",
		"	// Listener mode: stay alive so /proc/<pid>/cmdline keeps --listen.",
		"	setInterval(() => {}, 1 << 30);",
		"} else {",
		"	if (args[0] === '--server') {",
		"		const i = args.indexOf('--remote-expr');",
		"		if (i !== -1) {",
		"			if (args[i + 1] === '1') process.exit(0);",
		"			const state = process.env.FAKE_NVIM_STATE;",
		"			if (state && fs.existsSync(state + '/nvim-fail')) process.exit(1);",
		"			const m = args[i + 1].match(/readfile\\(\"([^\"]+)\"\\)/);",
		"			let lua = '';",
		"			try { lua = m ? fs.readFileSync(m[1], 'utf-8') : ''; } catch {}",
		"			console.log(lua.indexOf('return \"missing\"') === -1 ? 'ok' : 'missing');",
		"		}",
		"	}",
		"	process.exit(0);",
		"}",
	].join("\n"), "utf-8");
	chmodSync(join(binDir, "nvim"), 0o755);
	writeFileSync(join(binDir, "herdr"), [
		"#!/usr/bin/env node",
		"const fs = require('node:fs');",
		"const path = require('node:path');",
		"const state = process.env.FAKE_HERDR_STATE;",
		"const args = process.argv.slice(2);",
		"const cmd = args.join(' ');",
		"const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };",
		"if (cmd === 'pane current') {",
		"	out({ result: { pane: { pane_id: 'w1:p1', tab_id: 't1', cwd: '/tmp' } } });",
		"} else if (cmd.startsWith('pane list')) {",
		"	out({ result: { panes: [",
		"		{ pane_id: 'w1:p1', tab_id: 't1', cwd: '/tmp' },",
		"		{ pane_id: 'w1:p2', tab_id: 't1', cwd: '/tmp' } ] } });",
		"} else if (cmd.startsWith('pane process-info')) {",
		"	const pane = args[args.indexOf('--pane') + 1];",
		"	const pid = Number(fs.readFileSync(path.join(state, 'editor-pid'), 'utf-8').trim());",
		"	if (pane === 'w1:p2') {",
		"		out({ result: { process_info: { pane_id: pane, foreground_processes: [{ name: 'nvim', pid, argv: ['nvim'] }] } } });",
		"	} else {",
		"		out({ result: { process_info: { pane_id: pane, foreground_processes: [{ name: 'zsh', pid: 4242, argv: ['zsh'] }] } } });",
		"	}",
		"} else if (cmd.startsWith('pane neighbor')) {",
		"	out({ result: { neighbor: { neighbor_pane_id: 'w1:p2' } } });",
		"}",
		"process.exit(0);",
	].join("\n"), "utf-8");
	chmodSync(join(binDir, "herdr"), 0o755);

	const listener = spawn(join(binDir, "nvim"), ["--listen", join(stateDir, "listener.sock")], {
		stdio: "ignore",
	});
	const waitForListen = (pid, budgetMs = 3000) => {
		const deadline = Date.now() + budgetMs;
		for (;;) {
			try {
				if (readFileSync(`/proc/${pid}/cmdline`, "utf-8").includes("--listen")) return true;
			} catch {}
			if (Date.now() >= deadline) return false;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	};
	const savedHarnessTmpdir = process.env.TMPDIR;
	const savedHarnessXdg = process.env.XDG_RUNTIME_DIR;
	try {
		process.env.PATH = `${binDir}:${originalPath}`;
		process.env.TMPDIR = harnessTmp;
		process.env.XDG_RUNTIME_DIR = runDir;
		process.env.FAKE_HERDR_STATE = stateDir;
		process.env.FAKE_NVIM_STATE = stateDir;
		assert.ok(waitForListen(listener.pid), "the fake nvim listener must expose --listen");
		writeFileSync(join(stateDir, "editor-pid"), String(listener.pid));

		const shown = showNodeBuffer("session-abc", "Node A", "Node A", "body");
		assert.equal(shown.ok, true, shown.message);
		assert.ok(shown.message.includes('node "Node A" buffer "Node A" updated'), shown.message);

		const overviewShown = showOverviewBuffer("session-abc", "Arc overview", "nodes and verdicts");
		assert.equal(overviewShown.ok, true, overviewShown.message);
		assert.ok(overviewShown.message.includes('overview buffer "Arc overview" updated'), overviewShown.message);

		// Pure focus on a never-shown buffer reports it missing — the caller
		// falls back to the overview, and an empty buffer is never created.
		const missing = focusNodeBuffer("session-abc", "Node A");
		assert.equal(missing.ok, false);
		assert.ok(missing.message.includes('no node "Node A" buffer yet'), missing.message);

		// An RPC failure (nvim exits nonzero) surfaces as a failed update,
		// never as a throw into the conversation.
		writeFileSync(join(stateDir, "nvim-fail"), "1");
		const rpcFailed = showNodeBuffer("session-abc", "Node B", "Node B", "body");
		assert.equal(rpcFailed.ok, false);
		assert.ok(rpcFailed.message.includes("buffer update failed"), rpcFailed.message);
		rmSync(join(stateDir, "nvim-fail"), { force: true });

		// With a live editor pane the readiness poll succeeds at once.
		assert.equal(await ensureEditorReady(1000), true);
	} finally {
		listener.kill();
		process.env.PATH = originalPath;
		if (savedHarnessTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = savedHarnessTmpdir;
		if (savedHarnessXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = savedHarnessXdg;
		delete process.env.FAKE_HERDR_STATE;
		delete process.env.FAKE_NVIM_STATE;
	}
} else {
	console.log("skip live fake-editor scenarios (no /proc)");
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("focus-buffer tests passed");
