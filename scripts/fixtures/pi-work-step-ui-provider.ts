import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { appendFileSync, existsSync, watch, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Type } from "typebox";
import registerNativeSubagents from "../native/pi-subagents/index.ts";

const PROVIDER = "pi-work-step-ui-verify";
const MODEL = "faux-work-step";
const STATE = Symbol.for("aviral.pi.work-step-verifier-state");

type VerifyState = { responseIndex: number };

const state =
	((globalThis as typeof globalThis & { [STATE]?: VerifyState })[STATE] ??= {
		responseIndex: Number(process.env.PI_VERIFY_RESPONSE_INDEX ?? 0),
	});

function codexShapedStream(source: any) {
	const stream = createAssistantMessageEventStream();
	void (async () => {
		for await (const event of source) {
			stream.push(
				"partial" in event
					? {
							...event,
							partial: {
								...event.partial,
								stopReason: "stop",
								usage: { ...event.partial.usage, totalTokens: 0 },
							},
						}
					: event,
			);
		}
	})();
	return stream;
}

const SUBAGENT_TASK =
	"Verify native subagent composition while retaining EXPANDED_TASK_DETAIL_SENTINEL";
const SUBAGENT_EMPTY_TASK = "Verify native subagent empty-output fallback";
const SUBAGENT_FAILED_EMPTY_TASK = "Verify failed native subagent with empty final text";
const SUBAGENT_CONCURRENCY_FIRST_TASK = "Verify first concurrency-one native child";
const SUBAGENT_CONCURRENCY_SECOND_TASK = "Verify queued concurrency-one native child";
const SUBAGENT_PROVIDER_TASK = "Verify provider-supplied compatibility states";
const SUBAGENT_ROOT_AGENT = "scout";
const SUBAGENT_NESTED_AGENT = "researcher";
const SUBAGENT_QUEUED_AGENT = "queued-worker";
const SUBAGENT_PROVIDER_AGENT = "provider-worker";
const SUBAGENT_EXIT_ONLY_AGENT = "exit-observer";
const SUBAGENT_NESTED_MODEL = "fixture/nested";
const SUBAGENT_EXIT_ONLY_MODEL = "fixture/exit-only";
const SUBAGENT_REAL_MODEL = `${PROVIDER}/${MODEL}`;
const SUBAGENT_FINAL_HEADING = "Native completion";
const SUBAGENT_FINAL_BOLD_TEXT = "Composition preserved";
const SUBAGENT_FINAL_TAIL = "V01 complete fixture-derived final response tail.";
const SUBAGENT_FINAL_SECOND = "Second deterministic completion paragraph.";
const SUBAGENT_FINAL_THIRD = "Third deterministic completion paragraph.";
const SUBAGENT_COLLAPSED_PROSE =
	`${SUBAGENT_FINAL_BOLD_TEXT} by the package renderer.`;
const SUBAGENT_OUTPUT =
	`## ${SUBAGENT_FINAL_HEADING}

**${SUBAGENT_FINAL_BOLD_TEXT}** by the package renderer.

${SUBAGENT_FINAL_SECOND}

${SUBAGENT_FINAL_THIRD}

${SUBAGENT_FINAL_TAIL}`;
const SUBAGENT_EMPTY_FALLBACK =
	"Completed successfully; no final response was returned.";
const SUBAGENT_REASONING_SENTINEL = "NATIVE_REASONING_SENTINEL_MUST_NOT_RENDER";
const SUBAGENT_PROVIDER_REASONING_SENTINEL = "PROVIDER_REASONING_SENTINEL_MUST_NOT_RENDER";
const SUBAGENT_PROVIDER_FALSE_SUCCESS = "Completed successfully despite producer state";
const SUBAGENT_FAILURE_NARRATIVE = `## V01 deterministic child failure

**Failure detail** from the real child process.

V01_REAL_FAILURE_TAIL`;
const SUBAGENT_EXIT_ONLY_NARRATIVE = "Subagent failed.";
const SUBAGENT_CONCURRENCY_FIRST_TOOL_ARGUMENT =
	"V01_QUEUED_CHILD_FIRST_TOOL_EVENT";
