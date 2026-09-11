import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// Allow CI to supply its own jiti via JITI_PATH; fall back to the host pi install.
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.85.0/node_modules/.mise/jiti@2.7.0/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "btw-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubAi = join(tempRoot, "pi-ai.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubAgent, "exports.defineTool = (def) => def;\n");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTui, `
exports.Key = { enter: "\\r", escape: "\\x1b" };
exports.Loader = class Loader {
	constructor(tui, accent, muted, label) { this.label = label; }
	start() {}
	stop() {}
	render(width) { return [this.label]; }
};
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => String(text).slice(0, width);
exports.visibleWidth = (text) => String(text).length;
exports.wrapTextWithAnsi = (text) => [text];
`);
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
		"@earendil-works/pi-ai": stubAi,
		typebox: stubTypes,
	},
});

const { default: registerBtw, ANSWER_SYSTEM_PROMPT, buildContextDigest, buildQuestionPrompt } = jiti("./btw.ts");

// ─── buildContextDigest ─────────────────────────────────────────────────────

const digestEntries = [
	{ message: { role: "user", content: "Fix the login bug in auth.ts", timestamp: 1 } },
	{ message: { role: "assistant", content: [{ type: "thinking", thinking: "(private)" }, { type: "text", text: "Patched the token check." }], timestamp: 2 } },
	{ message: { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "noisy tool output" }] } },
	{ message: { role: "user", content: "Run the tests now", timestamp: 3 } },
];

const fullDigest = buildContextDigest(digestEntries);
assert.match(fullDigest, /^user: Fix the login bug/);
assert.ok(fullDigest.includes("assistant: Patched the token check."), "assistant text must survive");
assert.ok(fullDigest.includes("Run the tests now"), "newest user message must survive");
assert.ok(!fullDigest.includes("noisy tool output"), "tool results must be omitted");
assert.ok(!fullDigest.includes("(private)"), "thinking blocks must be omitted");

// Budget: a tiny budget keeps only the tail message.
const tinyDigest = buildContextDigest(digestEntries, 40);
assert.match(tinyDigest, /^user: Run the tests now$/);

// Degenerate: a single oversized message yields its clipped head, not "".
const single = buildContextDigest([{ message: { role: "user", content: "x".repeat(500) } }], 100);
assert.equal(single.length, 100);
assert.match(single, /^user: x+$/);

// Per-message clip keeps one wall of text from crowding out later context.
const clipped = buildContextDigest([
	{ message: { role: "user", content: `${"x".repeat(3000)}END` } },
	{ message: { role: "assistant", content: "short reply" } },
]);
assert.ok(clipped.includes("…"));
assert.ok(!clipped.includes("END"), "oversized message must be clipped");

assert.equal(buildQuestionPrompt("Q?", ""), "Q?");
assert.ok(buildQuestionPrompt("Q?", "digest").includes("Q?"));
assert.ok(buildQuestionPrompt("Q?", "digest").includes("digest"));

// ─── command flow ────────────────────────────────────────────────────────────

let command;
registerBtw({
	registerCommand(name, options) {
		if (name === "btw") command = options;
	},
});
assert.equal(typeof command?.handler, "function");

function makeCtx({ requestCountToDismiss, dismissKey, completeImpl }) {
	const calls = [];
	let component;
	let renders = 0;
	// sessionManager proxy that throws on anything but the read we expect:
	// proves the handler never writes to the session (no context pollution).
	const sessionManager = new Proxy(
		{ buildContextEntries: () => digestEntries },
		{
			get(target, prop) {
				if (prop in target) return target[prop];
				throw new Error(`sessionManager.${String(prop)} must not be used (context pollution)`);
			},
		},
	);
	return {
		calls,
		ctx: {
			hasUI: true,
			mode: "tui",
			cwd: tempRoot,
			model: { provider: "anthropic", id: "claude-session-model" },
			modelRegistry: {
				async complete(model, prompt, options) {
					calls.push({ model, prompt, options });
					// Yield a macrotask so the panel factory (and its state.refresh
					// hook) is wired up before the fork resolves — matches real
					// provider latency.
					await new Promise((resolve) => setTimeout(resolve, 0));
					return completeImpl();
				},
			},
			sessionManager,
			ui: {
				custom(factory) {
					return new Promise((done) => {
						const tui = {
							requestRender() {
								renders++;
								if (renders === requestCountToDismiss) {
									queueMicrotask(() => component.handleInput(dismissKey));
								}
							},
						};
						const theme = { fg: (_color, text) => text, bold: (text) => text };
						component = factory(tui, theme, {}, done);
					});
				},
				notify() {},
			},
		},
		getComponent: () => component,
	};
}

