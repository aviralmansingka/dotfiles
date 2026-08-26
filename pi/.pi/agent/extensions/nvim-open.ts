import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { resolve, isAbsolute } from "node:path";

const HERDR_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Herdr helpers
// ---------------------------------------------------------------------------
interface PaneInfo {
	pane_id: string;
	tab_id: string;
	cwd: string;
	foreground_cwd?: string;
	workspace_id: string;
}
interface ProcessEntry {
	name: string;
	pid: number;
	argv?: string[];
	cmdline?: string;
}
interface ProcessInfo {
	foreground_processes: ProcessEntry[];
	pane_id: string;
}
/** Run a herdr subcommand and parse its JSON response. Returns null on failure. */
function herdrJson(args: string[]): unknown | null {
	try {
		const out = execFileSync("herdr", args, {
			encoding: "utf-8", timeout: HERDR_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"],
		});
		return JSON.parse(out);
	} catch {
		return null;
	}
}
/** Run a herdr subcommand, discarding output. Returns true on success. */
function herdrOk(args: string[]): boolean {
	try {
		execFileSync("herdr", args, {
			timeout: HERDR_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"],
		});
		return true;
	} catch {
		return false;
	}
}
function getCurrentPane(): PaneInfo | null {
	const res = herdrJson(["pane", "current"]) as
		| { result?: { pane?: PaneInfo } } | null;
	return res?.result?.pane ?? null;
}
function listPanes(): PaneInfo[] | null {
	const res = herdrJson(["pane", "list"]) as
		| { result?: { panes?: PaneInfo[] } } | null;
	return res?.result?.panes ?? null;
}
function getProcessInfo(paneId: string): ProcessInfo | null {
	const res = herdrJson(["pane", "process-info", "--pane", paneId]) as
		| { result?: { process_info?: ProcessInfo } } | null;
	return res?.result?.process_info ?? null;
}
// ---------------------------------------------------------------------------
// editor detection (tri-state: found | absent | error)
// ---------------------------------------------------------------------------
interface EditorPane {
	paneId: string;
	pid: number;
}
type DetectionResult =
	| { status: "found"; editor: EditorPane }
	| { status: "absent" }
	| { status: "error" };
/**
 * Search all panes in the current tab for one whose foreground process is
 * vim/nvim. Returns "error" if any herdr call fails, so the caller does NOT
 * launch a duplicate on a transient failure.
 */
function findEditorPane(currentTabId: string): DetectionResult {
	const panes = listPanes();
	if (panes === null) return { status: "error" };
	const tabPanes = panes.filter((p) => p.tab_id === currentTabId);
	if (tabPanes.length === 0) return { status: "error" };
	let hadError = false;
	for (const pane of tabPanes) {
		const info = getProcessInfo(pane.pane_id);
		if (!info) {
			hadError = true;
			continue;
		}
		for (const proc of info.foreground_processes ?? []) {
			if (
				proc.name === "vim" || proc.argv?.[0] === "vim" ||
				proc.name === "nvim" || proc.argv?.[0] === "nvim"
			) {
				return { status: "found", editor: { paneId: pane.pane_id, pid: proc.pid } };
			}
		}
	}
	return hadError ? { status: "error" } : { status: "absent" };
}
// ---------------------------------------------------------------------------
// editor communication
// ---------------------------------------------------------------------------
/**
 * Escape a file path for use in a Vim `:e` ex command, following
 * fnameescape() semantics. Backslash-escape every character that has
 * special meaning in ex commands.
 */
