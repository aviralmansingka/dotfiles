import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	createJiti,
} = require("/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs");
const jiti = createJiti(import.meta.url);
const { INPUT_MODES, nextInputMode, inputModeLabel } = jiti("./input-modes.ts");

// Tab cycles steering -> note -> follow-up -> steering.
assert.equal(nextInputMode("steering"), "note");
assert.equal(nextInputMode("note"), "follow-up");
assert.equal(nextInputMode("follow-up"), "steering");

// The cycle covers exactly the three modes the captain asked for, in order.
assert.deepEqual(INPUT_MODES, ["steering", "note", "follow-up"]);

// An unknown mode falls back to the first (steering) instead of crashing.
assert.equal(nextInputMode("garbage"), "steering");

// Labels are stable and human-readable for the mode indicator.
assert.equal(inputModeLabel("steering"), "Steering");
assert.equal(inputModeLabel("note"), "Note");
assert.equal(inputModeLabel("follow-up"), "Follow-up");

console.log("quiz input-mode cycling tests passed");
