import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
process.env.NODE_PATH = [
	"/opt/homebrew/lib/node_modules",
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules",
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules",
	process.env.NODE_PATH || "",
].filter(Boolean).join(":");
require("node:module").Module._initPaths();

// Resolve jiti the same way CI (JITI_PATH) and the local installs do.
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);

const {
	deriveRunId,
	bridgeRunDir,
	splitAgentArgv,
	stepLabelFromPrompt,
	buildTabLauncher,
	SessionEventTranslator,
} = jiti("./no-mistakes-pane/bridge.ts");
const {
	runPhaseLabel,
	isCiPhaseActive,
	PaneReportState,
} = jiti("./no-mistakes-pane/herdr-report.ts");

// ---------------------------------------------------------------------------
// Run discovery: the shim and the server must derive the same run id from
// the daemon-provided step worktree, and nothing else.
// ---------------------------------------------------------------------------
{
	const runId = "01M4KZ1QA7E1CSFXJM5B4W0240";
	assert.equal(deriveRunId(`/home/me/.no-mistakes/worktrees/e5cce92fbf21/${runId}`), runId);
	assert.equal(deriveRunId(`/home/me/.no-mistakes/worktrees/${runId}`), runId);
	assert.equal(deriveRunId("/home/me/.no-mistakes/worktrees/e5cce92fbf21"), undefined);
	assert.equal(deriveRunId("/home/me/dotfiles"), undefined);
	assert.equal(deriveRunId("/home/me/.no-mistakes/worktrees/not-a-ulid"), undefined);
	assert.equal(bridgeRunDir("/nm/home", runId), "/nm/home/herdr-bridge/" + runId);
}

// ---------------------------------------------------------------------------
// argv translation: interactive tab argv from the daemon's json-mode argv.
// The daemon's contract (upstream internal/agent/pi.go buildArgs): operator
// extras, then `--mode json`, then `--no-session` or `--session <uuid>`, and
// `--extension <file>` appended on the strict structured-output path.
// ---------------------------------------------------------------------------
{
	const daemonArgv = [
		"--provider", "fireworks",
		"--model", "accounts/fireworks/routers/glm-5p3-fast",
		"--mode", "json",
		"--no-session",
		"--extension", "/tmp/nm-output-abc.mjs",
	];
	const split = splitAgentArgv(daemonArgv);
	assert.deepEqual(
		split.interactive,
		[
			"--provider", "fireworks",
			"--model", "accounts/fireworks/routers/glm-5p3-fast",
			"--extension", "/tmp/nm-output-abc.mjs",
		],
	);
	assert.equal(split.sessionless, true);
	assert.equal(split.sessionId, undefined);
}
{
	const sessionId = "01a127f1-f447-7467-a86c-b2223710ba8e";
	const split = splitAgentArgv(["--mode", "json", "--session", sessionId]);
	assert.equal(split.sessionId, sessionId);
	assert.equal(split.sessionless, false);
	assert.deepEqual(split.interactive, ["--session", sessionId]);
}
{
	// A value that merely contains flag text must survive verbatim.
	const split = splitAgentArgv(["--append-system-prompt", "--no-session text", "--mode", "json"]);
	assert.deepEqual(split.interactive, ["--append-system-prompt", "--no-session text"]);
	assert.equal(split.sessionless, false);
}
{
	// Everything after `--` is positional and passes through untouched.
	const split = splitAgentArgv(["--mode", "json", "--", "positional", "--no-session"]);
	assert.deepEqual(split.interactive, ["--", "positional", "--no-session"]);
	assert.equal(split.sessionless, false);
}

// ---------------------------------------------------------------------------
// Step labels for tab names, derived from the daemon's phase prompt.
// ---------------------------------------------------------------------------
{
	assert.equal(stepLabelFromPrompt("Review the changes against the intent...", 1), "review");
	assert.equal(stepLabelFromPrompt("Drive live test scenarios...", 2), "test");
	assert.equal(stepLabelFromPrompt("Fix the CI failure on...", 3), "ci");
	assert.equal(stepLabelFromPrompt("Resolve the rebase conflict...", 4), "rebase");
	assert.equal(stepLabelFromPrompt("Extract the intent...", 5), "intent");
	assert.equal(stepLabelFromPrompt("Lint and fix...", 6), "lint");
	assert.equal(stepLabelFromPrompt("Update documentation...", 7), "document");
	assert.equal(stepLabelFromPrompt("Do something unclassifiable", 8), "agent-8");
}

