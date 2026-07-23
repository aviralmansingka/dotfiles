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
import { Container, truncateToWidth, type Component } from "@earendil-works/pi-tui";

type BuiltInToolName = "bash" | "read" | "write" | "edit" | "grep" | "find" | "ls";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function lineCount(value: string | undefined): number {
	return value ? value.split("\n").length : 0;
}

function plural(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function firstLine(value: string | undefined): string {
	if (!value) return "...";
	const lines = value.trim().split("\n");
	return `${lines[0] ?? "..."}${lines.length > 1 ? " …" : ""}`;
}

function statusIcon(theme: Theme, context: { isPartial?: boolean; isError?: boolean }): string {
	if (context.isPartial) {
		const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length] ?? "⠋";
		return theme.fg("accent", frame);
	}
	return context.isError ? theme.fg("warning", "!") : theme.fg("muted", "✓");
}

class ToolSummary implements Component {
	private theme: Theme;
	private summary: string;
	private context: { isPartial?: boolean; isError?: boolean; invalidate?: () => void };
	private interval?: ReturnType<typeof setInterval>;

	constructor(theme: Theme, summary: string, context: { isPartial?: boolean; isError?: boolean; invalidate?: () => void }) {
		this.theme = theme;
		this.summary = summary;
		this.context = context;
		this.update(theme, summary, context);
	}

	update(theme: Theme, summary: string, context: { isPartial?: boolean; isError?: boolean; invalidate?: () => void }): void {
		this.theme = theme;
		this.summary = summary;
		this.context = context;

		if (context.isPartial && !this.interval) {
			this.interval = setInterval(() => context.invalidate?.(), 80);
			this.interval.unref?.();
		} else if (!context.isPartial && this.interval) {
			clearInterval(this.interval);
			this.interval = undefined;
		}
	}

	render(width: number): string[] {
		return [truncateToWidth(`${statusIcon(this.theme, this.context)} ${this.summary}`, width)];
	}

	invalidate(): void {}
}

function summaryForTool(name: string, args: unknown, theme: Theme): string {
	const input = asObject(args);
	const title = theme.fg("toolTitle", theme.bold(name));

	if (name === "bash") return `${theme.fg("toolTitle", theme.bold("$"))} ${firstLine(asString(input.command))}`;
	if (name === "read" || name === "ls") {
		const path = asString(input.path) ?? (name === "ls" ? "." : "...");
		return `${title} ${theme.fg("accent", path)}`;
	}
	if (name === "grep" || name === "find") {
		const pattern = asString(input.pattern) ?? "...";
		const path = asString(input.path) ?? ".";
		return `${title} ${theme.fg("accent", pattern)} ${theme.fg("dim", `in ${path}`)}`;
	}
	if (name === "write") {
		const path = asString(input.path) ?? "...";
		return `${title} ${theme.fg("accent", path)} ${theme.fg("dim", `(${plural(lineCount(asString(input.content)), "line")})`)}`;
	}
	if (name === "edit") {
		const path = asString(input.path) ?? "...";
		const edits = Array.isArray(input.edits) ? input.edits.length : 0;
		return `${title} ${theme.fg("accent", path)} ${theme.fg("dim", `(${plural(edits, "edit")})`)}`;
	}
	if (name === "mcp" && typeof input.tool === "string") return `${title} ${theme.fg("accent", input.tool)}`;

	return title;
}

function renderCall(name: string, args: unknown, theme: Theme, context: { isPartial?: boolean; isError?: boolean; invalidate?: () => void; lastComponent?: Component }) {
	const summary = summaryForTool(name, args, theme);
	const component = context.lastComponent instanceof ToolSummary ? context.lastComponent : new ToolSummary(theme, summary, context);
	component.update(theme, summary, context);
	return component;
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
		renderCall(args, theme, context) {
			return renderCall(tool.name, args, theme, context);
		},
		renderResult() {
			return new Container();
		},
	};
}

export default function (pi: ExtensionAPI) {
	const registerTool = pi.registerTool.bind(pi);
	pi.registerTool = ((tool: ToolDefinition) => registerTool(compactTool(tool))) as typeof pi.registerTool;

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
