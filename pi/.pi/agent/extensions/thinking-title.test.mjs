// Paths: pi/.pi/agent/extensions/thinking-title.ts
// Thinking rows: spinner while streaming, a title once closed. This suite
// pins the render rules (passthrough, spinner, short-block-as-title,
// heuristic fallback, escape), the closure detection that fires nested
// title calls (closed runs only, never short ones, deduped, not awaited
// inside handlers), the title cleanup, and the /thinking toggle. The
// live-PTY contract lives in scripts/test-pi-hidden-thinking-render.py.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
const { createJiti } = require(jitiPath);

// thinking-title.ts only type-imports the package, so an empty stub works.
const tempRoot = mkdtempSync(join(tmpdir(), "thinking-title-test-"));
writeFileSync(join(tempRoot, "pi-coding-agent.cjs"), "module.exports = {};\n");
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": join(tempRoot, "pi-coding-agent.cjs") },
});
const mod = jiti("./thinking-title.ts");
const {
	wordCount,
	collapseWhitespace,
	capWords,
	firstSentence,
	heuristicTitle,
	cleanModelTitle,
	escapeTitle,
	hashText,
} = mod;

// ── pure helpers ─────────────────────────────────────────────────────────────

assert.equal(wordCount("  one two   three "), 3);
assert.equal(wordCount(""), 0);
assert.equal(collapseWhitespace(" a\n\n b \t c "), "a b c");
assert.equal(capWords("a b c d", 3), "a b c");
assert.equal(capWords("a b", 3), "a b");
assert.equal(firstSentence("First sentence. Second sentence."), "First sentence");
assert.equal(firstSentence("No terminator at all"), "No terminator at all");
assert.equal(firstSentence("Wait... really?! Yes."), "Wait"); // ellipsis ends the first sentence
assert.equal(
	heuristicTitle("Checking the result before running the second command. Then more text follows here."),
	"Checking the result before running the second command",
);
assert.equal(
	heuristicTitle("word ".repeat(40).trim()), // 40-word unterminated blob
	"word ".repeat(14).trim() + " word", // capped at 15 words
);
assert.equal(cleanModelTitle('  "Fix the anchor parser bug in bundle chunks."  '), "Fix the anchor parser bug in bundle chunks");
assert.equal(cleanModelTitle("## A markdown heading title\n\n"), "A markdown heading title");
assert.equal(cleanModelTitle("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen"), "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen");
assert.equal(cleanModelTitle(""), "");
assert.equal(escapeTitle("a * b _ c [d] ~ # e ` f \\ g"), "a \\* b \\_ c \\[d\\] \\~ \\# e \\` f \\\\ g");
assert.notEqual(hashText("alpha"), hashText("beta"));
assert.equal(hashText("alpha"), hashText(" alpha\n\n"));

// ── transformer rules ────────────────────────────────────────────────────────

const registrations = { transformers: [], commands: new Map(), handlers: new Map() };
const pi = {
	on: (event, handler) => registrations.handlers.set(event, handler),
	registerMarkdownTransformer: (transformer) => registrations.transformers.push(transformer),
	registerCommand: (name, def) => registrations.commands.set(name, def),
};
mod.default(pi);
assert.equal(registrations.transformers.length, 1, "one markdown transformer registered");
assert.ok(registrations.handlers.has("session_start"));
assert.ok(registrations.handlers.has("message_update"));
assert.ok(registrations.handlers.has("message_end"));
assert.ok(registrations.commands.has("titles"), "command must be /titles: /thinking is built-in");
const transformer = registrations.transformers[0];
const ctx = (messageType, isStreaming = false) => ({ messageType, isStreaming, availableWidth: 80 });

// Non-thinking markdown passes through untouched.
const userText = "# Heading\n\nbody";
assert.equal(transformer(userText, ctx("user")), userText);
assert.equal(transformer(userText, ctx("assistant")), userText);

// Streaming, no title yet: a single spinner line.
const spinner = transformer("Anything at all while streaming", ctx("assistant-thinking", true));
assert.match(spinner, /^[\u2800-\u28FF] thinking$/);
assert.equal(transformer("", ctx("assistant-thinking", true)), "");

// Spinner frame advances with time.
const realNow = Date.now;
try {
	Date.now = () => 0;
	const first = transformer("long enough text here", ctx("assistant-thinking", true));
	Date.now = () => 250;
	const second = transformer("long enough text here", ctx("assistant-thinking", true));
	assert.notEqual(first, second, "spinner frame must advance between renders");
	assert.match(second, /^[\u2800-\u28FF] thinking$/);
} finally {
	Date.now = realNow;
}

