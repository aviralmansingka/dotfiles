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
import { Container, Text } from "@earendil-works/pi-tui";

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

function renderCall(
	name: BuiltInToolName,
	args: unknown,
	theme: Theme,
	context: { isPartial?: boolean; isError?: boolean },
) {
	const input = asObject(args);
	const title = theme.fg("toolTitle", theme.bold(name));
	let summary: string;

	if (name === "bash") {
		summary = `${theme.fg("toolTitle", theme.bold("$"))} ${firstLine(asString(input.command))}`;
	} else if (name === "read" || name === "ls") {
		const path = asString(input.path) ?? (name === "ls" ? "." : "...");
		summary = `${title} ${theme.fg("accent", path)}`;
	} else if (name === "grep" || name === "find") {
		const pattern = asString(input.pattern) ?? "...";
		const path = asString(input.path) ?? ".";
		summary = `${title} ${theme.fg("accent", pattern)} ${theme.fg("dim", `in ${path}`)}`;
	} else if (name === "write") {
		const path = asString(input.path) ?? "...";
		summary = `${title} ${theme.fg("accent", path)} ${theme.fg("dim", `(${plural(lineCount(asString(input.content)), "line")})`)}`;
	} else if (name === "edit") {
		const path = asString(input.path) ?? "...";
		const edits = Array.isArray(input.edits) ? input.edits.length : 0;
		summary = `${title} ${theme.fg("accent", path)} ${theme.fg("dim", `(${plural(edits, "edit")})`)}`;
	} else {
		summary = title;
	}

	return new Text(`${statusIcon(theme, context)} ${summary}`, 0, 0);
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

export default function (pi: ExtensionAPI) {
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
			renderShell: "self",
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				return createDefinition(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			},
			renderCall(args, theme, context) {
				return renderCall(name, args, theme, context);
			},
			renderResult() {
				return new Container();
			},
		});
	}
}
