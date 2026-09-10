import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Allow CI to supply its own jiti via JITI_PATH; fall back to the host pi install.
const _jitiCjs = process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const {
	createJiti,
} = require(_jitiCjs);
const jiti = createJiti(import.meta.url);
const {
	joinHints,
	NAVIGATION_HINT,
	numberShortcutHint,
	numberShortcutIndex,
} = jiti("./option-shortcuts.ts");

assert.equal(NAVIGATION_HINT, "↑↓/jk navigate");

assert.equal(numberShortcutIndex("1", 3), 0);
assert.equal(numberShortcutIndex("3", 3), 2);
assert.equal(numberShortcutIndex("\u001b[50u", 3), 1); // Kitty keyboard protocol: 2
assert.equal(numberShortcutIndex("\u001b[50;1u", 3), 1);
assert.equal(numberShortcutIndex("\u001b[50;2u", 3), undefined); // Shift+2 is not answer 2
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
assert.equal(joinHints(NAVIGATION_HINT, undefined, "Enter select"), "↑↓/jk navigate • Enter select");

console.log("option shortcut tests passed");
