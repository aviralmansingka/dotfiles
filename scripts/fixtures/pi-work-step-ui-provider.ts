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
import { existsSync, watch, writeFileSync } from "node:fs";
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
const SUBAGENT_FAILED_DUPLICATE_TASK = "Verify failed native subagent error deduplication";
const SUBAGENT_ROOT_AGENT = "scout";
const SUBAGENT_NESTED_AGENT = "researcher";
const SUBAGENT_NESTED_MODEL = "fixture/nested";
const SUBAGENT_FINAL_HEADING = "Native completion";
const SUBAGENT_FINAL_BOLD_TEXT = "Composition preserved";
const SUBAGENT_COLLAPSED_PROSE =
	`${SUBAGENT_FINAL_BOLD_TEXT} by the package renderer.`;
const SUBAGENT_OUTPUT =
	`## ${SUBAGENT_FINAL_HEADING}\n\n**${SUBAGENT_FINAL_BOLD_TEXT}** by the package renderer.`;
const SUBAGENT_EMPTY_FALLBACK =
	"Completed successfully; no final response was returned.";
const SUBAGENT_REASONING_SENTINEL = "NATIVE_REASONING_SENTINEL_MUST_NOT_RENDER";
const SUBAGENT_FAILURE_NARRATIVE = "V01 deterministic child failure";
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
		command: "v01printf ordinaryArg 'quoted-v01' \"$V01_VALUE\" > ./v01-output.log",
		tokens: {
			command: ["v01printf"],
			argument: ["ordinaryArg"],
			flagVariable: ["$V01_VALUE"],
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
			flagVariable: ["-v", "$V01_ASSIGN"],
			stringPath: [],
			operator: ["V01_ASSIGN=$(", "||"],
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
	expandedTaskSentinel: "EXPANDED_TASK_DETAIL_SENTINEL",
	finalHeading: SUBAGENT_FINAL_HEADING,
	finalBoldText: SUBAGENT_FINAL_BOLD_TEXT,
	collapsedProse: SUBAGENT_COLLAPSED_PROSE,
	emptyFallback: SUBAGENT_EMPTY_FALLBACK,
	reasoningSentinel: SUBAGENT_REASONING_SENTINEL,
	usage: { input: 321, output: 123, turns: 2 },
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
		},
		failure: {
			emptyPrompt: "subagent failed empty",
			duplicatePrompt: "subagent failed duplicate",
			narrative: SUBAGENT_FAILURE_NARRATIVE,
			successPrefix: "Completed successfully",
			successFallback: SUBAGENT_EMPTY_FALLBACK,
		},
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
			fauxText("Verify failed native error deduplication"),
			fauxToolCall(
				"subagent",
				{
					agent: SUBAGENT_SPEC.rootAgent,
					task: SUBAGENT_FAILED_DUPLICATE_TASK,
				},
				{ id: "verify-subagent-failed-duplicate" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SUBAGENT_FAILED_DUPLICATE_DONE"),
];

const SUBAGENT_USAGE = {
	input: SUBAGENT_SPEC.usage.input,
	output: SUBAGENT_SPEC.usage.output,
	cacheRead: 45,
	cacheWrite: 6,
	cost: 0.0123,
	turns: SUBAGENT_SPEC.usage.turns,
};

function nativeChildren() {
	return [
		{
			agent: SUBAGENT_SPEC.nestedAgent,
			task: "Inspect nested fixture progress",
			output: "Nested fixture complete.",
			exitCode: 0,
			model: SUBAGENT_NESTED_MODEL,
			contextWindow: 8192,
			usage: { input: 34, output: 21, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			progress: {
				agent: SUBAGENT_SPEC.nestedAgent,
				status: "completed" as const,
				task: "Inspect nested fixture progress",
				recentTools: [
					{
						tool: SUBAGENT_COMMANDS[1].shell,
						args: SUBAGENT_COMMANDS[1].command,
						toolCallId: "nested-zsh",
						status: "done" as const,
					},
				],
				toolCount: 1,
				tokens: 55,
				durationMs: 640,
				lastMessage: "",
				reasoning: SUBAGENT_REASONING_SENTINEL,
			},
		},
	];
}

function nativeInitialDetails() {
	const progress = {
		agent: SUBAGENT_SPEC.rootAgent,
		status: "running" as const,
		task: SUBAGENT_TASK,
		recentTools: [],
		toolCount: 0,
		tokens: 0,
		durationMs: 0,
		lastMessage: "Thinking…",
		reasoning: SUBAGENT_REASONING_SENTINEL,
	};
	return {
		results: [
			{
				agent: SUBAGENT_SPEC.rootAgent,
				task: SUBAGENT_TASK,
				output: "",
				exitCode: -1,
				model: "fixture/root",
				contextWindow: 16384,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				progress,
			},
		],
	};
}

function nativeRunningDetails() {
	const progress = {
		agent: SUBAGENT_SPEC.rootAgent,
		status: "running" as const,
		task: SUBAGENT_TASK,
		recentTools: [
			{
				tool: SUBAGENT_COMMANDS[0].shell,
				args: SUBAGENT_COMMANDS[0].command,
				toolCallId: "root-bash",
				status: "done" as const,
			},
			{
				tool: "subagent",
				args: SUBAGENT_PARENT_ARGUMENT_DECOY,
				toolCallId: "root-subagent",
				status: "done" as const,
				children: nativeChildren(),
			},
			{
				tool: SUBAGENT_COMMANDS[2].shell,
				args: SUBAGENT_COMMANDS[2].command,
				toolCallId: "root-zsh",
				status: "done" as const,
			},
			{
				tool: SUBAGENT_SPEC.review.longCommand.shell,
				args: SUBAGENT_SPEC.review.longCommand.raw,
				toolCallId: "root-long-bash",
				status: "running" as const,
			},
		],
		toolCount: 4,
		tokens: 444,
		durationMs: 1200,
		lastMessage: "NATIVE_RUNNING_PROGRESS_SENTINEL",
		reasoning: SUBAGENT_REASONING_SENTINEL,
	};
	return {
		results: [
			{
				agent: SUBAGENT_SPEC.rootAgent,
				task: SUBAGENT_TASK,
				output: "",
				exitCode: -1,
				model: "fixture/root",
				contextWindow: 16384,
				usage: { ...SUBAGENT_USAGE },
				progress,
			},
		],
	};
}

function nativeFinalDetails(output = SUBAGENT_OUTPUT) {
	const details = nativeRunningDetails();
	const result = details.results[0];
	result.output = output;
	result.exitCode = 0;
	result.progress.status = "completed";
	result.progress.recentTools = result.progress.recentTools.map((tool) => ({
		...tool,
		status: "done" as const,
	}));
	result.progress.lastMessage = "";
	return details;
}

function nativeFailedDetails(output: string) {
	const details = nativeInitialDetails();
	const result = details.results[0];
	result.output = output;
	result.exitCode = 1;
	result.progress.status = "failed";
	result.progress.lastMessage = "";
	(result.progress as typeof result.progress & { error: string }).error =
		SUBAGENT_FAILURE_NARRATIVE;
	return details;
}

function writeFixtureMarker(environmentName: string, value: string): void {
	const markerPath = process.env[environmentName];
	if (!markerPath) throw new Error(`${environmentName} is required`);
	writeFileSync(markerPath, `${value}\n`, "utf8");
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
	if (!nativeTool?.renderCall || !nativeTool?.renderResult)
		throw new Error("Active pi-subagents package did not register its native renderers");
	return nativeTool;
}

export default function piWorkStepUiProvider(pi: ExtensionAPI) {
	const faux = fauxProvider({
		provider: PROVIDER,
		models: [{ id: MODEL, name: "Pi Work-Step UI Faux", reasoning: true }],
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
	pi.registerTool({
		...nativeSubagentTool,
		async execute(_toolCallId: string, params: unknown, signal: AbortSignal, onUpdate: any) {
			try {
				const task = (params as { task?: unknown })?.task;
				writeFixtureMarker("PI_VERIFY_SUBAGENT_SPEC", JSON.stringify(SUBAGENT_SPEC));
				if (task === SUBAGENT_EMPTY_TASK) {
					return {
						content: [{ type: "text", text: "" }],
						details: nativeFinalDetails(""),
					};
				}
				if (task === SUBAGENT_FAILED_EMPTY_TASK) {
					return {
						content: [{ type: "text", text: "" }],
						details: nativeFailedDetails(""),
						isError: true,
					};
				}
				if (task === SUBAGENT_FAILED_DUPLICATE_TASK) {
					const output = `Error: ${SUBAGENT_FAILURE_NARRATIVE}`;
					return {
						content: [{ type: "text", text: output }],
						details: nativeFailedDetails(output),
						isError: true,
					};
				}
				if (task !== SUBAGENT_TASK)
					throw new Error("Deterministic subagent call and result tasks diverged");
				if (!onUpdate) throw new Error("Deterministic subagent update callback is unavailable");
				onUpdate({
					content: [{ type: "text", text: "deterministic subagent initial state" }],
					details: nativeInitialDetails(),
				});
				writeFixtureMarker("PI_VERIFY_SUBAGENT_INITIAL_MARKER", "native initial update emitted");
				await waitForFixtureRelease("PI_VERIFY_SUBAGENT_PROGRESS_RELEASE", signal);
				onUpdate({
					content: [{ type: "text", text: "deterministic subagent running" }],
					details: nativeRunningDetails(),
				});
				writeFixtureMarker("PI_VERIFY_SUBAGENT_UPDATE_MARKER", "native foreground update emitted");
				await waitForFixtureRelease("PI_VERIFY_SUBAGENT_RELEASE", signal);
				return {
					content: [{ type: "text", text: SUBAGENT_OUTPUT }],
					details: nativeFinalDetails(),
				};
			} catch (error) {
				const message = error instanceof Error ? error.stack ?? error.message : String(error);
				try {
					writeFixtureMarker("PI_VERIFY_SUBAGENT_EXCEPTION_MARKER", message);
				} catch {
					// Preserve the original fixture exception when diagnostics cannot be written.
				}
				throw error;
			}
		},
	});

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
