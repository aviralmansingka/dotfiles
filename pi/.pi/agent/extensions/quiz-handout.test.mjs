import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

// Exercise the registered quiz tool: render the panel, press h, complete the
// model fork, persist Markdown, and send that exact file to an existing editor.
const tempRoot = mkdtempSync(join(tmpdir(), "quiz-handout-test-"));
const handoutPath = process.env.PI_QUIZ_HANDOUT_PATH || join(tempRoot, "quiz-handout.md");
const openLogPath = process.env.PI_QUIZ_HANDOUT_OPEN_LOG || join(tempRoot, "editor-open.log");
const oldEnv = {
	PATH: process.env.PATH,
	PI_QUIZ_HANDOUT_MODEL: process.env.PI_QUIZ_HANDOUT_MODEL,
	PI_QUIZ_HANDOUT_PATH: process.env.PI_QUIZ_HANDOUT_PATH,
	HANDOUT_OPEN_LOG: process.env.HANDOUT_OPEN_LOG,
};

try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTypes = join(tempRoot, "types.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	writeFileSync(stubAgent, "exports.defineTool = value => value;\n");
	writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
	writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; }
	getText() { return this.text; }
	handleInput(data) { this.text += data; }
	render() { return [this.text]; }
	invalidate() {}
}
exports.Editor = Editor;
exports.Key = { enter: "\\r", escape: "\\x1b", tab: "\\t", up: "up", down: "down", space: " " };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
exports.wrapTextWithAnsi = text => [text];
`);
	const quizJiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-ai": stubTypes,
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			typebox: stubTypes,
		},
	});

	const fakeBin = join(tempRoot, "bin");
	mkdirSync(fakeBin);
	const fakeHerdr = join(fakeBin, "herdr");
	writeFileSync(fakeHerdr, `#!/bin/sh
if [ "$1 $2" = "pane current" ]; then
	printf '%s\\n' '{"result":{"pane":{"pane_id":"p-current","tab_id":"tab-1","cwd":"/tmp","workspace_id":"ws-1"}}}'
elif [ "$1 $2" = "pane list" ]; then
	printf '%s\\n' '{"result":{"panes":[{"pane_id":"p-current","tab_id":"tab-1","cwd":"/tmp","workspace_id":"ws-1"},{"pane_id":"p-editor","tab_id":"tab-1","cwd":"/tmp","workspace_id":"ws-1"}]}}'
elif [ "$1 $2" = "pane process-info" ] && [ "$4" = "p-editor" ]; then
	printf '%s\\n' '{"result":{"process_info":{"pane_id":"p-editor","foreground_processes":[{"name":"vim","pid":42,"argv":["vim"]}]}}}'
elif [ "$1 $2" = "pane process-info" ]; then
	printf '%s\\n' '{"result":{"process_info":{"pane_id":"p-current","foreground_processes":[{"name":"zsh","pid":41,"argv":["zsh"]}]}}}'
elif [ "$1 $2" = "pane send-text" ]; then
	printf '%s\\n' "$@" >> "$HANDOUT_OPEN_LOG"
elif [ "$1 $2" = "pane neighbor" ]; then
	printf '%s\\n' '{"result":{"neighbor":{"pane_id":"p-editor"}}}'
fi
`);
	chmodSync(fakeHerdr, 0o755);
	process.env.PATH = `${fakeBin}:${oldEnv.PATH}`;
	delete process.env.PI_QUIZ_HANDOUT_MODEL;
	process.env.PI_QUIZ_HANDOUT_PATH = handoutPath;
	process.env.HANDOUT_OPEN_LOG = openLogPath;

	const { default: registerQuiz } = quizJiti("./quiz.ts");
	let quizTool;
	registerQuiz({ registerTool(tool) { quizTool = tool; } });
	assert.equal(quizTool?.name, "quiz");

	const generatedMarkdown = `# Why Sets Ignore Order

A set is compared by membership, not insertion order.

## Takeaway

Equal members make equal sets.`;
	const calls = [];
	const notifications = [];
	let renderedPanel = "";
	let component;
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		modelRegistry: {
			find(provider, id) {
				return provider === "fireworks" && id === "accounts/fireworks/routers/glm-5p2-fast"
					? { provider, id }
					: undefined;
			},
			hasConfiguredAuth: () => true,
			async complete(model, prompt, options) {
				calls.push({ model, prompt, options });
				return { content: [{ type: "text", text: generatedMarkdown }] };
			},
		},
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
				if (message.startsWith("handout generated")) queueMicrotask(() => component.handleInput("\u001b"));
			},
			custom(factory) {
				return new Promise((done) => {
					const theme = { fg: (_color, text) => text, bold: (text) => text };
					component = factory({ requestRender() {} }, theme, {}, done);
					renderedPanel = component.render(100).join("\n");
					component.handleInput("h");
				});
			},
		},
	};
	const signal = new AbortController().signal;
	const result = await quizTool.execute("handout-e2e", {
		question: "When are two sets equal?",
		options: [
			{ label: "Same members", value: "members" },
			{ label: "Same insertion order", value: "order" },
		],
		correctAnswer: "members",
		explanation: "Set equality compares membership.",
		shuffle: false,
	}, signal, undefined, ctx);

	assert.match(renderedPanel, /h handout/);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].model, {
		provider: "fireworks",
		id: "accounts/fireworks/routers/glm-5p2-fast",
	});
	assert.equal(calls[0].options.signal, signal);
	assert.equal(calls[0].options.reasoningEffort, "low");
	assert.ok(!Object.hasOwn(calls[0].options, "maxTokens"));
	assert.equal(readFileSync(handoutPath, "utf8"), generatedMarkdown);
	const openLog = readFileSync(openLogPath, "utf8");
	assert.match(openLog, /pane\nsend-text\np-editor\n/);
	assert.ok(openLog.includes(handoutPath));
	assert.equal(notifications[0].message, "Generating handout…");
	assert.match(notifications.at(-1).message, /^handout generated and opened in vim/);
	assert.equal(result.details.status, "cancelled", "the quiz should remain active and ungraded after h");
} finally {
	process.env.PATH = oldEnv.PATH;
	if (oldEnv.PI_QUIZ_HANDOUT_MODEL === undefined) delete process.env.PI_QUIZ_HANDOUT_MODEL;
	else process.env.PI_QUIZ_HANDOUT_MODEL = oldEnv.PI_QUIZ_HANDOUT_MODEL;
	if (oldEnv.PI_QUIZ_HANDOUT_PATH === undefined) delete process.env.PI_QUIZ_HANDOUT_PATH;
	else process.env.PI_QUIZ_HANDOUT_PATH = oldEnv.PI_QUIZ_HANDOUT_PATH;
	if (oldEnv.HANDOUT_OPEN_LOG === undefined) delete process.env.HANDOUT_OPEN_LOG;
	else process.env.HANDOUT_OPEN_LOG = oldEnv.HANDOUT_OPEN_LOG;
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("quiz handout end-to-end regression passed");
