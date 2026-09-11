// Regression test for the tool-call-renderer "dual-instance no-op" bug.
//
// The published pi runtime ships a BUNDLED CLI: dist/bundle/cli.js boots from
// dist/bundle/chunks/*.js, which inline their OWN copies of
// AssistantMessageComponent / ToolExecutionComponent. The separate
// dist/modes/interactive/components/*.js tree is a dead-at-runtime build
// output. ESM caches modules by URL, so the chunk classes and the
// modes/interactive classes are DIFFERENT instances. Patching the
// modes/interactive prototypes (the pre-fix behavior) therefore never affects
// the classes the runtime instantiates — a silent no-op that leaves the live
// TUI with zero `▸/▹/◆/◇` tree rows.
//
// This test activates the renderer the way pi does (with process.argv[1]
// pointing at the real pi CLI so the extension's loadPiInternals path
// resolution matches production) and asserts:
//   1. the renderer resolves its classes from the bundled chunk, not
//      modes/interactive (the stderr diagnostic names the source);
//   2. the bundled chunk's AssistantMessageComponent / ToolExecutionComponent
//      prototypes ARE patched (the runtime's classes — the fix);
//   3. the dead modes/interactive copies are NOT patched (they are a
//      different instance — the precondition that made the pre-fix code a
//      no-op).
//
// On the pre-fix code (8e243c2, which only imports modes/interactive) the
// chunk-prototype assertions fail and the diagnostic names modes/interactive,
// which is exactly the regression this guards against.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Make the globally-installed pi package tree resolvable from this test
// (mirrors usage.test.mjs).
process.env.NODE_PATH = [
	"/opt/homebrew/lib/node_modules",
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules",
	process.env.NODE_PATH || "",
].filter(Boolean).join(":");
require("node:module").Module._initPaths();

// --- Locate the installed pi package (the runtime the renderer must patch) ---
// The package `exports` map only defines an `import` condition, so CJS
// require.resolve cannot resolve it; resolve the install by known path (same
// candidate style as the other extension tests).
const piPackageCandidates = [
	process.env.PI_PACKAGE_DIR,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent",
].filter(Boolean);
const piPackageDir = piPackageCandidates.find((p) =>
	existsSync(join(p, "dist", "bundle", "cli.js")),
);
if (!piPackageDir) {
	console.error("pi install not found. Set PI_PACKAGE_DIR to the pi-coding-agent package dir.");
	process.exit(1);
}
const piCliPath = realpathSync(join(piPackageDir, "dist", "bundle", "cli.js"));
const cliDir = dirname(piCliPath);
const chunksDir = join(cliDir, "chunks");
const interactiveDir = join(dirname(cliDir), "modes", "interactive");
assert.ok(existsSync(chunksDir), "test expects a bundled pi install with dist/bundle/chunks");
assert.ok(
	existsSync(join(interactiveDir, "components", "assistant-message.js")),
	"test expects dist/modes/interactive present as the dead-at-runtime copy",
);

// --- Locate jiti (same resolution as the other extension tests) ---
const jitiCandidates = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].filter(Boolean);
const jitiPath = jitiCandidates.find((p) => p && existsSync(p));
if (!jitiPath) {
	console.error("jiti not found. Set JITI_PATH to jiti.cjs for your pi install.");
	process.exit(1);
}
const { createJiti } = require(jitiPath);
// Replicate pi's getAliases() so the renderer's `@earendil-works/*` imports
// resolve the same way they do when pi loads the extension (the package
// `exports` map has no `require` condition, so plain CJS resolution fails).
const piTuiEntry = require.resolve("@earendil-works/pi-tui", { paths: [piPackageDir] });
const { Text, visibleWidth } = require(piTuiEntry);
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": join(interactiveDir, "components", "keybinding-hints.js"),
		"@earendil-works/pi-tui": piTuiEntry,
		"@mariozechner/pi-coding-agent": join(interactiveDir, "components", "keybinding-hints.js"),
		"@mariozechner/pi-tui": piTuiEntry,
	},
});

