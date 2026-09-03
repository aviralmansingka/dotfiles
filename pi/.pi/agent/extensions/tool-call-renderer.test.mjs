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
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": join(piPackageDir, "dist", "index.js"),
		"@earendil-works/pi-tui": piTuiEntry,
		"@mariozechner/pi-coding-agent": join(piPackageDir, "dist", "index.js"),
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
try {
	const stubPi = { on() {}, events: { on() {} } };
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

console.log("tool-call-renderer.test.mjs: PASS — runtime bundled-chunk classes patched, dead modes/interactive copy not patched");