// ---------------------------------------------------------------------------
// Tab launcher: daemon env subset exported, argv quoted, extensions explicit.
// ---------------------------------------------------------------------------
{
	const script = buildTabLauncher({
		realPi: "/home/me/.pi/agent/bin/pi",
		interactiveArgv: ["--provider", "fireworks", "--extension", "/tmp/nm-output.mjs"],
		env: { NO_MISTAKES_GATE: "1", GIT_EDITOR: ":", "BAD-KEY": "x", "1BAD": "y" },
		extraExtensions: ["/home/me/.pi/agent/extensions/herdr-agent-state.ts"],
	});
	const lines = script.split("\n");
	assert.equal(lines[0], "#!/bin/bash");
	assert.ok(lines.includes("export NO_MISTAKES_GATE='1'"), "gate evidence var is exported");
	assert.ok(lines.includes("export GIT_EDITOR=':'"), "git non-interactive discipline is exported");
	assert.ok(!script.includes("BAD-KEY") && !script.includes("1BAD"), "invalid env key names are skipped");
	const exec = lines.find((line) => line.startsWith("exec "));
	assert.ok(exec && exec.includes("'/home/me/.pi/agent/bin/pi'"));
	assert.ok(exec && exec.includes("'--no-extensions'"));
	assert.ok(exec && exec.includes("'--extension' '/tmp/nm-output.mjs'"));
	assert.ok(exec && exec.includes("'-e' '/home/me/.pi/agent/extensions/herdr-agent-state.ts'"));
	// A value with a single quote must round-trip through shell quoting.
	const tricky = buildTabLauncher({
		realPi: "pi",
		interactiveArgv: [],
		env: { GIT_MSG: "it's done" },
		extraExtensions: [],
	});
	assert.ok(tricky.includes("export GIT_MSG='it'\\''s done'"));
}