// --- The patched-prototype symbols the renderer sets (must match the .ts) ---
const ASSISTANT_PATCHED = Symbol.for("aviral.pi.work-step-renderer.assistant");
const TOOL_PATCHED = Symbol.for("aviral.pi.work-step-renderer.tool");

// --- Find the bundled chunk that actually exports the runtime classes ---
// Mirrors the renderer's own scan in loadPiInternals.
let chunkFile;
for (const file of readdirSync(chunksDir).filter((f) => f.endsWith(".js"))) {
	const src = readFileSync(join(chunksDir, file), "utf8");
	if (src.includes("AssistantMessageComponent") && src.includes("ToolExecutionComponent")) {
		const mod = await import(pathToFileURL(join(chunksDir, file)).href).catch(() => undefined);
		if (mod?.AssistantMessageComponent && mod?.ToolExecutionComponent) {
			chunkFile = file;
			break;
		}
	}
}
assert.ok(chunkFile, "could not find a bundled chunk exporting the components");
const chunkUrl = pathToFileURL(join(chunksDir, chunkFile)).href;
const chunkModule = await import(chunkUrl);
const ChunkAssistant = chunkModule.AssistantMessageComponent;
const ChunkTool = chunkModule.ToolExecutionComponent;

// The dead-at-runtime modes/interactive copy (separate class instance).
const interactiveAssistant = (
	await import(pathToFileURL(join(interactiveDir, "components", "assistant-message.js")).href)
).AssistantMessageComponent;
const interactiveTool = (
	await import(pathToFileURL(join(interactiveDir, "components", "tool-execution.js")).href)
).ToolExecutionComponent;

// Sanity: the two trees really are different instances (the precondition for
// the original no-op bug). If these ever become reference-equal, the bug
// disappears on its own and this regression test is no longer meaningful.
assert.notEqual(
	ChunkAssistant,
	interactiveAssistant,
	"bundled chunk and modes/interactive must be distinct AssistantMessageComponent instances",
);
assert.notEqual(
	ChunkTool,
	interactiveTool,
	"bundled chunk and modes/interactive must be distinct ToolExecutionComponent instances",
);

// --- Activate the renderer as pi would ---
// loadPiInternals reads process.argv[1] to find the CLI, so point it at the
// real installed pi CLI for the duration of the activation.
const savedArgv1 = process.argv[1];
process.argv[1] = piCliPath;

const renderer = jiti.import("./tool-call-renderer.ts", { default: true });
const activate = await renderer;
assert.equal(typeof activate, "function", "renderer must export an activate function");

const stderrLines = [];
const savedError = console.error;
console.error = (...args) => stderrLines.push(args.join(" "));
const piHandlers = new Map();
try {
	const stubPi = {
		on(name, handler) {
			piHandlers.set(name, handler);
		},
		events: { on() {} },
	};
	await activate(stubPi);
} finally {
	console.error = savedError;
	process.argv[1] = savedArgv1;
}

const diagnostic = stderrLines.join("\n");

// --- Assertions ---

// 1. The renderer patched the BUNDLED CHUNK classes (the runtime's classes),
//    not the dead modes/interactive copy. This is the fix.
assert.equal(
	ChunkAssistant.prototype[ASSISTANT_PATCHED],
	true,
	"bundled chunk AssistantMessageComponent.prototype must be patched (the runtime class)",
);
assert.equal(
	ChunkTool.prototype[TOOL_PATCHED],
	true,
	"bundled chunk ToolExecutionComponent.prototype must be patched (the runtime class)",
);

// 2. The dead modes/interactive copy is NOT patched — proving it is a separate
//    instance and that patching it (the pre-fix behavior) was a no-op.
assert.notEqual(
	interactiveAssistant.prototype[ASSISTANT_PATCHED],
	true,
	"modes/interactive AssistantMessageComponent must NOT be patched (dead-at-runtime copy)",
);
assert.notEqual(
	interactiveTool.prototype[TOOL_PATCHED],
	true,
	"modes/interactive ToolExecutionComponent must NOT be patched (dead-at-runtime copy)",
);