const logFile = join(tempRoot, "btw.md");
process.env.PI_BTW_LOG_PATH = logFile;

// Happy path: answer arrives, panel dismissed with Enter, log written.
{
	const { ctx, calls, getComponent } = makeCtx({
		requestCountToDismiss: 1,
		dismissKey: "\r",
		completeImpl: () => ({ content: [{ type: "text", text: "Yes — concise answer." }] }),
	});
	await command.handler("Why did the patch work?", ctx);

	assert.equal(calls.length, 1, "exactly one fork model call");
	assert.deepEqual(calls[0].model, { provider: "anthropic", id: "claude-session-model" });
	assert.equal(calls[0].prompt.systemPrompt, ANSWER_SYSTEM_PROMPT);
	assert.match(ANSWER_SYSTEM_PROMPT, /Lead with the answer/);
	const userMessage = calls[0].prompt.messages[0];
	assert.equal(userMessage.role, "user");
	assert.match(userMessage.content, /Why did the patch work\?/);
	assert.match(userMessage.content, /Patched the token check\./, "digest grounds the fork");
	assert.ok(
		userMessage.content.indexOf("Fix the login bug") < userMessage.content.indexOf("Why did the patch"),
		"digest precedes the question",
	);
	assert.ok(calls[0].options.signal instanceof AbortSignal);
	assert.equal(calls[0].options.maxTokens, 900);
	assert.equal(calls[0].options.reasoningEffort, "low");

	// Panel rendered the answer in the merged frame.
	const lines = getComponent().render(100);
	assert.ok(lines.some((l) => l.includes("Yes — concise answer.")));
	assert.ok(lines.some((l) => l.includes("╭")));
	assert.ok(lines.some((l) => l.includes("› btw")));

	assert.ok(existsSync(logFile), "answer must be logged");
	const logged = readFileSync(logFile, "utf-8");
	assert.match(logged, /^## .* — Why did the patch work\?$/m);
	assert.match(logged, /Yes — concise answer\./);
}

// Abort path: Esc during thinking dismisses the panel and never logs.
{
	rmSync(logFile, { force: true });
	const { ctx, calls, getComponent } = makeCtx({
		requestCountToDismiss: 0,
		dismissKey: "",
		// Fork never settles: state stays "thinking" so Esc is an abort.
		completeImpl: () => new Promise(() => ({})),
	});
	const pending = command.handler("Abort me", ctx);
	await new Promise((resolve) => setTimeout(resolve, 0)); // let the factory wire up
	getComponent().handleInput("\x1b");
	await pending;
	assert.equal(calls.length, 1);
	assert.ok(!existsSync(logFile), "aborted btw must not be logged");
}

// Error path: model failure shows an error panel, no log.
{
	rmSync(logFile, { force: true });
	const { ctx, getComponent } = makeCtx({
		requestCountToDismiss: 1,
		dismissKey: "\r",
		completeImpl: () => {
			throw new Error("boom");
		},
	});
	await command.handler("Break please", ctx);
	const lines = getComponent().render(100);
	assert.ok(lines.some((l) => l.includes("btw failed — boom")));
	assert.ok(!existsSync(logFile), "failed btw must not be logged");
}

// No-args: usage notification, no model call.
{
	const { ctx, calls } = makeCtx({
		requestCountToDismiss: 1,
		dismissKey: "\r",
		completeImpl: () => ({ content: [{ type: "text", text: "unused" }] }),
	});
	await command.handler("   ", ctx);
	assert.equal(calls.length, 0, "empty question must not call the model");
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("btw extension tests passed");
