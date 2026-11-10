// ask_user_question — the Ctrl+P escape hatch.
//
// Offline: the TUI boundary (`ctx.ui.custom`) is a fake that builds the real
// component, presses one key, and returns what `done` got. The theme is a
// pass-through, so render() output can be asserted as plain text. Stubbed pi
// packages keep the module loadable without the managed install.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

const root = mkdtempSync(join(tmpdir(), "ask-user-question-test-"));
try {
	writeFileSync(join(root, "agent.cjs"), "exports.registerTool = () => {};\n");
	writeFileSync(
		join(root, "tui.cjs"),
		`class Editor {
	constructor() { this.focused = false; this.text = ""; this.onSubmit = () => {}; this.disableSubmit = false; }
	handleInput() {}
	setText(v) { this.text = v; }
	getText() { return this.text; }
	invalidate() {}
	render() { return [this.text]; }
}
class Text { constructor(text) { this.text = text; } }
const Key = {
	up: "up", down: "down", enter: "enter", escape: "escape", space: "space",
	ctrl: (name) => "ctrl+" + name,
};
exports.Editor = Editor;
exports.Text = Text;
exports.Key = Key;
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => (text.length <= width ? text : text.slice(0, Math.max(0, width - 1)));
exports.visibleWidth = (text) => text.length;
exports.wrapTextWithAnsi = (text) => [text];
`,
	);
	writeFileSync(join(root, "typebox.cjs"), "exports.Type = new Proxy({}, { get: () => () => ({}) });\n");

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": join(root, "agent.cjs"),
			"@earendil-works/pi-tui": join(root, "tui.cjs"),
			typebox: join(root, "typebox.cjs"),
		},
	});

	const extension = jiti("./ask-user-question.ts").default;
	// fg(color, text) and bold(text) both return the last argument, so the
	// rendered frame can be asserted as plain text.
	const theme = new Proxy({}, { get: () => (...args) => args[args.length - 1] ?? "" });

	let registered;
	extension({ registerTool(def) { registered = def; } });
	assert.equal(registered.name, "ask_user_question", "the tool keeps its name");

	// A fake panel: build the real component, press one key, capture render().
	function press(keys, extra = {}) {
		let component;
		let result;
		const ctx = {
			hasUI: true,
			ui: {
				custom(factory) {
					const done = (value) => {
						result = value;
					};
					component = factory({ requestRender() {} }, theme, {}, done);
					for (const key of keys) {
						component.handleInput(key);
					}
					return Promise.resolve(result);
				},
			},
		};
		return {
			run: registered.execute("t", extra.params, undefined, undefined, ctx),
			screen: () => (component ? component.render(100).join("\n") : ""),
		};
	}

	const run = (params, keys) => press(keys, { params });

	// --- the escape hatch in each mode ---
	{
		const { run: call, screen } = run(
			{ question: "Which cache should the importer use?" },
			["ctrl+p"],
		);
		const outcome = await call;
		assert.equal(outcome.details.status, "explain", "Ctrl+P returns the explain status");
		assert.equal(outcome.details.mode, "text", "text mode keeps its mode");
		assert.equal(outcome.details.answers[0].type, "explain", "the marker is the only answer");
		assert.match(outcome.content[0].text, /explain this question/i);
		assert.match(outcome.content[0].text, /`simple` skill/, "the agent is told which skill to use");
		assert.match(outcome.content[0].text, /wait for the user to confirm/i, "it must wait for confirmation");
		assert.match(screen(), /Ctrl\+P explain/, "text mode advertises the shortcut");
	}

	{
		const { run: call, screen } = run(
			{
				question: "Which cache?",
				options: [{ label: "Write-through" }, { label: "Write-back" }],
			},
			["ctrl+p"],
		);
		const outcome = await call;
		assert.equal(outcome.details.status, "explain", "single-select returns the explain status");
		assert.equal(outcome.details.mode, "single-select");
		assert.match(screen(), /Ctrl\+P explain/, "single-select advertises the shortcut");
	}

	{
		const { run: call, screen } = run(
			{
				question: "Which caches?",
				multiSelect: true,
				options: [{ label: "Disk" }, { label: "Memory" }],
			},
			["ctrl+p"],
		);
		const outcome = await call;
		assert.equal(outcome.details.status, "explain", "multi-select returns the explain status");
		assert.equal(outcome.details.mode, "multi-select");
		assert.match(screen(), /Ctrl\+P explain/, "multi-select advertises the shortcut");
	}

	// --- regression: an ordinary answer is still an answer ---
	{
		const { run: call } = run(
			{ question: "Which cache?", options: [{ label: "Write-through" }, { label: "Write-back" }] },
			["down", "enter"],
		);
		const outcome = await call;
		assert.equal(outcome.details.status, "answered", "Enter still answers");
		assert.equal(outcome.details.answers[0].label, "Write-back", "the highlighted option is returned");
	}

	// --- regression: Escape still cancels ---
	{
		const { run: call } = run({ question: "Which cache?" }, ["escape"]);
		const outcome = await call;
		assert.equal(outcome.details.status, "cancelled", "Escape still cancels");
	}

	console.log("ask_user_question explain shortcut: ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
