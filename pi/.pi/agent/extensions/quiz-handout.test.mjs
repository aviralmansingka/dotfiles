import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Allow CI to supply its own jiti via JITI_PATH; fall back to the host pi install.
const _jitiCjs =
	process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(_jitiCjs);
const jiti = createJiti(import.meta.url);
const { contextFileHint, handoutHint, normalizeContextFiles } = jiti("./user-input/context-files.ts");
const { handoutModelOptions } = jiti("./quiz-handout.ts");
// `joinHints` is how the steering hint row assembles the per-shortcut hints;
// importing it lets us assert the `h` hint actually lands in the rendered row.
const { joinHints } = jiti("./user-input/option-shortcuts.ts");

// The `h` handout shortcut is unconditional: it always works because the
// handout is generated from the quiz's own content, not from contextFiles.
assert.equal(typeof handoutHint(), "string");
assert.equal(handoutHint(), "h handout");
// Calling it twice yields the same stable string (no hidden state).
assert.equal(handoutHint(), handoutHint());

// It composes into the steering hint row the way the `o` context-file hint
// does — present whether or not contextFiles are supplied.
const rowWithoutContext = joinHints("Mode: steering", "↑↓ navigate", "Enter answer", contextFileHint([]), handoutHint(), "Tab → note", "Esc cancel");
assert.ok(rowWithoutContext.includes("h handout"), `steering hint should include h handout even without contextFiles: ${rowWithoutContext}`);
assert.ok(!rowWithoutContext.includes("o open"), `steering hint should NOT show the o hint when contextFiles are empty: ${rowWithoutContext}`);

const rowWithContext = joinHints("Mode: steering", "↑↓ navigate", "Enter answer", contextFileHint(["bench_core.py"]), handoutHint(), "Tab → note", "Esc cancel");
assert.ok(rowWithContext.includes("o open context file"), `steering hint should still show the o hint when contextFiles are present: ${rowWithContext}`);
assert.ok(rowWithContext.includes("h handout"), `steering hint should show BOTH o and h hints when contextFiles are present: ${rowWithContext}`);

// Re-assert the existing context-file contract is unchanged by the new helper.
assert.equal(contextFileHint([]), undefined);
assert.equal(contextFileHint(["bench_core.py"]), "o open context file");
assert.deepEqual(normalizeContextFiles(undefined), []);

// Do not cap handout output: reasoning and answer text can share the provider's budget.
const signal = new AbortController().signal;
const modelOptions = handoutModelOptions(signal);
assert.equal(modelOptions.signal, signal);
assert.equal(modelOptions.reasoningEffort, "low");
assert.ok(!Object.hasOwn(modelOptions, "maxTokens"));

console.log("quiz handout shortcut hint smoke passed");
