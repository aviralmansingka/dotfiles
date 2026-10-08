import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);

// Peer stubs (house pattern). focus-buffer imports nvim-open, which imports
// defineTool and Type — stub those. The herdr/nvim IO paths are intentionally
// NOT exercised here (same policy as hunk-open / lesson tests).
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
const { editorSocketPath, showNodeBuffer } = jiti("./focus-buffer.ts");

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
const disabled = showNodeBuffer("session-abc", "Node A", "body");
assert.equal(disabled.ok, false);
assert.ok(disabled.message.includes("disabled"));
delete process.env.PI_DISABLE_FOCUS_BUFFER;

// Without the guard, the very first step is editor detection; with herdr
// unavailable on PATH this fails cleanly rather than throwing. (On a machine
// WITH herdr the call is safe: it only lists panes and would proceed to the
// buffer update — which is the production behavior under test elsewhere.)
process.env.PATH = "/nonexistent";
const noEditor = showNodeBuffer("session-abc", "Node A", "body");
assert.equal(noEditor.ok, false);
assert.ok(noEditor.message.length > 0);
process.env.PATH = originalPath;

rmSync(tempRoot, { recursive: true, force: true });
console.log("focus-buffer tests passed");