const SUBAGENT_LONG_COMMAND_HEAD = "v01-long-command-head";
const SUBAGENT_LONG_COMMAND_TAIL = "V01_DISTINGUISHING_COMMAND_TAIL";
const SUBAGENT_LONG_COMMAND_RAW = `${SUBAGENT_LONG_COMMAND_HEAD} begin
${Array.from({ length: 420 }, (_, index) => `segment-${String(index).padStart(4, "0")}`).join(" ")}
${SUBAGENT_LONG_COMMAND_TAIL}`;
const SUBAGENT_LONG_COMMAND_LOGICAL = SUBAGENT_LONG_COMMAND_RAW.replace(/\s+/g, " ").trim();
const SUBAGENT_PARENT_ARGUMENT_DECOY =
	`parent-argument ${SUBAGENT_NESTED_AGENT} (${SUBAGENT_NESTED_MODEL})`;
const SUBAGENT_COMMANDS = [
	{
		agent: SUBAGENT_ROOT_AGENT,
		shell: "bash",
		command: "v01printf ordinaryArg 'quoted-v01' \"$V01_VALUE\" \"${HOME}\" > ./v01-output.log",
		tokens: {
			command: ["v01printf"],
			argument: ["ordinaryArg"],
			flagVariable: ["$V01_VALUE", "${HOME}"],
			stringPath: ["'quoted-v01'", "./v01-output.log"],
			operator: [">"],
		},
	},
	{
		agent: SUBAGENT_NESTED_AGENT,
		shell: "zsh",
		command: "V01_ASSIGN=$(v01pwd) || v01test -v \"$V01_ASSIGN\"",
		tokens: {
			command: ["v01pwd", "v01test"],
			argument: [],
			flagVariable: ["V01_ASSIGN", "-v", "$V01_ASSIGN"],
			stringPath: [],
			operator: ["=$(", ")", "||"],
		},
	},
	{
		agent: SUBAGENT_ROOT_AGENT,
		shell: "zsh",
		command: "v01rg --v01-count needleArg ./v01-input.txt && v01echo doneArg",
		tokens: {
			command: ["v01rg", "v01echo"],
			argument: ["needleArg", "doneArg"],
			flagVariable: ["--v01-count"],
			stringPath: ["./v01-input.txt"],
			operator: ["&&"],
		},
	},
] as const;
const SUBAGENT_SPEC = {
	rootAgent: SUBAGENT_ROOT_AGENT,
	nestedAgent: SUBAGENT_NESTED_AGENT,
	parentThinking: "Exercise native subagent rendering inside the parent activity",
	expandedTaskSentinel: "EXPANDED_TASK_DETAIL_SENTINEL",
	finalHeading: SUBAGENT_FINAL_HEADING,
	finalBoldText: SUBAGENT_FINAL_BOLD_TEXT,
	finalTail: SUBAGENT_FINAL_TAIL,
	finalOutput: SUBAGENT_OUTPUT,
	finalBlocks: [
		SUBAGENT_FINAL_HEADING,
		SUBAGENT_COLLAPSED_PROSE,
		SUBAGENT_FINAL_SECOND,
		SUBAGENT_FINAL_THIRD,
		SUBAGENT_FINAL_TAIL,
	],
	expandedOnlyFinalBlocks: [
		SUBAGENT_FINAL_HEADING,
		SUBAGENT_FINAL_SECOND,
		SUBAGENT_FINAL_THIRD,
		SUBAGENT_FINAL_TAIL,
	],
	collapsedProse: SUBAGENT_COLLAPSED_PROSE,
	emptyFallback: SUBAGENT_EMPTY_FALLBACK,
	reasoningSentinel: SUBAGENT_REASONING_SENTINEL,
	usage: {
		firstTurn: {
			input: 321,
			output: 123,
			cacheRead: 45,
			cacheWrite: 6,
			totalTokens: 444,
			cost: 0.0123,
		},
		fallbackTurn: {
			input: 41,
			output: 17,
			cacheRead: 9,
			cacheWrite: 3,
			contextTokens: 70,
			cost: 0.0045,
		},
		turns: 2,
		contextWindow: 8192,
		running: {
			accumulatedTokens: 495,
			latestContextTokens: 444,
			tokenDisplay: "495 tokens",
			costDisplay: "$0.012",
			contextDisplay: "5.4%/8k",
		},
		settled: {
			input: 362,
			output: 140,
			cacheRead: 54,
			cacheWrite: 9,
			accumulatedTokens: 565,
			latestContextTokens: 70,
			cost: 0.0168,
			tokenDisplay: "565 tokens",
			costDisplay: "$0.017",
			contextDisplay: "0.9%/8k",
		},
	},
	commands: SUBAGENT_COMMANDS,
	chronology: [
		SUBAGENT_COMMANDS[0].command,
		SUBAGENT_NESTED_AGENT,
		SUBAGENT_COMMANDS[1].command,
		SUBAGENT_COMMANDS[2].command,
	],
	review: {
		longCommand: {
			shell: "bash",
			raw: SUBAGENT_LONG_COMMAND_RAW,
			logical: SUBAGENT_LONG_COMMAND_LOGICAL,
			head: SUBAGENT_LONG_COMMAND_HEAD,
			tail: SUBAGENT_LONG_COMMAND_TAIL,
			captureWidth: SUBAGENT_LONG_COMMAND_LOGICAL.length + 80,
		},
		nested: {
			agent: SUBAGENT_NESTED_AGENT,
			model: SUBAGENT_NESTED_MODEL,
			parentArgumentDecoy: SUBAGENT_PARENT_ARGUMENT_DECOY,
			shell: SUBAGENT_COMMANDS[1].shell,
			command: SUBAGENT_COMMANDS[1].command,
			exitOnly: {
				agent: SUBAGENT_EXIT_ONLY_AGENT,
				model: SUBAGENT_EXIT_ONLY_MODEL,
				narrative: SUBAGENT_EXIT_ONLY_NARRATIVE,
			},
		},
		failure: {
			emptyPrompt: "subagent failed empty",
			narrative: SUBAGENT_FAILURE_NARRATIVE,
			narrativeTail: "V01_REAL_FAILURE_TAIL",
			blocks: [
				"V01 deterministic child failure",
				"Failure detail from the real child process.",
				"V01_REAL_FAILURE_TAIL",
			],
			successPrefix: "Completed successfully",
			successFallback: SUBAGENT_EMPTY_FALLBACK,
		},
	},
	real: {
		model: SUBAGENT_REAL_MODEL,
		mainTask: SUBAGENT_TASK,
		emptyTask: SUBAGENT_EMPTY_TASK,
		failureTask: SUBAGENT_FAILED_EMPTY_TASK,
		concurrencyPrompt: "subagent concurrency one",
		concurrencyFirstTask: SUBAGENT_CONCURRENCY_FIRST_TASK,
		concurrencySecondTask: SUBAGENT_CONCURRENCY_SECOND_TASK,
		queuedAgent: SUBAGENT_QUEUED_AGENT,
		queuedText: "Queued…",
		thinkingText: "Thinking…",
		concurrencyFirstTool: "read",
		concurrencyFirstToolArgument: SUBAGENT_CONCURRENCY_FIRST_TOOL_ARGUMENT,
	},
	provider: {
		tool: "subagent",
		agent: SUBAGENT_PROVIDER_AGENT,
		model: "fixture/provider",
		prompt: "subagent provider compatibility",
		task: SUBAGENT_PROVIDER_TASK,
		reasoningSentinel: SUBAGENT_PROVIDER_REASONING_SENTINEL,
		falseSuccess: SUBAGENT_PROVIDER_FALSE_SUCCESS,
		queuedText: "Queued…",
	},
};