// Closed short block (codex style): the text itself, one line.
assert.equal(
	transformer("Planning\n  the first command.", ctx("assistant-thinking")),
	"Planning the first command.",
);

// Closed long block, title call pending: heuristic at once.
const longThinking =
	"Checking the first result carefully before deciding whether the second command is necessary. " +
	"After that I will run the second command and verify the output.";
assert.equal(
	transformer(longThinking, ctx("assistant-thinking")),
	"Checking the first result carefully before deciding whether the second command is necessary",
);

// ── nested title calls ───────────────────────────────────────────────────────

const calls = { complete: 0 };
const ui = { setHiddenThinkingLabel: () => {}, notify: () => {} };
const modelRegistry = {
	find: (provider, id) => (provider === "fireworks" && id === "deepseek-v4-flash-0731" ? { id } : undefined),
	complete: async () => {
		calls.complete += 1;
		return { content: [{ type: "text", text: '  "Patch the bundle anchors and rerun"  ' }] };
	},
};
const extCtx = () => ({ ui, modelRegistry });
const tick = () => new Promise((resolve) => setTimeout(resolve, 120)); // repaint coalesce is 50 ms

// Open run (nothing after it, message not final): no call yet.
registrations.handlers.get("message_update")(
	{ message: { role: "assistant", content: [{ type: "thinking", thinking: longThinking }] } },
	extCtx(),
);
assert.equal(calls.complete, 0, "an open thinking run must not fire a title call");

// Closed run (tool call follows): call fires, transformer upgrades to the model title.
registrations.handlers.get("message_update")(
	{
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: longThinking },
				{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
			],
		},
	},
	extCtx(),
);
assert.equal(calls.complete, 1, "a closed thinking run fires exactly one title call");
await tick();
assert.equal(
	transformer(longThinking, ctx("assistant-thinking")),
	"Patch the bundle anchors and rerun",
	"the model title replaces the heuristic once the call lands",
);
// The same closed run again (message_end): deduped by cache.
registrations.handlers.get("message_end")(
	{
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: longThinking },
				{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
			],
		},
	},
	extCtx(),
);
assert.equal(calls.complete, 1, "a cached title must not refire the call");

// Short blocks never call the model.
calls.complete = 0;
registrations.handlers.get("message_end")(
	{ message: { role: "assistant", content: [{ type: "thinking", thinking: "Planning the first command." }] } },
	extCtx(),
);
assert.equal(calls.complete, 0, "short blocks are their own titles; no model call");

// Non-assistant messages are ignored.
registrations.handlers.get("message_end")({ message: { role: "user", content: [{ type: "text", text: longThinking }] } }, extCtx());
registrations.handlers.get("message_update")({ message: { role: "toolResult", content: [] } }, extCtx());
assert.equal(calls.complete, 0);

// Model failure keeps the heuristic; no unhandled rejection.
modelRegistry.complete = async () => {
	throw new Error("provider down");
};
const otherThinking = "Deciding between two very different implementation strategies for the renderer rewrite. " +
	"The first option is simpler but slower, the second is more work.";
registrations.handlers.get("message_end")(
	{ message: { role: "assistant", content: [{ type: "thinking", thinking: otherThinking }] } },
	extCtx(),
);
await tick();
assert.equal(
	transformer(otherThinking, ctx("assistant-thinking")),
	"Deciding between two very different implementation strategies for the renderer rewrite",
	"a failed title call keeps the heuristic",
);

// Missing title model: heuristic stays, no call.
modelRegistry.find = () => undefined;
const thirdThinking = "Working through the failure modes of the nested model call path step by step. " +
	"Each failure needs a deterministic fallback.";
registrations.handlers.get("message_end")(
	{ message: { role: "assistant", content: [{ type: "thinking", thinking: thirdThinking }] } },
	extCtx(),
);
assert.equal(
	transformer(thirdThinking, ctx("assistant-thinking")),
	"Working through the failure modes of the nested model call path step by step",
);

// ── /thinking toggle ─────────────────────────────────────────────────────────

await registrations.commands.get("titles").handler("", { ui, modelRegistry });
assert.equal(transformer(longThinking, ctx("assistant-thinking")), longThinking, "toggled on shows full text");
await registrations.commands.get("titles").handler("", { ui, modelRegistry });
assert.equal(
	transformer(longThinking, ctx("assistant-thinking")),
	"Patch the bundle anchors and rerun",
	"toggled off returns to the title",
);

rmSync(tempRoot, { recursive: true, force: true });
console.log("thinking-title tests passed");
