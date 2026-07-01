import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	getLanguageFromPath,
	highlightCode,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type BuiltInToolName = "bash" | "read" | "write" | "edit" | "grep" | "find" | "ls";

const MAX_COLLAPSED_LINES = 8;
const MAX_EXPANDED_LINES = 40;
const MAX_JSON_CHARS = 2400;

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function lineCount(value: string | undefined): number {
	return value ? value.split("\n").length : 0;
}

function truncateLines(lines: string[], limit: number, moreText: (count: number) => string): string[] {
	if (lines.length <= limit) return lines;
	return [...lines.slice(0, limit), moreText(lines.length - limit)];
}

function highlightedSnippet(
	code: string | undefined,
	language: string | undefined,
	context: { expanded: boolean },
	theme: Theme,
): string {
	if (!code) return theme.fg("dim", "...");
	const limit = context.expanded ? MAX_EXPANDED_LINES : MAX_COLLAPSED_LINES;
	const rendered = language ? highlightCode(code, language) : code.split("\n").map((line) => theme.fg("toolOutput", line));
	return truncateLines(rendered, limit, (count) => theme.fg("muted", `... (${count} more lines)`)).join("\n");
}

function highlightedJson(args: unknown, context: { expanded: boolean }, theme: Theme): string {
	let json = JSON.stringify(args ?? {}, null, 2);
	if (json.length > MAX_JSON_CHARS && !context.expanded) {
		json = `${json.slice(0, MAX_JSON_CHARS)}\n...`;
	}
	return highlightedSnippet(json, "json", context, theme);
}

function renderCall(name: BuiltInToolName, args: unknown, theme: Theme, context: { expanded: boolean }) {
	const input = asObject(args);
	const title = theme.fg("toolTitle", theme.bold(name));

	if (name === "bash") {
		const command = asString(input.command);
		const timeout = typeof input.timeout === "number" ? theme.fg("dim", ` timeout=${input.timeout}s`) : "";
		return new Text(`${theme.fg("toolTitle", theme.bold("$"))}${timeout}\n${highlightedSnippet(command, "bash", context, theme)}`, 0, 0);
	}

	if (name === "read" || name === "ls") {
		const path = asString(input.path) ?? (name === "ls" ? "." : undefined);
		const suffix = [input.offset ? `offset=${input.offset}` : undefined, input.limit ? `limit=${input.limit}` : undefined]
			.filter(Boolean)
			.join(" ");
		return new Text(`${title} ${theme.fg("accent", path ?? "...")}${suffix ? theme.fg("dim", ` ${suffix}`) : ""}`, 0, 0);
	}

	if (name === "grep" || name === "find") {
		const pattern = asString(input.pattern);
		const path = asString(input.path) ?? ".";
		const limit = typeof input.limit === "number" ? theme.fg("dim", ` limit=${input.limit}`) : "";
		return new Text(`${title} ${theme.fg("accent", pattern ?? "...")} ${theme.fg("toolOutput", `in ${path}`)}${limit}`, 0, 0);
	}

	if (name === "write") {
		const path = asString(input.path);
		const content = asString(input.content);
		const lang = path ? getLanguageFromPath(path) : undefined;
		const summary = `${title} ${theme.fg("accent", path ?? "...")} ${theme.fg("dim", `(${lineCount(content)} lines)`)}`;
		return new Text(`${summary}\n${highlightedSnippet(content, lang, context, theme)}`, 0, 0);
	}

	if (name === "edit") {
		const path = asString(input.path);
		const oldString = asString(input.old_string);
		const newString = asString(input.new_string);
		const lang = path ? getLanguageFromPath(path) : undefined;
		const summary = `${title} ${theme.fg("accent", path ?? "...")} ${theme.fg("dim", `(${lineCount(oldString)} -> ${lineCount(newString)} lines)`)}`;
		return new Text(
			[
				summary,
				theme.fg("toolDiffRemoved", "- old"),
				highlightedSnippet(oldString, lang, context, theme),
				theme.fg("toolDiffAdded", "+ new"),
				highlightedSnippet(newString, lang, context, theme),
			].join("\n"),
			0,
			0,
		);
	}

	return new Text(`${title}\n${highlightedJson(args, context, theme)}`, 0, 0);
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
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				return createDefinition(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			},
			renderCall(args, theme, context) {
				return renderCall(name, args, theme, context);
			},
			renderResult: undefined,
		});
	}
}
