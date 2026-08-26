import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Allow CI to supply its own jiti via JITI_PATH; fall back to the host pi install.
const _jitiCjs = process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const {
	createJiti,
} = require(_jitiCjs);
const jiti = createJiti(import.meta.url);
const { joinHints, numberShortcutHint, numberShortcutIndex } = jiti("./option-shortcuts.ts");

assert.equal(numberShortcutIndex("1", 3), 0);
assert.equal(numberShortcutIndex("3", 3), 2);
assert.equal(numberShortcutIndex("9", 12), 8);
assert.equal(numberShortcutIndex("0", 12), undefined);
assert.equal(numberShortcutIndex("a", 12), undefined);
assert.equal(numberShortcutIndex("2", 1), undefined);
assert.equal(numberShortcutIndex("9", 8), undefined);
assert.equal(numberShortcutIndex("10", 12), undefined);

assert.equal(numberShortcutHint(0, "select"), undefined);
assert.equal(numberShortcutHint(1, "select"), "1 select");
assert.equal(numberShortcutHint(3, "toggle"), "1-3 toggle");
assert.equal(numberShortcutHint(12, "select"), "1-9 select first nine");
assert.equal(joinHints("↑↓ navigate", undefined, "Enter select"), "↑↓ navigate • Enter select");

console.log("option shortcut tests passed");
