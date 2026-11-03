import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { HOMEBREW_JITI, resolveJiti } from "../test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const {
	INPUT_MODES,
	nextInputMode,
	inputModeLabel,
	inputModeHint,
	isInputBoxMode,
} = jiti("./input-modes.ts");

// Tab cycles answer → steering → note → follow-up → answer.
assert.deepEqual(INPUT_MODES, ["answer", "steering", "note", "follow-up"]);
assert.equal(nextInputMode("answer"), "steering");
assert.equal(nextInputMode("steering"), "note");
assert.equal(nextInputMode("note"), "follow-up");
assert.equal(nextInputMode("follow-up"), "answer");

// Unknown state recovers to the initial answer mode.
assert.equal(nextInputMode("garbage"), "answer");

// Every mode has a visible label so the active mode is always rendered.
for (const mode of INPUT_MODES) {
	assert.ok(inputModeLabel(mode).length > 0, `label for ${mode}`);
}
assert.equal(inputModeLabel("steering"), "Steering");
assert.equal(inputModeLabel("note"), "Note");
assert.equal(inputModeLabel("follow-up"), "Follow-up");

// The input box owns the keyboard in every mode except answer.
assert.equal(isInputBoxMode("answer"), false);
assert.equal(isInputBoxMode("steering"), true);
assert.equal(isInputBoxMode("note"), true);
assert.equal(isInputBoxMode("follow-up"), true);

// The steering hint promises the quiz stays open — the send never closes it
// silently.
assert.ok(inputModeHint("steering").includes("quiz stays open"));

// The steering hint only advertises `o` when the quiz has context files to
// open; without them `o` is literal text, so the hint must not promise it.
assert.ok(inputModeHint("steering", true).includes("o open files"));
assert.ok(!inputModeHint("steering", false).includes("o open files"));
assert.ok(!inputModeHint("steering").includes("o open files"));

// Every input-box mode's hint names what Enter and Tab do next.
for (const mode of ["steering", "note", "follow-up"]) {
	assert.ok(inputModeHint(mode).includes("Enter"), `hint for ${mode} names Enter`);
	assert.ok(inputModeHint(mode).includes("Tab"), `hint for ${mode} names Tab`);
}

console.log("quiz input-mode cycling tests passed");
