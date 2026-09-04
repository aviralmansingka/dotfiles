import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// Herdr launches each subagent in an unfocused tab and returns its root pane id.
const fakeBin = mkdtempSync(join(tmpdir(), "subagent-herdr-test-"));
const captureFile = join(fakeBin, "args");
writeFileSync(
	join(fakeBin, "herdr"),
	`#!/bin/sh
printf '%s\\n' "$@" > "$HERDR_TEST_CAPTURE"
printf '%s\\n' '{"result":{"root_pane":{"pane_id":"w44:p9"}}}'
`,
	{ mode: 0o755 },
);
const savedPath = process.env.PATH;
const savedWorkspace = process.env.HERDR_WORKSPACE_ID;
try {
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w44:p2";
	process.env.HERDR_WORKSPACE_ID = "w44";
	process.env.HERDR_TEST_CAPTURE = captureFile;
	process.env.PATH = `${fakeBin}:${savedPath}`;
	assert.equal(herdr.createSurface("scout tab"), "w44:p9");
	assert.deepEqual(readFileSync(captureFile, "utf8").trim().split("\n"), [
		"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
		"--label", "scout tab", "--no-focus",
	]);
} finally {
	process.env.HERDR_ENV = savedHerdrEnv;
	process.env.HERDR_PANE_ID = savedHerdrPane;
	process.env.HERDR_WORKSPACE_ID = savedWorkspace;
	process.env.PATH = savedPath;
	delete process.env.HERDR_TEST_CAPTURE;
	rmSync(fakeBin, { recursive: true, force: true });
}

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
assert.deepEqual(herdr.__pollForExitTest__.paneKilledResult(), {
	reason: "killed",
	exitCode: 130,
});

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
assert.match(
	subagentSource,
	/Ask the user what to do next: resume it with subagent_message/,
	"killed panes should prompt the orchestrator to ask the user",
);

// --- Bundled professor is an interactive, skill-backed teaching agent ---
const professorProfile = readFileSync(
	new URL("./interactive-subagents/agents/professor.md", import.meta.url),
	"utf8",
);
assert.match(professorProfile, /^name: professor$/m);
assert.match(professorProfile, /^skills: professor$/m);
assert.match(professorProfile, /^subagent_agents: researcher$/m);
assert.match(professorProfile, /^auto-exit: false$/m);
for (const tool of [
	"ask_user_question",
	"quiz",
	"explain",
	"run-command",
]) {
	assert.match(
		professorProfile,
		new RegExp(`^tools:.*\\b${tool}\\b`, "m"),
		`professor profile should allow ${tool}`,
	);
}

const professorSkill = readFileSync(
	new URL(
		"../../../../agents/.agents/skills/professor/SKILL.md",
		import.meta.url,
	),
	"utf8",
);
assert.match(professorSkill, /agent: "professor"/);
assert.match(professorSkill, /Phase 0 — Goal grill \(never skip\)/);
assert.match(
	professorSkill,
	/Use `ask_user_question` for every grilling turn/,
);
assert.match(professorSkill, /Do not enter Probe until approval is explicit/);

console.log("interactive-subagents surface smoke passed");
