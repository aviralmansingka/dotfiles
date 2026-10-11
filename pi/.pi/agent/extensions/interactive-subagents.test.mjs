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

const require = createRequire(import.meta.url);

// Allow CI / other hosts to supply jiti via JITI_PATH; otherwise fall back to
// the captain's macOS homebrew pi install AND the Linux nvm homelab install.
const jitiCandidates = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
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
	"waitForAgentReady",
	"sendAgentPrompt",
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
const readinessFile = join(fakeBin, "agent-get-count");
writeFileSync(
	join(fakeBin, "herdr"),
	`#!/bin/sh
printf '%s\\n' "$@" >> "$HERDR_TEST_CAPTURE"
printf '%s\\n' --call-- >> "$HERDR_TEST_CAPTURE"
case "$1:$2" in
	pane:get) printf '%s\\n' '{"result":{"pane":{"pane_id":"w44:p2","workspace_id":"w44"}}}' ;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"w44:p9"}}}' ;;
	pane:run) [ "$HERDR_TEST_FAIL_SEND" = 1 ] && exit 1; printf '%s\\n' '{"result":{}}' ;;
	pane:read) printf '%s\\n' "$HERDR_TEST_SCREEN" ;;
	agent:get)
		if [ -n "$HERDR_TEST_STATUS" ]; then
			printf '{"result":{"agent":{"agent_status":"%s"}}}\\n' "$HERDR_TEST_STATUS"
		else
			count=0
			[ -f "$HERDR_TEST_READINESS" ] && count=$(cat "$HERDR_TEST_READINESS")
			count=$((count + 1))
			printf '%s' "$count" > "$HERDR_TEST_READINESS"
			if [ "$count" = 1 ]; then
				printf '%s\\n' '{"result":{"agent":{"agent_status":"unknown"}}}'
			else
				printf '%s\\n' '{"result":{"agent":{"agent_status":"idle"}}}'
			fi
		fi
		;;
	agent:prompt) printf '%s\\n' '{"result":{}}' ;;
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
process.env.HERDR_TEST_READINESS = readinessFile;
process.env.PATH = `${fakeBin}:${savedPath}`;
const herdr = createJiti(import.meta.url, { moduleCache: false })(
	"./interactive-subagents/pi-extension/subagents/herdr.ts",
);
const herdrSurface = createJiti(import.meta.url, { moduleCache: false })(
	"./interactive-subagents/pi-extension/subagents/surface.ts",
);
try {
	assert.equal(herdr.isHerdrAvailable(), true);
	const rootPane = herdr.createSurface("auth-review");
	assert.equal(rootPane, "w44:p9");
	herdr.sendCommand(rootPane, "pi --session child.jsonl");
	await herdr.waitForAgentReady(rootPane);
	herdr.sendAgentPrompt(rootPane, "Implement the fix");
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
		["pane", "run", "w44:p9", "pi --session child.jsonl"],
		["agent", "get", "w44:p9"],
		["pane", "read", "w44:p9", "--source", "recent", "--lines", "5", "--format", "text"],
		["agent", "get", "w44:p9"],
		["agent", "prompt", "w44:p9", "Implement the fix"],
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
		["pane", "run", "w44:p9", "false"],
		["pane", "close", "w44:p9"],
	]);

	const startupFailureOffset = calls.length + failedLaunchCalls.length;
	process.env.HERDR_TEST_STATUS = "done";
	process.env.HERDR_TEST_SCREEN = "__SUBAGENT_DONE_1__";
	await assert.rejects(
		herdrSurface.withNewSurface("failed-startup", async (pane) => {
			herdrSurface.sendCommand(pane, "pi --session failed.jsonl");
			await herdrSurface.waitForAgentReady(pane);
			herdrSurface.sendAgentPrompt(pane, "This must not be delivered");
		}),
		/exited with code 1 before becoming ready/,
	);
	delete process.env.HERDR_TEST_STATUS;
	delete process.env.HERDR_TEST_SCREEN;
	const startupFailureCalls = readFileSync(captureFile, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"))
		.slice(startupFailureOffset);
	assert.deepEqual(startupFailureCalls, [
		["pane", "get", "w44:p2"],
		[
			"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
			"--label", "subagent: failed-startup", "--no-focus",
		],
		["pane", "run", "w44:p9", "pi --session failed.jsonl"],
		["agent", "get", "w44:p9"],
		["pane", "read", "w44:p9", "--source", "recent", "--lines", "5", "--format", "text"],
		["pane", "close", "w44:p9"],
	]);

	const cancelledLaunchOffset = calls.length + failedLaunchCalls.length + startupFailureCalls.length;
	process.env.HERDR_TEST_STATUS = "unknown";
	const launchAbort = new AbortController();
	await assert.rejects(
		herdrSurface.withNewSurface("cancelled-startup", async (pane) => {
			herdrSurface.sendCommand(pane, "pi --session cancelled.jsonl");
			setTimeout(() => launchAbort.abort(), 20);
			await herdrSurface.waitForAgentReady(pane, launchAbort.signal);
			launchAbort.signal.throwIfAborted();
			herdrSurface.sendAgentPrompt(pane, "This must not be delivered");
		}),
		/abort/i,
	);
	delete process.env.HERDR_TEST_STATUS;
	const cancelledLaunchCalls = readFileSync(captureFile, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"))
		.slice(cancelledLaunchOffset);
	assert.equal(cancelledLaunchCalls.some((call) => call[0] === "agent" && call[1] === "prompt"), false);
	assert.deepEqual(cancelledLaunchCalls.at(-1), ["pane", "close", "w44:p9"]);

	process.env.HERDR_ENV = "";
	process.env.HERDR_PANE_ID = "";
	assert.equal(herdr.isHerdrAvailable(), false);
} finally {
	if (savedHerdrEnv === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = savedHerdrEnv;
	if (savedHerdrPane === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = savedHerdrPane;
	if (savedWorkspace === undefined) delete process.env.HERDR_WORKSPACE_ID; else process.env.HERDR_WORKSPACE_ID = savedWorkspace;
	if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
	delete process.env.HERDR_TEST_CAPTURE;
	delete process.env.HERDR_TEST_READINESS;
	delete process.env.HERDR_TEST_FAIL_SEND;
	delete process.env.HERDR_TEST_STATUS;
	delete process.env.HERDR_TEST_SCREEN;
	rmSync(fakeBin, { recursive: true, force: true });
}

const initialPrompt = jiti("./interactive-subagents/pi-extension/subagents/initial-prompt.ts");
const encodedInitialPrompt = initialPrompt.encodeSubagentInitialPrompt({
	skills: ["professor", "demo-skill"],
	task: "Explain the launch race.",
});
assert.equal(
	initialPrompt.buildSubagentInitialPrompt(
		encodedInitialPrompt,
		[
			{ name: "professor", filePath: "/trusted/professor/SKILL.md", baseDir: "/trusted/professor" },
			{ name: "demo-skill", filePath: "/extension/demo-skill/SKILL.md", baseDir: "/extension/demo-skill" },
		],
		(skill) => `Resolved instructions for ${skill.name}.`,
	),
	'<skill name="professor" location="/trusted/professor/SKILL.md">\n' +
		'References are relative to /trusted/professor.\n\nResolved instructions for professor.\n</skill>\n\n' +
		'<skill name="demo-skill" location="/extension/demo-skill/SKILL.md">\n' +
		'References are relative to /extension/demo-skill.\n\nResolved instructions for demo-skill.\n</skill>\n\n' +
		"Explain the launch race.",
);
assert.throws(
	() => initialPrompt.buildSubagentInitialPrompt(encodedInitialPrompt, [], () => ""),
	/Subagent skill not found: professor/,
);

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

// --- Runtime profile resolution: bundled defaults, then project overrides ---
assert.deepEqual(agentIsolationArgs("researcher"), []);
assert.deepEqual(agentIsolationArgs("tuicr-review"), []);
const profileRoot = mkdtempSync(join(tmpdir(), "subagent-profile-test-"));
const profileAgentDir = join(profileRoot, ".pi", "agents");
mkdirSync(profileAgentDir, { recursive: true });
const bundledAgentsDir = fileURLToPath(
	new URL("./interactive-subagents/agents", import.meta.url),
);
try {
	const reviewer = loadAgentDefaultsFromPaths("tuicr-review", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.equal(
		reviewer.tools,
		"read, write, edit, bash, grep, find, ls, tuicr, tuicr_reply",
	);
	assert.equal(reviewer.autoExit, true);
	// The reviewer's own instructions must sweep pre-attach comments and stop
	// on any final steer, matching the task the tuicr extension builds.
	assert.match(reviewer.body, /existed before the watcher attached/);
	assert.match(reviewer.body, /tuicr review comments --session <slug> --repo <repo>/);
	assert.match(reviewer.body, /no pi-agent reply/);
	assert.match(reviewer.body, /watcher\s+stopped\s+early/);

	// A project-local profile now overrides the bundled one (no special case).
	writeFileSync(
		join(profileAgentDir, "tuicr-review.md"),
		"---\nname: tuicr-review\ntools: read\n---\nOverride\n",
	);
	const overridden = loadAgentDefaultsFromPaths("tuicr-review", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.equal(overridden.tools, "read");
	assert.equal(overridden.body, "Override");

	const researcher = loadAgentDefaultsFromPaths("researcher", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.equal(
		researcher.tools,
		"web_search, web_fetch, bash, tuicr, tuicr_reply",
	);

	const professor = loadAgentDefaultsFromPaths("professor", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.ok(professor.tools.split(", ").includes("tuicr_reply"));
	assert.ok(professor.tools.split(", ").includes("hunk_open"));
	assert.ok(professor.tools.split(", ").includes("bash"));
	assert.deepEqual(professor.subagentAgents, ["researcher", "tuicr-review"]);
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

// --- List rendering groups definitions by override precedence without losing defaults ---
// Isolate the registration so this check needs only jiti, not the installed Pi UI.
const indexSource = readFileSync(new URL("./interactive-subagents/pi-extension/subagents/index.ts", import.meta.url), "utf8");
const listRegistration = indexSource.split("// ── subagents_list tool ──")[1].split("// ── subagent_message tool ──")[0];
const listTool = jiti.evalModule(`
	const pi = { registerTool: (tool) => { module.exports = tool; } };
	const Type = { Object: (value) => value };
	class Text { constructor(text) { this.text = text; } render() { return this.text.split("\\n"); } }
	${listRegistration}
`, { filename: join(tmpdir(), "subagents-list-render-test.ts") });
const theme = {
	fg: (token, text) => `<${token}>${text}</${token}>`,
	bold: (text) => `<bold>${text}</bold>`,
};
const renderList = (agents) => listTool.renderResult({ details: { agents } }, {}, theme).render(1000).join("\n").trimEnd();
const definitions = [
	{ name: "bundled", source: "package" },
	{ name: "shared", source: "global", model: "test-model" },
	{ name: "local", source: "project", model: "local-model", description: "Local helper" },
	{ name: "plain", source: "global", description: "Shared helper" },
];
assert.equal(renderList(definitions), [
	"<dim>project</dim>",
	" • <toolTitle><bold>local</bold></toolTitle><accent> (project)</accent><dim> [local-model]</dim><dim> — Local helper</dim>",
	"<dim>global</dim>",
	" • <toolTitle><bold>shared</bold></toolTitle><dim> [test-model]</dim>",
	" • <toolTitle><bold>plain</bold></toolTitle><dim> — Shared helper</dim>",
	"<dim>package</dim>",
	" • <toolTitle><bold>bundled</bold></toolTitle>",
].join("\n"));
for (const source of ["project", "global", "package"]) {
	const rendered = renderList(definitions.filter((agent) => agent.source === source));
	assert.equal(rendered.split("\n")[0], `<dim>${source}</dim>`);
	assert.equal((rendered.match(/^<dim>/gm) ?? []).length, 1, "omit empty groups");
}
assert.equal(renderList([]), "<dim>No subagent definitions found.</dim>");
assert.equal(renderList(undefined), "<dim>No subagent definitions found.</dim>");

console.log("interactive-subagents surface smoke passed");
