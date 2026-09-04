import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	agentIsolationArgs,
	loadAgentDefaultsFromPaths,
} from "./interactive-subagents/pi-extension/subagents/agent-definitions.mjs";
import { runHunkReview } from "./interactive-subagents/pi-extension/subagents/tools/hunk-review-core.mjs";

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
	"withNewSurface",
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

// --- Herdr surface detection and labeled tab creation ---
const fakeBin = mkdtempSync(join(tmpdir(), "subagent-herdr-tab-test-"));
const captureFile = join(fakeBin, "calls");
writeFileSync(
	join(fakeBin, "herdr"),
	`#!/bin/sh
printf '%s\\n' "$@" >> "$HERDR_TEST_CAPTURE"
printf '%s\\n' --call-- >> "$HERDR_TEST_CAPTURE"
case "$1:$2" in
	pane:get) printf '%s\\n' '{"result":{"pane":{"pane_id":"w44:p2","workspace_id":"w44"}}}' ;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"w44:p9"}}}' ;;
	pane:send-text) [ "$HERDR_TEST_FAIL_SEND" = 1 ] && exit 1; printf '%s\\n' '{"result":{}}' ;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
	{ mode: 0o755 },
);
const savedHerdrEnv = process.env.HERDR_ENV;
const savedHerdrPane = process.env.HERDR_PANE_ID;
const savedWorkspace = process.env.HERDR_WORKSPACE_ID;
const savedPath = process.env.PATH;
process.env.HERDR_ENV = "1";
process.env.HERDR_PANE_ID = "w44:p2";
process.env.HERDR_WORKSPACE_ID = "stale-workspace";
process.env.HERDR_TEST_CAPTURE = captureFile;
process.env.PATH = `${fakeBin}:${savedPath}`;
const herdr = createJiti(import.meta.url, { moduleCache: false })(
	"./interactive-subagents/pi-extension/subagents/herdr.ts",
);
try {
	assert.equal(herdr.isHerdrAvailable(), true);
	const rootPane = herdr.createSurface("auth-review");
	assert.equal(rootPane, "w44:p9");
	herdr.closeSurface(rootPane);

	const calls = readFileSync(captureFile, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"));
	assert.deepEqual(calls, [
		["pane", "get", "w44:p2"],
		[
			"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
			"--label", "subagent: auth-review", "--no-focus",
		],
		["pane", "close", "w44:p9"],
	]);

	process.env.HERDR_TEST_FAIL_SEND = "1";
	await assert.rejects(
		surface.withNewSurface("broken-launch", async (pane) => {
			surface.sendCommand(pane, "false");
		}),
	);
	delete process.env.HERDR_TEST_FAIL_SEND;
	const failedLaunchCalls = readFileSync(captureFile, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"))
		.slice(calls.length);
	assert.deepEqual(failedLaunchCalls, [
		["pane", "get", "w44:p2"],
		[
			"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
			"--label", "subagent: broken-launch", "--no-focus",
		],
		["pane", "send-text", "w44:p9", "false"],
		["pane", "close", "w44:p9"],
	]);

	process.env.HERDR_ENV = "";
	process.env.HERDR_PANE_ID = "";
	assert.equal(herdr.isHerdrAvailable(), false);
} finally {
	if (savedHerdrEnv === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = savedHerdrEnv;
	if (savedHerdrPane === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = savedHerdrPane;
	if (savedWorkspace === undefined) delete process.env.HERDR_WORKSPACE_ID; else process.env.HERDR_WORKSPACE_ID = savedWorkspace;
	if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
	delete process.env.HERDR_TEST_CAPTURE;
	delete process.env.HERDR_TEST_FAIL_SEND;
	rmSync(fakeBin, { recursive: true, force: true });
}

// --- Arbitrary explicit names remain registered and deduplicate ---
const session = jiti("./interactive-subagents/pi-extension/subagents/session.ts");
const registryDir = mkdtempSync(join(tmpdir(), "subagent-name-registry-test-"));
try {
	const entry = { sessionFile: "/tmp/proto-session.jsonl", sessionId: "proto-session" };
	session.registerName(registryDir, "__proto__", entry);
	assert.deepEqual(session.resolveNameInRegistry(registryDir, "__proto__"), entry);
	const registryNames = new Set(Object.keys(session.readNameRegistry(registryDir)));
	assert.deepEqual([...registryNames], ["__proto__"]);
	assert.equal(session.uniqueSubagentName("__proto__", registryNames), "__proto__-2");
} finally {
	rmSync(registryDir, { recursive: true, force: true });
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

// --- Runtime profile resolution pins and isolates the read-only reviewer ---
assert.deepEqual(agentIsolationArgs("researcher"), []);
assert.deepEqual(agentIsolationArgs("hunk-review"), ["--no-extensions"]);
const profileRoot = mkdtempSync(join(tmpdir(), "subagent-profile-test-"));
const profileAgentDir = join(profileRoot, ".pi", "agents");
mkdirSync(profileAgentDir, { recursive: true });
writeFileSync(
	join(profileAgentDir, "hunk-review.md"),
	"---\nname: hunk-review\ntools: read, write, edit, bash\n---\nOverride\n",
);
const bundledAgentsDir = fileURLToPath(
	new URL("./interactive-subagents/agents", import.meta.url),
);
try {
	const reviewer = loadAgentDefaultsFromPaths("hunk-review", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.equal(reviewer.tools, "read, grep, find, ls, hunk_review");
	assert.equal(reviewer.skills, "hunk-review");
	assert.equal(reviewer.autoExit, true);

	const professor = loadAgentDefaultsFromPaths("professor", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.ok(professor.tools.split(", ").includes("hunk_open"));
	assert.deepEqual(professor.subagentAgents, ["researcher", "hunk-review"]);
	assert.equal(professor.skills, "professor");
	assert.equal(professor.autoExit, false);
} finally {
	rmSync(profileRoot, { recursive: true, force: true });
}

// --- No Mistakes compact status follows the shared activity-widget contract ---
const { noMistakesFindingLines, noMistakesIsWaiting, noMistakesWidgetStatus } = jiti(
	"./interactive-subagents/pi-extension/subagents/no-mistakes.ts",
);
const pipelineActivity = {
	id: "01TEST",
	status: "running",
	gate: "review",
	summary: "review · 12s · 17s total",
	phases: [{ name: "review", status: "awaiting_approval", findings: 3 }],
	reviewFindings: [
		{ severity: "error", file: "src/a.ts", description: "Null value reaches renderer" },
		{ severity: "warning", file: "src/b.ts", description: "Missing cleanup" },
		{ severity: "info", description: "Context only" },
		{ severity: "error", file: "src/c.ts", description: "Fourth explicit finding" },
		{ severity: "unknown", description: "Count-only finding" },
	],
};
assert.equal(noMistakesWidgetStatus(pipelineActivity), " review · 12s · 17s total ");
assert.equal(noMistakesIsWaiting(pipelineActivity), true);
assert.equal(noMistakesIsWaiting({ ...pipelineActivity, gate: undefined, outcome: "checks-passed" }), true);
assert.equal(noMistakesIsWaiting({ ...pipelineActivity, gate: undefined, outcome: undefined }), false);
assert.deepEqual(noMistakesFindingLines(pipelineActivity), [
	"❌ src/a.ts: Null value reaches renderer",
	"⚠️ src/b.ts: Missing cleanup",
	"ℹ️ Context only",
	"❌ src/c.ts: Fourth explicit finding",
]);

// --- The reviewer tool exposes only Hunk inspection and comment application ---
const hunkToolRoot = mkdtempSync(join(tmpdir(), "hunk-review-tool-test-"));
const hunkArgsFile = join(hunkToolRoot, "args");
const hunkInputFile = join(hunkToolRoot, "input");
writeFileSync(
	join(hunkToolRoot, "hunk"),
	`#!/bin/sh
printf '%s\\n' "$@" > "$HUNK_TEST_ARGS"
cat > "$HUNK_TEST_INPUT"
printf '%s\\n' '{"ok":true}'
`,
	{ mode: 0o755 },
);
const savedToolPath = process.env.PATH;
process.env.PATH = `${hunkToolRoot}:${savedToolPath}`;
process.env.HUNK_TEST_ARGS = hunkArgsFile;
process.env.HUNK_TEST_INPUT = hunkInputFile;
try {
	runHunkReview(hunkToolRoot, { operation: "review", includePatch: true });
	assert.deepEqual(readFileSync(hunkArgsFile, "utf8").trim().split("\n"), [
		"session", "review", "--repo", ".", "--include-patch", "--json",
	]);

	runHunkReview(hunkToolRoot, {
		operation: "comment_apply",
		comments: [{ filePath: "src/app.ts", newLine: 9, summary: "Handle failure" }],
	});
	assert.deepEqual(readFileSync(hunkArgsFile, "utf8").trim().split("\n"), [
		"session", "comment", "apply", "--repo", ".", "--stdin", "--json",
	]);
	assert.deepEqual(JSON.parse(readFileSync(hunkInputFile, "utf8")), {
		comments: [{
			filePath: "src/app.ts",
			newLine: 9,
			summary: "Handle failure",
			author: "Hunk reviewer",
		}],
	});
} finally {
	if (savedToolPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedToolPath;
	delete process.env.HUNK_TEST_ARGS;
	delete process.env.HUNK_TEST_INPUT;
	rmSync(hunkToolRoot, { recursive: true, force: true });
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
