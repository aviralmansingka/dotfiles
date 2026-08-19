import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, isAbsolute, relative } from "node:path";

const HERDR_TIMEOUT_MS = 5000;
const LLM_TIMEOUT_MS = 20000;
const MAX_FILE_LIST = 200;

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
	// Return null on failure (not []) so callers can distinguish error from empty
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
	// Only report "absent" if every pane was successfully scanned
	return hadError ? { status: "error" } : { status: "absent" };
}

// ---------------------------------------------------------------------------
// editor communication
// ---------------------------------------------------------------------------

/**
 * Escape a file path for use in a Vim `:e` ex command, following
 * fnameescape() semantics. Backslash-escape every character that has
 * special meaning in ex commands: backslash itself, space, pipe, percent,
 * hash, double-quote, single-quote, tab, and newline.
 */
function fnameEscape(path: string): string {
	// Characters that need backslash-escaping in ex commands
	return path.replace(/[\\ |%"'#\t\n\r]/g, "\\$&");
}

/** Send `:e <file>` keystrokes to the editor pane via herdr send-text. */
function sendFilesViaText(paneId: string, files: string[]): void {
	for (const file of files) {
		const escaped = fnameEscape(file);
		// Escape to exit insert mode, then :e with the escaped path, then Enter.
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
	// Check the run result — don't claim success if vim failed to start
	if (!herdrOk(["pane", "run", newPaneId, ...cmd])) {
		return null;
	}
	return newPaneId;
}

/**
 * Focus the editor pane by discovering the direction from the current pane
 * to the editor pane using `herdr pane neighbor`. Falls back to trying all
 * four directions. `herdr pane focus` requires --direction, so we cannot
 * focus by pane ID alone.
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
			// Check if we landed on the editor pane
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
		// tmux split-window accepts ONE optional shell-command as the last arg.
		// Construct a single safely-quoted shell command string.
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
// file listing for LLM resolution
// ---------------------------------------------------------------------------

/**
 * Recursively list files under cwd (limited depth/count), returning relative
 * paths. Skips known large/build dirs but allows hidden project config dirs
 * like .pi, .agents, .claude so source files in them are discoverable.
 */
function listFilesForLlm(cwd: string): string[] {
	const results: string[] = [];
	// Only skip these known-large or irrelevant directories
	const skipDirs = new Set([
		".git", "node_modules", ".venv", "__pycache__",
		"target", "dist", "build", ".cache", ".treehouse",
	]);

	function walk(dir: string, depth: number) {
		if (depth > 4 || results.length >= MAX_FILE_LIST) return;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= MAX_FILE_LIST) return;
			const full = join(dir, entry);
			try {
				const st = statSync(full);
				if (st.isDirectory()) {
					// Skip only known large dirs — allow hidden config dirs
					if (!skipDirs.has(entry)) {
						walk(full, depth + 1);
					}
				} else {
					results.push(relative(cwd, full));
				}
			} catch {
				// skip
			}
		}
	}

	walk(cwd, 0);
	return results.sort();
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
				// Escaped char inside double quotes
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
// LLM-based file resolution
// ---------------------------------------------------------------------------

interface LlmResolution {
	files: string[];
	confident: boolean;
	candidates: string[];
}

/** Extract the assistant text from pi --mode json -p output (NDJSON lines). */
function extractAssistantText(jsonOutput: string): string {
	let lastText = "";
	for (const line of jsonOutput.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const obj = JSON.parse(trimmed);
			if (obj.type === "turn_end" && obj.message?.role === "assistant") {
				const content = obj.message.content;
				if (Array.isArray(content)) {
					lastText = content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("");
				} else if (typeof content === "string") {
					lastText = content;
				}
			}
		} catch {
			// not JSON, skip
		}
	}
	return lastText;
}

function resolvePiBinary(): { command: string; baseArgs: string[] } {
	const entry = process.argv[1];
	if (entry) {
		try {
			const realEntry = realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realEntry)) {
				return { command: process.execPath, baseArgs: [realEntry] };
			}
		} catch {}
	}
	return { command: "pi", baseArgs: [] };
}