const responses = [
	fauxAssistantMessage([
		fauxThinking("NON_TOOL_THINKING_SENTINEL"),
		fauxText("NON_TOOL_RENDERING_SENTINEL"),
	]),
	fauxAssistantMessage(
		[
			fauxThinking(
				"PRE_TOOL_SUPPRESSION_SENTINEL → keep tool activity flow chronological",
			),
			fauxThinking("Inspect configuration → Decision: validate grouped tool rendering"),
			fauxThinking("Answer renderer question → Outcome: grouped tools share one timeline"),
			fauxThinking("Select plan limit → Decision: retain five recent thinking blocks"),
			fauxText("Run grouped verification"),
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-same-1" },
			),
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-same-2" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage(
		[
			fauxThinking("Continue inspection → Outcome: renderer remains stable after grouped tools"),
			fauxThinking("Check summary contract → Outcome: every retained block has a result"),
			fauxThinking("Finalize plan rendering → Outcome: oldest thinking blocks are omitted"),
			fauxText("Continue grouped verification"),
			fauxToolCall(
				"mcp",
				{ server: "google_workspace", tool: "google_workspace_search_gmail_messages" },
				{ id: "verify-mcp-google-1" },
			),
			fauxToolCall(
				"mcp",
				{ connect: "google_workspace" },
				{ id: "verify-mcp-google-2" },
			),
			fauxToolCall(
				"mcp",
				{ server: "whatsapp", tool: "whatsapp_list_messages" },
				{ id: "verify-mcp-whatsapp" },
			),
			fauxToolCall(
				"mcp",
				{ tool: "search_gmail_messages" },
				{ id: "verify-mcp-gateway" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage([
		fauxThinking("Prepare grouped verification response"),
		fauxText("VERIFY_SAME_NAME_DONE"),
	]),
	fauxAssistantMessage(
		[
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: true },
				{ id: "verify-mixed-failure" },
			),
			fauxToolCall("read", { path: "pi/.pi/agent/settings.json" }, { id: "verify-mixed-read" }),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_MIXED_NAME_DONE"),
	fauxAssistantMessage(
		[
			fauxThinking(
				"Check which title source is available across narrow terminals",
			),
			fauxThinking("Keep every native thinking update in source order"),
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-thinking-no-title" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_THINKING_NO_TITLE_DONE"),
	fauxAssistantMessage(
		[
			fauxThinking("Restore **missing** result"),
			fauxText("Reconcile persisted tool result"),
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-missing-result" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_RESTORE_SOURCE_DONE"),
	fauxAssistantMessage(
		[
			fauxThinking("### Verify `after reload`"),
			fauxText("Run post-reload verification"),
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-after-reload" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_AFTER_RELOAD_DONE"),
	fauxAssistantMessage(
		[
			fauxThinking("Exercise native subagent rendering inside the parent activity"),
			fauxText("Delegate deterministic subagent verification"),
			fauxToolCall(
				"subagent",
				{
					agent: "scout",
					task: SUBAGENT_TASK,
				},
				{ id: "verify-subagent-composition" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SUBAGENT_COMPOSITION_DONE"),
	fauxAssistantMessage(
		[
			fauxText("Verify native empty-output fallback"),
			fauxToolCall(
				"subagent",
				{
					agent: SUBAGENT_SPEC.rootAgent,
					task: SUBAGENT_EMPTY_TASK,
				},
				{ id: "verify-subagent-empty-output" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SUBAGENT_EMPTY_DONE"),
	fauxAssistantMessage(
		[
			fauxText("Verify failed empty native result"),
			fauxToolCall(
				"subagent",
				{
					agent: SUBAGENT_SPEC.rootAgent,
					task: SUBAGENT_FAILED_EMPTY_TASK,
				},
				{ id: "verify-subagent-failed-empty" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SUBAGENT_FAILED_EMPTY_DONE"),
	fauxAssistantMessage(
		[
			fauxText("Verify concurrency-one queued child state"),
			fauxToolCall(
				"subagent",
				{
					agent: SUBAGENT_SPEC.rootAgent,
					task: SUBAGENT_CONCURRENCY_FIRST_TASK,
				},
				{ id: "verify-subagent-concurrency-first" },
			),
			fauxToolCall(
				"subagent",
				{
					agent: SUBAGENT_SPEC.real.queuedAgent,
					task: SUBAGENT_CONCURRENCY_SECOND_TASK,
				},
				{ id: "verify-subagent-concurrency-second" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SUBAGENT_CONCURRENCY_DONE"),
	fauxAssistantMessage(
		[
			fauxText("Verify provider compatibility states"),
			fauxToolCall(
				SUBAGENT_SPEC.provider.tool,
				{
					agent: SUBAGENT_SPEC.provider.agent,
					task: SUBAGENT_PROVIDER_TASK,
				},
				{ id: "verify-subagent-provider-compatibility" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SUBAGENT_PROVIDER_DONE"),
];

function providerCompatibilityDetails(
	status: "running" | "pending" | "failed",
	lastMessage: string,
) {
	const error = status === "failed" ? SUBAGENT_FAILURE_NARRATIVE : undefined;
	return {
		results: [
			{
				agent: SUBAGENT_SPEC.provider.agent,
				task: SUBAGENT_SPEC.provider.task,
				output: "",
				exitCode: status === "failed" ? 1 : -1,
				model: SUBAGENT_SPEC.provider.model,
				usage: { input: 17, turns: 1 },
				progress: {
					agent: SUBAGENT_SPEC.provider.agent,
					status,
					task: SUBAGENT_SPEC.provider.task,
					recentTools: [],
					toolCount: 0,
					tokens: 23,
					durationMs: 0,
					lastMessage,
					...(error ? { error } : {}),
				},
			},
		],
	};
}

const REAL_CHILD_SOURCE = String.raw`
const fs = require("node:fs");
const spec = JSON.parse(fs.readFileSync(process.env.PI_VERIFY_SUBAGENT_SPEC, "utf8"));
const taskArg = process.argv.find((arg) => arg.startsWith("Task: ")) || "";
const task = taskArg.slice(6);
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const mark = (name, value) => {
	const path = process.env[name];
	if (path) fs.writeFileSync(path, value + "\n", "utf8");
};
const appendMark = (name, value) => {
	const path = process.env[name];
	if (path) fs.appendFileSync(path, value + "\n", "utf8");
};
const waitFor = (name) => new Promise((resolve) => {
	const path = process.env[name];
	if (!path || fs.existsSync(path)) return resolve();
	const timer = setInterval(() => {
		if (fs.existsSync(path)) {
			clearInterval(timer);
			resolve();
		}
	}, 10);
});
const usage = {
	input: spec.usage.firstTurn.input,
	output: spec.usage.firstTurn.output,
	cacheRead: spec.usage.firstTurn.cacheRead,
	cacheWrite: spec.usage.firstTurn.cacheWrite,
	totalTokens: spec.usage.firstTurn.totalTokens,
	cost: { total: spec.usage.firstTurn.cost },
};
const message = (text, errorMessage, messageUsage = usage) => ({
	type: "message_end",
	message: {
		role: "assistant",
		model: spec.real.model,
		content: text === undefined ? [] : [
			{ type: "thinking", thinking: spec.reasoningSentinel },
			{ type: "text", text },
		],
		usage: messageUsage,
		...(errorMessage ? { errorMessage } : {}),
	},
});
const nestedResult = {
	agent: spec.review.nested.agent,
	task: "Inspect nested fixture progress",
	output: "Nested fixture complete.",
	exitCode: 0,
	model: spec.review.nested.model,
	contextWindow: 8192,
	usage: { input: 34, output: 21, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
	progress: {
		agent: spec.review.nested.agent,
		status: "completed",
		task: "Inspect nested fixture progress",
		recentTools: [{
			tool: spec.review.nested.shell,
			args: spec.review.nested.command,
			toolCallId: "nested-zsh",
			status: "done",
		}],
		toolCount: 1,
		tokens: 55,
		durationMs: 640,
		lastMessage: "",
	},
};
const nestedExitOnlyResult = {
	agent: spec.review.nested.exitOnly.agent,
	task: "Observe nested exit-only failure",
	output: "",
	exitCode: 23,
	model: spec.review.nested.exitOnly.model,
	contextWindow: 4096,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
	progress: {
		agent: spec.review.nested.exitOnly.agent,
		status: "failed",
		task: "Observe nested exit-only failure",
		recentTools: [],
		toolCount: 0,
		tokens: 0,
		durationMs: 230,
		lastMessage: "",
	},
};
async function main() {
	appendMark("PI_VERIFY_REAL_CHILD_MARKER", task);
	if (task === spec.real.mainTask) {
		mark("PI_VERIFY_REAL_MAIN_SPAWN_MARKER", "spawned");
		await waitFor("PI_VERIFY_SUBAGENT_PROGRESS_RELEASE");
		const events = [
			{ type: "tool_execution_start", toolName: spec.commands[0].shell, toolCallId: "root-bash", args: { command: spec.commands[0].command } },
			{ type: "tool_execution_end", toolName: spec.commands[0].shell, toolCallId: "root-bash", result: {} },
			{ type: "tool_execution_start", toolName: "subagent", toolCallId: "root-subagent", args: { agent: spec.review.nested.parentArgumentDecoy } },
			{ type: "tool_execution_update", toolName: "subagent", toolCallId: "root-subagent", partialResult: { details: { results: [nestedResult, nestedExitOnlyResult] } } },
			{ type: "tool_execution_end", toolName: "subagent", toolCallId: "root-subagent", result: { details: { results: [nestedResult, nestedExitOnlyResult] } } },
			{ type: "tool_execution_start", toolName: spec.commands[2].shell, toolCallId: "root-zsh", args: { command: spec.commands[2].command } },
			{ type: "tool_execution_end", toolName: spec.commands[2].shell, toolCallId: "root-zsh", result: {} },
			{ type: "tool_execution_start", toolName: spec.review.longCommand.shell, toolCallId: "root-long-bash", args: { command: spec.review.longCommand.raw } },
		];
		for (const event of events) emit(event);
		mark("PI_VERIFY_NESTED_EXIT_ONLY_MARKER", JSON.stringify({
			parentTool: "subagent",
			parentToolCallId: "root-subagent",
			agent: nestedExitOnlyResult.agent,
			model: nestedExitOnlyResult.model,
			status: nestedExitOnlyResult.progress.status,
			exitCode: nestedExitOnlyResult.exitCode,
			output: nestedExitOnlyResult.output,
			lastMessage: nestedExitOnlyResult.progress.lastMessage,
			error: nestedExitOnlyResult.progress.error ?? null,
		}));
		mark("PI_VERIFY_REAL_EVENT_MARKER", "normalized");
		emit(message(""));
		mark("PI_VERIFY_REASONING_UPSTREAM_MARKER", spec.reasoningSentinel);
		await waitFor("PI_VERIFY_SUBAGENT_RELEASE");
		emit({ type: "tool_execution_end", toolName: spec.review.longCommand.shell, toolCallId: "root-long-bash", result: {} });
		emit(message(spec.finalOutput, undefined, {
			input: spec.usage.fallbackTurn.input,
			output: spec.usage.fallbackTurn.output,
			cacheRead: spec.usage.fallbackTurn.cacheRead,
			cacheWrite: spec.usage.fallbackTurn.cacheWrite,
			cost: { total: spec.usage.fallbackTurn.cost },
		}));
		return;
	}
	if (task === spec.real.emptyTask) {
		emit(message(""));
		return;
	}
	if (task === spec.real.failureTask) {
		emit(message(undefined, spec.review.failure.narrative));
		process.exitCode = 1;
		return;
	}
	if (task === spec.real.concurrencyFirstTask) {
		mark("PI_VERIFY_CONCURRENCY_FIRST_MARKER", "spawned");
		await waitFor("PI_VERIFY_CONCURRENCY_RELEASE");
		emit(message("First concurrency child complete."));
		return;
	}
	if (task === spec.real.concurrencySecondTask) {
		mark("PI_VERIFY_CONCURRENCY_SECOND_MARKER", "spawned");
		await waitFor("PI_VERIFY_CONCURRENCY_SECOND_RELEASE");
		emit({
			type: "tool_execution_start",
			toolName: spec.real.concurrencyFirstTool,
			toolCallId: "queued-first-tool",
			args: { path: spec.real.concurrencyFirstToolArgument },
		});
		emit({
			type: "tool_execution_end",
			toolName: spec.real.concurrencyFirstTool,
			toolCallId: "queued-first-tool",
			result: {},
		});
		emit(message("Second concurrency child complete."));
		return;
	}
	throw new Error("Unexpected deterministic child task: " + task);
}
main().catch((error) => {
	process.stderr.write(String(error && error.stack || error) + "\n");
	process.exitCode = 1;
});
`;

function writeFixtureMarker(environmentName: string, value: string): void {
	const markerPath = process.env[environmentName];
	if (!markerPath) throw new Error(`${environmentName} is required`);
	writeFileSync(markerPath, `${value}\n`, "utf8");
}

function containsRawReasoning(value: unknown): boolean {
	if (typeof value === "string")
		return value.includes(SUBAGENT_REASONING_SENTINEL) ||
			value.includes(SUBAGENT_PROVIDER_REASONING_SENTINEL);
	if (Array.isArray(value)) return value.some(containsRawReasoning);
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([key, nested]) =>
		key === "reasoning" ||
		key === "thinking" ||
		(key === "type" && nested === "thinking") ||
		containsRawReasoning(nested),
	);
}

function waitForFixtureRelease(
	environmentName: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const releasePath = process.env[environmentName];
	if (!releasePath)
		return Promise.reject(new Error(`${environmentName} is required`));
	if (existsSync(releasePath)) return Promise.resolve();

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const watcher = watch(dirname(releasePath), () => {
			if (existsSync(releasePath)) finish();
		});
		const abort = () => finish(new Error("Deterministic subagent fixture aborted"));
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			watcher.close();
			signal?.removeEventListener("abort", abort);
			if (error) reject(error);
			else resolve();
		};
		signal?.addEventListener("abort", abort, { once: true });
		if (existsSync(releasePath)) finish();
	});
}

function loadNativeSubagentTool(pi: ExtensionAPI): any {
	let nativeTool: any;
	const intercepted = new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") {
				return (tool: any) => {
					if (tool.name === "subagent") nativeTool = tool;
					else target.registerTool(tool);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	registerNativeSubagents(intercepted);
	if (!nativeTool?.execute || !nativeTool?.renderCall || !nativeTool?.renderResult)
		throw new Error("Active pi-subagents package did not register its native renderers");
	const childPath = process.env.PI_VERIFY_REAL_CHILD;
	if (!childPath) return nativeTool;
	writeFileSync(childPath, REAL_CHILD_SOURCE, { encoding: "utf8", mode: 0o700 });
	for (const name of [
		SUBAGENT_ROOT_AGENT,
		SUBAGENT_QUEUED_AGENT,
		SUBAGENT_PROVIDER_AGENT,
	]) {
		(globalThis as any).__pi_subagents.registerAgent({
			name,
			description: "Deterministic verifier child",
			tools: [],
			model: SUBAGENT_REAL_MODEL,
			thinking: "off",
			systemPrompt: "Deterministic verifier child",
			filePath: childPath,
		});
	}
	const execute = nativeTool.execute.bind(nativeTool);
	let activeExecutions = 0;
	let originalEntry = "";
	nativeTool.execute = async (...args: any[]) => {
		if (activeExecutions++ === 0) {
			originalEntry = process.argv[1];
			process.argv[1] = childPath;
		}
		const params = args[1] as { task?: string };
		appendFileSync(
			process.env.PI_VERIFY_REAL_EXECUTE_MARKER!,
			`${params.task ?? "<missing task>"}\n`,
			"utf8",
		);
		const onUpdate = args[3];
		const forwardUpdate = (update: any) => {
			if (containsRawReasoning(update))
				writeFixtureMarker("PI_VERIFY_REASONING_CONTAMINATION_MARKER", "contaminated");
			const progress = update?.details?.results?.[0]?.progress;
			if (params.task === SUBAGENT_TASK) {
				if ((progress?.recentTools?.length ?? 0) === 0)
					writeFixtureMarker("PI_VERIFY_SUBAGENT_INITIAL_MARKER", "real execute initial update");
				else
					writeFixtureMarker("PI_VERIFY_SUBAGENT_UPDATE_MARKER", "real child event normalized");
			}
			onUpdate?.(update);
		};
		args[3] = forwardUpdate;
		try {
			if (params.task === SUBAGENT_PROVIDER_TASK) {
				forwardUpdate({
					content: [{ type: "text", text: "provider running" }],
					details: providerCompatibilityDetails(
						"running",
						SUBAGENT_SPEC.real.thinkingText,
					),
				});
				writeFixtureMarker("PI_VERIFY_PROVIDER_RUNNING_MARKER", "running");
				await waitForFixtureRelease("PI_VERIFY_PROVIDER_PENDING_RELEASE", args[2]);
				forwardUpdate({
					content: [{ type: "text", text: "provider pending" }],
					details: providerCompatibilityDetails(
						"pending",
						SUBAGENT_PROVIDER_FALSE_SUCCESS,
					),
				});
				writeFixtureMarker("PI_VERIFY_PROVIDER_PENDING_MARKER", "pending");
				await waitForFixtureRelease("PI_VERIFY_PROVIDER_FAILED_RELEASE", args[2]);
				const failed = providerCompatibilityDetails(
					"failed",
					SUBAGENT_PROVIDER_FALSE_SUCCESS,
				);
				forwardUpdate({
					content: [{ type: "text", text: "provider failed" }],
					details: failed,
				});
				writeFixtureMarker("PI_VERIFY_PROVIDER_FAILED_MARKER", "failed");
				await waitForFixtureRelease("PI_VERIFY_PROVIDER_FINAL_RELEASE", args[2]);
				return {
					content: [{ type: "text", text: SUBAGENT_FAILURE_NARRATIVE }],
					details: failed,
					isError: true,
				};
			}
			const result = await execute(...args);
			if (params.task === SUBAGENT_TASK) {
				const normalized = result?.details?.results?.[0];
				if (!existsSync(process.env.PI_VERIFY_REASONING_CONTAMINATION_MARKER!))
					writeFixtureMarker(
						"PI_VERIFY_REASONING_MODEL_MARKER",
						"all-updates-clean",
					);
				writeFixtureMarker("PI_VERIFY_USAGE_MARKER", JSON.stringify({
					model: normalized?.model,
					contextWindow: normalized?.contextWindow,
					usage: normalized?.usage,
					latestContextTokens: normalized?.progress?.tokens,
				}));
			}
			return result;
		} finally {
			if (--activeExecutions === 0) process.argv[1] = originalEntry;
		}
	};
	return nativeTool;
}

export default function piWorkStepUiProvider(pi: ExtensionAPI) {
	const faux = fauxProvider({
		provider: PROVIDER,
		models: [{ id: MODEL, name: "Pi Work-Step UI Faux", reasoning: true, contextWindow: 8192 }],
		tokenSize: { min: 1024, max: 1024 },
		tokensPerSecond: 100,
	});

	faux.setResponses(
		Array.from({ length: 64 }, () => () => {
			const response = responses[state.responseIndex++];
			return (
				response ??
				fauxAssistantMessage([], {
					stopReason: "error",
					errorMessage: `Unexpected faux response ${state.responseIndex}`,
				})
			);
		}),
	);
	for (const method of ["stream", "streamSimple"] as const) {
		const original = faux.provider[method].bind(faux.provider);
		(faux.provider as any)[method] = (...args: any[]) =>
			codexShapedStream(original(...args));
	}
	pi.registerProvider(faux.provider);

	pi.registerTool({
		name: "mcp",
		label: "MCP verifier tool",
		description: "Verifies that MCP calls are grouped by server.",
		parameters: Type.Object({
			server: Type.Optional(Type.String()),
			connect: Type.Optional(Type.String()),
			tool: Type.Optional(Type.String()),
		}),
		async execute() {
			return { content: [{ type: "text", text: "MCP_RESULT_SENTINEL" }] };
		},
	});

	const nativeSubagentTool = loadNativeSubagentTool(pi);
	if (process.env.PI_VERIFY_SUBAGENT_SPEC)
		writeFixtureMarker("PI_VERIFY_SUBAGENT_SPEC", JSON.stringify(SUBAGENT_SPEC));
	pi.registerTool(nativeSubagentTool);

	pi.registerTool({
		name: "noisy_verify_tool",
		label: "Noisy verifier tool",
		description: "Emits content that the aggregate work-step renderer must suppress.",
		parameters: Type.Object({
			value: Type.String(),
			fail: Type.Boolean(),
		}),
		async execute(_toolCallId, params, _signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: "NOISY_PARTIAL_SENTINEL" }] });
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (params.fail) throw new Error("NOISY_ERROR_SENTINEL");
			return {
				content: [{ type: "text", text: "NOISY_RESULT_SENTINEL" }],
				details: { value: params.value },
			};
		},
		renderCall() {
			return new Text("NOISY_CALL_RENDERER_SENTINEL", 0, 0);
		},
		renderResult() {
			return new Text("NOISY_RESULT_RENDERER_SENTINEL", 0, 0);
		},
	});
}
