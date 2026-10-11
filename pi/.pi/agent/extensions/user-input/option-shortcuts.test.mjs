import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { HOMEBREW_JITI, resolveJiti } from "../test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
const { createJiti } = require(jitiPath);
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
assert.equal(numberShortcutIndex("\u001b[50;65u", 3), 1);
assert.equal(numberShortcutIndex("\u001b[50;129u", 3), 1);
assert.equal(numberShortcutIndex("\u001b[50;193u", 3), 1);
assert.equal(numberShortcutIndex("\u001b[57401u", 3), 1);
assert.equal(numberShortcutIndex("\u001b[57401;129u", 3), 1);
assert.equal(numberShortcutIndex("\u001b[50;2u", 3), undefined); // Shift+2 is not answer 2
assert.equal(numberShortcutIndex("\u001b[50;66u", 3), undefined);
assert.equal(numberShortcutIndex("\u001b[50;67u", 3), undefined);
assert.equal(numberShortcutIndex("\u001b[50;69u", 3), undefined);
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
