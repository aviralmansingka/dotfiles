// Rounded bar footer: the prompt bubble's token-speed label grows a `⚡ `
// prefix while fast mode is on, driven by the shared fast-mode slot (not by a
// local flag — the extension loader gives every extension its own module
// instance). formatSpeedLabel is exported so the exact strings the border math
// measures with visibleWidth are testable without a TUI; the wiring cases then
// fake the footer/editor mount to prove the bolt follows the slot and that a
// mid-session toggle repaints through requestRender.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAST_MODE_SLOT, notifyFastModeChange, setFastModeEnabled } from "./fast-mode-slot.mjs";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

const root = mkdtempSync(join(tmpdir(), "rounded-bar-footer-test-"));
const savedFastMode = process.env.PI_FAST_MODE;
delete process.env.PI_FAST_MODE;

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text) => text.replace(ANSI, "");

try {
	const agentStub = join(root, "agent.cjs");
	const tuiStub = join(root, "tui.cjs");
	// The editor only needs a renderable base class; borderColor and paddingX
	// are pass-throughs so the wrapper's own border math is what gets measured.
	writeFileSync(
		agentStub,
		[
			"class CustomEditor {",
			"  constructor(tui) { this.tui = tui; }",
			"  render(width) { return ['─'.repeat(Math.max(0, width))]; }",
			"  borderColor(text) { return text; }",
			"  setPaddingX(value) { this.paddingX = value; }",
			"}",
			"module.exports = { CustomEditor };",
		].join("\n") + "\n",
	);
	writeFileSync(
		tuiStub,
		[
			"exports.visibleWidth = (text) => [...String(text).replace(/\\x1b\\[[0-9;]*m/g, '')].length;",
			"exports.truncateToWidth = (text, width) => [...String(text)].slice(0, Math.max(0, width)).join('');",
		].join("\n") + "\n",
	);

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": agentStub,
			"@earendil-works/pi-tui": tuiStub,
		},
	});
	const { default: registerFooter, formatSpeedLabel } = jiti("./rounded-bar-footer.ts");

	// --- formatSpeedLabel (pure) ----------------------------------------------

	const bolt = formatSpeedLabel(42, true, true);
	assert.ok(bolt.startsWith("⚡ "), `fast label starts with the bolt: ${JSON.stringify(bolt)}`);
	assert.ok(bolt.includes("42 tok/s"), "the rate survives verbatim");
	assert.equal(formatSpeedLabel(42, true, false), "42 tok/s", "fast off adds no bolt");

	assert.equal(formatSpeedLabel(undefined, false, true), "⚡ -- tok/s", "no rate yet, fast on");
	assert.equal(formatSpeedLabel(undefined, false, false), "-- tok/s", "no rate, fast off is unchanged");
	assert.equal(formatSpeedLabel(null, true, false), "-- tok/s", "an explicit null rate is unchanged");

	// Non-fast formatting is untouched by the feature.
	assert.equal(formatSpeedLabel(42.4, false, false), "~42 tok/s", "estimated rates keep the tilde");
	assert.equal(formatSpeedLabel(0.1, false, false), "~1 tok/s", "rates clamp at 1");
	assert.equal(formatSpeedLabel(1234, true, false), "1234 tok/s", "exact rates have no tilde");

	// --- mounting: editor label + footer repaint ------------------------------

	delete globalThis[FAST_MODE_SLOT];
	setFastModeEnabled(true);

	const handlers = new Map();
	registerFooter({ on: (name, handler) => handlers.set(name, handler) });
	const sessionStart = handlers.get("session_start");
	assert.equal(typeof sessionStart, "function", "registers session_start");

	let editorFactory;
	let footerFactory;
	const sessionCtx = {
		ui: {
			setEditorComponent: (factory) => {
				editorFactory = factory;
			},
			setFooter: (factory) => {
				footerFactory = factory;
			},
		},
		sessionManager: { getEntries: () => [], getCwd: () => "/tmp/pi-footer" },
		getContextUsage: () => ({ contextWindow: 200_000, percent: 10 }),
		model: { id: "glm-fast-latest", provider: "fireworks", contextWindow: 200_000 },
		thinkingLevel: "off",
	};
	sessionStart({ type: "session_start" }, sessionCtx);
	assert.equal(typeof editorFactory, "function", "mounts the rounded editor");
	assert.equal(typeof footerFactory, "function", "mounts the single-line footer");

	const theme = { fg: (_color, text) => text };
	const editor = editorFactory({ requestRender() {} }, theme, {});
	assert.match(stripAnsi(editor.render(40)[0]), /⚡ -- tok\/s/, "an on session shows the bolt in the bubble");
	setFastModeEnabled(false);
	assert.doesNotMatch(stripAnsi(editor.render(40)[0]), /⚡/, "off hides it again");
	setFastModeEnabled(true);

	let renders = 0;
	const footer = footerFactory(
		{
			requestRender: () => {
				renders++;
			},
		},
		theme,
		{
			onBranchChange: () => () => {},
			getGitBranch: () => "feat/fast-command",
			getAvailableProviderCount: () => 1,
		},
	);
	const line = footer.render(80);
	assert.match(stripAnsi(line[0]), /glm-fast-latest/, "the footer still renders the model");

	const beforeToggle = renders;
	notifyFastModeChange();
	assert.equal(renders, beforeToggle + 1, "a fast-mode change repaints through requestRender");

	footer.dispose();
	notifyFastModeChange();
	assert.equal(renders, beforeToggle + 1, "dispose unsubscribes the repaint listener");

	console.log("rounded-bar-footer.test.mjs: all assertions passed");
} finally {
	delete globalThis[FAST_MODE_SLOT];
	if (savedFastMode === undefined) delete process.env.PI_FAST_MODE;
	else process.env.PI_FAST_MODE = savedFastMode;
	rmSync(root, { recursive: true, force: true });
}
