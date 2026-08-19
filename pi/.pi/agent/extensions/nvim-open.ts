import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, isAbsolute, relative } from "node:path";

const HERDR_TIMEOUT_MS = 5000;
const NVIM_TIMEOUT_MS = 4000;
const LLM_TIMEOUT_MS = 20000;
const MAX_FILE_LIST = 200;

// ---------------------------------------------------------------------------
// binary discovery
// ---------------------------------------------------------------------------

/** Find the nvim binary, checking PATH and common bob install locations. */
function findNvimBinary(): string | null {
	// 1. On PATH directly
	try {
		const path = execFileSync("which", ["nvim"], { encoding: "utf-8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim();
		if (path) return path;
	} catch {}

	// 2. bob-managed nightly (most common on this homelab)
	const bobCandidates = [
		`${process.env.HOME}/.local/share/bob/nightly/bin/nvim`,
		`${process.env.HOME}/.local/share/bob/stable/bin/nvim`,
	];
	for (const c of bobCandidates) {
		if (existsSync(c)) return c;
	}

	// 3. Fallback to "nvim" and hope the shell resolves it
	return "nvim";
}

let _nvimBin: string | null | undefined;
function nvimBin(): string {
	if (_nvimBin === undefined) _nvimBin = findNvimBinary();
	return _nvimBin ?? "nvim";
}

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
			encoding: "utf-8",
			timeout: HERDR_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
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
			timeout: HERDR_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return true;
	} catch {
		return false;
	}
}

function getCurrentPane(): PaneInfo | null {
	const res = herdrJson(["pane", "current"]) as
		| { result?: { pane?: PaneInfo } }
		| null;
	return res?.result?.pane ?? null;
}

function listPanes(): PaneInfo[] {
	const res = herdrJson(["pane", "list"]) as
		| { result?: { panes?: PaneInfo[] } }
		| null;
	return res?.result?.panes ?? [];
}

function getProcessInfo(paneId: string): ProcessInfo | null {
	const res = herdrJson(["pane", "process-info", "--pane", paneId]) as
		| { result?: { process_info?: ProcessInfo } }
		| null;
	return res?.result?.process_info ?? null;
}

// ---------------------------------------------------------------------------
// editor detection & communication
// ---------------------------------------------------------------------------

interface EditorPane {
	paneId: string;
	pid: number;
}

/** Search all panes in the current tab for one whose foreground process is vim/nvim. */
function findEditorPane(currentTabId: string): EditorPane | null {
	const panes = listPanes().filter((p) => p.tab_id === currentTabId);
	for (const pane of panes) {
		const info = getProcessInfo(pane.pane_id);
		if (!info) continue;
		for (const proc of info.foreground_processes ?? []) {
			if (
				proc.name === "vim" || proc.argv?.[0] === "vim" ||
				proc.name === "nvim" || proc.argv?.[0] === "nvim"
			) {
				return { paneId: pane.pane_id, pid: proc.pid };
			}
		}
	}
	return null;
}

/**
 * Discover a live nvim RPC socket. Nvim puts sockets in $XDG_RUNTIME_DIR
 * (typically /run/user/<uid> on Linux) or $TMPDIR/nvim.<user>/ on macOS.
 * The socket filename uses nvim's own PID, which may differ slightly from the
 * process PID reported by the OS, so we glob all sockets and test for liveness.
 */
function findNvimSocket(): string | null {
	const bin = nvimBin();
	const searchDirs: string[] = [];

	// Linux: $XDG_RUNTIME_DIR
	if (process.env.XDG_RUNTIME_DIR) {
		searchDirs.push(process.env.XDG_RUNTIME_DIR);
	}
	// macOS / fallback: $TMPDIR/nvim.<user>/
	const user = process.env.USER ?? "unknown";
	const tmp = process.env.TMPDIR ?? "/tmp";
	searchDirs.push(join(tmp, `nvim.${user}`));

	for (const dir of searchDirs) {
		if (!existsSync(dir)) continue;
		try {
			const entries = readdirSync(dir);
			// Collect nvim socket files (nvim.<pid>.0)
			const sockets = entries
				.filter((e) => /^nvim\.\d+\.0$/.test(e))
				.map((e) => join(dir, e));
			// Test each for liveness — return the first live one
			for (const sock of sockets) {
				try {
					execFileSync(bin, ["--server", sock, "--remote-expr", "1"], {
						timeout: 1000,
						stdio: "ignore",
					});
					return sock;
				} catch {
					// stale socket, skip
				}
			}
		} catch {
			// ignore
		}
	}
	return null;
}

