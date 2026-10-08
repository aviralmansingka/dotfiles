import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-ai": stubAi,
	},
});
const { editorSocketPath, showNodeBuffer } = jiti("./focus-buffer.ts");

// ── socket resolution (pure) ─────────────────────────────────────────────────

// A pid with no /proc entry and no default socket resolves to undefined.
assert.equal(editorSocketPath(999_999_999), undefined);

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
const realPath = process.env.PATH;
process.env.PATH = "/nonexistent";
const noEditor = showNodeBuffer("session-abc", "Node A", "body");
assert.equal(noEditor.ok, false);
assert.ok(noEditor.message.length > 0);
process.env.PATH = realPath;

rmSync(tempRoot, { recursive: true, force: true });
console.log("focus-buffer tests passed");
