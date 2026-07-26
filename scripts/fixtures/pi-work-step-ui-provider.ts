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
const SUBAGENT_OUTPUT =
	"## NATIVE_COMPLETED_OUTPUT_SENTINEL\n\n**composition preserved** by the package renderer.";

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
];

const SUBAGENT_RUN_ID = "deterministic-subagent-verifier";
const SUBAGENT_USAGE = {
	input: 321,
	output: 123,
	cacheRead: 45,
	cacheWrite: 6,
	cost: 0.0123,
	turns: 2,
};
const SUBAGENT_PROGRESS_SUMMARY = { toolCount: 1, tokens: 444, durationMs: 1200 };

function nativeChildren() {
	return [
		{
			id: "native-nested-child",
			parentRunId: SUBAGENT_RUN_ID,
			parentStepIndex: 0,
			parentAgent: "scout",
			depth: 1,
			path: [{ runId: SUBAGENT_RUN_ID, stepIndex: 0, agent: "scout" }],
			state: "complete" as const,
			agent: "researcher",
		},
	];
}

function nativeRunningDetails() {
	// Mirrors runSync's foreground onUpdate snapshot: the same live progress is
	// present on the result and in details.progress.
	const progress = {
		index: 0,
		agent: "scout",
		status: "running" as const,
		task: SUBAGENT_TASK,
		currentTool: "grep",
		currentToolArgs: "NATIVE_RUNNING_PROGRESS_SENTINEL",
		recentTools: [],
		recentOutput: [],
		toolCount: 1,
		tokens: 0,
		durationMs: 0,
	};
	return {
		mode: "single" as const,
		results: [
			{
				agent: "scout",
				task: SUBAGENT_TASK,
				exitCode: 0,
				messages: [],
				usage: { ...SUBAGENT_USAGE },
				progress,
			},
		],
		progress: [progress],
	};
}

function nativeFinalDetails() {
	// Mirrors compactForegroundDetails for a completed single foreground run:
	// progress is removed while its compact summary and semantic result survive.
	return {
		mode: "single" as const,
		runId: SUBAGENT_RUN_ID,
		results: [
			{
				agent: "scout",
				task: SUBAGENT_TASK,
				exitCode: 0,
				usage: { ...SUBAGENT_USAGE },
				progressSummary: { ...SUBAGENT_PROGRESS_SUMMARY },
				finalOutput: SUBAGENT_OUTPUT,
				outputMode: "inline" as const,
				children: nativeChildren(),
			},
		],
		totalChildUsage: { ...SUBAGENT_USAGE },
		totalCost: {
			inputTokens: SUBAGENT_USAGE.input,
			outputTokens: SUBAGENT_USAGE.output,
			costUsd: SUBAGENT_USAGE.cost,
		},
	};
}

function writeFixtureMarker(environmentName: string, value: string): void {
	const markerPath = process.env[environmentName];
	if (!markerPath) throw new Error(`${environmentName} is required`);
	writeFileSync(markerPath, `${value}\n`, "utf8");
}

function waitForSubagentRelease(signal: AbortSignal | undefined): Promise<void> {
	const releasePath = process.env.PI_VERIFY_SUBAGENT_RELEASE;
	if (!releasePath)
		return Promise.reject(new Error("PI_VERIFY_SUBAGENT_RELEASE is required"));
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
				if ((params as { task?: unknown })?.task !== SUBAGENT_TASK)
					throw new Error("Deterministic subagent call and result tasks diverged");
				if (!onUpdate) throw new Error("Deterministic subagent update callback is unavailable");
				onUpdate({
					content: [{ type: "text", text: "deterministic subagent running" }],
					details: nativeRunningDetails(),
				});
				writeFixtureMarker("PI_VERIFY_SUBAGENT_UPDATE_MARKER", "native foreground update emitted");
				await waitForSubagentRelease(signal);
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