/** Open files in an existing nvim instance via its RPC socket. Returns true on success. */
function sendFilesViaRpc(socket: string, files: string[]): boolean {
	const bin = nvimBin();
	try {
		for (const file of files) {
			execFileSync(bin, ["--server", socket, "--remote", file], {
				timeout: NVIM_TIMEOUT_MS,
				stdio: "ignore",
			});
		}
		return true;
	} catch {
		return false;
	}
}

/** Fallback: send `:e <file>` keystrokes to the editor pane via herdr send-text. */
function sendFilesViaText(paneId: string, files: string[]): void {
	for (const file of files) {
		// Escape spaces in the path for the ex command
		const escaped = file.replace(/ /g, "\\ ");
		// Escape to exit insert mode, then :e with the path, then Enter.
		const text = `\x1b:e ${escaped}\r`;
		try {
			execFileSync("herdr", ["pane", "send-text", paneId, text], {
				timeout: HERDR_TIMEOUT_MS,
				stdio: "ignore",
			});
		} catch {
			// best-effort
		}
	}
}

// ---------------------------------------------------------------------------
// launch & focus
// ---------------------------------------------------------------------------

/** Split the current pane to the right and launch vim in the new pane. */
function launchEditor(cwd: string, files: string[]): string | null {
	const splitRes = herdrJson([
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		cwd,
		"--focus",
	]) as { result?: { pane?: { pane_id?: string } } } | null;

	const newPaneId = splitRes?.result?.pane?.pane_id;
	if (!newPaneId) return null;

	const cmd = files.length > 0 ? ["vim", ...files] : ["vim"];
	herdrOk(["pane", "run", newPaneId, ...cmd]);
	return newPaneId;
}

/** Focus a specific pane by ID. */
function focusPane(paneId: string): void {
	herdrOk(["pane", "focus", "--pane", paneId]);
}

// ---------------------------------------------------------------------------
// tmux fallback
// ---------------------------------------------------------------------------

