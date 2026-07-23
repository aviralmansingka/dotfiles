import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Container, truncateToWidth } from "@earendil-works/pi-tui";

type BuiltInToolName = "bash" | "read" | "write" | "edit" | "grep" | "find" | "ls";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASSISTANT_PATCHED = Symbol.for("aviral.pi.work-step-renderer");

type WorkStep = {
	title: string;
	toolNames: string[];
	toolCallIds: Set<string>;
	completedToolCallIds: Set<string>;
	finalized: boolean;
	failed: boolean;
};

const workSteps = new WeakMap<object, WorkStep>();
const workStepByToolCallId = new Map<string, WorkStep>();
let summaryTick: ReturnType<typeof setInterval> | undefined;

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function plural(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
	return value
		?.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
}

function titleFromContent(content: any[]): string {
	const textTitle = content
		.filter((item) => item.type === "text")
		.map((item) => firstNonEmptyLine(asString(item.text)))
		.find(Boolean);
	if (textTitle) return textTitle;

	const thinking = content
		.filter((item) => item.type === "thinking")
		.map((item) => firstNonEmptyLine(asString(item.thinking)))
		.find(Boolean);
	return thinking?.match(/\*\*([^*]+)\*\*/)?.[1] ?? thinking ?? "Working";
}

function statusIcon(theme: Theme, context: { isPartial?: boolean; isError?: boolean }): string {
	if (context.isPartial) {
		const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length] ?? "⠋";
		return theme.fg("accent", frame);
	}
	return context.isError ? theme.fg("warning", "!") : theme.fg("muted", "✓");
}

function summarizeTools(toolNames: string[]): string {
	const counts = new Map<string, number>();
	for (const name of toolNames) counts.set(name, (counts.get(name) ?? 0) + 1);
	return [plural(toolNames.length, "call"), ...counts.entries().map(([name, count]) => `${name} ×${count}`)].join(" · ");
}

function createDefinition(name: BuiltInToolName, cwd: string): ToolDefinition {
	if (name === "bash") return createBashToolDefinition(cwd) as ToolDefinition;
	if (name === "read") return createReadToolDefinition(cwd) as ToolDefinition;
	if (name === "write") return createWriteToolDefinition(cwd) as ToolDefinition;
	if (name === "edit") return createEditToolDefinition(cwd) as ToolDefinition;
	if (name === "grep") return createGrepToolDefinition(cwd) as ToolDefinition;
	if (name === "find") return createFindToolDefinition(cwd) as ToolDefinition;
	return createLsToolDefinition(cwd) as ToolDefinition;
}

function compactTool(tool: ToolDefinition): ToolDefinition {
	return {
		...tool,
		renderShell: "self",
		renderCall() {
			return new Container();
		},
		renderResult() {
			return new Container();
		},
	};
}

async function loadAssistantMessageComponent(): Promise<any> {
	const cliPath = realpathSync(process.argv[1] ?? "");
	const componentPath = join(dirname(cliPath), "modes/interactive/components/assistant-message.js");
	return (await import(pathToFileURL(componentPath).href)).AssistantMessageComponent;
}

function patchWorkStepRenderer(AssistantMessageComponent: any): void {
	const proto = AssistantMessageComponent.prototype as {
		[ASSISTANT_PATCHED]?: boolean;
		updateContent: (message: any) => void;
		render: (width: number) => string[];
	};
	if (proto[ASSISTANT_PATCHED]) return;
	proto[ASSISTANT_PATCHED] = true;

	const updateContent = proto.updateContent;
	proto.updateContent = function (message: any) {
		updateContent.call(this, message);

		const content = Array.isArray(message.content) ? message.content : [];
		const toolCalls = content.filter((item: any) => item.type === "toolCall");
		if (toolCalls.length === 0) return;

		const step =
			workSteps.get(this) ??
			({
				title: "Working",
				toolNames: [],
				toolCallIds: new Set<string>(),
				completedToolCallIds: new Set<string>(),
				finalized: false,
				failed: false,
			} satisfies WorkStep);

		step.title = titleFromContent(content);
		step.toolNames = toolCalls.map((toolCall: any) => asString(toolCall.name) ?? "tool");
		step.toolCallIds = new Set(toolCalls.map((toolCall: any) => asString(toolCall.id)).filter(Boolean));
		step.finalized = Boolean(message.stopReason);
		step.failed ||= message.stopReason === "error" || message.stopReason === "aborted";

		workSteps.set(this, step);
		for (const toolCallId of step.toolCallIds) workStepByToolCallId.set(toolCallId, step);
	};

	const render = proto.render;
	proto.render = function (width: number) {
		const lines = render.call(this, width);
		const step = workSteps.get(this);
		if (!step) return lines;

		const pending = !step.finalized || step.completedToolCallIds.size < step.toolCallIds.size;
		const icon = statusIcon(themeShim, { isPartial: pending && !step.failed, isError: step.failed });
		return [
			truncateToWidth(`${icon} ${step.title}`, width),
			truncateToWidth(`  ${summarizeTools(step.toolNames)}`, width),
		];
	};
}

const themeShim: Theme = {
	fg(_name: string, text: string) {
		return text;
	},
	bg(_name: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
	italic(text: string) {
		return text;
	},
	strikethrough(text: string) {
		return text;
	},
} as Theme;

function startSummaryTick(ctx: { ui?: { setHiddenThinkingLabel?: (label?: string) => void } }): void {
	if (summaryTick) return;
	summaryTick = setInterval(() => ctx.ui?.setHiddenThinkingLabel?.(), 80);
	summaryTick.unref?.();
}

function stopSummaryTick(): void {
	if (!summaryTick) return;
	clearInterval(summaryTick);
	summaryTick = undefined;
}

export default async function (pi: ExtensionAPI) {
	patchWorkStepRenderer(await loadAssistantMessageComponent());

	const registerTool = pi.registerTool.bind(pi);
	pi.registerTool = ((tool: ToolDefinition) => registerTool(compactTool(tool))) as typeof pi.registerTool;

	pi.on("tool_execution_start", (_event, ctx) => {
		startSummaryTick(ctx);
	});

	pi.on("tool_execution_end", (event) => {
		const step = workStepByToolCallId.get(event.toolCallId);
		if (step) {
			step.completedToolCallIds.add(event.toolCallId);
			step.failed ||= event.isError;
			workStepByToolCallId.delete(event.toolCallId);
		}
		if (workStepByToolCallId.size === 0) stopSummaryTick();
	});

	pi.on("agent_end", () => {
		stopSummaryTick();
	});

	pi.on("session_shutdown", () => {
		stopSummaryTick();
	});

	const cwd = process.cwd();
	const definitions: Array<[BuiltInToolName, ToolDefinition]> = [
		["bash", createDefinition("bash", cwd)],
		["read", createDefinition("read", cwd)],
		["write", createDefinition("write", cwd)],
		["edit", createDefinition("edit", cwd)],
		["grep", createDefinition("grep", cwd)],
		["find", createDefinition("find", cwd)],
		["ls", createDefinition("ls", cwd)],
	];

	for (const [name, original] of definitions) {
		pi.registerTool({
			...original,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				return createDefinition(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			},
		});
	}
}
