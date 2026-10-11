import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOMEBREW_JITI, resolveJiti } from "../test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
const { createJiti } = require(jitiPath);

// U4 — prompt-frame invariants of the merged panel frame (frameMerged, the
// shared renderer behind ask_user_question, quiz, and explain).
//
// Invariants, proven by #222:
//   1. Every prompt row keeps one column of padding on BOTH sides, so prompt
//      content can never touch the frame's borders — even when the content
//      wraps away or is empty.
//   2. The two boxes are MERGED: a tee row (┴) joins the top content box to
//      the full-width prompt box.
//   3. The prompt box always renders at least one content row, even when the
//      caller passes an empty bottom (the "content wrapped away" case).
//   4. Below 24 columns the frame degrades to borderless padded rows.
const tempRoot = mkdtempSync(join(tmpdir(), "prompt-frame-test-"));
try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTypes = join(tempRoot, "types.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	writeFileSync(stubAgent, "exports.defineTool = value => value;\n");
	writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
	writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; this.focused = false; this.disableSubmit = false; }
	getText() { return this.text; }
	handleInput(data) { this.text += data; }
	render() { return [this.text || (this.focused ? "█" : "")]; }
	invalidate() {}
}
exports.Editor = Editor;
exports.Key = { enter: "enter", escape: "escape", tab: "tab", up: "up", down: "down", space: " ", ctrl: key => "ctrl+" + key };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
exports.wrapTextWithAnsi = (text) => [text];
`);

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-ai": stubTypes,
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			typebox: stubTypes,
		},
	});
	const { frameMerged } = jiti("../ask-user-question.ts");
	const theme = { fg: (_color, text) => text };

	const assertFramed = (framed, width) => {
		// Structure: top box rows (indented 2), tee row, prompt rows, bottom.
		assert.ok(framed[0].startsWith("  ╭"), "top box opens");
		assert.ok(framed[0].endsWith("╮"));
		const teeRows = framed.filter((line) => line.includes("┴"));
		assert.equal(teeRows.length, 1, "exactly one merged tee row");
		assert.ok(teeRows[0].startsWith("╭─┴"), "tee row merges the boxes");
		assert.equal(framed.at(-1), "╰" + "─".repeat(width - 2) + "╯", "prompt box closes full width");

		// Every row between the tee and the bottom border is a prompt row, and
		// each keeps one column of padding on both sides.
		const promptRows = framed.slice(framed.indexOf(teeRows[0]) + 1, -1);
		assert.ok(promptRows.length >= 1, "prompt box renders at least one content row");
		for (const row of promptRows) {
			assert.ok(row.startsWith("│ "), "prompt row keeps left padding");
			assert.ok(row.endsWith(" │"), "prompt row keeps right padding");
			assert.equal(row.length, width, "prompt row fills the prompt box");
		}
		// Content rows of the top box are padded on both sides too.
		for (const row of framed.slice(1, framed.indexOf(teeRows[0]))) {
			assert.ok(row.startsWith("  │ "), "top row keeps left padding");
			assert.ok(row.endsWith(" │"), "top row keeps right padding");
		}
	};

	for (const width of [24, 32, 60, 100]) {
		// Ordinary content.
		assertFramed(frameMerged(["Question?", "1. Alpha"], ["› answer"], width, theme), width);

		// Empty bottom (content wrapped away): still one padded prompt row.
		const emptyBottom = frameMerged(["Question?"], [], width, theme);
		assertFramed(emptyBottom, width);
		assert.match(emptyBottom.at(-2), /^│ +│$/, "empty prompt renders a padded blank row");

		// Bottom content exactly as wide as the box: padding collapses to the
		// single mandatory column on each side, never to zero.
		const bw = width - 4;
		const fullLine = "x".repeat(bw);
		const fullBottom = frameMerged(["Question?"], [fullLine], width, theme);
		assertFramed(fullBottom, width);
		assert.equal(fullBottom.at(-2), `│ ${fullLine} │`);
	}

	// Narrow terminals (< 24 columns): the frame degrades to borderless
	// rows, and prompt rows keep their one column of left padding.
	for (const width of [10, 20, 23]) {
		const narrow = frameMerged(["Question?"], ["› answer"], width, theme);
		assert.ok(narrow.length >= 2);
		for (const row of narrow) {
			assert.ok(!row.includes("│") && !row.includes("╭") && !row.includes("┴"), "no borders below 24 columns");
		}
		// The prompt row is the last one and stays left-padded.
		assert.ok(narrow.at(-1).startsWith(" "), "narrow prompt row keeps left padding");
		// Empty bottom still yields a padded (blank) prompt row.
		const narrowEmpty = frameMerged(["Question?"], [], width, theme);
		assert.equal(narrowEmpty.at(-1), " ");
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("prompt frame invariant tests passed");
