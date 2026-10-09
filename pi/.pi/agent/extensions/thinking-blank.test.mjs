import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "thinking-blank-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
writeFileSync(stubAgent, "exports.defineTool = (tool) => tool;\n");

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
	},
});

const { default: registerBlank, HIDDEN_THINKING_LABEL } = jiti("./thinking-blank.ts");

// The label must be the empty string exactly: an empty string survives the
// `label ?? default` reset inside setHiddenThinkingLabel, so the hidden row
// renders no text at all. Null or undefined would fall back to "Thinking...".
assert.equal(HIDDEN_THINKING_LABEL, "");

const handlers = {};
const ui = {
	setHiddenThinkingLabel(label) {
		this.label = label;
	},
	label: undefined,
};
registerBlank({
	on(event, handler) {
		handlers[event] = handler;
	},
});

// Registration must hook session_start, which fires for startup, reload,
// new, resume, and fork — every path that renders chat history.
assert.equal(typeof handlers.session_start, "function");

// The headless runner stubs setHiddenThinkingLabel as a no-op, so calling
// unconditionally is safe in every mode.
handlers.session_start({ type: "session_start", reason: "startup" }, { ui });
assert.equal(ui.label, "");

rmSync(tempRoot, { recursive: true, force: true });
console.log("thinking-blank tests passed");
