import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";

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
// herdr-nvim sidebar daemon (ChmaraX/herdr-nvim)
// ---------------------------------------------------------------------------
// The plugin keeps one persistent headless nvim per Herdr tab. A daemon
// registers itself as a listen socket in its runtime dir (plugin
// src/daemon/registry.rs): <tab key>.sock, where the tab key is the tab id
// with every ':' turned into '_'. When this tab has a live daemon, the
// sidebar IS the tab's editor: open files in it instead of launching a
// duplicate split.

/** herdr-nvim tab key: the tab id with every ':' replaced by '_'. */
function sidebarTabKey(tabId: string): string {
	return tabId.replace(/:/g, "_");
}

/** Candidate daemon sockets for a tab, mirroring the plugin's registry
 *  lookup order: $XDG_RUNTIME_DIR/herdr-nvim, then the platform temp dir. */
export function sidebarSocketCandidates(tabId: string): string[] {
	const name = `${sidebarTabKey(tabId)}.sock`;
	const dirs: string[] = [];
	if (process.env.XDG_RUNTIME_DIR) {
		dirs.push(join(process.env.XDG_RUNTIME_DIR, "herdr-nvim"));
	}
	dirs.push(join(tmpdir(), "herdr-nvim"));
	return [...new Set(dirs.map((dir) => join(dir, name)))];
}

/** The tab's registered daemon socket, or null when the plugin is absent
 *  or the tab never started a daemon. The socket file can outlive a
 *  crashed daemon — liveness-check with `nvimServerAlive` before use. */
export function sidebarDaemonSocket(tabId: string): string | null {
	for (const socket of sidebarSocketCandidates(tabId)) {
		if (existsSync(socket)) return socket;
	}
	return null;
}