// 3. The renderer's own diagnostic confirms it took the chunk path.
assert.ok(
	diagnostic.includes("bundled chunk"),
	`renderer diagnostic must name the bundled chunk source; got: ${diagnostic}`,
);

const controller = ChunkTool.prototype[Symbol.for("aviral.pi.work-step-renderer.controller")];
const bridgeKey = Symbol.for("aviral.pi.work-step-renderer.subagent-bridge");
const toolCallId = "failed-no-mistakes";
controller.assistantUpdated(
	{ hideThinkingBlock: false },
	{
		content: [{ type: "toolCall", id: toolCallId, name: "no_mistakes_axi", arguments: { args: "respond" } }],
		stopReason: "toolUse",
	},
);
const failedComponent = {
	toolName: "no_mistakes_axi",
	toolCallId,
	rendererState: {},
	executionStarted: true,
	isPartial: false,
	result: {
		isError: true,
		content: [{ type: "text", text: "RAW FAILURE OUTPUT" }],
		details: {
			exitCode: 1,
			progress: {
				kind: "pipeline",
				status: "failed",
				error: "test failed",
				recentTools: [
					{ name: "review", status: "completed" },
					{ name: "test", status: "failed" },
				],
			},
		},
	},
	resultRendererComponent: { render: () => ["RAW FAILURE OUTPUT"] },
};
controller.toolUpdated(failedComponent);
assert.ok(failedComponent.rendererState[bridgeKey], "failed pipeline phase data enables connected rendering");
failedComponent.rendererState[bridgeKey].outputMode = "expanded";
globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")] = {
	fg: (_role, text) => text,
	bg: (_role, text) => text,
	bold: (text) => text,
	italic: (text) => text,
};
const failedLines = controller.renderTool(failedComponent, 120).join("\n");
assert.ok(failedLines.includes("review"), "expanded failed pipeline renders phase rows");
assert.ok(failedLines.includes("RAW FAILURE OUTPUT"), "expanded failed pipeline retains raw output");

// --- Regression: the "missing conversation" bug (three swallowing paths) ---
//
// 1. Assistant text emitted alongside tool calls was reduced to the step row
//    title (first line) and the rest vanished from the transcript.
const rendererModule = jiti("./tool-call-renderer.ts");
const { stepSurplusText } = rendererModule;
assert.deepEqual(
	stepSurplusText({
		content: [
			{ type: "text", text: "Displaying the padded bank map" },
			{ type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "true" } },
		],
	}),
	[],
	"single-line text equals its row title; no surplus",
);
const quizSurplus = stepSurplusText({
	content: [
		{
			type: "text",
			text: "Restarting Socratic quiz\n\n### Question 1A — CP identity\n\nWhy must the VM retain a stable Tailscale identity?",
		},
		{ type: "toolCall", id: "tc-2", name: "bash", arguments: { command: "true" } },
	],
});
assert.ok(
	quizSurplus.join("\n").includes("Question 1A"),
	"multi-line text alongside a tool call keeps its surplus lines",
);
assert.ok(
	!quizSurplus.some((line) => line.includes("Restarting Socratic quiz")),
	"the first line (the row title) is not duplicated",
);
controller.assistantUpdated(
	{ hideThinkingBlock: false },
	{
		content: [{ type: "text", text: "Previous response complete." }],
		stopReason: "stop",
		usage: { totalTokens: 1 },
	},
);
const orderedMessage = {
	content: [
		{
			type: "text",
			text: [
				"Restarting Socratic quiz",
				"",
				"### Question 1A — CP identity",
				...Array.from({ length: 11 }, (_, index) => `long surplus line ${index}`),
			].join("\n"),
		},
		{ type: "toolCall", id: "tc-3", name: "bash", arguments: { command: "true" } },
	],
};
const orderedAssistant = { hideThinkingBlock: false };
controller.assistantUpdated(orderedAssistant, orderedMessage);
assert.deepEqual(
	ChunkAssistant.prototype.render.call(orderedAssistant, 120),
	[],
	"the assistant component defers tool-call text to the owning tool row",
);
const orderedTool = {
	toolName: "bash",
	toolCallId: "tc-3",
	rendererState: {},
	executionStarted: true,
	invalidate: () => {},
	ui: { requestRender: () => {} },
};
controller.toolUpdated(orderedTool);
const orderedLines = controller.renderTool(orderedTool, 120);
const orderedText = orderedLines.join("\n");
assert.ok(
	orderedText.indexOf("Restarting Socratic quiz") < orderedText.indexOf("Question 1A"),
	"surplus text follows its title in the owning tool row",
);
const narrowOrderedLines = controller.renderTool(orderedTool, 10);
assert.ok(
	narrowOrderedLines.every((line) => visibleWidth(line) <= 10),
	"surplus content and overflow marker are clipped after indentation",
);

