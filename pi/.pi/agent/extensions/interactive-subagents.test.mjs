import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

// Allow CI / other hosts to supply jiti via JITI_PATH; otherwise fall back to
// the captain's macOS homebrew pi install AND the Linux nvm homelab install.
const jitiCandidates = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/latest/node_modules/.mise/jiti@2.7.0/node_modules/jiti/lib/jiti.cjs",
].filter(Boolean);
const jitiPath = jitiCandidates.find((p) => p && existsSync(p));
if (!jitiPath) {
	console.error(
		"jiti not found. Set JITI_PATH to jiti.cjs for your pi install.",
	);
	process.exit(1);
}
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);

// --- Surface dispatcher loads cleanly and re-exports the index.ts contract ---
const surface = jiti("./interactive-subagents/pi-extension/subagents/surface.ts");

// Every symbol index.ts imports from ./surface.ts must be present.
for (const name of [
	"isMuxAvailable",
	"muxSetupHint",
	"createSurface",
	"sendCommand",
	"sendLongCommand",
	"pollForExit",
	"closeSurface",
	"shellEscape",
	"readScreen",
]) {
	assert.equal(typeof surface[name], "function", `surface.${name} must be a function`);
}
assert.equal(typeof surface.readScreenAsync, "function", "surface.readScreenAsync must be a function");
assert.equal(typeof surface.__pollForExitTest__, "object", "surface.__pollForExitTest__ must be exported");

// shellEscape is a pure string helper shared by both surfaces.
assert.equal(surface.shellEscape("simple"), "'simple'");
assert.equal(surface.shellEscape("it's"), "'it'\\''s'");

// muxSetupHint never throws and returns a non-empty string regardless of surface.
assert.ok(typeof surface.muxSetupHint() === "string" && surface.muxSetupHint().length > 0);

// --- Herdr surface detection (gated on the captain's live Herdr env) ---
const herdr = jiti("./interactive-subagents/pi-extension/subagents/herdr.ts");

// Simulate running under Herdr (the captain's primary surface).
const savedHerdrEnv = process.env.HERDR_ENV;
const savedHerdrPane = process.env.HERDR_PANE_ID;
process.env.HERDR_ENV = "1";
process.env.HERDR_PANE_ID = "w44:p2";
try {
	assert.equal(herdr.isHerdrAvailable(), true, "isHerdrAvailable under HERDR_ENV=1 + HERDR_PANE_ID + herdr on PATH");
	assert.equal(herdr.isMuxAvailable(), true, "herdr.isMuxAvailable mirrors isHerdrAvailable");
} finally {
	process.env.HERDR_ENV = savedHerdrEnv;
	process.env.HERDR_PANE_ID = savedHerdrPane;
}

// Without Herdr env, isHerdrAvailable is false (no false positives).
process.env.HERDR_ENV = "";
process.env.HERDR_PANE_ID = "";
assert.equal(herdr.isHerdrAvailable(), false, "isHerdrAvailable false when Herdr env absent");

// --- pollForExit sidecar decoding (surface-agnostic logic) ---
const { interpretExitSidecar } = herdr.__pollForExitTest__;
assert.deepEqual(interpretExitSidecar({ type: "error", errorMessage: "boom" }), {
	reason: "error",
	exitCode: 1,
	errorMessage: "boom",
});
assert.deepEqual(interpretExitSidecar({ type: "error" }), {
	reason: "error",
	exitCode: 1,
	errorMessage: "Subagent exited with stopReason=error (no errorMessage in sidecar).",
});
assert.deepEqual(interpretExitSidecar({}), { reason: "done", exitCode: 0 });

// --- Subagent launch sandbox keeps extension discovery enabled ---
const subagentSource = readFileSync(
	new URL("./interactive-subagents/pi-extension/subagents/index.ts", import.meta.url),
	"utf8",
);
assert.equal(
	subagentSource.includes('parts.push("--no-extensions")'),
	false,
	"subagent launches should inherit normal extension discovery",
);
assert.match(
	subagentSource,
	/parts\.push\("--tools", shellEscape\(loadout\.toolAllowlist\)\)/,
	"tool restrictions should still be applied with --tools",
);

console.log("interactive-subagents surface smoke passed");