/**
 * Resolve a natural-language file query using a small LLM call via pi print mode.
 * Uses newline-separated paths in the response to preserve spaces in file paths.
 */
function resolveFilesWithLlm(cwd: string, query: string): Promise<LlmResolution> {
	const fileList = listFilesForLlm(cwd);
	const fileSet = new Set(fileList);

	const systemPrompt = `You resolve natural-language file references to actual file paths.
Given a list of files in the working directory and a user's request, determine which file(s) to open.

Respond in ONE of these formats:
1. If you are confident, reply with EXACTLY this structure (paths on separate lines):
CONFIDENT:
<file1>
<file2>
2. If you are uncertain, reply with EXACTLY: UNCERTAIN: <option1> | <option2> | <option3>
   List 2-5 candidate files separated by " | ".

Rules:
- File paths must be relative paths from the working directory, matching the file list exactly.
- If the user's request doesn't match any file, reply with: UNCERTAIN: (no matches)
- Reply with only the format, no explanation.`;

	const userPrompt = `Working directory: ${cwd}

Available files (relative paths):
${fileList.length > 0 ? fileList.join("\n") : "(no files found)"}

User request: "${query}"

Which file(s) should be opened?`;

	return new Promise<LlmResolution>((resolve) => {
		const piBin = resolvePiBinary();
		const args = [
			...piBin.baseArgs,
			"--mode", "json", "-p",
			"--no-skills", "--no-extensions", "--no-context-files",
			"--no-prompt-templates", "--no-themes",
			"--system-prompt", systemPrompt,
			userPrompt,
		];

		// Strip Herdr env vars so the child pi process doesn't report to Herdr
		const childEnv: Record<string, string> = {};
		for (const [key, val] of Object.entries(process.env)) {
			if (val !== undefined && !key.startsWith("HERDR_")) {
				childEnv[key] = val;
			}
		}

		let stdout = "";
		let stderr = "";
		const child = spawn(piBin.command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: LLM_TIMEOUT_MS,
			env: childEnv,
		});

		child.stdin.end();

		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
		child.on("error", () =>
			resolve({ files: [], confident: false, candidates: [] }),
		);
		child.on("close", () => {
			const text = extractAssistantText(stdout).trim();

			if (text.startsWith("CONFIDENT:")) {
				// Paths are newline-separated after the CONFIDENT: line
				const paths = text
					.slice("CONFIDENT:".length)
					.trim()
					.split("\n")
					.map((s) => s.trim())
					.filter(Boolean)
					.filter((p) => fileSet.has(p));
				resolve({ files: paths, confident: true, candidates: [] });
			} else if (text.startsWith("UNCERTAIN:")) {
				const rest = text.slice("UNCERTAIN:".length).trim();
				if (rest === "(no matches)") {
					resolve({ files: [], confident: false, candidates: [] });
				} else {
					const candidates = rest
						.split("|")
						.map((s) => s.trim())
						.filter(Boolean)
						.filter((c) => fileSet.has(c));
					resolve({ files: [], confident: false, candidates });
				}
			} else {
				resolve({ files: [], confident: false, candidates: [] });
			}
		});
	});
}

// ---------------------------------------------------------------------------
// multiple-choice selection via terminal
// ---------------------------------------------------------------------------

interface UIContext {
	notify: (msg: string, level: string) => void;
	onTerminalInput: (cb: (data: string) => { consume?: boolean } | undefined) => () => void;
}

/** Present a numbered multiple-choice menu and wait for the user's selection. */
function presentChoice(
	ui: UIContext,
	prompt: string,
	candidates: string[],
): Promise<string | null> {
	return new Promise((resolve) => {
		const lines = [
			prompt,
			"",
			...candidates.map((c, i) => `  ${i + 1}. ${c}`),
			"",
			"Enter a number (or press Enter to cancel):",
		];
		ui.notify(lines.join("\n"), "info");

		const stop = ui.onTerminalInput((data: string) => {
			const trimmed = data.trim();
			if (!trimmed) {
				stop?.();
				resolve(null);
				return;
			}
			const num = parseInt(trimmed, 10);
			if (Number.isFinite(num) && num >= 1 && num <= candidates.length) {
				stop?.();
				resolve(candidates[num - 1]);
				return { consume: true };
			}
			ui.notify(`Invalid choice "${trimmed}". Enter 1-${candidates.length} or press Enter to cancel.`, "warn");
			return { consume: true };
		});

		const timer = setTimeout(() => {
			stop?.();
			resolve(null);
		}, 30000);
		timer.unref?.();
	});
}

