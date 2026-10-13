import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	agentIsolationArgs,
	loadAgentDefaultsFromPaths,
	parseAgentDefinition,
} from "./interactive-subagents/pi-extension/subagents/agent-definitions.mjs";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);

// Shared jiti resolution (test-lib): JITI_PATH/NODE_PATH or the pi-managed
// install; this file's historical macOS homebrew and homelab nvm installs
// stay as caller fallbacks.
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
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
	pane:get)
		if [ "$HERDR_TEST_PANE_GET_FAIL" = 1 ]; then
			printf '%s\\n' '{}'
		else
			printf '%s\\n' '{"result":{"pane":{"pane_id":"w44:p2","workspace_id":"w44"}}}'
		fi
		;;
	tab:create)
		if [ "$HERDR_TEST_TAB_NO_PANE" = 1 ]; then
			printf '%s\\n' '{"result":{"tab":{"tab_id":"w44:t9"}}}'
		elif [ "$HERDR_TEST_TAB_NO_PANE" = 2 ]; then
			printf '%s\\n' '{}'
		else
			printf '%s\\n' '{"result":{"root_pane":{"pane_id":"w44:p9"}}}'
		fi
		;;
	pane:run) [ "$HERDR_TEST_FAIL_SEND" = 1 ] && exit 1; printf '%s\\n' '{"result":{}}' ;;
	pane:split) printf '%s\\n' '{"result":{"pane":{"pane_id":"w44:p10"}}}' ;;
	pane:read)
		if [ "$HERDR_TEST_READ_FAIL" = 1 ]; then
			exit 1
		else
			printf '%s\\n' "$HERDR_TEST_SCREEN"
		fi
		;;
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

	// --- Readiness gate completion: blocked startup, timeout, pre-aborted signal ---
	const callsAfter = (offset) =>
		readFileSync(captureFile, "utf8")
			.split("--call--\n")
			.filter(Boolean)
			.map((call) => call.trim().split("\n"))
			.slice(offset);
	const readinessOffset =
		calls.length + failedLaunchCalls.length + startupFailureCalls.length + cancelledLaunchCalls.length;

	// A blocked subagent aborts the launch and never receives its prompt (#216).
	process.env.HERDR_TEST_STATUS = "blocked";
	await assert.rejects(
		herdrSurface.withNewSurface("blocked-startup", async (pane) => {
			herdrSurface.sendCommand(pane, "pi --session blocked.jsonl");
			await herdrSurface.waitForAgentReady(pane);
			herdrSurface.sendAgentPrompt(pane, "This must not be delivered");
		}),
		/blocked during startup/,
	);
	delete process.env.HERDR_TEST_STATUS;
	const blockedCalls = callsAfter(readinessOffset);
	assert.equal(
		blockedCalls.some((call) => call[0] === "agent" && call[1] === "prompt"),
		false,
		"a blocked startup must never receive the prompt",
	);
	assert.deepEqual(blockedCalls.at(-1), ["pane", "close", "w44:p9"]);

	// A subagent that never becomes ready times out and its pane is closed.
	process.env.HERDR_TEST_STATUS = "unknown";
	await assert.rejects(
		herdrSurface.withNewSurface("timeout-startup", async (pane) => {
			herdrSurface.sendCommand(pane, "pi --session timeout.jsonl");
			await herdrSurface.waitForAgentReady(pane, undefined, 250);
		}),
		/Timed out waiting for subagent/,
	);
	delete process.env.HERDR_TEST_STATUS;
	const timeoutCalls = callsAfter(readinessOffset + blockedCalls.length);
	assert.deepEqual(timeoutCalls.at(-1), ["pane", "close", "w44:p9"]);

	// An already-aborted signal rejects before any polling call.
	const preAbortedOffset = readinessOffset + blockedCalls.length + timeoutCalls.length;
	const preAborted = new AbortController();
	preAborted.abort();
	await assert.rejects(herdrSurface.waitForAgentReady("w44:p9", preAborted.signal), /abort/i);
	assert.deepEqual(callsAfter(preAbortedOffset), [], "an aborted signal must not poll the pane");

	// sendLongCommand stages the command in a script file and runs bash on it.
	const longScript = join(fakeBin, "long-cmd.sh");
	herdr.sendLongCommand("w44:p9", "echo hello world", {
		scriptPath: longScript,
		scriptPreamble: "set -x",
	});
	assert.equal(readFileSync(longScript, "utf8"), "#!/bin/bash\nset -x\necho hello world\n");
	assert.deepEqual(callsAfter(preAbortedOffset), [
		["pane", "run", "w44:p9", `bash '${longScript}'`],
	]);

	// A failed live-workspace lookup fails BEFORE any tab is created, so no
	// orphaned tab can leak (#208/#209).
	const paneGetFailOffset = preAbortedOffset + 1;
	process.env.HERDR_TEST_PANE_GET_FAIL = "1";
	assert.throws(() => herdr.createSurface("orphan-check"), /Unexpected Herdr pane output/);
	delete process.env.HERDR_TEST_PANE_GET_FAIL;
	assert.deepEqual(
		callsAfter(paneGetFailOffset),
		[["pane", "get", "w44:p2"]],
		"no tab create may follow a failed workspace lookup",
	);

	// C31: a `tab create` answer without a pane id leaves the caller no close
	// target (withNewSurface closes by pane id). The recovery closes the tab
	// the response DOES name, so no empty tab leaks, and the malformed
	// response still fails loudly.
	const paneLessOffset = paneGetFailOffset + 1;
	process.env.HERDR_TEST_TAB_NO_PANE = "1";
	assert.throws(() => herdr.createSurface("pane-less"), /Unexpected Herdr surface creation output/);
	delete process.env.HERDR_TEST_TAB_NO_PANE;
	assert.deepEqual(callsAfter(paneLessOffset), [
		["pane", "get", "w44:p2"],
		[
			"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
			"--label", "subagent: pane-less", "--no-focus",
		],
		["tab", "close", "w44:t9"],
	], "the pane-less tab-create answer closes the tab it named — no leak");

	// A response carrying NEITHER a pane id nor a tab id still fails loudly;
	// there is simply nothing to close.
	const noIdsOffset = paneLessOffset + 3;
	process.env.HERDR_TEST_TAB_NO_PANE = "2";
	assert.throws(() => herdr.createSurface("no-ids"), /Unexpected Herdr surface creation output/);
	delete process.env.HERDR_TEST_TAB_NO_PANE;
	assert.deepEqual(callsAfter(noIdsOffset), [
		["pane", "get", "w44:p2"],
		[
			"tab", "create", "--workspace", "w44", "--cwd", process.cwd(),
			"--label", "subagent: no-ids", "--no-focus",
		],
	], "an id-less response closes nothing and still throws");

	// A successful launch keeps its pane open — only failures close it.
	const successOffset = noIdsOffset + 2;
	const kept = await herdrSurface.withNewSurface("good-launch", async (pane) => {
		herdrSurface.sendCommand(pane, "pi --session good.jsonl");
		return "kept-open";
	});
	assert.equal(kept, "kept-open");
	const successCalls = callsAfter(successOffset);
	assert.equal(
		successCalls.some((call) => call[0] === "pane" && call[1] === "close"),
		false,
		"a successful launch must not close its pane",
	);
	assert.deepEqual(successCalls.at(-1), ["pane", "run", "w44:p9", "pi --session good.jsonl"]);

	// The default long-command script lands under the shared temp script dir.
	const defaultScript = herdr.sendLongCommand("w44:p9", "true");
	assert.ok(defaultScript.startsWith(join(tmpdir(), "pi-subagent-scripts")));
	assert.equal(readFileSync(defaultScript, "utf8"), "#!/bin/bash\ntrue\n");
	rmSync(defaultScript, { force: true });

	// --- pollForExit end-to-end: sidecar, sentinel file, screen, killed, abort ---
	const pollAndCalls = async (run) => {
		const before = callsAfter(0).length;
		const result = await run();
		return { result, calls: callsAfter(before) };
	};
	const sidecarSessionFile = join(fakeBin, "sidecar-session.jsonl");
	writeFileSync(`${sidecarSessionFile}.exit`, JSON.stringify({ type: "error", errorMessage: "overloaded" }));
	{
		const { result, calls } = await pollAndCalls(() =>
			herdr.pollForExit("w44:p9", new AbortController().signal, {
				interval: 20,
				sessionFile: sidecarSessionFile,
			}),
		);
		assert.deepEqual(result, { reason: "error", exitCode: 1, errorMessage: "overloaded" });
		assert.deepEqual(calls, [], "the sidecar fast path polls no panes");
		assert.equal(existsSync(`${sidecarSessionFile}.exit`), false, "the sidecar is consumed once read");
	}
	{
		const sentinelFlag = join(fakeBin, "sentinel-flag");
		writeFileSync(sentinelFlag, "");
		const { result, calls } = await pollAndCalls(() =>
			herdr.pollForExit("w44:p9", new AbortController().signal, {
				interval: 20,
			sentinelFile: sentinelFlag,
			}),
		);
		assert.deepEqual(result, { reason: "sentinel", exitCode: 0 });
		assert.deepEqual(calls, [], "a sentinel file needs no pane read");
	}
	process.env.HERDR_TEST_SCREEN = "ready-screen";
	assert.equal(herdr.readScreen("w44:p9", 5), "ready-screen\n");
	process.env.HERDR_TEST_SCREEN = "__SUBAGENT_DONE_7__";
	{
		const { result } = await pollAndCalls(() =>
			herdr.pollForExit("w44:p9", new AbortController().signal, { interval: 20 }),
		);
		assert.deepEqual(result, { reason: "sentinel", exitCode: 7 });
	}
	process.env.HERDR_TEST_READ_FAIL = "1";
	{
		const { result } = await pollAndCalls(() =>
			herdr.pollForExit("w44:p9", new AbortController().signal, { interval: 20 }),
		);
		assert.deepEqual(result, { reason: "killed", exitCode: 130 }, "a dead pane reads as killed");
	}
	delete process.env.HERDR_TEST_READ_FAIL;
	delete process.env.HERDR_TEST_SCREEN;
	{
		const pollAborted = new AbortController();
		pollAborted.abort();
		const { calls } = await pollAndCalls(() =>
			assert.rejects(
				herdr.pollForExit("w44:p9", pollAborted.signal, { interval: 20 }),
				/Aborted while waiting/,
			),
		);
		assert.deepEqual(calls, [], "an aborted poll touches no panes");
	}
	{
		// An abort that lands mid-wait rejects through the sleep's listener.
		const midPoll = new AbortController();
		const abortTimer = setTimeout(() => midPoll.abort(), 30);
		try {
			await assert.rejects(
				herdr.pollForExit("w44:p9", midPoll.signal, { interval: 50 }),
				/Aborted/,
			);
		} finally {
			clearTimeout(abortTimer);
		}
	}

	// Herdr exposes only right/down splits; left/up map onto them.
	{
		const before = callsAfter(0).length;
		assert.equal(herdr.createSurfaceSplit("dir-test", "left", "w44:p2"), "w44:p10");
		assert.equal(herdr.createSurfaceSplit("dir-test", "up"), "w44:p10");
		assert.deepEqual(callsAfter(before), [
			["pane", "split", "w44:p2", "--direction", "right", "--ratio", "0.5", "--no-focus"],
			["pane", "split", "--direction", "down", "--ratio", "0.5", "--no-focus"],
		]);
	}

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
	delete process.env.HERDR_TEST_PANE_GET_FAIL;
	delete process.env.HERDR_TEST_READ_FAIL;
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