function fnameEscape(path: string): string {
	return path.replace(/[\\ |%"'#\t\n\r]/g, "\\$&");
}
/** Send `:e <file>` keystrokes to the editor pane via herdr send-text. */
function sendFilesViaText(paneId: string, files: string[]): void {
	for (const file of files) {
		const escaped = fnameEscape(file);
		const text = `\x1b:e ${escaped}\r`;
		try {
			execFileSync("herdr", ["pane", "send-text", paneId, text], {
				timeout: HERDR_TIMEOUT_MS, stdio: "ignore",
			});
		} catch {
			// best-effort
		}
	}
}
// ---------------------------------------------------------------------------
// launch & focus
// ---------------------------------------------------------------------------
/**
 * Split the current pane to the right and launch vim in the new pane.
 * Returns the new pane ID, or null if the split or run failed.
 */
function launchEditor(cwd: string, files: string[]): string | null {
	const splitRes = herdrJson([
		"pane", "split", "--current", "--direction", "right", "--cwd", cwd, "--focus",
	]) as { result?: { pane?: { pane_id?: string } } } | null;
	const newPaneId = splitRes?.result?.pane?.pane_id;
	if (!newPaneId) return null;
	const cmd = files.length > 0 ? ["vim", ...files] : ["vim"];
	if (!herdrOk(["pane", "run", newPaneId, ...cmd])) {
		return null;
	}
	return newPaneId;
}
/**
 * Focus the editor pane by discovering the direction from the current pane
 * to the editor pane using `herdr pane neighbor`. `herdr pane focus` requires
 * --direction, so we cannot focus by pane ID alone.
 */
function focusEditorPane(editorPaneId: string, currentPaneId: string): boolean {
	const directions = ["right", "down", "left", "up"] as const;
	for (const dir of directions) {
		const res = herdrJson(["pane", "neighbor", "--pane", currentPaneId, "--direction", dir]) as
			| { result?: { neighbor?: { pane_id?: string } } } | null;
		const neighborId = res?.result?.neighbor?.pane_id;
		if (neighborId === editorPaneId) {
			return herdrOk(["pane", "focus", "--current", "--direction", dir]);
		}
	}
	// Fallback: try each direction directly
	for (const dir of directions) {
		if (herdrOk(["pane", "focus", "--current", "--direction", dir])) {
			const current = getCurrentPane();
			if (current?.pane_id === editorPaneId) return true;
		}
	}
	return false;
}
// ---------------------------------------------------------------------------
// tmux fallback
// ---------------------------------------------------------------------------
function tmuxFallback(cwd: string, files: string[]): boolean {
	try {
		let shellCmd: string;
		if (files.length > 0) {
			const quotedFiles = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`);
			shellCmd = `vim ${quotedFiles.join(" ")}`;
		} else {
			shellCmd = "vim";
		}
		execFileSync("tmux", ["split-window", "-h", "-c", cwd, shellCmd], {
			timeout: HERDR_TIMEOUT_MS, stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}
// ---------------------------------------------------------------------------
// argument parsing (quote-aware)
// ---------------------------------------------------------------------------
/**
 * Parse a string into arguments, respecting single and double quotes.
 * Handles paths with spaces like: docs/"My Notes.md" or docs/'My Notes.md'
 */
function parseArgs(input: string): string[] {
	const args: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (inSingle) {
			if (ch === "'") {
				inSingle = false;
			} else {
				current += ch;
			}
		} else if (inDouble) {
			if (ch === '"') {
				inDouble = false;
			} else if (ch === "\\" && i + 1 < input.length) {
				current += input[++i];
			} else {
				current += ch;
			}
		} else {
			if (ch === "'" && !inDouble) {
				inSingle = true;
			} else if (ch === '"' && !inSingle) {
				inDouble = true;
			} else if (ch === "\\") {
				if (i + 1 < input.length) {
					current += input[++i];
				}
			} else if (/\s/.test(ch)) {
				if (current) {
					args.push(current);
					current = "";
				}
			} else {
				current += ch;
			}
		}
	}
	if (current) args.push(current);
	return args;
}
// ---------------------------------------------------------------------------
// core orchestration
// ---------------------------------------------------------------------------
function resolveFilePaths(cwd: string, files: string[]): string[] {
	return files.map((f) => (isAbsolute(f) ? f : resolve(cwd, f)));
}
export async function openEditor(
	cwd: string,
	rawArgs: string[],
): Promise<{ message: string; launched: boolean }> {
	const finalFiles = resolveFilePaths(cwd, rawArgs);
	// Try Herdr — getCurrentPane returns null if herdr is unavailable
	const current = getCurrentPane();
	if (current) {
		const detection = findEditorPane(current.tab_id);
		if (detection.status === "found") {
			const editor = detection.editor;
			if (finalFiles.length > 0) {
				sendFilesViaText(editor.paneId, finalFiles);
				focusEditorPane(editor.paneId, current.pane_id);
				return {
					message: `Sent ${finalFiles.length} file(s) to existing editor (pane ${editor.paneId}).`,
					launched: false,
				};
			}
			focusEditorPane(editor.paneId, current.pane_id);
			return {
				message: `Focused existing editor pane (${editor.paneId}).`,
				launched: false,
			};
		}
		// Only launch a new editor if we definitively confirmed no editor exists.
		// On error, fall through to tmux fallback rather than risking a duplicate.
		if (detection.status === "absent") {
			const newPane = launchEditor(cwd, finalFiles);
			if (newPane) {
				const fileNote = finalFiles.length > 0 ? ` with ${finalFiles.length} file(s)` : "";
				return {
					message: `Launched vim in a vertical split (pane ${newPane}) at ${cwd}${fileNote}.`,
					launched: true,
				};
			}
		}
	}
	// Herdr unavailable or failed — try tmux.
	if (tmuxFallback(cwd, finalFiles)) {
		return { message: `Launched vim in a tmux split at ${cwd}.`, launched: true };
	}
	return {
		message: `Could not launch vim automatically. Run manually: cd ${cwd} && vim ${finalFiles.join(" ")}`,
		launched: false,
	};
}
// ---------------------------------------------------------------------------
// extension registration
// ---------------------------------------------------------------------------
const nvimOpenTool = defineTool({
	name: "nvim_open",
	label: "Open Editor",
	description:
		"Open vim as a vertical split in the current Herdr tab, or send files to an existing editor instance in the current tab. If an editor is already running in the current tab, files are sent to the existing instance instead of launching a new one. With no files, opens vim at the agent's cwd.",
	promptSnippet: "Open vim in the current Herdr tab as a vertical split",
	promptGuidelines: [
		"Use nvim_open when the user wants to open an editor (vim) for editing, either at the current working directory or for specific files.",
		"If an editor is already running in the current Herdr tab, this tool sends files to the existing instance rather than launching a duplicate.",
		"With no files provided, it opens vim at the agent's cwd. With file paths, it opens those specific files.",
		"The split is vertical (to the right of the agent pane) and focus moves to the editor pane so the captain can see it.",
	],
	parameters: Type.Object({
		cwd: Type.String({
			description: "The working directory to open vim in. Defaults to the agent's cwd.",
		}),
		files: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional list of file paths to open in vim. Relative paths are resolved against cwd.",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const cwd = params.cwd ?? process.cwd();
		const files = params.files ?? [];
		const result = await openEditor(cwd, files);
		return { content: [{ type: "text", text: result.message }] };
	},
});
export default function (pi: ExtensionAPI) {
	pi.registerTool(nvimOpenTool);
	pi.registerCommand("nvim", {
		description: "Open vim in the current Herdr tab as a vertical split",
		handler: async (args: unknown, ctx: { cwd?: string; ui: { notify: (msg: string, level: string) => void } }) => {
			const cwd = ctx?.cwd ?? process.cwd();
			const fileList: string[] = (() => {
				if (Array.isArray(args)) return args.map(String);
				if (typeof args === "string") return args.trim() ? parseArgs(args.trim()) : [];
				return [];
			})();
			const result = await openEditor(cwd, fileList);
			ctx?.ui?.notify(result.message, "info");
		},
	});
}
