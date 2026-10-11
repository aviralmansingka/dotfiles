import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath =
	process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(jitiPath);

// U5 — context files wired through the quiz tool end to end.
//
// The quiz tool schema carries `contextFiles`; the panel joins the `o` hint
// with the other hints; pressing `o` opens exactly those files; and an open
// that fails notifies a warning without ever throwing into the panel. All
// file opening happens through a stubbed ./nvim-open, so nothing touches a
// real editor or pane. typebox resolves for real via NODE_PATH so the schema
// assertions see the true parameter shape.
const tempRoot = mkdtempSync(join(tmpdir(), "quiz-context-wiring-test-"));
try {
	const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
	const stubTui = join(tempRoot, "pi-tui.cjs");
	const stubNvimOpen = join(tempRoot, "nvim-open.cjs");
	const stubMdLog = join(tempRoot, "md-log.cjs");
	writeFileSync(stubAgent, "exports.defineTool = value => value;\n");

	// nvim-open stub: records every openEditor call; the failure scenario
	// flips the switch (on globalThis, shared with the jiti-aliased module).
	writeFileSync(stubNvimOpen, `
globalThis.__openEditorCalls = [];
globalThis.__openEditorState = { reject: false };
exports.openEditor = async (cwd, files) => {
	globalThis.__openEditorCalls.push({ cwd, files });
	if (globalThis.__openEditorState.reject) throw new Error("no editor");
	return { message: "opened in stub", mode: "split" };
};
`);
	writeFileSync(stubMdLog, `
exports.openNodeView = async () => ({ mode: "node", message: "node view" });
exports.openJournalInEditor = async () => ({ mode: "journal", message: "journal" });
`);
	writeFileSync(stubTui, `
class Editor {
	constructor() { this.text = ""; this.focused = false; this.disableSubmit = false; }
	getText() { return this.text; }
	setText(text) { this.text = text; }
	handleInput(data) {
		if (data === "enter" && !this.disableSubmit && this.onSubmit) this.onSubmit(this.text);
		else this.text += data;
	}
	render() { return [this.text || (this.focused ? "█" : "")]; }
	invalidate() {}
}
exports.Editor = Editor;
exports.Key = { enter: "enter", escape: "escape", tab: "tab", up: "up", down: "down", space: " ", ctrl: key => "ctrl+" + key };
exports.Loader = class Loader { start() {} stop() {} render() { return ["grading"]; } };
exports.Text = class Text { constructor(text) { this.text = text; } };
exports.matchesKey = (data, key) => data === key;
exports.truncateToWidth = (text, width) => text.slice(0, width);
exports.visibleWidth = text => text.length;
exports.wrapTextWithAnsi = (text, width) => {
	const words = String(text).split(" ");
	const lines = [];
	let line = "";
	for (const word of words) {
		if (line.length === 0) line = word;
		else if (line.length + 1 + word.length <= width) line += " " + word;
		else { lines.push(line); line = word; }
	}
	if (line) lines.push(line);
	return lines.length ? lines : [""];
};
`);

	const jiti = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			"./nvim-open": stubNvimOpen,
			"./md-log": stubMdLog,
		},
	});
	const tools = {};
	const registry = { registerTool(tool) { tools[tool.name] = tool; } };
	jiti("../quiz.ts").default(registry);
	const quizTool = tools.quiz;
	assert.equal(quizTool?.name, "quiz");

	// U5: contextFiles is part of the quiz tool schema.
	assert.ok(
		quizTool.parameters.properties && "contextFiles" in quizTool.parameters.properties,
		"quiz schema carries contextFiles",
	);
	assert.match(
		JSON.stringify(quizTool.parameters.properties.contextFiles),
		/files in vim/i,
		"contextFiles schema documents the o shortcut",
	);

	const theme = { fg: (_color, text) => text, bold: (text) => text };
	const signal = new AbortController().signal;
	const params = {
		question: "Pick beta",
		options: [
			{ label: "Alpha", value: "alpha" },
			{ label: "Beta", value: "beta" },
		],
		correctAnswer: "beta",
		explanation: "Beta is correct.",
		shuffle: false,
	};

	// Drive the quiz panel. "tick" steps wait one macrotask so fire-and-forget
	// open promises settle before the assertions.
	async function execute(runParams, steps, captures) {
		const notifications = [];
		const ctx = {
			cwd: tempRoot,
			hasUI: true,
			model: {},
			modelRegistry: {
				find() {},
				complete() { return new Promise(() => {}); },
			},
			ui: {
				notify(message, level) { notifications.push({ message, level }); },
				custom(factory) {
					return new Promise((done) => {
						const component = factory({ requestRender() {} }, theme, {}, done);
						component.focused = true;
						(async () => {
							for (const step of steps) {
								if (step === "tick") {
									await new Promise((resolve) => setImmediate(resolve));
									continue;
								}
								if (step === "capture") {
									captures.push(component.render(100).join("\n"));
									continue;
								}
								component.handleInput(step);
							}
						})();
					});
				},
			},
		};
		const result = await quizTool.execute("context-files", runParams, signal, undefined, ctx);
		return { result, notifications };
	}

	const openCalls = () => globalThis.__openEditorCalls;
	const resetOpens = () => {
		globalThis.__openEditorCalls.length = 0;
		globalThis.__openEditorState.reject = false;
	};

	// The `o` hint joins with the navigation and lesson hints in one row, and
	// disappears when no context files were passed (the lesson hint stays).
	{
		resetOpens();
		const withContext = [];
		const hinted = await execute(
			{ ...params, contextFiles: ["bench.py", "fast.cu/h100/matmul.cu"] },
			["capture", "escape"],
			withContext,
		);
		assert.equal(hinted.result.details.status, "cancelled");
		assert.match(withContext[0], /o open context files/);
		assert.match(withContext[0], /o open context files • h node · H journal/);
		assert.match(withContext[0], /↑↓\/jk navigate[\s\S]*1-2 select/);

		const withoutContext = [];
		const bare = await execute(params, ["capture", "escape"], withoutContext);
		assert.equal(bare.result.details.status, "cancelled");
		assert.doesNotMatch(withoutContext[0], /o open context file/);
		assert.match(withoutContext[0], /h node · H journal/);
	}

	// Pressing `o` opens exactly the context files (normalized: trimmed,
	// empties dropped) against the session cwd, and the quiz stays active.
	{
		resetOpens();
		const opened = await execute(
			{ ...params, contextFiles: [" bench.py ", "", "fast.cu/h100/matmul.cu"] },
			["o", "tick", "2", "enter", "enter"],
		);
		assert.equal(opened.result.details.status, "answered");
		assert.equal(opened.result.details.answers[0].value, "beta");
		assert.deepEqual(openCalls(), [
			{ cwd: tempRoot, files: ["bench.py", "fast.cu/h100/matmul.cu"] },
		]);
		assert.ok(opened.notifications.some((n) => n.message === "opened in stub" && n.level === "info"));
	}

	// An open that FAILS notifies a warning and never throws: the quiz panel
	// keeps working and still grades the answer afterwards.
	{
		resetOpens();
		globalThis.__openEditorState.reject = true;
		let threw = null;
		try {
			const failing = await execute(
				{ ...params, contextFiles: ["bench.py"] },
				["o", "tick", "2", "enter", "enter"],
			);
			assert.ok(
				failing.notifications.some(
					(n) => n.message.includes("Could not open context files") && n.level === "warning"),
				"failed open warns",
			);
			assert.ok(
				!failing.notifications.some((n) => n.message === "opened in stub"),
				"no success notification on failure",
			);
			assert.equal(failing.result.details.status, "answered", "panel survives a failed open");
			assert.equal(failing.result.details.answers[0].value, "beta");
		} catch (error) {
			threw = error;
		}
		assert.equal(threw, null, "openContextFiles failure must never throw into the quiz");
		assert.equal(openCalls().length, 1);
	}

	// Without contextFiles, `o` does nothing at all.
	{
		resetOpens();
		const noFiles = await execute(params, ["o", "enter", "enter"]);
		assert.equal(noFiles.result.details.status, "answered");
		assert.equal(openCalls().length, 0);
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

console.log("quiz context-file wiring tests passed");
