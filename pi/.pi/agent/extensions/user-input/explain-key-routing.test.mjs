import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath =
	process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);

// U3 — the explain panel's lesson-shortcut key routing.
//
// Current contract (post journal-shortcut redesign): bare `h` focuses the
// current lesson node, but ONLY while the answer field is still empty or in
// the verdict phase — the Editor must keep every printable key once the
// learner is composing. `H` (Shift+H) opens the lesson journal at every
// phase, including while grading. Alt is deliberately NOT routed (the
// learner's window manager owns the Option key). Both terminal encodings —
// legacy (plain `h` / uppercase `H` / ESC-prefixed alt) and Kitty CSI-u
// (`ESC[104u`, `ESC[104;3u`) — must reach the same wiring through matchesKey.
// The opens are fire-and-forget: a failing open notifies a warning and never
// throws into the panel.
//
// Hermetic: pi-tui AND ./md-log are stubs, so no journal file, editor, or
// pane is ever touched.
const tempRoot = mkdtempSync(join(tmpdir(), "explain-key-routing-test-"));
try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTypes = join(tempRoot, "types.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	const stubMdLog = join(tempRoot, "md-log.cjs");
	writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
	writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");

	// md-log stub with a mutable failure switch: the never-throw scenario
	// flips it so both opens reject. The switch rides globalThis so the test
	// and the jiti-aliased module share one instance regardless of module cache.
	writeFileSync(stubMdLog, `
globalThis.__mdlogState = { reject: false };
exports.openNodeView = async () => {
	if (globalThis.__mdlogState.reject) throw new Error("node boom");
	return { mode: "node", message: "node view" };
};
exports.openJournalInEditor = async () => {
	if (globalThis.__mdlogState.reject) throw new Error("journal boom");
	return { mode: "journal", message: "journal" };
};
`);

	// matchesKey faithful to the real pi-tui contract for the keys explain
	// queries: "h", "shift+h", "enter", "escape". Kitty CSI-u sequences carry
	// codepoint + (modifier bits + 1); shift = bit 1 (value 2), so shift+h is
	// ESC[104;3u. Legacy shift+letter is the uppercase letter. Legacy
	// alt+letter is ESC + letter and must match NEITHER h nor shift+h.
	writeFileSync(stubTui, `
const parseKitty = (data) => {
	const m = data.match(/^\\x1b\\[(\\d+)(?::\\d*)?(?:;(\\d+)(?::\\d*)?)?u$/);
	if (!m) return null;
	return { cp: Number(m[1]), mod: Number(m[2] ?? 1) - 1 };
};
class Editor {
	constructor() { this.text = ""; this.focused = false; this.disableSubmit = false; }
	getText() { return this.text; }
	setText(text) { this.text = text; }
	handleInput(data) {
		if (data === "backspace") { this.text = this.text.slice(0, -1); return; }
		if (data === "enter" && !this.disableSubmit && this.onSubmit) { this.onSubmit(this.text); return; }
		this.text += data;
	}
	render() { return [this.text || (this.focused ? "█" : "")]; }
	invalidate() {}
}
exports.Editor = Editor;
exports.Key = { enter: "enter", escape: "escape", ctrl: (key) => "ctrl+" + key };
exports.Loader = class Loader { start() {} stop() {} render() { return [" grading…"]; } };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, keyId) => {
	const parts = keyId.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (key === "enter") return data === "enter";
	if (key === "escape") return data === "escape";
	if (!(key.length === 1 && key >= "a" && key <= "z")) return false;
	let want = 0;
	if (parts.includes("ctrl")) want |= 1;
	if (parts.includes("shift")) want |= 2;
	if (parts.includes("alt")) want |= 4;
	const cp = key.charCodeAt(0);
	if (want === 0) {
		if (data === key) return true;
		const k = parseKitty(data);
		return !!k && k.cp === cp && (k.mod & ~(64 | 128)) === 0;
	}
	if (want === 2) {
		if (data === key.toUpperCase()) return true;
		const k = parseKitty(data);
		return !!k && k.cp === cp && (k.mod & 7) === 2;
	}
	const k = parseKitty(data);
	return !!k && k.cp === cp && (k.mod & 7) === want;
};
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = (text) => text.length;
exports.wrapTextWithAnsi = (text) => [text];
`);

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-ai": stubTypes,
			"@earendil-works/pi-tui": stubTui,
			typebox: stubTypes,
			"./md-log": stubMdLog,
		},
	});
	const { default: registerExplain } = jiti("../explain.ts");
	const tools = {};
	registerExplain({ registerTool(tool) { tools[tool.name] = tool; } });
	const explainTool = tools.explain;
	assert.equal(explainTool?.name, "explain");

	// The md-log stub's mutable failure switch (see stubMdLog above).
	const mdLogState = globalThis.__mdlogState;

	const theme = { fg: (_color, text) => text, bold: (text) => text };
	const signal = new AbortController().signal;
	const gradingJson = JSON.stringify({
		verdict: "correct",
		grade: "A",
		summary: "All required claims are present.",
		correctAnswer: "Occupancy counts resident warps.",
		refinements: [{ quote: "occ", issue: "loose term", correction: "occupancy" }],
	});

	// Drive the panel: plain strings are keystrokes, "tick" waits one
	// macrotask (for the fire-and-forget open promises and the grader fork to
	// settle), and every keystroke is followed by a render capture.
	// options.gradingText swaps the grader fork's reply; options.findModel
	// swaps the registry lookup for the grader-model override scenario.
	async function runExplain(inputs, options = {}) {
		const gradingText = options.gradingText ?? gradingJson;
		const notifications = [];
		const renders = [];
		const usedModels = [];
		let modelCalls = 0;
		const ctx = {
			cwd: process.cwd(),
			hasUI: true,
			model: { provider: "session", id: "test-model" },
			modelRegistry: {
				find: options.findModel ?? (() => undefined),
				hasConfiguredAuth() { return true; },
				async complete(model) {
					modelCalls++;
					usedModels.push(model);
					return { content: [{ type: "text", text: gradingText }] };
				},
			},
			ui: {
				notify(message, level) { notifications.push({ message, level }); },
				custom(factory) {
					return new Promise((done) => {
						const component = factory({ requestRender() {} }, theme, {}, done);
						(async () => {
							for (const input of inputs) {
								if (input === "tick") {
									await new Promise((resolve) => setImmediate(resolve));
									continue;
								}
								component.handleInput(input);
								renders.push(component.render(100).join("\n"));
							}
						})();
					});
				},
			},
		};
		const result = await explainTool.execute(
			"key-routing",
			{ question: "What does occupancy count?", expected: "Occupancy counts resident warps." },
			signal,
			undefined,
			ctx,
		);
		return { result, notifications, renders, modelCalls, usedModels };
	}

	const count = (notes, message) => notes.filter((n) => n.message === message).length;

	// Empty answering phase: bare h (both encodings) opens the node view;
	// H (both encodings) opens the journal. Alt+h (legacy ESC-h and Kitty
	// alt-modified) opens NOTHING — it falls through to the editor.
	const emptyPhase = await runExplain(["h", "H", "\x1b[104u", "\x1b[104;3u", "\x1bh", "\x1b[104;5u", "escape"]);
	assert.equal(count(emptyPhase.notifications, "Opening current node…"), 2, "bare h (raw + kitty) opens the node view");
	assert.equal(count(emptyPhase.notifications, "Opening lesson journal…"), 2, "H (legacy + kitty) opens the journal");
	assert.match(emptyPhase.renders[0], /h \(empty\) — node · H — journal/);
	assert.match(emptyPhase.renders[0], /│ █/, "routed h never lands in the answer text");
	assert.match(emptyPhase.renders[4], /│ \x1bh/, "legacy alt+h lands in the editor, not a shortcut");
	assert.match(emptyPhase.renders[5], /│ \x1bh\x1b\[104;5u/, "kitty alt+h lands in the editor, not a shortcut");
	assert.equal(emptyPhase.result.details.status, "cancelled");

	// Composing phase: once the editor holds text, every h — raw, kitty, even
	// after backspacing back to empty — is TEXT. hasComposed is sticky.
	// (The kitty sequence is 6 characters to the stub editor, so 8 backspaces
	// clear "x" + "h" + "\x1b[104u".)
	const composing = await runExplain([
		"x",
		"h",
		"\x1b[104u",
		...Array(8).fill("backspace"), // back to "" — hasComposed stays true
		"h",
		"escape",
	]);
	assert.equal(count(composing.notifications, "Opening current node…"), 0, "no bare h shortcut while composed");
	assert.equal(count(composing.notifications, "Opening lesson journal…"), 0);
	assert.match(composing.renders[1], /│ xh/);
	assert.match(composing.renders[2], /│ xh\x1b\[104u/);
	assert.match(composing.renders[11], /│ h/, "sticky hasComposed keeps h as text even at empty");
	assert.equal(composing.result.details.status, "cancelled");

	// Grading + verdict: H still opens the journal (both encodings); bare h
	// is swallowed during grading and opens the node view in the verdict
	// phase (both encodings). The frame keeps a padded prompt row in every
	// phase (U4) and each phase shows its own hint row.
	const graded = await runExplain([
		"o", "c", "c", "enter", // compose + submit -> grading
		"h", // swallowed during grading: no open, no crash, no text loss
		"H", "\x1b[104;3u", // journal during grading, both encodings
		"tick", // grader fork resolves -> verdict
		"h", "\x1b[104u", // node view in verdict, both encodings
		"enter",
	]);
	assert.equal(graded.modelCalls, 1, "exactly one grader fork");
	assert.match(graded.renders[3], /H — journal · Esc — abort grading/);
	assert.match(graded.renders[3], /│ +│/, "grading frame keeps a padded prompt row");
	assert.ok(graded.renders[3].includes("┴"), "grading frame keeps its tee row");
	assert.equal(count(graded.notifications, "Opening current node…"), 2, "bare h swallowed in grading, opens node twice in verdict");
	assert.equal(count(graded.notifications, "Opening lesson journal…"), 2, "journal opens during grading");
	assert.match(graded.renders[8], /Enter — continue · h — node · H — journal/);
	assert.match(graded.renders[8], /✓ correct — grade A/);
	assert.equal(graded.result.details.grading.verdict, "correct");
	assert.equal(graded.result.details.answer, "occ");

	// Fire-and-forget: when both opens REJECT, the panel warns and carries
	// on. No throw, no unhandled rejection, Enter still finishes the panel.
	mdLogState.reject = true;
	let threw = null;
	try {
		const failing = await runExplain(["h", "H", "tick", "escape"]);
		assert.equal(count(failing.notifications, "Opening current node…"), 1);
		assert.equal(count(failing.notifications, "Opening lesson journal…"), 1);
		assert.ok(
			failing.notifications.some((n) => n.message === "node view open failed: node boom" && n.level === "warning"),
			"node open failure warns",
		);
		assert.ok(
			failing.notifications.some((n) => n.message === "lesson journal open failed: journal boom" && n.level === "warning"),
			"journal open failure warns",
		);
		assert.equal(failing.result.details.status, "cancelled", "panel survives a failing open");
	} catch (error) {
		threw = error;
	}
	assert.equal(threw, null, "a rejecting open must never throw into the panel");
	mdLogState.reject = false;

	// Empty answer skips the grader fork entirely — no model call, honest
	// "I don't know" text for the agent.
	const empty = await runExplain(["enter"]);
	assert.equal(empty.modelCalls, 0);
	assert.equal(empty.result.details.status, "answered");
	assert.match(empty.result.content[0].text, /EMPTY answer/);

	// The grader's refinements travel verbatim: quoted in the panel, in the
	// tool text, and in the rendered transcript row.
	assert.match(graded.renders[8], /“occ”/);
	assert.match(graded.renders[8], /loose term — → occupancy/);
	assert.match(graded.result.content[0].text, /Terminology refinements/);
	assert.match(graded.result.content[0].text, /"occ" — loose term → occupancy/);
	const gradedView = explainTool.renderResult({ details: graded.result.details }, {}, theme);
	assert.match(gradedView.text, /─ grader ─/);
	assert.match(gradedView.text, /✓ correct — grade A/);
	assert.match(gradedView.text, /“occ”/);
	const cancelledView = explainTool.renderResult({ details: emptyPhase.result.details }, {}, theme);
	assert.match(cancelledView.text, /User cancelled explain/);

	// An unparseable grader reply degrades visibly: the panel says grading is
	// unavailable, the tool text tells the agent to grade the prose itself,
	// and the answer still comes back.
	const unparseable = await runExplain(
		["o", "c", "c", "enter", "tick", "enter"],
		{ gradingText: "not json at all" },
	);
	assert.equal(unparseable.modelCalls, 1);
	assert.equal(unparseable.result.details.status, "answered");
	assert.equal(unparseable.result.details.grading, undefined);
	assert.match(unparseable.renders[4], /grading unavailable — grader returned unparseable output/);
	assert.match(unparseable.renders[4], /returned ungraded; the agent will evaluate your answer itself/);
	assert.match(unparseable.result.content[0].text, /Grader fork unavailable: grader returned unparseable output/);
	assert.match(unparseable.result.content[0].text, /User's answer \(their own words\):\nocc/);

	// PI_EXPLAIN_GRADER_MODEL overrides the grader model choice; the env is
	// saved and restored in a finally so a failure cannot leak it.
	{
		const savedOverride = process.env.PI_EXPLAIN_GRADER_MODEL;
		process.env.PI_EXPLAIN_GRADER_MODEL = "stub/ovr-model";
		let overridden;
		try {
			overridden = await runExplain(["x", "enter", "tick", "enter"], {
				findModel: (provider, id) =>
					provider === "stub" && id === "ovr-model" ? { provider, id } : undefined,
			});
		} finally {
			if (savedOverride === undefined) delete process.env.PI_EXPLAIN_GRADER_MODEL;
			else process.env.PI_EXPLAIN_GRADER_MODEL = savedOverride;
		}
		assert.equal(overridden.modelCalls, 1);
		assert.equal(overridden.usedModels[0].id, "ovr-model", "PI_EXPLAIN_GRADER_MODEL picks the grader model");
		assert.equal(overridden.result.details.grading.verdict, "correct");
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("explain key-routing state machine tests passed");
