import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { openHunkWithHost, parseHunkArgs } from "./hunk-open-core.mjs";

const COMMAND_TIMEOUT_MS = 5000;

interface PaneInfo {
	pane_id: string;
	tab_id: string;
	cwd: string;
	foreground_cwd?: string;
}

interface ProcessEntry {
	name?: string;
	argv?: string[];
}

interface ProcessInfo {
	foreground_processes?: ProcessEntry[];
}

type DetectionResult =
	| { status: "found"; paneId: string }
	| { status: "absent" }
	| { status: "error" };

function commandJson(command: string, args: string[]): unknown | null {
	try {
		return JSON.parse(
			execFileSync(command, args, {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: COMMAND_TIMEOUT_MS,
			}),
		);
	} catch {
		return null;
	}
}

function commandOk(command: string, args: string[]): boolean {
	try {
		execFileSync(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: COMMAND_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

function currentPane(): PaneInfo | null {
	const response = commandJson("herdr", ["pane", "current"]) as
		| { result?: { pane?: PaneInfo } }
		| null;
	return response?.result?.pane ?? null;
}

function repositoryRoot(cwd: string): string {
	try {
		return resolve(
			execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: COMMAND_TIMEOUT_MS,
			}).trim(),
		);
	} catch {
		return resolve(cwd);
	}
}

function findHunkPane(tabId: string, cwd: string): DetectionResult {
	const response = commandJson("herdr", ["pane", "list"]) as
		| { result?: { panes?: PaneInfo[] } }
		| null;
	const panes = response?.result?.panes;
	if (!panes) return { status: "error" };

	const targetRoot = repositoryRoot(cwd);
	let hadError = false;
	for (const pane of panes.filter((candidate) => candidate.tab_id === tabId)) {
		if (repositoryRoot(pane.foreground_cwd ?? pane.cwd) !== targetRoot) continue;
		const processResponse = commandJson("herdr", ["pane", "process-info", "--pane", pane.pane_id]) as
			| { result?: { process_info?: ProcessInfo } }
			| null;
		const processes = processResponse?.result?.process_info?.foreground_processes;
		if (!processes) {
			hadError = true;
			continue;
		}
		if (processes.some((process) => process.name === "hunk" || basename(process.argv?.[0] ?? "") === "hunk")) {
			return { status: "found", paneId: pane.pane_id };
		}
	}
	return hadError ? { status: "error" } : { status: "absent" };
}

function focusPane(targetPaneId: string, currentPaneId: string): boolean {
	for (const direction of ["right", "down", "left", "up"] as const) {
		const response = commandJson("herdr", [
			"pane",
			"neighbor",
			"--pane",
			currentPaneId,
			"--direction",
			direction,
		]) as { result?: { neighbor?: { pane_id?: string } } } | null;
		if (response?.result?.neighbor?.pane_id === targetPaneId) {
			return commandOk("herdr", ["pane", "focus", "--current", "--direction", direction]);
		}
	}
	return false;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function tmuxOpen(cwd: string, args: string[]): boolean {
	const command = ["hunk", ...args].map(shellQuote).join(" ");
	return commandOk("tmux", ["split-window", "-h", "-c", cwd, command]);
}

function launchPane(cwd: string, args: string[]): string | null {
	const split = commandJson("herdr", [
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		cwd,
		"--focus",
	]) as { result?: { pane?: { pane_id?: string } } } | null;
	const paneId = split?.result?.pane?.pane_id;
	if (paneId && commandOk("herdr", ["pane", "run", paneId, "hunk", ...args])) {
		commandOk("herdr", ["pane", "rename", paneId, "hunk"]);
		return paneId;
	}
	if (paneId) commandOk("herdr", ["pane", "close", paneId]);
	return null;
}

export async function openHunk(
	cwd: string,
	requestedArgs: string[] = [],
): Promise<{ message: string; launched: boolean }> {
	return openHunkWithHost(cwd, requestedArgs, {
		currentPane,
		findHunkPane,
		focusPane,
		launchPane,
		tmuxOpen,
		manualCommand: (directory: string, args: string[]) =>
			`Could not open Hunk automatically. Run: cd ${shellQuote(directory)} && ${["hunk", ...args].map(shellQuote).join(" ")}`,
	});
}

const hunkOpenTool = defineTool({
	name: "hunk_open",
	label: "Open Hunk",
	description:
		"Open Hunk in a sibling Herdr pane, or focus an existing Hunk pane in the current tab. This only opens the review canvas; it never starts a reviewer or modifies code.",
	promptSnippet: "Open or focus Hunk without starting a code review agent",
	promptGuidelines: [
		"Use hunk_open when the user wants a visual diff canvas or when a teaching exercise benefits from inspecting their changes in Hunk.",
		"hunk_open only opens or focuses Hunk; it never launches a reviewer, applies code, or replaces quiz, explain, or run-command.",
	],
	parameters: Type.Object({
		cwd: Type.Optional(Type.String({ description: "Repository directory. Defaults to the current working directory." })),
		args: Type.Optional(
			Type.Array(Type.String(), {
				description: 'Arguments after `hunk`; defaults to ["diff", "--watch"].',
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const result = await openHunk(params.cwd ?? ctx.cwd, params.args ?? []);
		return { content: [{ type: "text" as const, text: result.message }], details: result };
	},
});

export default function hunkOpen(pi: ExtensionAPI) {
	pi.registerTool(hunkOpenTool);
	pi.registerCommand("hunk", {
		description: "Open or focus Hunk; defaults to a watched working-tree diff",
		handler: async (args, ctx) => {
			const result = await openHunk(ctx.cwd, parseHunkArgs(typeof args === "string" ? args : ""));
			ctx.ui.notify(result.message, result.message.startsWith("Could not") ? "warning" : "info");
		},
	});
}