controller.assistantUpdated(
	{ hideThinkingBlock: false },
	{
		content: [{ type: "text", text: "Previous run complete." }],
		stopReason: "stop",
		usage: { totalTokens: 1 },
	},
);
const connectedOwnerAssistant = { hideThinkingBlock: false };
controller.assistantUpdated(connectedOwnerAssistant, {
	content: [
		{ type: "text", text: "Launching connected work\nfirst connected surplus" },
		{ type: "toolCall", id: "tc-connected", name: "subagent", arguments: { name: "worker" } },
	],
	stopReason: "toolUse",
});
const connectedOwnerTool = {
	toolName: "subagent",
	toolCallId: "tc-connected",
	rendererState: {},
	executionStarted: true,
};
controller.toolUpdated(connectedOwnerTool);
controller.assistantUpdated({ hideThinkingBlock: false }, {
	content: [
		{ type: "text", text: "Showing later output\nlater step surplus" },
		{ type: "toolCall", id: "tc-later", name: "bash", arguments: { command: "true" } },
	],
	stopReason: "toolUse",
});
controller.toolUpdated({
	toolName: "bash",
	toolCallId: "tc-later",
	rendererState: {},
	executionStarted: true,
});
const connectedRunText = controller.renderTool(connectedOwnerTool, 120).join("\n");
assert.ok(
	connectedRunText.indexOf("Launching connected work") <
		connectedRunText.indexOf("first connected surplus"),
	"a connected owner renders its surplus under its title",
);
assert.ok(
	connectedRunText.indexOf("Showing later output") <
		connectedRunText.indexOf("later step surplus"),
	"a connected owner renders later run surplus under the later step title",
);

// 2. Plain tool output was unviewable: rows collapsed to a one-line summary
//    with no expand path. setExpanded(true) must now open the native output.
const plainToolComponent = {
	toolName: "bash",
	toolCallId: "tc-4",
	invalidate: () => {},
	ui: { requestRender: () => {} },
};
const plainBridgeKey = Symbol.for("aviral.pi.work-step-renderer.plain-bridge");
assert.equal(
	plainToolComponent[plainBridgeKey],
	undefined,
	"plain bridge is created lazily",
);
controller.toolExpanded(plainToolComponent, true);
assert.equal(
	plainToolComponent[plainBridgeKey]?.outputMode,
	"expanded",
	"ctrl+o expands plain tool output",
);
controller.toolExpanded(plainToolComponent, false);
assert.equal(
	plainToolComponent[plainBridgeKey]?.outputMode,
	"hidden",
	"collapsing restores the summary-only row",
);