function tmuxFallback(cwd: string, files: string[]): boolean {
	try {
		const fileArgs = files.length > 0 ? files : [];
		execFileSync(
			"tmux",
			["split-window", "-h", "-c", cwd, "vim", ...fileArgs],
			{ timeout: HERDR_TIMEOUT_MS, stdio: "ignore" },
		);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// file listing for LLM resolution
// ---------------------------------------------------------------------------

/** Recursively list files under cwd (limited depth/count), returning relative paths. */
function listFilesForLlm(cwd: string): string[] {
	const results: string[] = [];
	const skipDirs = new Set([
		".git", "node_modules", ".venv", "__pycache__", ".pi", ".agents",
		"target", "dist", "build", ".cache", ".treehouse",
	]);

	function walk(dir: string, depth: number) {
		if (depth > 3 || results.length >= MAX_FILE_LIST) return;
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
					// Skip hidden directories and known large dirs
					if (!skipDirs.has(entry) && !entry.startsWith(".")) {
						walk(full, depth + 1);
					}
				} else {
					// Include regular files (including dotfiles)
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
// LLM-based file resolution
// ---------------------------------------------------------------------------

interface LlmResolution {
	/** Resolved file paths (relative to cwd), or empty if uncertain. */
	files: string[];
	/** Whether the LLM was confident. */
	confident: boolean;
	/** Candidate options for multiple-choice (when not confident). */
	candidates: string[];
}

/** Extract the assistant text from pi --mode json -p output (NDJSON lines). */
function extractAssistantText(jsonOutput: string): string {
	// Track the LAST turn_end — tool calls produce multiple turns, and the
	// final assistant message (after any tool results) is the one we want.
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

/** Resolve a natural-language file query using a small LLM call via pi print mode. */
function resolveFilesWithLlm(cwd: string, query: string): Promise<LlmResolution> {
	const fileList = listFilesForLlm(cwd);
	const fileSet = new Set(fileList);

	const systemPrompt = `You resolve natural-language file references to actual file paths.
Given a list of files in the working directory and a user's request, determine which file(s) to open.

Respond in ONE of these formats:
1. If you are confident, reply with EXACTLY: CONFIDENT: <file1> [file2 ...]
2. If you are uncertain, reply with EXACTLY: UNCERTAIN: <option1> | <option2> | <option3>
   List 2-5 candidate files separated by " | ".

Rules:
- File paths must be relative paths from the working directory, matching the file list exactly.
- If the user's request doesn't match any file, reply with: UNCERTAIN: (no matches)
- Reply with only the format line, no explanation.`;

	const userPrompt = `Working directory: ${cwd}

Available files (relative paths):
${fileList.length > 0 ? fileList.join("\n") : "(no files found)"}

User request: "${query}"

Which file(s) should be opened?`;

	return new Promise<LlmResolution>((resolve) => {
		const piBin = resolvePiBinary();
		const args = [
			...piBin.baseArgs,
			"--mode", "json",
			"-p",
			"--no-skills",
			"--no-extensions",
			"--no-context-files",
			"--no-prompt-templates",
			"--no-themes",
			"--system-prompt", systemPrompt,
			userPrompt,
		];

		// Strip Herdr env vars so the child pi process doesn't try to report to Herdr
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

		// Close stdin so pi print mode does not wait for input.
		child.stdin.end();

		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
		child.on("error", () =>
			resolve({ files: [], confident: false, candidates: [] }),
		);
		child.on("close", () => {
			const text = extractAssistantText(stdout).trim();

			if (text.startsWith("CONFIDENT:")) {
				const paths = text
					.slice("CONFIDENT:".length)
					.trim()
					.split(/\s+/)
					.filter(Boolean)
					// Validate that resolved paths actually exist in the file list
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
						// Validate candidates too
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
	ctx: UIContext,
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
		ctx.ui.notify(lines.join("\n"), "info");

		const stop = ctx.ui.onTerminalInput((data: string) => {
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
			ctx.ui.notify(`Invalid choice "${trimmed}". Enter 1-${candidates.length} or press Enter to cancel.`, "warn");
			return { consume: true };
		});

		// Timeout after 30s
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
				return {
					message: "Cancelled — no file selected.",
					launched: false,
				};
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
		const existing = findEditorPane(current.tab_id);
		if (existing) {
			if (finalFiles.length > 0) {
				// Try RPC first, fall back to send-text
				const sock = findNvimSocket();
				if (sock && sendFilesViaRpc(sock, finalFiles)) {
					focusPane(existing.paneId);
					return {
						message: `Opened ${finalFiles.length} file(s) in existing editor (pane ${existing.paneId}) via RPC.`,
						launched: false,
					};
				}
				sendFilesViaText(existing.paneId, finalFiles);
				focusPane(existing.paneId);
				return {
					message: `Sent ${finalFiles.length} file(s) to existing editor (pane ${existing.paneId}) via send-text.`,
					launched: false,
				};
			}
			focusPane(existing.paneId);
			return {
				message: `Focused existing editor pane (${existing.paneId}).`,
				launched: false,
			};
		}

		// No existing editor in this tab — launch a new vertical split.
		const newPane = launchEditor(cwd, finalFiles);
		if (newPane) {
			const fileNote =
				finalFiles.length > 0
					? ` with ${finalFiles.length} file(s)`
					: "";
			return {
				message: `Launched vim in a vertical split (pane ${newPane}) at ${cwd}${fileNote}.`,
				launched: true,
			};
		}
	}

	// Herdr unavailable or failed — try tmux.
	if (tmuxFallback(cwd, finalFiles)) {
		return {
			message: `Launched vim in a tmux split at ${cwd}.`,
			launched: true,
		};
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
			const fileList: string[] = (() => {
				if (Array.isArray(args)) return args.map(String);
				if (typeof args === "string") return args.trim() ? args.trim().split(/\s+/) : [];
				return [];
			})();
			const result = await openEditor(cwd, fileList, ctx);
			ctx?.ui?.notify(result.message, "info");
		},
	});
}
