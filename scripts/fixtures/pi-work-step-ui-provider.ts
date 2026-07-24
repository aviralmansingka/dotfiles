import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const PROVIDER = "pi-work-step-ui-verify";
const MODEL = "faux-work-step";
const STATE = Symbol.for("aviral.pi.work-step-verifier-state");

type VerifyState = { responseIndex: number };

const state =
	((globalThis as typeof globalThis & { [STATE]?: VerifyState })[STATE] ??= {
		responseIndex: 0,
	});

const responses = [
	fauxAssistantMessage("NON_TOOL_RENDERING_SENTINEL"),
	fauxAssistantMessage(
		[
			fauxThinking("Inspect configuration → Decision: validate grouped tool rendering"),
			fauxText("IGNORE_THIS_TEXT_TITLE"),
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
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-same-followup" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_SAME_NAME_DONE"),
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
			fauxThinking("Restore **missing** result"),
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
			fauxToolCall(
				"noisy_verify_tool",
				{ value: "NOISY_ARGUMENT_SENTINEL", fail: false },
				{ id: "verify-after-reload" },
			),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("VERIFY_AFTER_RELOAD_DONE"),
];

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
	pi.registerProvider(faux.provider);

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
