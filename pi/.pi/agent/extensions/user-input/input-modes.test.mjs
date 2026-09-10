import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jitiPath =
	process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const { INPUT_MODES, nextInputMode, inputModeLabel } = jiti("./input-modes.ts");

assert.equal(nextInputMode("answer"), "steering");
assert.equal(nextInputMode("steering"), "answer");
assert.deepEqual(INPUT_MODES, ["answer", "steering"]);

// Unknown state recovers to the initial answer mode.
assert.equal(nextInputMode("garbage"), "answer");
assert.equal(inputModeLabel("answer"), "Answer");
assert.equal(inputModeLabel("steering"), "Steering");

console.log("quiz input-mode cycling tests passed");