// ---------------------------------------------------------------------------
// core orchestration
// ---------------------------------------------------------------------------

function resolveFilePaths(cwd: string, files: string[]): string[] {
	return files.map((f) => (isAbsolute(f) ? f : resolve(cwd, f)));
}

/** Check if a string is a direct file path that exists on disk. */
function isDirectFilePath(cwd: string, arg: string): boolean {
	const full = isAbsolute(arg) ? arg : resolve(cwd, arg);
	return existsSync(full);
}

async function openEditor(
	cwd: string,
	rawArgs: string[],
	ctx?: { ui?: UIContext },
): Promise<{ message: string; launched: boolean }> {
	// Classify args: direct file paths vs natural-language queries
	const directFiles: string[] = [];
	const naturalLanguage: string[] = [];

	for (const arg of rawArgs) {
		if (isDirectFilePath(cwd, arg)) {
			directFiles.push(arg);
		} else {
			naturalLanguage.push(arg);
		}
	}

	// Resolve natural-language args via LLM
	let resolvedFiles = [...directFiles];

	if (naturalLanguage.length > 0) {
		const query = naturalLanguage.join(" ");
		ctx?.ui?.notify(`Resolving "${query}" ...`, "info");
		const resolution = await resolveFilesWithLlm(cwd, query);

		if (resolution.confident && resolution.files.length > 0) {
			resolvedFiles.push(...resolution.files);
		} else if (!resolution.confident && resolution.candidates.length > 0 && ctx?.ui) {
			const choice = await presentChoice(
				ctx.ui,
				`Which file did you mean by "${query}"?`,
				resolution.candidates,
			);
			if (choice) {
				resolvedFiles.push(choice);
			} else {
				return { message: "Cancelled — no file selected.", launched: false };
			}
		} else if (!resolution.confident && ctx?.ui) {
			ctx.ui.notify(
				`Could not resolve "${query}" to any file. Launching vim with no file.`,
				"warn",
			);
		}
	}

	const finalFiles = resolveFilePaths(cwd, resolvedFiles);

	// Try Herdr — getCurrentPane returns null if herdr is unavailable
	const current = getCurrentPane();
	if (current) {
		const detection = findEditorPane(current.tab_id);

		if (detection.status === "found") {
			const editor = detection.editor;
			if (finalFiles.length > 0) {
				// Send files to the existing editor via herdr pane send-text.
				// This always targets the correct pane — no socket correlation needed.
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

		if (detection.status === "error") {
			ctx?.ui?.notify(
				"Could not scan panes for existing editor — falling back to tmux.",
				"warn",
			);
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
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const cwd = params.cwd ?? process.cwd();
		const files = params.files ?? [];
		const result = await openEditor(cwd, files, ctx as { ui?: UIContext });
		return { content: [{ type: "text", text: result.message }] };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(nvimOpenTool);

	pi.registerCommand("nvim", {
		description: "Open vim in the current Herdr tab as a vertical split",
		handler: async (args: unknown, ctx: { cwd?: string; ui: UIContext }) => {
			const cwd = ctx?.cwd ?? process.cwd();
			// Parse args with quote-aware splitting for paths with spaces
			const fileList: string[] = (() => {
				if (Array.isArray(args)) return args.map(String);
				if (typeof args === "string") return args.trim() ? parseArgs(args.trim()) : [];
				return [];
			})();
			const result = await openEditor(cwd, fileList, ctx);
			ctx?.ui?.notify(result.message, "info");
		},
	});
}