/** True when an nvim RPC server answers on `socket`. */
export function nvimServerAlive(socket: string): boolean {
	try {
		execFileSync("nvim", ["--server", socket, "--remote-expr", "1"], {
			timeout: HERDR_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

/** Live herdr-nvim daemon for a tab — pass the current pane when the
 *  caller already has it (openEditor), else it is looked up. */
export function liveSidebarDaemon(
	current?: PaneInfo,
): { socket: string; tabId: string } | null {
	const pane = current ?? getCurrentPane();
	if (!pane) return null;
	const socket = sidebarDaemonSocket(pane.tab_id);
	if (!socket || !nvimServerAlive(socket)) return null;
	return { socket, tabId: pane.tab_id };
}

/** True when `proc` is a sidebar-pane foreground process. Two shapes:
 *  the `herdr-nvim sidebar` launcher (brief on Unix before it execs, the
 *  parent on Windows) and the `nvim --server <socket> --remote-ui` client
 *  it execs into on Unix (daemon/mod.rs `attach_remote_ui`) — the steady
 *  state. The client is matched by the tab's own daemon socket, which the
 *  caller already holds. */
export function isSidebarProcess(proc: ProcessEntry, daemonSocket: string): boolean {
	const argv = proc.argv ?? [];
	const exe = proc.name || argv[0] || "";
	const base = exe.replace(/^.*[\\/]/, "");
	if (/^herdr-nvim(\.exe)?$/.test(base) && argv.includes("sidebar")) return true;
	const server = argv.indexOf("--server");
	return (
		(base === "nvim" || base === "nvim.exe") &&
		argv.includes("--remote-ui") &&
		server !== -1 &&
		argv[server + 1] === daemonSocket
	);
}

/** Find the tab's visible sidebar pane — the pane whose foreground
 *  process is the remote-ui window onto the headless daemon. Returns
 *  its pane id, or null when the sidebar is toggled off. */
function findSidebarPane(currentTabId: string, daemonSocket: string): string | null {
	const panes = listPanes();
	if (!panes) return null;
	for (const pane of panes) {
		if (pane.tab_id !== currentTabId) continue;
		const procs = getProcessInfo(pane.pane_id)?.foreground_processes ?? [];
		if (procs.some((proc) => isSidebarProcess(proc, daemonSocket))) {
			return pane.pane_id;
		}
	}
	return null;
}

/** Open files in the daemon's nvim over its RPC socket (`--remote`, one
 *  client per file — the same mechanism the plugin's own picker uses). */
function openInDaemon(socket: string, files: string[]): boolean {
	let ok = true;
	for (const file of files) {
		try {
			execFileSync("nvim", ["--server", socket, "--remote", file], {
				timeout: HERDR_TIMEOUT_MS,
				stdio: ["pipe", "pipe", "ignore"],
			});
		} catch {
			ok = false;
		}
	}
	return ok;
}

/** Attach to the tab's herdr-nvim sidebar: open the files in its daemon,
 *  then show the sidebar — focus it when visible, open it with the
 *  plugin's own toggle action (what `prefix+t` runs) when toggled off.
 *  The toggle applies to the focused tab, which is where the user is
 *  looking when they ask for files. */
function attachToSidebarDaemon(
	daemon: { socket: string; tabId: string },
	current: PaneInfo,
	files: string[],
): { message: string; ok: boolean; launched: boolean } {
	const opened = files.length === 0 || openInDaemon(daemon.socket, files);
	const sidebarPane = findSidebarPane(daemon.tabId, daemon.socket);
	if (sidebarPane) {
		focusEditorPane(sidebarPane, current.pane_id);
	} else {
		herdrOk(["plugin", "action", "invoke", "chmarax.herdr-nvim.toggle"]);
	}
	const where = `herdr-nvim sidebar (tab ${daemon.tabId})`;
	if (!opened) {
		return { message: `Could not open files in the ${where}.`, ok: false, launched: false };
	}
	if (files.length > 0) {
		return { message: `Opened ${files.length} file(s) in the ${where}.`, ok: true, launched: false };
	}
	return {
		message: `${sidebarPane ? "Focused" : "Opened"} the ${where}.`,
		ok: true,
		launched: false,
	};
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
export function findEditorPane(currentTabId: string): DetectionResult {
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
/** Detect the editor (vim/nvim) process in the current Herdr tab, with its
 *  pane id and process name. Exported for focus-buffer's nvim RPC path. */
export function detectEditorProcess():
	| { paneId: string; pid: number; name: string }
	| null {
	const current = getCurrentPane();
	if (!current) return null;
	const detection = findEditorPane(current.tab_id);
	if (detection.status !== "found") return null;
	const proc = getProcessInfo(detection.editor.paneId)?.foreground_processes ?? [];
	const match = proc.find(
		(p) => p.name === "nvim" || p.argv?.[0] === "nvim" || p.name === "vim" || p.argv?.[0] === "vim",
	);
	if (!match) return null;
	return {
		paneId: detection.editor.paneId,
		pid: detection.editor.pid,
		name: match.name === "vim" || match.argv?.[0] === "vim" ? "vim" : "nvim",
	};
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
function sendFilesViaText(paneId: string, files: string[]): boolean {
	let sent = true;
	for (const file of files) {
		const escaped = fnameEscape(file);
		const text = `\x1b:e ${escaped}\r`;
		try {
			execFileSync("herdr", ["pane", "send-text", paneId, text], {
				timeout: HERDR_TIMEOUT_MS, stdio: "ignore",
			});
		} catch {
			sent = false;
		}
	}
	return sent;
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
	// Launch nvim with an explicit RPC socket so focus-buffer (and nvimr)
	// can drive this pane: the pi-focus:// node buffers live in THIS
	// instance. Without --listen the pane is a dead end for buffer updates.
	// Pane IDs contain colons ("w57:p2X") and nvim parses colon-bearing
	// --listen values as host:service addresses — sanitize to a plain path.
	const safePaneId = newPaneId.replace(/[^A-Za-z0-9._-]/g, "-");
	const socketPath = join(tmpdir(), `pi-nvim-${safePaneId}.sock`);
	// The pane dies with nvim (tuicr behavior): when nvim exits, the pane's
	// shell closes the pane itself — no dead prompt left behind. `herdr pane
	// run` injects the string into the pane's interactive shell (zsh/fish
	// safe: bash -c with a single single-quoted argument, quotes escaped).
	const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
	const nvimLine = ["nvim", "--listen", socketPath, ...files.map(quote)].join(" ");
	const inner = `${nvimLine}; herdr pane close ${newPaneId}`;
	const paneCommand = `bash -c '${inner.replace(/'/g, "'\\''")}'`;
	if (!herdrOk(["pane", "run", newPaneId, paneCommand])) {
		return null;
	}
	return newPaneId;
}
/**
 * Focus the editor pane by discovering the direction from the current pane
 * to the editor pane using `herdr pane neighbor` (the neighbor is reported
 * as `neighbor_pane_id`; `pane_id` is the origin). `herdr pane focus`
 * requires --direction, so focus relative to the current pane with --pane
 * rather than --current, whose origin is the client's focused pane — often
 * the sidebar itself when it is visible.
 */
function focusEditorPane(editorPaneId: string, currentPaneId: string): boolean {
	const directions = ["right", "down", "left", "up"] as const;
	for (const dir of directions) {
		const res = herdrJson(["pane", "neighbor", "--pane", currentPaneId, "--direction", dir]) as
			| { result?: { neighbor?: { neighbor_pane_id?: string } } } | null;
		const neighborId = res?.result?.neighbor?.neighbor_pane_id;
		if (neighborId === editorPaneId) {
			return herdrOk(["pane", "focus", "--pane", currentPaneId, "--direction", dir]);
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
		// Same contract as the herdr launcher: nvim with an RPC socket, so
		// focus-buffer can drive this pane too.
		const socketPath = join(tmpdir(), `pi-nvim-${process.pid}-${Date.now()}.sock`);
		const socketArg = `--listen ${socketPath}`;
		let shellCmd: string;
		if (files.length > 0) {
			const quotedFiles = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`);
			shellCmd = `nvim ${socketArg} ${quotedFiles.join(" ")}`;
		} else {
			shellCmd = `nvim ${socketArg}`;
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
): Promise<{ message: string; ok: boolean; launched: boolean }> {
	const finalFiles = resolveFilePaths(cwd, rawArgs);
	// Try Herdr — getCurrentPane returns null if herdr is unavailable
	const current = getCurrentPane();
	if (current) {
		// A live herdr-nvim sidebar daemon owns editing for this tab:
		// attach to it instead of detecting or launching a split editor.
		const daemon = liveSidebarDaemon(current);
		if (daemon) return attachToSidebarDaemon(daemon, current, finalFiles);
		const detection = findEditorPane(current.tab_id);
		if (detection.status === "found") {
			const editor = detection.editor;
			if (finalFiles.length > 0) {
				const ok = sendFilesViaText(editor.paneId, finalFiles);
				if (ok) focusEditorPane(editor.paneId, current.pane_id);
				return {
					message: ok
						? `Sent ${finalFiles.length} file(s) to existing editor (pane ${editor.paneId}).`
						: `Could not send files to existing editor (pane ${editor.paneId}).`,
					ok,
					launched: false,
				};
			}
			const ok = focusEditorPane(editor.paneId, current.pane_id);
			return {
				message: ok
					? `Focused existing editor pane (${editor.paneId}).`
					: `Could not focus existing editor pane (${editor.paneId}).`,
				ok,
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
					ok: true,
					launched: true,
				};
			}
		}
	}
	// Herdr unavailable or failed — try tmux.
	if (tmuxFallback(cwd, finalFiles)) {
		return { message: `Launched vim in a tmux split at ${cwd}.`, ok: true, launched: true };
	}
	return {
		message: `Could not launch vim automatically. Run manually: cd ${cwd} && vim ${finalFiles.join(" ")}`,
		ok: false,
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
		"Open vim in the current Herdr tab: attach to the tab's herdr-nvim sidebar daemon when one is live, else send files to an existing editor pane in the tab, else launch a vertical split. With no files, opens or focuses the editor at the agent's cwd.",
	promptSnippet: "Open vim in the current Herdr tab as a vertical split",
	promptGuidelines: [
		"Use nvim_open when the user wants to open an editor (vim) for editing, either at the current working directory or for specific files.",
		"If an editor is already running in the current Herdr tab, this tool sends files to the existing instance rather than launching a duplicate.",
		"When the tab has a live herdr-nvim sidebar daemon, the tool attaches to it: files open in the sidebar and no second editor is launched.",
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
	renderResult(result, _options, theme, context) {
		const files = context.args?.files ?? [];
		const target = files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : context.args?.cwd || context.cwd;
		const first = result.content.find((part) => part.type === "text")?.text.split("\n", 1)[0].trim() ?? "";
		// Older results have no details or error flag, even when opening failed.
		const failed = context.isError || first.startsWith("Could not");
		return {
			render(width) {
				const leaf = theme.fg("dim", " ├─ ⌨  nvim · ") + theme.fg("text", theme.bold(target));
				const banner = theme.fg("dim", " └─ ") + theme.fg(failed ? "error" : "success", failed ? `✗ ${first || "Could not open editor"}` : "✓ opened in editor pane");
				return [
					truncateToWidth(leaf, width),
					...files.flatMap((file) => wrapTextWithAnsi(file, Math.max(1, width - 4))
						.map((line) => truncateToWidth(theme.fg("dim", ` │  ${line}`), width))),
					truncateToWidth(banner, width),
				];
			},
			invalidate() {},
		};
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
