import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

function restoreEnv(name, value) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

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

// --- Herdr surface detection and tab creation ---
const fakeBin = mkdtempSync(join(tmpdir(), "subagent-herdr-test-"));
const captureFile = join(fakeBin, "args");
writeFileSync(
	join(fakeBin, "herdr"),
	`#!/bin/sh
printf '%s\\n' "$@" >> "$HERDR_TEST_CAPTURE"
printf '%s\\n' '--call--' >> "$HERDR_TEST_CAPTURE"
case "$1:$2" in
	pane:get)
		printf '%s\\n' '{"result":{"pane":{"pane_id":"w44:p2","workspace_id":"w44"}}}'
		;;
	tab:create)
		printf '%s\\n' '{"result":{"root_pane":{"pane_id":"w44:p9"}}}'
		;;
	pane:read)
		printf '%s\\n' '__SUBAGENT_DONE_0__'
		;;
	*)
		printf '%s\\n' '{"result":{}}'
		;;
esac
`,
	{ mode: 0o755 },
);
const tmuxCaptureFile = join(fakeBin, "tmux-args");
writeFileSync(
	join(fakeBin, "tmux"),
	`#!/bin/sh
printf '%s\\n' "$@" >> "$TMUX_TEST_CAPTURE"
printf '%s\\n' '--call--' >> "$TMUX_TEST_CAPTURE"
printf '%s\\n' '%9'
`,
	{ mode: 0o755 },
);
const savedHerdrEnv = process.env.HERDR_ENV;
const savedHerdrPane = process.env.HERDR_PANE_ID;
const savedWorkspace = process.env.HERDR_WORKSPACE_ID;
const savedTmux = process.env.TMUX;
const savedTmuxPane = process.env.TMUX_PANE;
const savedPath = process.env.PATH;
process.env.PATH = `${fakeBin}:${savedPath}`;
process.env.HERDR_TEST_CAPTURE = captureFile;
const herdr = jiti("./interactive-subagents/pi-extension/subagents/herdr.ts");
try {
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w44:p2";
	assert.equal(herdr.isHerdrAvailable(), true, "isHerdrAvailable under HERDR_ENV=1 + HERDR_PANE_ID + herdr on PATH");
	assert.equal(herdr.isMuxAvailable(), true, "herdr.isMuxAvailable mirrors isHerdrAvailable");

	process.env.HERDR_ENV = "";
	process.env.HERDR_PANE_ID = "";
	assert.equal(herdr.isHerdrAvailable(), false, "isHerdrAvailable false when Herdr env absent");

	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w44:p2";
	process.env.HERDR_WORKSPACE_ID = "stale-workspace";
	const rootPane = herdr.createSurface("scout tab");
	assert.equal(rootPane, "w44:p9");

	herdr.sendCommand(rootPane, "printf ready");
	const messageScript = join(fakeBin, "message.sh");
	assert.equal(
		herdr.sendLongCommand(rootPane, "printf message", { scriptPath: messageScript }),
		messageScript,
	);
	assert.equal(readFileSync(messageScript, "utf8"), "#!/bin/bash\nprintf message\n");
	assert.equal(herdr.readScreen(rootPane, 3), "__SUBAGENT_DONE_0__\n");
	assert.deepEqual(
		await herdr.pollForExit(rootPane, new AbortController().signal, { interval: 1 }),
		{ reason: "sentinel", exitCode: 0 },
	);
	herdr.closeSurface(rootPane);

	assert.deepEqual(readFileSync(captureFile, "utf8").trim().split("\n"), [
		"pane", "get", "w44:p2", "--call--",
		"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
		"--label", "scout tab", "--no-focus", "--call--",
		"pane", "send-text", "w44:p9", "printf ready", "--call--",
		"pane", "send-keys", "w44:p9", "Enter", "--call--",
		"pane", "send-text", "w44:p9", `bash '${messageScript}'`, "--call--",
		"pane", "send-keys", "w44:p9", "Enter", "--call--",
		"pane", "read", "w44:p9", "--source", "recent", "--lines", "3", "--format", "text", "--call--",
		"pane", "read", "w44:p9", "--source", "recent", "--lines", "5", "--format", "text", "--call--",
		"pane", "close", "w44:p9", "--call--",
	]);

	// Herdr absent + tmux present still dispatches to the unchanged pane fallback.
	process.env.HERDR_ENV = "";
	process.env.HERDR_PANE_ID = "";
	process.env.TMUX = "fake-server";
	process.env.TMUX_PANE = "%2";
	process.env.TMUX_TEST_CAPTURE = tmuxCaptureFile;
	const uncachedJiti = createJiti(import.meta.url, { moduleCache: false });
	const tmuxSurface = uncachedJiti("./interactive-subagents/pi-extension/subagents/surface.ts");
	assert.equal(tmuxSurface.activeSurface, "tmux");
	assert.equal(tmuxSurface.createSurface("worker"), "%9");
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.deepEqual(readFileSync(tmuxCaptureFile, "utf8").trim().split("\n"), [
		"split-window", "-d", "-h", "-t", "%2", "-P", "-F", "#{pane_id}", "--call--",
		"select-layout", "-t", "%2", "even-horizontal", "--call--",
	]);
} finally {
	restoreEnv("HERDR_ENV", savedHerdrEnv);
	restoreEnv("HERDR_PANE_ID", savedHerdrPane);
	restoreEnv("HERDR_WORKSPACE_ID", savedWorkspace);
	restoreEnv("TMUX", savedTmux);
	restoreEnv("TMUX_PANE", savedTmuxPane);
	restoreEnv("PATH", savedPath);
	delete process.env.HERDR_TEST_CAPTURE;
	delete process.env.TMUX_TEST_CAPTURE;
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
