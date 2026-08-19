import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve, isAbsolute } from "node:path";

const HERDR_TIMEOUT_MS = 5000;
const NVIM_TIMEOUT_MS = 4000;

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

function herdrAvailable(): boolean {
	try {
		execFileSync("herdr", ["workspace", "list"], {
			timeout: 3000,
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
// nvim detection & communication
// ---------------------------------------------------------------------------

interface NvimPane {
	paneId: string;
	pid: number;
}

/** Search all panes in the current tab for one whose foreground process is nvim. */
function findNvimPane(currentTabId: string): NvimPane | null {
	const panes = listPanes().filter((p) => p.tab_id === currentTabId);
	for (const pane of panes) {
		const info = getProcessInfo(pane.pane_id);
		if (!info) continue;
		for (const proc of info.foreground_processes ?? []) {
			if (proc.name === "nvim" || proc.argv?.[0] === "nvim") {
				return { paneId: pane.pane_id, pid: proc.pid };
			}
		}
	}
	return null;
}

/** Discover the nvim RPC socket for a given PID by globbing the nvim temp dir. */
function findNvimSocket(pid: number): string | null {
	const user = userInfo().username;
	const tmp = process.env.TMPDIR ?? "/tmp";
	const nvimDir = join(tmp, `nvim.${user}`);
	if (!existsSync(nvimDir)) return null;
	try {
		for (const sub of readdirSync(nvimDir)) {
			const sock = join(nvimDir, sub, `nvim.${pid}.0`);
			if (existsSync(sock)) return sock;
		}
	} catch {
		// ignore
	}
	return null;
}

/** Open files in an existing nvim instance via its RPC socket. Returns true on success. */
function sendFilesViaRpc(socket: string, files: string[]): boolean {
	try {
		for (const file of files) {
			execFileSync("nvim", ["--server", socket, "--remote", file], {
				timeout: NVIM_TIMEOUT_MS,
				stdio: "ignore",
			});
		}
		return true;
	} catch {
		return false;
	}
}

/** Fallback: send `:e <file>` keystrokes to the nvim pane via herdr send-text. */
function sendFilesViaText(paneId: string, files: string[]): void {
	for (const file of files) {
		// Escape to exit insert mode, then :e with the path, then Enter.
		const text = `\x1b:e ${file}\r`;
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

/** Split the current pane downward and launch nvim in the new pane. */
function launchNvim(cwd: string, files: string[]): string | null {
	const splitRes = herdrJson([
		"pane",
		"split",
		"--current",
		"--direction",
		"down",
		"--cwd",
		cwd,
		"--focus",
	]) as { result?: { pane?: { pane_id?: string } } } | null;

	const newPaneId = splitRes?.result?.pane?.pane_id;
	if (!newPaneId) return null;

	const cmd = files.length > 0 ? ["nvim", ...files] : ["nvim", "."];
	herdrOk(["pane", "run", newPaneId, "--", ...cmd]);
	return newPaneId;
}

/** Best-effort focus of the pane below the current one. */
function focusPaneDown(): void {
	herdrOk(["pane", "focus", "--current", "--direction", "down"]);
}

// ---------------------------------------------------------------------------
// tmux fallback
// ---------------------------------------------------------------------------

function tmuxFallback(cwd: string, files: string[]): boolean {
	try {
		const fileArgs = files.length > 0 ? files : ["."];
		execFileSync(
			"tmux",
			["split-window", "-v", "-c", cwd, "--", "nvim", ...fileArgs],
			{ timeout: HERDR_TIMEOUT_MS, stdio: "ignore" },
		);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// core orchestration
// ---------------------------------------------------------------------------

function resolveFiles(cwd: string, files: string[]): string[] {
	return files.map((f) => (isAbsolute(f) ? f : resolve(cwd, f)));
}

function openNvim(cwd: string, files: string[]): { message: string; launched: boolean } {
	const resolvedFiles = resolveFiles(cwd, files);

	if (herdrAvailable()) {
		const current = getCurrentPane();
		if (current) {
			const existing = findNvimPane(current.tab_id);
			if (existing) {
				if (resolvedFiles.length > 0) {
					const sock = findNvimSocket(existing.pid);
					if (sock && sendFilesViaRpc(sock, resolvedFiles)) {
						focusPaneDown();
						return {
							message: `Opened ${resolvedFiles.length} file(s) in existing nvim (pane ${existing.paneId}) via RPC.`,
							launched: false,
						};
					}
					sendFilesViaText(existing.paneId, resolvedFiles);
					focusPaneDown();
					return {
						message: `Sent ${resolvedFiles.length} file(s) to existing nvim (pane ${existing.paneId}) via send-text.`,
						launched: false,
					};
				}
				focusPaneDown();
				return {
					message: `Focused existing nvim pane (${existing.paneId}).`,
					launched: false,
				};
			}

			// No existing nvim in this tab — launch a new horizontal split.
			const newPane = launchNvim(cwd, resolvedFiles);
			if (newPane) {
				const fileNote =
					resolvedFiles.length > 0
						? ` with ${resolvedFiles.length} file(s)`
						: "";
				return {
					message: `Launched nvim in a horizontal split (pane ${newPane}) at ${cwd}${fileNote}.`,
					launched: true,
				};
			}
		}
	}

	// Herdr unavailable or failed — try tmux.
	if (tmuxFallback(cwd, resolvedFiles)) {
		return {
			message: `Launched nvim in a tmux split at ${cwd}.`,
			launched: true,
		};
	}

	return {
		message: `Could not launch nvim automatically. Run manually: cd ${cwd} && nvim ${resolvedFiles.join(" ") || "."}`,
		launched: false,
	};
}

// ---------------------------------------------------------------------------
// extension registration
// ---------------------------------------------------------------------------

const nvimOpenTool = defineTool({
	name: "nvim_open",
	label: "Open Neovim",
	description:
		"Open Neovim as a horizontal split in the current Herdr tab, or send files to an existing Neovim instance in the current tab. If nvim is already running in the current tab, files are sent to the existing instance instead of launching a new one. With no files, opens nvim at the agent's cwd.",
	promptSnippet: "Open Neovim in the current Herdr tab as a horizontal split",
	promptGuidelines: [
		"Use nvim_open when the user wants to open Neovim (nvim) for editing, either at the current working directory or for specific files.",
		"If nvim is already running in the current Herdr tab, this tool sends files to the existing instance rather than launching a duplicate.",
		"With no files provided, it opens nvim at the agent's cwd. With file paths, it opens those specific files.",
		"The split is horizontal (below the agent pane) and focus moves to the nvim pane so the captain can see the editor.",
	],
	parameters: Type.Object({
		cwd: Type.String({
			description: "The working directory to open nvim in. Defaults to the agent's cwd.",
		}),
		files: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional list of file paths to open in nvim. Relative paths are resolved against cwd.",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const cwd = params.cwd ?? process.cwd();
		const files = params.files ?? [];
		const result = openNvim(cwd, files);
		return { content: [{ type: "text", text: result.message }] };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(nvimOpenTool);

	pi.registerCommand("nvim", {
		description: "Open Neovim in the current Herdr tab as a horizontal split",
		handler: async (args: unknown, ctx: { cwd?: string; ui: { notify: (msg: string, level: string) => void } }) => {
			const cwd = ctx?.cwd ?? process.cwd();
			const fileList: string[] = (() => {
				if (Array.isArray(args)) return args.map(String);
				if (typeof args === "string") return args.trim() ? args.trim().split(/\s+/) : [];
				return [];
			})();
			const result = openNvim(cwd, fileList);
			ctx?.ui?.notify(result.message, "info");
		},
	});
}