// Invalid payloads are rejected, never decoded into a broken prompt (#216).
const shapePayload = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
assert.throws(
	() => initialPrompt.buildSubagentInitialPrompt(
		Buffer.from("not json at all", "utf8").toString("base64url"),
		[],
		() => "",
	),
	/Unexpected|Invalid subagent initial prompt/,
	"undecodable input throws instead of producing a prompt",
);
for (const bad of [
	{ skills: "professor", task: "x" },
	{ skills: ["professor"], task: 5 },
	{ task: "no skills key" },
]) {
	assert.throws(
		() => initialPrompt.buildSubagentInitialPrompt(shapePayload(bad), [], () => ""),
		/Invalid subagent initial prompt/,
		JSON.stringify(bad),
	);
}
// A payload with no skills round-trips to just the task text.
assert.equal(
	initialPrompt.buildSubagentInitialPrompt(
		initialPrompt.encodeSubagentInitialPrompt({ skills: [], task: "Only the task." }),
		[],
		() => "",
	),
	"Only the task.",
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

	// A corrupt registry file reads as empty, never crashes the spawner (#209).
	writeFileSync(session.nameRegistryPath(registryDir), "{not json");
	const corrupt = session.readNameRegistry(registryDir);
	assert.equal(Object.getPrototypeOf(corrupt), null, "registry keeps a null prototype");
	assert.deepEqual(Object.keys(corrupt), []);
	// An entry without a usable sessionFile does not resolve.
	writeFileSync(
		session.nameRegistryPath(registryDir),
		JSON.stringify({ bad: { sessionFile: 5, sessionId: null } }),
	);
	assert.equal(session.resolveNameInRegistry(registryDir, "bad"), null);
	// Registration overwrites an existing name mapping.
	session.registerName(registryDir, "worker", { sessionFile: "/tmp/a.jsonl", sessionId: "a" });
	session.registerName(registryDir, "worker", { sessionFile: "/tmp/b.jsonl", sessionId: "b" });
	assert.deepEqual(session.resolveNameInRegistry(registryDir, "worker"), {
		sessionFile: "/tmp/b.jsonl",
		sessionId: "b",
	});
	// Disambiguation walks the -2, -3, … chain without gaps.
	assert.equal(session.uniqueSubagentName("worker", new Set(["worker", "worker-2"])), "worker-3");
	assert.equal(session.uniqueSubagentName("fresh", new Set(["worker"])), "fresh");
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

	// agent-dir frontmatter: "parent" is the only supported policy value.
	assert.equal(parseAgentDefinition("---\nname: x\nagent-dir: parent\n---\nBody").agentDir, "parent");
	assert.equal(parseAgentDefinition("---\nname: x\n---\nBody").agentDir, undefined, "omission parses to undefined");
	assert.equal(parseAgentDefinition("---\nname: x\nagent-dir: repo\n---\nBody").agentDir, undefined, "unsupported value parses to undefined");
	const orchestrator = loadAgentDefaultsFromPaths("nm-orchestrator", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.equal(orchestrator.agentDir, "parent");
	assert.equal(orchestrator.tools, "no_mistakes_axi, read");

	const researcher = loadAgentDefaultsFromPaths("researcher", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.equal(
		researcher.tools,
		"web_search, web_fetch, bash, mermaid, tuicr, tuicr_reply",
	);

	const professor = loadAgentDefaultsFromPaths("professor", {
		cwd: profileRoot,
		configDir: join(profileRoot, "global-agent-config"),
		bundledDir: bundledAgentsDir,
	});
	assert.ok(professor.tools.split(", ").includes("tuicr_reply"));
	assert.ok(professor.tools.split(", ").includes("bash"));
	assert.deepEqual(professor.subagentAgents, ["researcher", "tuicr-review"]);
	assert.equal(professor.skills, "professor");
	assert.equal(professor.autoExit, false);
} finally {
	rmSync(profileRoot, { recursive: true, force: true });
}

// --- Bundled agents inherit the session model; per-agent thinking stays ---
{
	const expectedThinking = {
		scout: "low",
		researcher: "medium",
		worker: "high",
		"tuicr-review": "high",
		professor: "high",
		"research-orchestrator": "high",
		"nm-orchestrator": undefined,
	};
	for (const [name, thinking] of Object.entries(expectedThinking)) {
		const defs = loadAgentDefaultsFromPaths(name, {
			cwd: tmpdir(),
			configDir: tmpdir(),
			bundledDir: bundledAgentsDir,
		});
		assert.equal(defs.model, undefined, `${name} inherits the session model (no model pin)`);
		assert.equal(defs.thinking, thinking, `${name} keeps its thinking level on the inherited model`);
	}
	// With no model pin, the standalone --thinking behavior is asserted for
	// real through the whole-load __test__ hooks in the applySandboxToParts
	// section of the index.ts whole-load block below.
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

// --- List rendering, baseline renderer, and applySandboxToParts behavior ---
// These were the last source-string-split eval blocks (C29): index.ts is
// whole-loadable through __test__ hooks and a registered-tools harness, so
// the assertions now drive the loaded module's real functions inside the
// whole-load block below (list renderer via the registered subagents_list
// tool; baseline + sandbox via __test__ hooks with a fixture agent dir).
// --- session.ts: seeding, id resolution, result extraction, stats ---
{
	const sessionRoot = mkdtempSync(join(tmpdir(), "subagent-session-core-"));
	try {
		const parent = join(sessionRoot, "parent.jsonl");
		writeFileSync(
			parent,
			[
				JSON.stringify({ type: "session", id: "s0", cwd: "/a" }),
				JSON.stringify({
					type: "message",
					id: "m1",
					message: { role: "user", content: [{ type: "text", text: "do it" }] },
				}),
				JSON.stringify({
					type: "message",
					id: "m2",
					message: {
						role: "assistant",
						model: "test-model",
						content: [{ type: "text", text: "working" }],
						usage: { input: 10, output: 20, cacheRead: 1, cacheWrite: 2, totalTokens: 30, cost: { total: 0.5 } },
					},
				}),
				JSON.stringify({
					type: "message",
					id: "m3",
					message: { role: "user", content: [{ type: "text", text: "more" }] },
				}),
			].join("\n") + "\n",
		);

		// A fork keeps history before the last user turn, minus session headers.
		const fork = join(sessionRoot, "fork.jsonl");
		session.seedSubagentSessionFile({
			mode: "fork",
			parentSessionFile: parent,
			childSessionFile: fork,
			childCwd: sessionRoot,
		});
		const forkEntries = readFileSync(fork, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
		assert.equal(forkEntries.length, 3, "fresh header + two history entries");
		assert.equal(forkEntries[0].type, "session");
		assert.equal(forkEntries[0].parentSession, parent);
		assert.equal(forkEntries[0].cwd, sessionRoot);
		assert.deepEqual(forkEntries.slice(1).map((entry) => entry.id), ["m1", "m2"]);

		// Lineage-only seeds just the header — no history copy.
		const lineage = join(sessionRoot, "lineage.jsonl");
		session.seedSubagentSessionFile({
			mode: "lineage-only",
			parentSessionFile: parent,
			childSessionFile: lineage,
			childCwd: sessionRoot,
		});
		const lineageEntries = readFileSync(lineage, "utf8").split("\n").filter(Boolean);
		assert.equal(lineageEntries.length, 1);
		assert.equal(JSON.parse(lineageEntries[0]).type, "session");

		assert.equal(session.getSessionId(parent), "s0");
		assert.equal(session.getLeafId(parent), "m3");
		assert.equal(session.getSessionId(join(sessionRoot, "missing.jsonl")), null);

		// The last assistant text wins; an error stop with no text falls back to
		// the error message; no assistant at all returns null.
		assert.equal(session.findLastAssistantMessage(session.getNewEntries(parent, 0)), "working");
		const errored = [
			JSON.stringify({ type: "message", id: "e1", message: { role: "assistant", content: [{ type: "text", text: " " }], stopReason: "error", errorMessage: "rate limited" } }),
		].join("\n");
		assert.equal(
			session.findLastAssistantMessage([JSON.parse(errored)]),
			"Subagent error: rate limited",
		);
		assert.equal(
			session.findLastAssistantMessage([
				JSON.stringify({ type: "message", id: "u1", message: { role: "user", content: [] } }),
			].map((line) => JSON.parse(line))),
			null,
		);

		// Session id resolution: exact, then prefix; unknown ids miss.
		const sessionsDir = join(sessionRoot, "sessions");
		mkdirSync(sessionsDir, { recursive: true });
		const fileA = join(sessionsDir, "a.jsonl");
		const fileB = join(sessionsDir, "b.jsonl");
		writeFileSync(fileA, JSON.stringify({ type: "session", id: "abc123", cwd: "/a" }) + "\n");
		writeFileSync(fileB, JSON.stringify({ type: "session", id: "xyz789", cwd: "/b" }) + "\n");
		session.resetSessionIndexCache();
		assert.equal(session.resolveSessionFileById("abc123", sessionsDir), fileA);
		assert.equal(session.resolveSessionFileById("xyz", sessionsDir), fileB);
		assert.equal(session.resolveSessionFileById("zzz", sessionsDir), null);
		assert.equal(session.resolveSessionFileById("", sessionsDir), null);
		assert.equal(await session.resolveSessionFileByIdAsync("abc123", sessionsDir), fileA);

		// Aggregate stats: model, token usage, context size, cost.
		assert.deepEqual(session.summarizeSessionStats(parent), {
			model: "test-model",
			toolCount: 0,
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			contextTokens: 30,
			cost: 0.5,
		});
		assert.equal(session.summarizeSessionStats(join(sessionRoot, "missing.jsonl")), null);

		// Entry counting and merging drive the resume path.
		assert.equal(session.countSessionEntryLines(parent), 4);
		const mergeTarget = join(sessionRoot, "merged.jsonl");
		const merged = session.mergeNewEntries(parent, mergeTarget, 3);
		assert.deepEqual(merged.map((entry) => entry.id), ["m3"]);
		assert.equal(
			readFileSync(mergeTarget, "utf8").trim(),
			JSON.stringify({ type: "message", id: "m3", message: { role: "user", content: [{ type: "text", text: "more" }] } }),
		);
	} finally {
		rmSync(sessionRoot, { recursive: true, force: true });
	}
}

// --- Agent definition parsing: every frontmatter key, and loud misses ---
assert.equal(parseAgentDefinition("no frontmatter here", "fallback"), null);
const richProfile = parseAgentDefinition(
	[
		"---",
		"name: rich",
		"description: Rich profile",
		"model: test-model",
		"tools: read, bash",
		"system-prompt: append",
		"skill: professor",
		"thinking: high",
		"subagent_agents: researcher, tuicr-review",
		"auto-exit: true",
		"interactive: false",
		"session-mode: fork",
		"agent-dir: parent",
		"cwd: /work",
		"cli: pi",
		"disable-model-invocation: true",
		"---",
		"Body text.",
	].join("\n"),
	"fallback",
);
assert.equal(richProfile.name, "rich");
assert.equal(richProfile.description, "Rich profile");
assert.equal(richProfile.model, "test-model");
assert.equal(richProfile.tools, "read, bash");
assert.equal(richProfile.systemPromptMode, "append");
assert.equal(richProfile.skills, "professor");
assert.equal(richProfile.thinking, "high");
assert.deepEqual(richProfile.subagentAgents, ["researcher", "tuicr-review"]);
assert.equal(richProfile.autoExit, true);
assert.equal(richProfile.interactive, false);
assert.equal(richProfile.sessionMode, "fork");
assert.equal(richProfile.agentDir, "parent");
assert.equal(richProfile.cwd, "/work");
assert.equal(richProfile.cli, "pi");
assert.equal(richProfile.disableModelInvocation, true);
assert.equal(richProfile.body, "Body text.");
// Unsupported enum values parse to undefined, never to a bad string.
const looseProfile = parseAgentDefinition(
	"---\nname: loose\nsystem-prompt: merge\nsession-mode: hybrid\nauto-exit: yes\n---\n",
	"loose",
);
assert.equal(looseProfile.systemPromptMode, undefined);
assert.equal(looseProfile.sessionMode, undefined);
assert.equal(looseProfile.autoExit, false, "any value except true parses to an explicit false");
assert.equal(parseAgentDefinition("---\nname: unset\n---\n", "unset").autoExit, undefined, "an omitted flag stays undefined");
// An unknown agent name resolves to nothing — callers must treat that as a
// missing profile, never as an unrestricted spawn.
assert.equal(
	loadAgentDefaultsFromPaths("ghost-agent", {
		cwd: tmpdir(),
		configDir: tmpdir(),
		bundledDir: bundledAgentsDir,
	}),
	null,
);

// --- index.ts loads whole under stub aliases: __test__ hooks are real behavior ---
// The pi-package imports are stubbed the same way nvim-open.test.mjs stubs
// them, so the module's own test hooks can be exercised directly instead of
// string-splitting the source.
{
	const loadRoot = mkdtempSync(join(tmpdir(), "subagent-index-load-"));
	const loadBin = join(loadRoot, "bin");
	const stubDir = join(loadRoot, "stubs");
	const agentConfigDir = join(loadRoot, "agent-config");
	mkdirSync(loadBin, { recursive: true });
	mkdirSync(stubDir, { recursive: true });
	mkdirSync(agentConfigDir, { recursive: true });
	writeFileSync(join(loadBin, "herdr"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
	writeFileSync(join(loadBin, "tmux"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
	writeFileSync(
		join(stubDir, "agent.cjs"),
		"exports.defineTool = (tool) => tool;\nexports.keyHint = () => 'hint';\n",
	);
	writeFileSync(
		join(stubDir, "ai.cjs"),
		"exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n",
	);
	writeFileSync(
		join(stubDir, "tui.cjs"),
		[
			"exports.Box = class Box { constructor(...a) { this.a = a; } };",
			"exports.Text = class Text { constructor(text) { this.text = text; } render() { return String(this.text).split('\\n'); } };",
			"exports.truncateToWidth = (text, width) => String(text).slice(0, Math.max(0, width));",
			"exports.visibleWidth = (text) => String(text).length;",
			"",
		].join("\n"),
	);
	const savedLoadEnv = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_SUBAGENT_ALLOWED: process.env.PI_SUBAGENT_ALLOWED,
		PI_SUBAGENT_AGENT: process.env.PI_SUBAGENT_AGENT,
	};
	try {
		process.env.PATH = `${loadBin}:${savedLoadEnv.PATH}`;
		delete process.env.HERDR_ENV;
		delete process.env.HERDR_PANE_ID;
		delete process.env.TMUX;
		delete process.env.TMUX_PANE;
		delete process.env.PI_SUBAGENT_ALLOWED;
		delete process.env.PI_SUBAGENT_AGENT;
		process.env.PI_CODING_AGENT_DIR = agentConfigDir;
		const index = createJiti(import.meta.url, {
			alias: {
				"@earendil-works/pi-coding-agent": join(stubDir, "agent.cjs"),
				"@earendil-works/pi-ai": join(stubDir, "ai.cjs"),
				"@earendil-works/pi-tui": join(stubDir, "tui.cjs"),
			},
		})(new URL("./interactive-subagents/pi-extension/subagents/index.ts", import.meta.url).href);
		const hooks = index.__test__;

		// Parallel-spawn name reservation: reserve, disambiguate, release (#209).
		hooks.reservedNames.add("worker");
		assert.equal(hooks.uniqueRunningName("worker"), "worker-2");
		assert.equal(hooks.uniqueRunningName("worker", new Set(["worker", "worker-2"])), "worker-3");
		hooks.reservedNames.delete("worker");
		assert.equal(hooks.uniqueRunningName("worker"), "worker");

		// Tool allowlist construction: empty stays unrestricted; grants are additive.
		assert.equal(hooks.buildSubagentToolAllowlist(undefined), null);
		assert.equal(hooks.buildSubagentToolAllowlist("read, bash"), "read,bash,ask_question");
		assert.deepEqual(
			hooks.buildSubagentToolAllowlist("read", { grantSpawning: true }).split(",").sort(),
			["ask_question", "read", "subagent", "subagent_message", "subagents_list"],
		);

		// The ready-path prompt embeds the exact skills + task payload (#216).
		const readyPrompt = hooks.buildPiReadyPrompt({
			effectiveSkills: "professor, demo-skill",
			task: "Explain.",
		});
		assert.match(readyPrompt, /^\/interactive-subagent-start /);
		assert.deepEqual(
			JSON.parse(Buffer.from(readyPrompt.split(" ")[1], "base64url").toString("utf8")),
			{ skills: ["professor", "demo-skill"], task: "Explain." },
		);
		assert.equal(hooks.buildPiReadyPrompt({ effectiveSkills: "", task: "Plain." }), "Plain.");

		// Minimized widget (ctrl+s): the full box collapses to one line that
		// counts every live state; names and per-agent rows disappear.
		{
			const now = Date.now();
			const mkState = (over = {}) => ({
				source: "pi",
				startTimeMs: now - 60_000,
				firstObservationAtMs: now - 60_000,
				lastActivityAtMs: now - 5_000,
				lastActivitySequence: 3,
				localOverrideAtMs: null,
				localOverrideSequence: null,
				activeNow: false,
				activeSinceMs: null,
				activeScope: null,
				waitingSinceMs: null,
				phase: "active",
				latestEvent: "tool",
				activityLabel: null,
				snapshotState: "present",
				snapshotProblemSinceMs: null,
				snapshotError: null,
				currentKind: "active",
				...over,
			});
			const mkAgent = (name, statusState, agent) => ({
				id: name,
				toolCallId: "",
				name,
				task: "t",
				surface: "herdr:1",
				startTime: now - 60_000,
				sessionFile: "/tmp/none.jsonl",
				statusState,
				interactive: true,
				...(agent ? { agent } : {}),
			});
			const agents = [
				mkAgent("scout", mkState()),
				mkAgent("planner", mkState({ phase: "waiting", waitingSinceMs: now - 10_000 })),
				mkAgent(
					"worker-2",
					mkState({
						snapshotState: "missing",
						lastActivityAtMs: null,
						firstObservationAtMs: now - 120_000,
					}),
				),
			];
			const expanded = hooks.renderSubagentWidgetLines(agents, 80);
			assert.equal(expanded.length, 5, "expanded box: top + one row per agent + bottom");
			assert.ok(expanded.some((line) => line.includes("planner")), "expanded rows name each agent");

			const minimized = hooks.renderSubagentWidgetLines(agents, 80, null, true);
			assert.equal(minimized.length, 1, "minimized widget is exactly one line");
			assert.match(minimized[0], /3 running: 1 active · 1 waiting · 1 stalled/);
			assert.ok(!minimized[0].includes("planner"), "minimized line drops agent names");

			// Pipeline mode: the no-mistakes row joins the counts under the
			// Activities title and the active word.
			const pipelined = hooks.renderSubagentWidgetLines([agents[0]], 80, pipelineActivity, true);
			assert.match(pipelined[0], /Activities/);
			assert.match(pipelined[0], /2 active: 1 active · 1 waiting/);

			// The ctrl+s handler flips module state; the next render picks it up.
			assert.equal(hooks.toggleWidgetMinimized(), true);
			assert.equal(hooks.toggleWidgetMinimized(), false);
		}

		// Loadout REPLAY behavior: a recorded allowlist naming a tool with no
		// backing extension still lands in --tools but gets no -e helper pair
		// (the resume path replays snapshots exactly). A PROFILE can no longer
		// produce such an allowlist — the C30 spawn gate below refuses it
		// loudly before any surface is created.
		const unknownToolParts = [];
		hooks.applySandboxToParts(
			unknownToolParts,
			{
				agent: null,
				model: null,
				thinking: null,
				systemPromptMode: null,
				identity: null,
				toolAllowlist: "not_a_real_tool",
				spawnable: null,
				autoExit: true,
				cwd: null,
				agentDir: null,
			},
			{ artifactDir: loadRoot, name: "unknown-tool" },
		);
		const toolsFlagIndex = unknownToolParts.indexOf("--tools");
		assert.deepEqual(
			unknownToolParts.slice(toolsFlagIndex, toolsFlagIndex + 2),
			["--tools", "'not_a_real_tool'"],
		);
		assert.equal(
			unknownToolParts.includes("-e"),
			false,
			"an unknown tool gets no helper extension",
		);

		// ── list renderer (migrated from the source-split eval, C29): the REAL ──
		// ── registered subagents_list tool renders the grouped list ──────────
		const loadTools = [];
		const loadCommands = new Map();
		const loadHandlers = new Map();
		const loadSent = [];
		const loadNotifications = [];
		const loadShortcuts = new Map();
		const loadPi = {
			registerTool: (tool) => loadTools.push(tool),
			registerCommand: (name, def) => loadCommands.set(name, def),
			registerMessageRenderer: () => {},
			registerShortcut: (key, def) => loadShortcuts.set(key, def),
			sendMessage: (message, options) => loadSent.push({ message, options }),
			on: (event, handler) => loadHandlers.set(event, handler),
			events: { on() {}, emit() {} },
			getAllTools: () => [],
		};
		index.default(loadPi);
		// The widget minimize toggle registers on ctrl+s and flips state.
		const minimizeShortcut = loadShortcuts.get("ctrl+s");
		assert.ok(minimizeShortcut, "ctrl+s shortcut is registered");
		assert.match(minimizeShortcut.description, /minimize/i);
		const probeA = hooks.toggleWidgetMinimized();
		minimizeShortcut.handler({ ui: { notify() {} } });
		const probeB = hooks.toggleWidgetMinimized();
		assert.equal(probeA, probeB, "the shortcut handler flipped the state exactly once");
		const listTool = loadTools.find((tool) => tool.name === "subagents_list");
		assert.ok(listTool, "the subagents_list tool is registered");
		const theme = {
			fg: (token, text) => `<${token}>${text}</${token}>`,
			bold: (text) => `<bold>${text}</bold>`,
		};
		const renderList = (agents) =>
			listTool.renderResult({ details: { agents } }, {}, theme).render(1000).join("\n").trimEnd();
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

		// ── baseline renderer (migrated from the source-split eval, C29): the ──
		// ── REAL baselineSubagentExtensionArgs hook ────────────────────────
		const baselineRoot = join(loadRoot, "baseline");
		// Missing renderer → no baseline args.
		const emptyAgentDir = join(baselineRoot, "agent");
		mkdirSync(emptyAgentDir, { recursive: true });
		assert.deepEqual(hooks.baselineSubagentExtensionArgs(emptyAgentDir), []);
		// Present renderer → exactly one shell-escaped -e pair.
		const rendererDir = join(baselineRoot, "agent-with-renderer", "extensions");
		mkdirSync(rendererDir, { recursive: true });
		writeFileSync(join(rendererDir, "tool-call-renderer-public.ts"), "export {};\n");
		assert.deepEqual(hooks.baselineSubagentExtensionArgs(join(baselineRoot, "agent-with-renderer")), [
			"-e",
			`'${join(rendererDir, "tool-call-renderer-public.ts")}'`,
		]);
		// A parent dir with spaces and an apostrophe is correctly quoted.
		const weirdDir = join(baselineRoot, "par ent's dir", "agent", "extensions");
		mkdirSync(weirdDir, { recursive: true });
		writeFileSync(join(weirdDir, "tool-call-renderer-public.ts"), "export {};\n");
		const [weirdFlag, weirdPath] = hooks.baselineSubagentExtensionArgs(join(baselineRoot, "par ent's dir", "agent"));
		assert.equal(weirdFlag, "-e");
		assert.equal(
			weirdPath,
			`'${join(weirdDir, "tool-call-renderer-public.ts").replace(/'/g, "'\\''")}'`,
			"spaces stay quoted and the apostrophe is escaped shell-style",
		);
		// A relative agent dir resolves against the process cwd to an absolute path.
		const relRoot = join(baselineRoot, "rel-cwd");
		mkdirSync(join(relRoot, "agent", "extensions"), { recursive: true });
		writeFileSync(join(relRoot, "agent", "extensions", "tool-call-renderer-public.ts"), "export {};\n");
		const previousCwd = process.cwd();
		process.chdir(relRoot);
		try {
			const [relFlag, relPath] = hooks.baselineSubagentExtensionArgs("agent");
			assert.equal(relFlag, "-e");
			assert.ok(relPath.startsWith("'"), "path is shell-quoted");
			assert.ok(
				!relPath.startsWith("'agent"),
				"resolve() made the relative agent dir absolute before quoting",
			);
			assert.ok(relPath.includes("tool-call-renderer-public.ts'"));
		} finally {
			process.chdir(previousCwd);
		}

		// ── applySandboxToParts behavior (migrated from the source-split eval, ──
		// ── C29): the REAL hook, with a fixture agent dir behind
		// ── PI_CODING_AGENT_DIR and a runtime-registered helper extension ────
		const sandboxRoot = join(loadRoot, "sandbox");
		const fixtureAgentDir = join(sandboxRoot, "agent");
		mkdirSync(join(fixtureAgentDir, "extensions"), { recursive: true });
		const fixtureRendererPath = join(fixtureAgentDir, "extensions", "tool-call-renderer-public.ts");
		writeFileSync(fixtureRendererPath, "export {};\n");
		const toolExtPath = join(sandboxRoot, "tools", "faketool.ts");
		mkdirSync(join(sandboxRoot, "tools"), { recursive: true });
		writeFileSync(toolExtPath, "export {};\n");
		index.registerToolExtension("faketool", toolExtPath);
		const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = fixtureAgentDir;
		try {
			// (a) No model pin: the agent's thinking level rides the inherited
			// default model as a standalone --thinking pair — no --model flag.
			const thinkingParts = [];
			hooks.applySandboxToParts(
				thinkingParts,
				{ model: null, thinking: "high", toolAllowlist: null },
				{ artifactDir: join(sandboxRoot, "artifacts"), name: "thinking-test" },
			);
			const thinkingIndex = thinkingParts.indexOf("--thinking");
			assert.ok(thinkingIndex !== -1, "a pinned thinking level yields a standalone --thinking flag");
			assert.deepEqual(
				thinkingParts.slice(thinkingIndex, thinkingIndex + 2),
				["--thinking", "'high'"],
				"the --thinking pair carries the shell-escaped level",
			);
			assert.ok(!thinkingParts.includes("--model"), "no model pin means no --model flag");

			// (b) The baseline renderer's -e pair is pushed BEFORE the granted
			// tool's helper-extension -e pair, regardless of source layout.
			const toolParts = [];
			hooks.applySandboxToParts(
				toolParts,
				{ model: null, thinking: null, toolAllowlist: "faketool" },
				{ artifactDir: join(sandboxRoot, "artifacts"), name: "tools-test" },
			);
			const baselineIndex = toolParts.indexOf(`'${fixtureRendererPath}'`);
			const grantedIndex = toolParts.indexOf(`'${toolExtPath}'`);
			assert.ok(baselineIndex !== -1, "the baseline renderer's -e pair is present");
			assert.ok(grantedIndex !== -1, "the granted tool's helper -e pair is present");
			assert.ok(
				baselineIndex < grantedIndex,
				"the baseline renderer's -e pair precedes the granted tool's -e pair",
			);
			assert.ok(toolParts.includes("--tools"), "the allowlist is replayed as --tools");
		} finally {
			if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		}

		// ── auto-exit tab close decision (migrated from the source-split eval, ──
		// ── C29): the REAL pure hook. Clean auto-exit closes the whole tab; ──
		// ── interactive, killed, errored, or non-zero exit do not. ────────────
		assert.equal(hooks.shouldCloseSubagentTab(false, { exitCode: 0 }), true, "clean auto-exit → close the tab");
		assert.equal(hooks.shouldCloseSubagentTab(true, { exitCode: 0 }), false, "interactive → park for the user");
		assert.equal(hooks.shouldCloseSubagentTab(false, { exitCode: 1 }), false);
		assert.equal(hooks.shouldCloseSubagentTab(false, { exitCode: 0, killed: true }), false);
		assert.equal(hooks.shouldCloseSubagentTab(false, { exitCode: 0, errorMessage: "overload" }), false);

		// ── C30: an agent profile naming a nonexistent tool fails LOUDLY at ──
		// ── spawn, before any surface exists — never a silent --tools ───────
		// ── pass-through. A fixture profile in the configured agent dir ────
		// names one real built-in and two bogus tools.
		const brokenProfileDir = join(agentConfigDir, "agents");
		mkdirSync(brokenProfileDir, { recursive: true });
		writeFileSync(
			join(brokenProfileDir, "broken-tool.md"),
			"---\nname: broken-tool\ndescription: names a bogus tool\ntools: read, definitely_not_a_tool, also_missing\n---\nBody\n",
		);
		const subagentToolDef = loadTools.find((tool) => tool.name === "subagent");
		assert.ok(subagentToolDef, "the subagent tool is registered");
		const bogusSpawn = await subagentToolDef.execute(
			"call-bogus-tool",
			{ agent: "broken-tool", task: "Do things." },
			new AbortController().signal,
			undefined,
			{ cwd: loadRoot },
		);
		assert.match(bogusSpawn.content[0].text, /agent profile "broken-tool" names a nonexistent tool/);
		assert.match(bogusSpawn.content[0].text, /"definitely_not_a_tool"/);
		assert.match(bogusSpawn.content[0].text, /"also_missing"/);
		assert.match(bogusSpawn.content[0].text, /spawn was refused/);
		assert.deepEqual(bogusSpawn.details, {
			error: "unknown tool in profile",
			agent: "broken-tool",
			tools: ["definitely_not_a_tool", "also_missing"],
		});
		// A SOUND profile in the same environment passes the gate: the bundled
		// worker names only built-ins plus tools the fixture agent dir
		// provides through normal extension discovery.
		const fixtureExts = join(agentConfigDir, "extensions");
		mkdirSync(join(fixtureExts, "web-search"), { recursive: true });
		writeFileSync(join(fixtureExts, "web-search", "index.ts"), "export {};\n");
		mkdirSync(join(fixtureExts, "web-fetch"), { recursive: true });
		writeFileSync(join(fixtureExts, "web-fetch", "index.ts"), "export {};\n");
		writeFileSync(join(fixtureExts, "mermaid.ts"), "export {};\n");
		writeFileSync(join(fixtureExts, "tuicr.ts"), "export {};\n");
		assert.deepEqual(
			hooks.findUnknownProfileTools("read, write, edit, bash, web_search, web_fetch, mermaid, tuicr, tuicr_reply", [agentConfigDir]),
			[],
			"every bundled-worker tool resolves through the discovery scan",
		);
	} finally {
		for (const [key, value] of Object.entries(savedLoadEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(loadRoot, { recursive: true, force: true });
	}
}

// --- S7: bundled agent profiles hold zero stale tool references (#243) ---
{
	// Names this repo or pi can provide: pi built-ins, this extension's own
	// tools, the conventional extension map in index.ts, every `name:` a repo
	// extension declares, and every extension file/dir basename.
	const knownTools = new Set([
		"read", "write", "edit", "bash", "grep", "find", "ls",
		"subagent", "subagent_message", "subagents_list", "ask_question",
		"web_search", "web_fetch", "video_extract", "youtube_search",
		"google_image_search", "tuicr", "tuicr_reply",
	]);
	const extensionsRoot = fileURLToPath(new URL(".", import.meta.url));
	const collectDeclared = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				collectDeclared(full);
				knownTools.add(entry.name);
				knownTools.add(entry.name.replace(/-/g, "_"));
			} else if (entry.name.endsWith(".ts")) {
				const base = entry.name.replace(/\.ts$/, "");
				knownTools.add(base);
				knownTools.add(base.replace(/-/g, "_"));
				const source = readFileSync(full, "utf8");
				for (const match of source.matchAll(/\bname:\s*["']([a-z0-9_-]+)["']/g)) {
					knownTools.add(match[1]);
					knownTools.add(match[1].replace(/-/g, "_"));
				}
			}
		}
	};
	collectDeclared(extensionsRoot);
	for (const file of readdirSync(bundledAgentsDir).filter((name) => name.endsWith(".md"))) {
		const parsed = parseAgentDefinition(
			readFileSync(join(bundledAgentsDir, file), "utf8"),
			file.replace(/\.md$/, ""),
		);
		assert.ok(parsed, `${file} has parseable frontmatter`);
		assert.ok(parsed.tools, `${file} declares a tools list`);
		for (const tool of parsed.tools.split(",").map((tool) => tool.trim()).filter(Boolean)) {
			assert.notEqual(
				tool,
				"safe_bash",
				`${file} must not reference the removed safe_bash tool (#243)`,
			);
			assert.ok(knownTools.has(tool), `${file} references unknown tool "${tool}"`);
		}
	}
}

// --- S6: surface dispatch matrix — herdr, tmux, neither (#191/#193) ---
// A tmux createSurface schedules a debounced select-layout that may fire
// after this block ends. The fake tmux bin stays first on PATH for the rest
// of this process so that late fire can never reach a real tmux; the bin dir
// is therefore intentionally kept until process exit.
const matrixRoot = mkdtempSync(join(tmpdir(), "subagent-surface-matrix-"));
const matrixBin = join(matrixRoot, "bin");
mkdirSync(matrixBin, { recursive: true });
const matrixHerdrCapture = join(matrixRoot, "herdr-calls");
const matrixTmuxCapture = join(matrixRoot, "tmux-calls");
writeFileSync(
	join(matrixBin, "herdr"),
	`#!/bin/sh
printf '%s\\n' "$@" >> "$MATRIX_HERDR_CAPTURE"
printf '%s\\n' --call-- >> "$MATRIX_HERDR_CAPTURE"
case "$1:$2" in
	pane:get) printf '%s\\n' '{"result":{"pane":{"pane_id":"w50:p1","workspace_id":"w50"}}}' ;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"w50:p7"}}}' ;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
	{ mode: 0o755 },
);
writeFileSync(
	join(matrixBin, "tmux"),
	`#!/bin/sh
printf '%s\\n' "$@" >> "$MATRIX_TMUX_CAPTURE"
printf '%s\\n' --call-- >> "$MATRIX_TMUX_CAPTURE"
case "$1" in
	split-window) printf '%s\\n' '%12' ;;
	capture-pane) printf '%s\\n' "$MATRIX_TMUX_SCREEN" ;;
esac
exit 0
`,
	{ mode: 0o755 },
);
const matrixCalls = (file) =>
	readFileSync(file, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"));
const savedMatrixEnv = {
	HERDR_ENV: process.env.HERDR_ENV,
	HERDR_PANE_ID: process.env.HERDR_PANE_ID,
	HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID,
	TMUX: process.env.TMUX,
	TMUX_PANE: process.env.TMUX_PANE,
};
process.env.MATRIX_HERDR_CAPTURE = matrixHerdrCapture;
process.env.MATRIX_TMUX_CAPTURE = matrixTmuxCapture;
process.env.PATH = `${matrixBin}:${process.env.PATH}`;
try {
	// HERDR_ENV=1 + HERDR_PANE_ID + herdr on PATH → the herdr surface.
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w50:p1";
	process.env.HERDR_WORKSPACE_ID = "stale-matrix-workspace";
	delete process.env.TMUX;
	delete process.env.TMUX_PANE;
	const herdrMatrix = createJiti(import.meta.url, { moduleCache: false })(
		"./interactive-subagents/pi-extension/subagents/surface.ts",
	);
	assert.equal(herdrMatrix.activeSurface, "herdr");
	assert.equal(herdrMatrix.isMuxAvailable(), true);
	assert.equal(herdrMatrix.createSurface("matrix-herdr"), "w50:p7");
	assert.deepEqual(matrixCalls(matrixHerdrCapture), [
		["pane", "get", "w50:p1"],
		[
			"tab", "create", "--workspace", "w50", "--cwd", process.cwd(),
			"--label", "subagent: matrix-herdr", "--no-focus",
		],
	]);

	// No HERDR_ENV + TMUX set + tmux on PATH → the tmux surface.
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	delete process.env.HERDR_WORKSPACE_ID;
	process.env.TMUX = "/tmp/fake-matrix-socket,1,0";
	process.env.TMUX_PANE = "%5";
	const tmuxMatrix = createJiti(import.meta.url, { moduleCache: false })(
		"./interactive-subagents/pi-extension/subagents/surface.ts",
	);
	assert.equal(tmuxMatrix.activeSurface, "tmux");
	assert.equal(tmuxMatrix.isMuxAvailable(), true);
	const tmuxPane = tmuxMatrix.createSurface("matrix-tmux");
	assert.equal(tmuxPane, "%12");
	tmuxMatrix.sendCommand(tmuxPane, "pi --session matrix.jsonl");
	process.env.MATRIX_TMUX_SCREEN = "__SUBAGENT_DONE_3__";
	assert.deepEqual(
		await tmuxMatrix.pollForExit(tmuxPane, new AbortController().signal, { interval: 20 }),
		{ reason: "sentinel", exitCode: 3 },
	);
	tmuxMatrix.closeSurface(tmuxPane);
	assert.deepEqual(
		matrixCalls(matrixTmuxCapture).filter((call) => call[0] !== "select-layout"),
		[
			["split-window", "-d", "-h", "-t", "%5", "-P", "-F", "#{pane_id}"],
			["send-keys", "-t", "%12", "-l", "pi --session matrix.jsonl"],
			["send-keys", "-t", "%12", "Enter"],
			["capture-pane", "-p", "-t", "%12", "-S", "-5"],
			["kill-pane", "-t", "%12"],
		],
	);
	// The same exit polling on the tmux surface: sidecar fast path, and an
	// already-aborted signal that touches no panes.
	const tmuxSidecarSession = join(matrixRoot, "sidecar-session.jsonl");
	writeFileSync(`${tmuxSidecarSession}.exit`, JSON.stringify({ type: "error", errorMessage: "boom" }));
	assert.deepEqual(
		await tmuxMatrix.pollForExit(tmuxPane, new AbortController().signal, {
			interval: 20,
			sessionFile: tmuxSidecarSession,
		}),
		{ reason: "error", exitCode: 1, errorMessage: "boom" },
	);
	const tmuxPollAborted = new AbortController();
	tmuxPollAborted.abort();
	const tmuxCallsBefore = matrixCalls(matrixTmuxCapture).length;
	await assert.rejects(
		tmuxMatrix.pollForExit(tmuxPane, tmuxPollAborted.signal, { interval: 20 }),
		/Aborted while waiting/,
	);
	assert.equal(matrixCalls(matrixTmuxCapture).length, tmuxCallsBefore, "an aborted poll touches no panes");
	// Direction mapping and the sync screen reader on the tmux surface.
	assert.equal(tmuxMatrix.createSurfaceSplit("matrix-split", "up"), "%12");
	assert.equal(tmuxMatrix.readScreen("%12", 5), "__SUBAGENT_DONE_3__\n");
	const tmuxLongScript = tmuxMatrix.sendLongCommand("%12", "echo hi", {
		scriptPath: join(matrixRoot, "long-cmd.sh"),
	});
	assert.equal(readFileSync(tmuxLongScript, "utf8"), "#!/bin/bash\necho hi\n");
	const tmuxTail = matrixCalls(matrixTmuxCapture)
		.filter((call) => call[0] !== "select-layout")
		.slice(-4);
	assert.deepEqual(tmuxTail[0], ["split-window", "-d", "-v", "-b", "-P", "-F", "#{pane_id}"]);
	assert.deepEqual(tmuxTail[1], ["capture-pane", "-p", "-t", "%12", "-S", "-5"]);
	assert.deepEqual(tmuxTail[2], ["send-keys", "-t", "%12", "-l", `bash '${tmuxLongScript}'`]);
	assert.deepEqual(tmuxTail[3], ["send-keys", "-t", "%12", "Enter"]);

	// Neither env var → no surface, and the hint names both multiplexers.
	delete process.env.TMUX;
	delete process.env.TMUX_PANE;
	const noneMatrix = createJiti(import.meta.url, { moduleCache: false })(
		"./interactive-subagents/pi-extension/subagents/surface.ts",
	);
	assert.equal(noneMatrix.activeSurface, "none");
	assert.equal(noneMatrix.isMuxAvailable(), false);
	const noneHint = noneMatrix.muxSetupHint();
	assert.match(noneHint, /Herdr/);
	assert.match(noneHint, /tmux/);
} finally {
	for (const [key, value] of Object.entries(savedMatrixEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	delete process.env.MATRIX_HERDR_CAPTURE;
	delete process.env.MATRIX_TMUX_SCREEN;
	// MATRIX_TMUX_CAPTURE stays set: the debounced select-layout writes into
	// the kept matrixRoot after this block, and must not print to stderr.
	// matrixRoot is intentionally kept: see the comment above this block.
}


// ── Subagent completion lifecycle: liveness fallback + auto-exit tab close ──
// A dedicated fake-herdr bin (the established pattern) with pane:process-info
// and tab:close cases drives the new completion-path behavior end-to-end: the
// done-watcher's liveness fallback (sentinel missed, pi process gone) and the
// auto-exit whole-tab close (orphaned sibling panes die with the subagent).
{
	const lifecycleBin = mkdtempSync(join(tmpdir(), "subagent-lifecycle-test-"));
	const lifecycleCapture = join(lifecycleBin, "calls");
	const lifecycleStageFile = join(lifecycleBin, "proc-stage");
	writeFileSync(
		join(lifecycleBin, "herdr"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$LIFECYCLE_CAPTURE"
printf '%s\\n' --call-- >> "$LIFECYCLE_CAPTURE"
case "$1:$2" in
	pane:get)
		printf '%s\\n' '{"result":{"pane":{"pane_id":"w44:p2","tab_id":"w44:t7","workspace_id":"w44"}}}'
		;;
	tab:close)
		[ "$LIFECYCLE_FAIL_TAB_CLOSE" = "1" ] && exit 1
		printf '%s\\n' '{"result":{}}'
		;;
	pane:close) printf '%s\\n' '{"result":{}}' ;;
	pane:read) printf '%s\\n' "$LIFECYCLE_SCREEN" ;;
	pane:process-info)
		# Staged liveness: the first read shows the pi agent in the pane's
		# foreground processes; every later read shows only the shell.
		stage=0
		[ -f "$LIFECYCLE_PROC_STAGE" ] && stage=$(cat "$LIFECYCLE_PROC_STAGE")
		stage=$((stage + 1))
		printf '%s' "$stage" > "$LIFECYCLE_PROC_STAGE"
		if [ "$stage" = "1" ]; then
			printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"bash","pid":100,"argv":["bash"]},{"name":"pi","pid":101,"argv":["pi"]}]}}}'
		else
			printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":100,"argv":["zsh"]}]}}}'
		fi
		;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	const savedLifecycleEnv = {
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		PATH: process.env.PATH,
	};
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w44:p2";
	process.env.PATH = `${lifecycleBin}:${savedLifecycleEnv.PATH}`;
	process.env.LIFECYCLE_CAPTURE = lifecycleCapture;
	process.env.LIFECYCLE_PROC_STAGE = lifecycleStageFile;
	delete process.env.LIFECYCLE_SCREEN;
	delete process.env.LIFECYCLE_FAIL_TAB_CLOSE;
	const lifecycleCalls = () =>
		readFileSync(lifecycleCapture, "utf8")
			.split("--call--\n")
			.filter(Boolean)
			.map((call) => call.trim().split("\n"));
	try {
		const lifecycleHerdr = createJiti(import.meta.url, { moduleCache: false })(
			"./interactive-subagents/pi-extension/subagents/herdr.ts",
		);

		// Pure decision logic: the liveness state machine.
		const bashOnly = [{ name: "bash", pid: 1, argv: ["bash"] }];
		const withPi = [{ name: "bash", pid: 1, argv: ["bash"] }, { name: "pi", pid: 2, argv: ["pi"] }];
		assert.deepEqual(lifecycleHerdr.updateAgentLiveness(false, bashOnly), {
			seenAgent: false, agentGone: false,
		}, "startup shell must never count as agent-gone");
		assert.deepEqual(lifecycleHerdr.updateAgentLiveness(false, withPi), {
			seenAgent: true, agentGone: false,
		});
		assert.deepEqual(lifecycleHerdr.updateAgentLiveness(true, bashOnly), {
			seenAgent: true, agentGone: true,
		}, "agent seen once, then gone → completed");
		assert.deepEqual(lifecycleHerdr.updateAgentLiveness(true, null), {
			seenAgent: true, agentGone: false,
		}, "transient process-info failure keeps polling");
		assert.deepEqual(lifecycleHerdr.updateAgentLiveness(false, null), {
			seenAgent: false, agentGone: false,
		});
		assert.equal(lifecycleHerdr.isPiForegroundProcess({ name: "pi", argv: ["pi"] }), true);
		assert.equal(lifecycleHerdr.isPiForegroundProcess({ name: "bash", argv: ["/usr/local/bin/pi"] }), true);
		assert.equal(lifecycleHerdr.isPiForegroundProcess({ name: "nvim", argv: ["nvim"] }), false);
		assert.equal(lifecycleHerdr.isPiForegroundProcess({ name: "bash", argv: ["bash"] }), false);

		// pollForExit end-to-end: the DONE sentinel never appears on the
		// screen, the pi agent was seen once, then it vanished — the watcher
		// must report a clean completion instead of polling forever.
		const lifecyclePoll = new AbortController();
		const livenessResult = await lifecycleHerdr.pollForExit("w44:p9", lifecyclePoll.signal, {
			interval: 20,
		});
		lifecyclePoll.abort();
		assert.deepEqual(livenessResult, { reason: "agent-gone", exitCode: 0 });
		const polled = lifecycleCalls();
		assert.ok(polled.filter((call) => call[1] === "read").length >= 2, "screen sentinel was checked every tick");
		assert.ok(
			polled.filter((call) => call[1] === "process-info").length >= 2,
			"foreground processes were checked every tick",
		);
		assert.equal(
			polled.some((call) => call[1] === "close" || call[1] === "tab"),
			false,
			"pollForExit itself must not close anything",
		);

		// The auto-exit tab close DECISION (shouldCloseSubagentTab) moved to the
		// whole-load __test__ block (C29): clean auto-exit closes the whole tab;
		// interactive, killed, errored, or non-zero exit do not. The end-to-end
		// close mechanics stay here.

		// closeTabForPane end-to-end: pane get → tab close, and the pane-close
		// fallback when tab close fails.
		lifecycleHerdr.closeTabForPane("w44:p9");
		assert.deepEqual(lifecycleCalls().at(-2), ["pane", "get", "w44:p9"]);
		assert.deepEqual(lifecycleCalls().at(-1), ["tab", "close", "w44:t7"]);
		process.env.LIFECYCLE_FAIL_TAB_CLOSE = "1";
		lifecycleHerdr.closeTabForPane("w44:p9");
		delete process.env.LIFECYCLE_FAIL_TAB_CLOSE;
		// The fake bin records a call even when it then exits 1, so the
		// failed tab close is followed by the pane-close fallback.
		assert.deepEqual(lifecycleCalls().at(-3), ["pane", "get", "w44:p9"]);
		assert.deepEqual(lifecycleCalls().at(-2), ["tab", "close", "w44:t7"]);
		assert.deepEqual(lifecycleCalls().at(-1), ["pane", "close", "w44:p9"], "failed tab close falls back to pane close");
	} finally {
		for (const [key, value] of Object.entries(savedLifecycleEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.LIFECYCLE_CAPTURE;
		delete process.env.LIFECYCLE_PROC_STAGE;
		delete process.env.LIFECYCLE_SCREEN;
		delete process.env.LIFECYCLE_FAIL_TAB_CLOSE;
		rmSync(lifecycleBin, { recursive: true, force: true });
	}
}

// --- tmux closeTabForPane: list-panes → kill-window, with kill-pane fallback ---
// The tmux twin of the herdr tab close: resolve the pane's window, kill the
// window so sibling panes die with it, and fall back to killing just the pane.
{
	const tabCloseBin = mkdtempSync(join(tmpdir(), "subagent-tmux-tabclose-"));
	const tabCloseCapture = join(tabCloseBin, "calls");
	writeFileSync(
		join(tabCloseBin, "tmux"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$TAB_CLOSE_CAPTURE"
printf '%s\\n' --call-- >> "$TAB_CLOSE_CAPTURE"
case "$1" in
	list-panes)
		if [ "$TAB_CLOSE_LIST_FAIL" = 1 ]; then
			exit 1
		elif [ "$TAB_CLOSE_EMPTY" = 1 ]; then
			printf '%s\\n' ''
		else
			printf '%s\\n' '@3'
		fi
		;;
esac
exit 0
`,
		{ mode: 0o755 },
	);
	const savedTabClosePath = process.env.PATH;
	process.env.TAB_CLOSE_CAPTURE = tabCloseCapture;
	process.env.PATH = `${tabCloseBin}:${savedTabClosePath}`;
	try {
		const tmuxTabClose = createJiti(import.meta.url, { moduleCache: false })(
			"./interactive-subagents/pi-extension/subagents/tmux.ts",
		);
		const readTabCloseCalls = () =>
			readFileSync(tabCloseCapture, "utf8")
				.split("--call--\n")
				.filter(Boolean)
				.map((call) => call.trim().split("\n"));
		tmuxTabClose.closeTabForPane("%12");
		assert.deepEqual(readTabCloseCalls(), [
			["list-panes", "-t", "%12", "-F", "#{window_id}"],
			["kill-window", "-t", "@3"],
		]);
		// A failed window lookup falls back to killing just the pane.
		process.env.TAB_CLOSE_LIST_FAIL = "1";
		tmuxTabClose.closeTabForPane("%12");
		delete process.env.TAB_CLOSE_LIST_FAIL;
		assert.deepEqual(readTabCloseCalls().at(-1), ["kill-pane", "-t", "%12"]);
		// An empty window id also falls back to the pane kill.
		process.env.TAB_CLOSE_EMPTY = "1";
		tmuxTabClose.closeTabForPane("%12");
		delete process.env.TAB_CLOSE_EMPTY;
		assert.deepEqual(readTabCloseCalls().at(-1), ["kill-pane", "-t", "%12"]);
	} finally {
		process.env.PATH = savedTabClosePath;
		delete process.env.TAB_CLOSE_CAPTURE;
		delete process.env.TAB_CLOSE_LIST_FAIL;
		delete process.env.TAB_CLOSE_EMPTY;
		rmSync(tabCloseBin, { recursive: true, force: true });
	}
}

// --- agent-gone → session harvest → subagent_result steer, end-to-end ---
// The whole extension loads through the stub aliases (the pi package is
// stubbed), the real `subagent` tool execute runs against a staged fake-herdr
// bin, and the done-watcher's liveness fallback (DONE sentinel never on the
// screen, the pane's pi process seen once then gone) drives the REAL harvest
// and the REAL subagent_result steer message — the two lost-workers incident
// path, recovered automatically.
{
	const e2eRoot = mkdtempSync(join(tmpdir(), "subagent-agent-gone-"));
	const e2eBin = join(e2eRoot, "bin");
	const e2eCapture = join(e2eRoot, "calls");
	const e2eStageFile = join(e2eRoot, "proc-stage");
	const e2eSessionDir = join(e2eRoot, "sessions");
	const e2eConfigDir = join(e2eRoot, "agent-config");
	mkdirSync(e2eBin, { recursive: true });
	mkdirSync(e2eSessionDir, { recursive: true });
	mkdirSync(e2eConfigDir, { recursive: true });
	const parentSessionFile = join(e2eSessionDir, "parent.jsonl");
	// The worker profile's extension tools (web_search, web_fetch, mermaid,
	// tuicr, tuicr_reply) must be discoverable in the child's agent dir —
	// the C30 spawn gate refuses a profile naming tools no source provides.
	for (const dir of ["web-search", "web-fetch"]) {
		mkdirSync(join(e2eConfigDir, "extensions", dir), { recursive: true });
		writeFileSync(join(e2eConfigDir, "extensions", dir, "index.ts"), "export {};\n");
	}
	for (const file of ["mermaid.ts", "tuicr.ts"]) {
		writeFileSync(join(e2eConfigDir, "extensions", file), "export {};\n");
	}
	writeFileSync(
		parentSessionFile,
		JSON.stringify({ type: "session", version: 3, id: "parent-id", cwd: e2eRoot, timestamp: new Date().toISOString() }) + "\n",
	);
	writeFileSync(
		join(e2eBin, "herdr"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$E2E_CAPTURE"
printf '%s\\n' --call-- >> "$E2E_CAPTURE"
case "$1:$2" in
	pane:get) printf '%s\\n' '{"result":{"pane":{"pane_id":"wE:p1","tab_id":"wE:t1","workspace_id":"wE"}}}' ;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"wE:p2"}}}' ;;
	pane:run) printf '%s\\n' '{"result":{}}' ;;
	agent:get) printf '%s\\n' '{"result":{"agent":{"agent_status":"idle"}}}' ;;
	agent:prompt) printf '%s\\n' '{"result":{}}' ;;
	pane:read) printf '%s\\n' "$E2E_SCREEN" ;;
	pane:process-info)
		stage=0
		[ -f "$E2E_PROC_STAGE" ] && stage=$(cat "$E2E_PROC_STAGE")
		stage=$((stage + 1))
		printf '%s' "$stage" > "$E2E_PROC_STAGE"
		if [ "$stage" = "1" ]; then
			printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"pi","pid":201,"argv":["pi"]}]}}}'
		else
			printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":200,"argv":["zsh"]}]}}}'
		fi
		;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	const savedE2EEnv = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID,
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_SUBAGENT_AGENT: process.env.PI_SUBAGENT_AGENT,
		PI_SUBAGENT_ALLOWED: process.env.PI_SUBAGENT_ALLOWED,
	};
	try {
		process.env.PATH = `${e2eBin}:${savedE2EEnv.PATH}`;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "wE:p1";
		delete process.env.HERDR_WORKSPACE_ID;
		delete process.env.TMUX;
		delete process.env.TMUX_PANE;
		process.env.PI_CODING_AGENT_DIR = e2eConfigDir;
		delete process.env.PI_SUBAGENT_AGENT;
		delete process.env.PI_SUBAGENT_ALLOWED;
		process.env.E2E_CAPTURE = e2eCapture;
		process.env.E2E_PROC_STAGE = e2eStageFile;

		const sentMessages = [];
		const registeredTools = new Map();
		const handlers = {};
		let steerResolve;
		const steerDone = new Promise((resolve) => { steerResolve = resolve; });
		const fakePi = {
			registerTool: (tool) => registeredTools.set(tool.name, tool),
			registerCommand() {},
			registerMessageRenderer() {},
			registerShortcut() {},
			on: (name, handler) => { handlers[name] = handler; },
			events: { on() {}, emit() {} },
			getAllTools: () => [],
			sendMessage: (message, opts) => {
				sentMessages.push({ message, opts });
				if (message.customType === "subagent_result") steerResolve();
			},
		};
		const e2eIndex = createJiti(import.meta.url, {
			moduleCache: false,
			alias: {
				"@earendil-works/pi-coding-agent": join(e2eRoot, "agent.cjs"),
				"@earendil-works/pi-ai": join(e2eRoot, "ai.cjs"),
				"@earendil-works/pi-tui": join(e2eRoot, "tui.cjs"),
			},
		});
		// The stub files are recreated here so this instance owns them.
		writeFileSync(
			join(e2eRoot, "agent.cjs"),
			"exports.defineTool = (tool) => tool;\nexports.keyHint = () => 'hint';\n",
		);
		writeFileSync(
			join(e2eRoot, "ai.cjs"),
			"exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n",
		);
		writeFileSync(
			join(e2eRoot, "tui.cjs"),
			[
				"exports.Box = class Box { constructor(...a) { this.a = a; } };",
				"exports.Text = class Text { constructor(text) { this.text = text; } render() { return String(this.text).split('\\n'); } };",
				"exports.truncateToWidth = (text, width) => String(text).slice(0, Math.max(0, width));",
				"exports.visibleWidth = (text) => String(text).length;",
				"",
			].join("\n"),
		);
		const e2eModule = e2eIndex(
			new URL("./interactive-subagents/pi-extension/subagents/index.ts", import.meta.url).href,
		);
		e2eModule.default(fakePi);
		// session_start installs the module abort signal the watcher polls against.
		handlers.session_start?.({}, {});
		const subagentTool = registeredTools.get("subagent");
		assert.ok(subagentTool, "the subagent tool is registered");

		const ack = await subagentTool.execute(
			"call-e2e",
			{ agent: "worker", task: "Summarize the repo." },
			new AbortController().signal,
			undefined,
			{
				sessionManager: {
					getSessionFile: () => parentSessionFile,
					getSessionId: () => "parent-id",
					getSessionDir: () => e2eSessionDir,
				},
				cwd: e2eRoot,
			},
		);
		assert.match(ack.content[0].text, /worker/);

		// The watcher polls at the source's 1 s interval. Its first tick sees
		// the pane's pi process; fill the child session NOW so the harvest on
		// the agent-gone tick reads a real transcript.
		const e2eHooks = e2eModule.__test__;
		const running = [...e2eHooks.runningSubagents.values()][0];
		assert.ok(running, "the subagent is registered as running");
		assert.equal(running.interactive, false, "worker is an auto-exit agent");
		writeFileSync(
			running.sessionFile,
			[
				JSON.stringify({ type: "session", version: 3, id: "child-id", cwd: e2eRoot, timestamp: new Date().toISOString() }),
				JSON.stringify({ type: "message", id: "c1", message: { role: "user", content: [{ type: "text", text: "Summarize the repo." }] } }),
				JSON.stringify({
					type: "message",
					id: "c2",
					message: {
						role: "assistant",
						model: "test-model",
						content: [{ type: "text", text: "All done: 3 files." }],
						usage: { input: 5, output: 7, totalTokens: 12, cost: { total: 0.1 } },
					},
				}),
			].join("\n") + "\n",
		);

		// The liveness fallback fires on the second tick → harvest → steer.
		await Promise.race([
			steerDone,
			new Promise((_, reject) => {
				const timer = setTimeout(
					() => reject(new Error("subagent_result steer never arrived")),
					5000,
				);
				timer.unref?.();
			})
		]);
		const steer = sentMessages.find((entry) => entry.message.customType === "subagent_result");
		assert.ok(steer, "the completion arrived as a subagent_result steer");
		assert.equal(steer.opts.deliverAs, "steer");
		assert.equal(steer.opts.triggerTurn, true);
		assert.match(steer.message.content, /Sub-agent "worker" completed/);
		assert.match(steer.message.content, /All done: 3 files\./, "the summary came from the session harvest, not the screen");
		assert.equal(steer.message.details.name, "worker");
		assert.equal(steer.message.details.exitCode, 0);
		assert.equal(steer.message.details.sessionId, "child-id");
		assert.ok(steer.message.details.stats, "the harvested stats ride along");
		assert.equal(steer.message.details.stats.outputTokens, 7);

		// Clean auto-exit → the whole tab closed, never just the root pane.
		const e2eCalls = readFileSync(e2eCapture, "utf8")
			.split("--call--\n")
			.filter(Boolean)
			.map((call) => call.trim().split("\n"));
		assert.ok(
			e2eCalls.some((call) => call[0] === "tab" && call[1] === "close" && call[2] === "wE:t1"),
			"a clean auto-exit closes the whole tab",
		);
		assert.equal(
			e2eCalls.some((call) => call[0] === "pane" && call[1] === "close" && call[2] === "wE:p2"),
			false,
			"the root-pane close is not used for a clean auto-exit",
		);
		assert.equal(e2eHooks.runningSubagents.size, 0, "the finished subagent is deregistered");

		// Tear down the widget/status intervals so this process can exit.
		handlers.session_shutdown?.({}, {});
	} finally {
		for (const [key, value] of Object.entries(savedE2EEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.E2E_CAPTURE;
		delete process.env.E2E_PROC_STAGE;
		rmSync(e2eRoot, { recursive: true, force: true });
	}
}


// ---------------------------------------------------------------------------
// Orphaned-subagent adoption — the deadline-close incident class. A parent
// process killed mid-run leaves child tabs running with no watcher; the
// durable registry running mark + session_start adoption must finalize the
// dead ones (harvest → result steer → tab close → mark finished) and adopt
// the live ones (fresh watcher → result on real completion), and
// subagent_message must steer a live orphan instead of resuming a duplicate.
// Offline and deterministic: fake herdr bin + staged registry/session files,
// poll cadence shrunk through PI_SUBAGENT_POLL_MS.
// ---------------------------------------------------------------------------
{
	const adoptRoot = mkdtempSync(join(tmpdir(), "subagent-adopt-"));
	const adoptBin = join(adoptRoot, "bin");
	const adoptCapture = join(adoptRoot, "calls");
	const adoptSessionDir = join(adoptRoot, "sessions");
	const adoptConfigDir = join(adoptRoot, "agent-config");
	mkdirSync(adoptBin, { recursive: true });
	mkdirSync(adoptSessionDir, { recursive: true });
	mkdirSync(join(adoptConfigDir, "extensions", "web-search"), { recursive: true });
	mkdirSync(join(adoptConfigDir, "extensions", "web-fetch"), { recursive: true });
	writeFileSync(join(adoptConfigDir, "extensions", "web-search", "index.ts"), "export {};\n");
	writeFileSync(join(adoptConfigDir, "extensions", "web-fetch", "index.ts"), "export {};\n");
	for (const file of ["mermaid.ts", "tuicr.ts"]) {
		writeFileSync(join(adoptConfigDir, "extensions", file), "export {};\n");
	}
	const parentSessionFile = join(adoptSessionDir, "parent.jsonl");
	writeFileSync(
		parentSessionFile,
		JSON.stringify({ type: "session", version: 3, id: "adopt-parent", cwd: adoptRoot, timestamp: new Date().toISOString() }) + "\n",
	);
	// Fake herdr: pane existence, process-info, screen, and tab/pane creation
	// all read per-call state from env so each scenario restages cheaply.
	writeFileSync(
		join(adoptBin, "herdr"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$ADOPT_CAPTURE"
printf '%s\\n' --call-- >> "$ADOPT_CAPTURE"
case "$1:$2" in
	pane:get)
		if [ "$ADOPT_PANE_GONE" = 1 ] && [ "$3" = "wO:p1" ]; then exit 1; fi
		printf '%s\\n' '{"result":{"pane":{"pane_id":"wO:p1","tab_id":"wO:t1","workspace_id":"wO"}}}'
		;;
	pane:process-info)
		case "$(cat "$ADOPT_PROC" 2>/dev/null)" in
			pi) printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"pi","pid":301,"argv":["pi"]}]}}}' ;;
			fail) exit 1 ;;
			*) printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":300,"argv":["zsh"]}]}}}' ;;
		esac
		;;
	pane:read) printf '%s\\n' "$ADOPT_SCREEN" ;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"wO:p9"}}}' ;;
	pane:run|pane:close|tab:close|agent:prompt) printf '%s\\n' '{"result":{}}' ;;
	agent:get) printf '%s\\n' '{"result":{"agent":{"agent_status":"idle"}}}' ;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	const artifactDirOf = () => join(adoptSessionDir, "artifacts", "adopt-parent");
	const registryPath = () => join(artifactDirOf(), "subagent-registry.json");
	/** Stage one registry entry + its child session file. */
	const stageEntry = (name, { ran = true, extra = {} } = {}) => {
		const childFile = join(adoptSessionDir, `${name}.jsonl`);
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: `child-${name}`, cwd: adoptRoot, timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Do the work." }] } }),
		];
		if (ran) {
			lines.push(
				JSON.stringify({
					type: "message",
					id: "a1",
					message: {
						role: "assistant",
						model: "test-model",
						content: [{ type: "text", text: `Finished: ${name} report ready.` }],
						usage: { input: 5, output: 7, totalTokens: 12, cost: { total: 0.1 } },
					},
				}),
			);
		}
		writeFileSync(childFile, lines.join("\n") + "\n");
		mkdirSync(artifactDirOf(), { recursive: true });
		const registry = existsSync(registryPath()) ? JSON.parse(readFileSync(registryPath(), "utf8")) : {};
		registry[name] = {
			sessionFile: childFile,
			sessionId: `child-${name}`,
			paneId: "wO:p1",
			running: true,
			spawnedAt: Date.now() - 45_000,
			interactive: false,
			canSpawnChildren: false,
			...extra,
		};
		writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
		return childFile;
	};
	const adoptCalls = () =>
		readFileSync(adoptCapture, "utf8")
			.split("--call--\n")
			.filter(Boolean)
			.map((call) => call.trim().split("\n"));
	const savedAdoptEnv = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID,
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_SUBAGENT_AGENT: process.env.PI_SUBAGENT_AGENT,
		PI_SUBAGENT_ALLOWED: process.env.PI_SUBAGENT_ALLOWED,
		PI_SUBAGENT_POLL_MS: process.env.PI_SUBAGENT_POLL_MS,
		PI_SUBAGENT_MAX_WAIT_MS: process.env.PI_SUBAGENT_MAX_WAIT_MS,
		PI_SUBAGENT_STARTUP_GRACE_MS: process.env.PI_SUBAGENT_STARTUP_GRACE_MS,
		PI_SUBAGENT_PROCINFO_FAIL_LIMIT: process.env.PI_SUBAGENT_PROCINFO_FAIL_LIMIT,
		PI_SUBAGENT_SHELL_READY_DELAY_MS: process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS,
	};
	try {
		process.env.PATH = `${adoptBin}:${savedAdoptEnv.PATH}`;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "wO:p0";
		delete process.env.HERDR_WORKSPACE_ID;
		delete process.env.TMUX;
		delete process.env.TMUX_PANE;
		process.env.PI_CODING_AGENT_DIR = adoptConfigDir;
		delete process.env.PI_SUBAGENT_AGENT;
		delete process.env.PI_SUBAGENT_ALLOWED;
		process.env.PI_SUBAGENT_POLL_MS = "30";
		process.env.PI_SUBAGENT_MAX_WAIT_MS = "4000";
		process.env.PI_SUBAGENT_STARTUP_GRACE_MS = "2000";
		process.env.PI_SUBAGENT_PROCINFO_FAIL_LIMIT = "2";
		process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = "5";
		process.env.ADOPT_CAPTURE = adoptCapture;
		process.env.ADOPT_SCREEN = "";

		const adoptJiti = createJiti(import.meta.url, {
			moduleCache: false,
			alias: {
				"@earendil-works/pi-coding-agent": join(adoptRoot, "agent.cjs"),
				"@earendil-works/pi-ai": join(adoptRoot, "ai.cjs"),
				"@earendil-works/pi-tui": join(adoptRoot, "tui.cjs"),
			},
		});
		writeFileSync(join(adoptRoot, "agent.cjs"), "exports.defineTool = (tool) => tool;\nexports.keyHint = () => 'hint';\n");
		writeFileSync(join(adoptRoot, "ai.cjs"), "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
		writeFileSync(
			join(adoptRoot, "tui.cjs"),
			[
				"exports.Box = class Box { constructor(...a) { this.a = a; } };",
				"exports.Text = class Text { constructor(text) { this.text = text; } render() { return String(this.text).split('\\n'); } };",
				"exports.truncateToWidth = (text, width) => String(text).slice(0, Math.max(0, width));",
				"exports.visibleWidth = (text) => String(text).length;",
				"",
			].join("\n"),
		);
		const adoptModule = adoptJiti(
			new URL("./interactive-subagents/pi-extension/subagents/index.ts", import.meta.url).href,
		);

		const waitFor = async (predicate, label, timeoutMs = 5000) => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				if (predicate()) return;
			await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error(`${label} never became true`);
		};

		// -- Scenario A: pane gone, transcript ran → finalize, deliver, no close --
		{
			const sent = [];
			const handlers = {};
			const fakePi = {
				registerTool() {},
				registerCommand() {},
				registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: (message, opts) => sent.push({ message, opts }),
			};
			adoptModule.default(fakePi);
			stageEntry("gone-worker", { ran: true });
			writeFileSync(join(adoptRoot, "proc"), "zsh\n");
			process.env.ADOPT_PROC = join(adoptRoot, "proc");
			process.env.ADOPT_PANE_GONE = "1";
			const ctx = {
				sessionManager: {
					getSessionFile: () => parentSessionFile,
					getSessionId: () => "adopt-parent",
					getSessionDir: () => adoptSessionDir,
				},
				cwd: adoptRoot,
			};
			handlers.session_start?.({}, ctx);
			await waitFor(() => sent.some((e) => e.message.customType === "subagent_result"), "finalize steer (pane gone)");
			const steer = sent.find((e) => e.message.customType === "subagent_result");
			assert.equal(steer.message.details.name, "gone-worker");
			assert.equal(steer.message.details.status, "agent-gone");
			assert.match(steer.message.content, /Recovered at parent restart/);
			assert.match(steer.message.content, /Finished: gone-worker report ready\./, "harvested summary delivered");
			assert.equal(steer.opts.deliverAs, "steer");
			assert.equal(steer.opts.triggerTurn, true);
			const callsA = adoptCalls();
			assert.equal(
				callsA.some((c) => c[0] === "tab" && c[1] === "close"),
				false,
				"no tab close for an already-gone pane",
			);
			const registryA = JSON.parse(readFileSync(registryPath(), "utf8"));
			assert.equal(registryA["gone-worker"].running, false, "dead entry marked finished");
			assert.ok(registryA["gone-worker"].resultDeliveredAt, "delivery time recorded");
			handlers.session_shutdown?.({}, {});
			delete process.env.ADOPT_PANE_GONE;
		}

		// -- Scenario B: pane alive, agent gone → deliver + close the whole tab --
		{
			const sent = [];
			const handlers = {};
			const fakePi = {
				registerTool() {},
				registerCommand() {},
			registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: (message, opts) => sent.push({ message, opts }),
			};
			adoptModule.default(fakePi);
			stageEntry("shell-worker", { ran: true });
			handlers.session_start?.({}, {
				sessionManager: {
					getSessionFile: () => parentSessionFile,
					getSessionId: () => "adopt-parent",
					getSessionDir: () => adoptSessionDir,
				},
				cwd: adoptRoot,
			});
			await waitFor(() => sent.some((e) => e.message.customType === "subagent_result"), "finalize steer (pane alive)");
			const steer = sent.find((e) => e.message.customType === "subagent_result");
			assert.equal(steer.message.details.status, "agent-gone");
			assert.match(steer.message.content, /Finished: shell-worker report ready\./);
			assert.ok(
				adoptCalls().some((c) => c[0] === "tab" && c[1] === "close" && c[2] === "wO:t1"),
				"the live-pane-but-dead-agent tab closes whole",
			);
			const registryB = JSON.parse(readFileSync(registryPath(), "utf8"));
			assert.equal(registryB["shell-worker"].running, false);
			handlers.session_shutdown?.({}, {});
		}

		// -- Scenario C: pane alive, never ran → no-agent verdict, tab closed --
		{
			const sent = [];
			const handlers = {};
			const fakePi = {
				registerTool() {},
				registerCommand() {},
				registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: (message, opts) => sent.push({ message, opts }),
			};
			adoptModule.default(fakePi);
			stageEntry("never-ran", { ran: false });
			handlers.session_start?.({}, {
				sessionManager: {
					getSessionFile: () => parentSessionFile,
					getSessionId: () => "adopt-parent",
					getSessionDir: () => adoptSessionDir,
				},
				cwd: adoptRoot,
			});
			await waitFor(() => sent.some((e) => e.message.customType === "subagent_result"), "no-agent finalize steer");
			const steer = sent.find((e) => e.message.customType === "subagent_result");
			assert.equal(steer.message.details.status, "no-agent");
			assert.ok(
				adoptCalls().some((c) => c[0] === "tab" && c[1] === "close" && c[2] === "wO:t1"),
				"never-started tab closes whole",
			);
			const registryC = JSON.parse(readFileSync(registryPath(), "utf8"));
			assert.equal(registryC["never-ran"].running, false);
			handlers.session_shutdown?.({}, {});
		}

		// -- Scenario D: pane alive with pi → adopted watcher delivers on sentinel --
		{
			const sent = [];
			const handlers = {};
			const tools = new Map();
			const fakePi = {
				registerTool: (tool) => tools.set(tool.name, tool),
				registerCommand() {},
				registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: (message, opts) => sent.push({ message, opts }),
			};
			adoptModule.default(fakePi);
			stageEntry("live-worker", { ran: true });
			writeFileSync(join(adoptRoot, "proc"), "pi\n");
			process.env.ADOPT_SCREEN = "__SUBAGENT_DONE_0__";
			handlers.session_start?.({}, {
				sessionManager: {
					getSessionFile: () => parentSessionFile,
					getSessionId: () => "adopt-parent",
					getSessionDir: () => adoptSessionDir,
				},
				cwd: adoptRoot,
			});
			// Adoption probes pi → registers a fresh watcher → the sentinel on the
			// screen completes it → result steer + whole-tab close + mark finished.
			await waitFor(
				() => sent.some((e) => e.message.customType === "subagent_result" && e.message.details.adopted),
				"adopted completion steer",
			);
			const steer = sent.find(
				(e) => e.message.customType === "subagent_result" && e.message.details.adopted,
			);
			assert.equal(steer.message.details.name, "live-worker");
			assert.equal(steer.message.details.status, "sentinel");
			assert.match(steer.message.content, /Finished: live-worker report ready\./);
			assert.ok(
				adoptCalls().some((c) => c[0] === "tab" && c[1] === "close" && c[2] === "wO:t1"),
				"adopted completion closes the whole tab",
			);
			const registryD = JSON.parse(readFileSync(registryPath(), "utf8"));
			assert.equal(registryD["live-worker"].running, false);
			assert.equal(adoptModule.__test__.runningSubagents.size, 0, "adopted watcher deregistered");
			process.env.ADOPT_SCREEN = "";
			handlers.session_shutdown?.({}, {});
		}

		// -- Scenario E: durable guard steers a live orphan instead of resuming --
		{
			const sent = [];
			const handlers = {};
			const tools = new Map();
			const fakePi = {
				registerTool: (tool) => tools.set(tool.name, tool),
				registerCommand() {},
				registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: (message, opts) => sent.push({ message, opts }),
			};
			adoptModule.default(fakePi);
			const childFile = stageEntry("stale-live", { ran: true });
			// Loadout sidecar so the resume path WOULD be reachable if the guard failed.
			writeFileSync(
				`${childFile}.loadout.json`,
				JSON.stringify({
					agent: "worker",
					toolAllowlist: null,
					model: null,
					thinking: null,
					systemPromptMode: null,
					identity: null,
					spawnable: null,
					autoExit: true,
					cwd: adoptRoot,
					agentDir: adoptConfigDir,
				}),
			);
			const callsBefore = adoptCalls().length;
			const ack = await tools.get("subagent_message").execute(
				"call-e",
				{ name: "stale-live", message: "Status update please." },
				new AbortController().signal,
				undefined,
				{
					sessionManager: {
						getSessionFile: () => parentSessionFile,
						getSessionId: () => "adopt-parent",
						getSessionDir: () => adoptSessionDir,
					},
					cwd: adoptRoot,
				},
			);
			assert.match(ack.content[0].text, /Message delivered to running subagent/, "live orphan is steered, not resumed");
			const callsE = adoptCalls().slice(callsBefore);
			assert.equal(
				callsE.some((c) => c[0] === "tab" && c[1] === "create"),
				false,
				"no resume tab was created for a live orphan",
			);
			assert.ok(
				callsE.some(
					(c) => c[0] === "pane" && c[1] === "run" && c[2] === "wO:p1" && c[3]?.includes("Status update please."),
				),
				"the steer targets the original pane",
			);
			const registryE = JSON.parse(readFileSync(registryPath(), "utf8"));
			assert.equal(registryE["stale-live"].running, true, "steered orphan stays running");
			handlers.session_shutdown?.({}, {});
		}

		// -- Scenario F: dead orphan falls through to a real resume --
		{
			const sent = [];
			const handlers = {};
			const tools = new Map();
			const fakePi = {
				registerTool: (tool) => tools.set(tool.name, tool),
				registerCommand() {},
				registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: (message, opts) => sent.push({ message, opts }),
			};
			adoptModule.default(fakePi);
			// Re-install the module abort signal: E's session_shutdown aborted the
			// shared controller, and the resume path's launch signal wraps it. Stage
			// the dead entry AFTER session_start so adoption cannot finalize it first.
			handlers.session_start?.({}, {
				sessionManager: {
					getSessionFile: () => parentSessionFile,
					getSessionId: () => "adopt-parent",
					getSessionDir: () => adoptSessionDir,
				},
				cwd: adoptRoot,
			});
			const childFile = stageEntry("stale-dead", { ran: true });
			writeFileSync(
				`${childFile}.loadout.json`,
				JSON.stringify({
					agent: "worker",
					toolAllowlist: null,
					model: null,
					thinking: null,
					systemPromptMode: null,
					identity: null,
					spawnable: null,
					autoExit: true,
					cwd: adoptRoot,
					agentDir: adoptConfigDir,
				}),
			);
			process.env.ADOPT_PANE_GONE = "1";
			const callsBefore = adoptCalls().length;
			const ack = await tools.get("subagent_message").execute(
				"call-f",
				{ name: "stale-dead", message: "Resume the work." },
				new AbortController().signal,
				undefined,
				{
					sessionManager: {
						getSessionFile: () => parentSessionFile,
						getSessionId: () => "adopt-parent",
						getSessionDir: () => adoptSessionDir,
					},
					cwd: adoptRoot,
				},
			);
			assert.match(ack.content[0].text, /resumed/, "dead orphan resumes in a fresh tab");
			const callsF = adoptCalls().slice(callsBefore);
			assert.ok(
				callsF.some((c) => c[0] === "tab" && c[1] === "create"),
				"the resume created a fresh tab",
			);
			const registryF = JSON.parse(readFileSync(registryPath(), "utf8"));
			assert.equal(registryF["stale-dead"].running, true, "the resume rewrites the entry as running");
			assert.equal(registryF["stale-dead"].paneId, "wO:p9", "the entry points at the new pane");
			delete process.env.ADOPT_PANE_GONE;
			handlers.session_shutdown?.({}, {});
		}

		// -- Scenario G: session_start with no surface / no session file is a no-op --
		{
			const handlers = {};
			const fakePi = {
				registerTool() {},
				registerCommand() {},
				registerMessageRenderer() {},
				on: (name, handler) => { handlers[name] = handler; },
				events: { on() {}, emit() {} },
				getAllTools: () => [],
				sendMessage: () => { throw new Error("adoption must not send anything"); },
			};
			adoptModule.default(fakePi);
			// No sessionManager at all (the plain session_start({}, {}) shape).
			handlers.session_start?.({}, {});
			// Empty registry dir: session present, nothing registered.
			const adoptEmpty = mkdtempSync(join(tmpdir(), "subagent-adopt-empty-"));
			handlers.session_start?.({}, {
				sessionManager: {
					getSessionFile: () => join(adoptEmpty, "p.jsonl"),
					getSessionId: () => "empty-session",
					getSessionDir: () => adoptEmpty,
				},
				cwd: adoptEmpty,
			});
			await new Promise((r) => setTimeout(r, 100));
			rmSync(adoptEmpty, { recursive: true, force: true });
		}
	} finally {
		for (const [key, value] of Object.entries(savedAdoptEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.ADOPT_CAPTURE;
		delete process.env.ADOPT_PROC;
		delete process.env.ADOPT_PANE_GONE;
		delete process.env.ADOPT_SCREEN;
		rmSync(adoptRoot, { recursive: true, force: true });
	}
}

console.log("interactive-subagents surface smoke passed");