// ---------------------------------------------------------------------------
// Event translation: session records become the json-mode stream the
// daemon's piParser consumes (verified against a live `pi --mode json`
// capture and upstream's parser contract).
// ---------------------------------------------------------------------------
{
	const translator = new SessionEventTranslator();
	const fed = [
		...translator.feedRecord({ type: "session", id: "01a127f1-f447-7467-a86c-b2223710ba8e", version: "3" }),
		...translator.feedRecord({ type: "session", id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }),
		...translator.feedRecord({ type: "message", message: { role: "system", content: "", sections: {} } }),
		...translator.feedRecord({ type: "message", message: { role: "user", content: [{ type: "text", text: "review please" }] } }),
	];
	assert.deepEqual(fed.map((line) => JSON.parse(line)), [
		{ type: "session", id: "01a127f1-f447-7467-a86c-b2223710ba8e" },
		{ type: "message_end", message: { role: "user", content: [{ type: "text", text: "review please" }] } },
	]);

	// Strict output tool: the terminating toolCall plus its toolResult
	// synthesize the exact tool_execution_end envelope upstream parses.
	const toolCallId = "chatcmpl-tool-1";
	const strict = [
		...translator.feedRecord({
			type: "message",
			message: {
				role: "assistant",
				stopReason: "toolUse",
				model: "m", provider: "p", usage: { input: 10, output: 2 },
				content: [{ type: "toolCall", id: toolCallId, name: "no_mistakes_output", arguments: {} }],
			},
		}),
		...translator.feedRecord({
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: toolCallId,
				isError: false,
				content: [{ type: "text", text: JSON.stringify({ findings: [] }) }],
			},
		}),
	];
	const strictEvents = strict.map((line) => JSON.parse(line));
	assert.equal(strictEvents[0].type, "message_end");
	assert.equal(strictEvents[1].type, "message_end");
	assert.equal(strictEvents[1].message.role, "toolResult");
	assert.deepEqual(strictEvents[2], {
		type: "tool_execution_end",
		toolName: "no_mistakes_output",
		isError: false,
		toolCallId,
		result: { terminate: true, details: { output: { findings: [] } } },
	});

	// A different tool's result never synthesizes the output-tool envelope.
	const other = [
		...translator.feedRecord({
			type: "message",
			message: { role: "assistant", content: [{ type: "toolCall", id: "t2", name: "bash", arguments: {} }], stopReason: "toolUse" },
		}),
		...translator.feedRecord({
			type: "message",
			message: { role: "toolResult", toolCallId: "t2", isError: false, content: [{ type: "text", text: "ok" }] },
		}),
	];
	assert.ok(other.every((line) => JSON.parse(line).type !== "tool_execution_end"));

	// Unparseable output-tool text emits nothing (the daemon then rejects and
	// retries the turn, exactly as for a headless mis-call).
	const bad = translator.feedRecord({
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "t3", name: "no_mistakes_output", arguments: {} }],
			stopReason: "toolUse",
		},
	}).concat(
		translator.feedRecord({
			type: "message",
			message: { role: "toolResult", toolCallId: "t3", isError: false, content: [{ type: "text", text: "{not json" }] },
		}),
	);
	assert.ok(bad.every((line) => JSON.parse(line).type !== "tool_execution_end"));

	const final = translator.feedRecord({
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 1, output: 1 } },
	});
	assert.ok(final.length === 1);
	const finished = translator.finish().map((line) => JSON.parse(line));
	assert.equal(finished[0].type, "turn_end");
	assert.equal(finished[0].message.stopReason, "stop");
	assert.equal(finished[1].type, "agent_end");
	assert.equal(finished[1].messages[0].role, "system");
	assert.equal(finished[1].messages.at(-1).role, "assistant");
	assert.deepEqual(finished[2], { type: "agent_settled", aborted: false });
}
{
	// A resumed session seeds the header id from argv when no `session`
	// record is ever seen (the preface scan can miss a torn file head).
	const translator = new SessionEventTranslator("01aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
	translator.feedRecord({ type: "message", message: { role: "user", content: "fix" } });
	const finished = translator.finish().map((line) => JSON.parse(line));
	assert.equal(finished.length, 2, "no assistant turn means no turn_end line");
	assert.equal(finished[0].type, "agent_end");
	assert.equal(finished[0].messages.length, 1);
	assert.deepEqual(finished[1], { type: "agent_settled", aborted: false });
}

// ---------------------------------------------------------------------------
// Pane report: label and CI transitions fire once per change, release on
// run end, and the merge phase (checks already passed) is never CI-red.
// ---------------------------------------------------------------------------
function snapshot(currentPhase, phases) {
	return {
		id: "01M4KZ1QA7E1CSFXJM5B4W0240",
		status: "running",
		phases: phases ?? [{ name: currentPhase, status: "running" }],
		currentPhase,
		totalDurationMs: 1000,
		reviewFindings: [],
	};
}
{
	assert.equal(runPhaseLabel(snapshot("review")), "nm: review");
	assert.equal(runPhaseLabel(snapshot("starting")), "nm: starting");
	assert.ok(isCiPhaseActive(snapshot("ci")));
	assert.ok(!isCiPhaseActive(snapshot("merge")), "checks-passed monitoring is not CI-red");
	assert.ok(!isCiPhaseActive(snapshot("review", [
		{ name: "ci", status: "pending" },
		{ name: "review", status: "running" },
	])), "a pending CI phase behind review is not CI-red");
	assert.ok(isCiPhaseActive(snapshot("review", [
		{ name: "ci", status: "fixing" },
		{ name: "review", status: "running" },
	])), "an actively fixing CI phase is CI-red even when review holds the gate");

	const report = new PaneReportState();
	assert.deepEqual(report.next(snapshot("review")), { label: "nm: review" }, "no CI transition fires from the initial unblocked state");
	assert.deepEqual(report.next(snapshot("review")), {}, "no transition fires twice");
	assert.deepEqual(report.next(snapshot("ci")), { label: "nm: ci", ciBlocked: true });
	assert.deepEqual(report.next(undefined), { clearLabels: true, ciBlocked: false });
	assert.deepEqual(report.next(undefined), {}, "release fires once");
}