// Exercise the public component methods that pi itself invokes, rather than
// only the controller seam above. This proves setExpanded(true) composes the
// work-step row with the native tool result renderer in the live TUI class.
controller.assistantUpdated(
	{ hideThinkingBlock: false },
	{
		content: [{ type: "text", text: "Previous plain tool complete." }],
		stopReason: "stop",
		usage: { totalTokens: 1 },
	},
);
const nativeToolCallId = "tc-native-plain";
const nativeMessage = {
	content: [
		{ type: "text", text: "Displaying requested output\nThe tool result can be expanded below." },
		{ type: "toolCall", id: nativeToolCallId, name: "evidence_plain", arguments: {} },
	],
	stopReason: "toolUse",
};
const nativeAssistant = new ChunkAssistant(nativeMessage, false);
assert.deepEqual(
	nativeAssistant.render(120),
	[],
	"the live assistant component delegates a tool-call turn to its tool row",
);
const nativePlainTool = new ChunkTool(
	"evidence_plain",
	nativeToolCallId,
	{},
	{},
	{
		name: "evidence_plain",
		renderCall: () => new Text("evidence_plain", 0, 0),
		renderResult: () => new Text("REQUESTED TOOL OUTPUT", 0, 0),
	},
	{ requestRender() {} },
	process.cwd(),
);
nativePlainTool.markExecutionStarted();
nativePlainTool.setArgsComplete();
nativePlainTool.updateResult(
	{ content: [{ type: "text", text: "REQUESTED TOOL OUTPUT" }], details: {} },
	false,
);
assert.equal(
	typeof piHandlers.get("tool_execution_end"),
	"function",
	"activation registers the tool completion lifecycle handler",
);
piHandlers.get("tool_execution_end")({ toolCallId: nativeToolCallId });
const nativeCollapsed = nativePlainTool.render(120).join("\n");
assert.ok(
	nativeCollapsed.includes("The tool result can be expanded below."),
	"the live tool row displays assistant surplus text",
);
assert.ok(
	!nativeCollapsed.includes("REQUESTED TOOL OUTPUT"),
	"the live plain tool starts collapsed",
);
nativePlainTool.setExpanded(true);
const nativeExpanded = nativePlainTool.render(120).join("\n");
assert.ok(
	nativeExpanded.includes("REQUESTED TOOL OUTPUT"),
	"the live plain tool displays native result output after expansion",
);
nativePlainTool.setExpanded(false);
assert.ok(
	!nativePlainTool.render(120).join("\n").includes("REQUESTED TOOL OUTPUT"),
	"the live plain tool hides native result output after collapse",
);

// 3. A finished assistant message with empty text and hidden thinking used
//    to render nothing at all (the answer had leaked into the thinking block).
const fallbackComponent = { hideThinkingBlock: true };
controller.assistantUpdated(fallbackComponent, {
	content: [
		{
			type: "thinking",
			thinking: "The user wants a session summary.\n\n## Session summary\n1. Fixed the widget.\n2. Added the SSH check.",
		},
	],
	stopReason: "stop",
	usage: { totalTokens: 120 },
});
const fallbackLines = controller.renderAssistant(fallbackComponent, [], 120).join("\n");
assert.ok(
	fallbackLines.includes("Session summary"),
	"empty response with hidden thinking falls back to raw thinking",
);
const nativeFallback = new ChunkAssistant(
	{
		content: [
			{
				type: "thinking",
				thinking: "The user wants a session summary.\n\n## Session summary\n1. Fixed the widget.\n2. Added the SSH check.",
			},
		],
		stopReason: "stop",
		usage: { totalTokens: 120 },
	},
	true,
).render(120).join("\n");
assert.ok(
	nativeFallback.includes("Session summary"),
	"the live assistant component renders hidden thinking when response text is empty",
);
assert.ok(
	fallbackLines.includes("no response text"),
	"the fallback is labeled so the captain knows it came from thinking",
);
const visibleTextComponent = { hideThinkingBlock: false };
controller.assistantUpdated(visibleTextComponent, {
	content: [
		{ type: "text", text: "Here is the answer." },
	],
	stopReason: "stop",
	usage: { totalTokens: 120 },
});
assert.equal(
	controller.renderAssistant(visibleTextComponent, ["Here is the answer."], 120).join("\n"),
	"Here is the answer.",
	"normal responses are untouched by the fallback",
);

console.log("tool-call-renderer.test.mjs: PASS — runtime patches, failed pipeline rendering, and missing-conversation recovery work");
