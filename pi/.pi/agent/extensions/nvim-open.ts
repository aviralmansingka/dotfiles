import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname, resolve, isAbsolute } from "node:path";

const HERDR_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// injectable exec seam
// ---------------------------------------------------------------------------
// Same pattern as tuicr-core.mjs postTuicRreply's execFile injection: every
// multiplexer call in this module goes through one injectable sync-exec
// primitive. Production always runs the real execFileSync; tests inject a
// fake that answers canned herdr/nvim/tmux responses, so the launch-race
// logic is exercised against real decision code with zero live panes.
export type SyncExecFn = (
	command: string,
	args: string[],
	options: ExecFileSyncOptions & { encoding: "utf-8" },
) => string;
const realSyncExec: SyncExecFn = (command, args, options) =>
	execFileSync(command, args, options);
let syncExecImpl: SyncExecFn = realSyncExec;

/** Test seam: swap the exec primitive used by every herdr/nvim/tmux call in
 *  this module. Pass null to restore the real execFileSync. */
export function __setExecSyncForTests(impl: SyncExecFn | null): void {
	syncExecImpl = impl ?? realSyncExec;
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
		const out = syncExecImpl("herdr", args, {
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
		syncExecImpl("herdr", args, {
			encoding: "utf-8", timeout: HERDR_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"],
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
		syncExecImpl("nvim", ["--server", socket, "--remote-expr", "1"], {
			encoding: "utf-8",
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
			syncExecImpl("nvim", ["--server", socket, "--remote", file], {
				encoding: "utf-8",
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
 *  then focus the sidebar pane when one is visible. When the sidebar is
 *  toggled off, the files land in the persistent daemon and the message
 *  says how to view them — the agent never shows the pane itself: a
 *  plugin *action* invoke resolves to the focused tab (possibly another
 *  workspace), and a raw `plugin pane open` bypasses the plugin's
 *  state/layout machinery and corrupts the next `prefix+t`. The user's
 *  own toggle is the only correct show path. */
function attachToSidebarDaemon(
	daemon: { socket: string; tabId: string },
	current: PaneInfo,
	files: string[],
): { message: string; ok: boolean; launched: boolean } {
	const opened = files.length === 0 || openInDaemon(daemon.socket, files);
	const sidebarPane = findSidebarPane(daemon.tabId, daemon.socket);
	const focused = sidebarPane !== null && focusEditorPane(sidebarPane, current.pane_id);
	const where = `herdr-nvim sidebar (tab ${daemon.tabId})`;
	const viewNote = sidebarPane ? "" : " — press prefix+t in that tab to view";
	if (!opened) {
		return { message: `Could not open files in the ${where}.`, ok: false, launched: false };
	}
	if (files.length > 0) {
		return { message: `Opened ${files.length} file(s) in the ${where}${viewNote}.`, ok: true, launched: false };
	}
	if (!sidebarPane) {
		return { message: `The ${where} is this tab's editor${viewNote}.`, ok: true, launched: false };
	}
	return focused
		? { message: `Focused the ${where}.`, ok: true, launched: false }
		: { message: `Could not focus the ${where}.`, ok: false, launched: false };
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
/** True when a foreground-process entry is a vim/nvim editor. */
function isEditorProcess(proc: ProcessEntry): boolean {
	return proc.name === "vim" || proc.argv?.[0] === "vim" ||
		proc.name === "nvim" || proc.argv?.[0] === "nvim";
}

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
			if (isEditorProcess(proc)) {
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
			syncExecImpl("herdr", ["pane", "send-text", paneId, text], {
				encoding: "utf-8",
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
/** XDG_CONFIG_HOME for a dotfiles worktree's nvim config — the nearest
 *  ancestor of cwd holding nvim/.config/nvim/init.lua — or null when cwd
 *  is not inside a dotfiles checkout. */
export function dotfilesConfigHome(cwd: string): string | null {
	let dir = cwd;
	for (let i = 0; i < 20; i++) {
		if (existsSync(join(dir, "nvim", ".config", "nvim", "init.lua"))) {
			return join(dir, "nvim", ".config");
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}
/** A herdr split attempt: what it established before succeeding or
 *  failing. The pane id and --listen socket survive a failed `pane run`
 *  and identify the orphan pane in the failure log line. */
interface SplitAttempt {
	ran: boolean;
	paneId: string | null;
	socket: string | null;
}
/**
 * Split the current pane to the right and launch vim in the new pane.
 * Returns the attempt: ran=true on success, or whatever the failed
 * attempt managed to establish (nulls when the split itself failed).
 */
function launchEditor(cwd: string, files: string[]): SplitAttempt {
	const splitRes = herdrJson([
		"pane", "split", "--current", "--direction", "right", "--cwd", cwd, "--focus",
	]) as { result?: { pane?: { pane_id?: string } } } | null;
	const newPaneId = splitRes?.result?.pane?.pane_id;
	if (!newPaneId) return { ran: false, paneId: null, socket: null };
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
	const configHome = dotfilesConfigHome(cwd);
	const nvimLine = [
		...(configHome ? ["env", `XDG_CONFIG_HOME=${quote(configHome)}`] : []),
		"nvim", "--listen", socketPath, ...files.map(quote),
	].join(" ");
	const inner = `${nvimLine}; herdr pane close ${newPaneId}`;
	const paneCommand = `bash -c '${inner.replace(/'/g, "'\\''")}'`;
	if (!herdrOk(["pane", "run", newPaneId, paneCommand])) {
		return { ran: false, paneId: newPaneId, socket: socketPath };
	}
	return { ran: true, paneId: newPaneId, socket: socketPath };
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
	return false;
}
// ---------------------------------------------------------------------------
// launch registry & per-tab launch lock
// ---------------------------------------------------------------------------
// The provenance log once recorded two splits 27 ms apart in one tab: the
// second caller scanned before the first caller's nvim had reached the
// pane's foreground processes, so both decided "no editor" and both split.
// Two guards fix that. In-process: every detect→split critical section runs
// under a per-tab async lock and consults this process's registry FIRST — a
// pane this process launched or attached to is trusted without a scan.
// Cross-process: after a split, a re-list closes our pane when another
// process's editor pane already won the race.

/** The editor pane this process launched or attached to for one tab. */
interface EditorRegistryEntry {
	paneId: string;
	/** --listen socket when this process launched the pane; null when attached. */
	socket: string | null;
	/** True only when THIS process created the pane (shutdown-close scope). */
	created: boolean;
}
/** tab id → the tab's editor pane, as this process knows it. */
const editorRegistry = new Map<string, EditorRegistryEntry>();

/** True when the registry pane still exists: `pane process-info` answers.
 *  A pane whose nvim is still starting answers with its shell — alive is
 *  alive, and that is exactly the lag the registry exists to ride out. */
function registryPaneAlive(paneId: string): boolean {
	return getProcessInfo(paneId) !== null;
}

/** Panes in the tab running a vim/nvim foreground process, excluding
 *  `exclude` (the post-split guard excludes the pane it just created). */
function editorPanesInTab(currentTabId: string, exclude: string | null): string[] {
	const panes = listPanes();
	if (!panes) return [];
	const found: string[] = [];
	for (const pane of panes) {
		if (pane.tab_id !== currentTabId) continue;
		if (exclude !== null && pane.pane_id === exclude) continue;
		const procs = getProcessInfo(pane.pane_id)?.foreground_processes ?? [];
		if (procs.some((proc) => isEditorProcess(proc))) {
			found.push(pane.pane_id);
		}
	}
	return found;
}

/** Per-tab async launch locks (chain mutex): each caller queues on the
 *  previous caller's completion, so concurrent openEditor calls in one tab
 *  serialize their detect→split sections instead of racing. */
const tabLaunchLocks = new Map<string, Promise<void>>();

async function withTabLaunchLock<T>(
	tabId: string,
	section: () => Promise<T>,
): Promise<T> {
	const predecessor = tabLaunchLocks.get(tabId) ?? Promise.resolve();
	const run = predecessor.then(section);
	const tail = run.then(() => {}, () => {});
	tabLaunchLocks.set(tabId, tail);
	try {
		return await run;
	} finally {
		// Drop the entry once no later caller queued behind us.
		if (tabLaunchLocks.get(tabId) === tail) tabLaunchLocks.delete(tabId);
	}
}

// ---------------------------------------------------------------------------
// tmux fallback
// ---------------------------------------------------------------------------
function tmuxFallback(cwd: string, files: string[]): string | null {
	try {
		// Same contract as the herdr launcher: nvim with an RPC socket, so
		// focus-buffer can drive this pane too.
		const socketPath = join(tmpdir(), `pi-nvim-${process.pid}-${Date.now()}.sock`);
		const configHome = dotfilesConfigHome(cwd);
		const shellCmd = [
			...(configHome ? ["env", `XDG_CONFIG_HOME='${configHome.replace(/'/g, "'\\''")}'`] : []),
			"nvim", `--listen ${socketPath}`, ...files.map((f) => `'${f.replace(/'/g, "'\\''")}'`),
		].join(" ");
		syncExecImpl("tmux", ["split-window", "-h", "-c", cwd, shellCmd], {
			encoding: "utf-8",
			timeout: HERDR_TIMEOUT_MS, stdio: "ignore",
		});
		return socketPath;
	} catch {
		return null;
	}
}
// ---------------------------------------------------------------------------
// launch provenance log
// ---------------------------------------------------------------------------
// Two nvim panes once appeared in a subagent tab running the wrong
// worktree's config, and no pi session log held any trace of their
// launchers. Every editor launch from every route now appends one
// attributable line to a fixed log, so an orphan pane can always be
// traced back — and a pane with NO line was launched outside pi (the
// Herdr plugin layer). Logging is debug state: a write failure must
// never fail or delay the launch it describes.

/** Fixed provenance log for editor launches; PI_NVIM_LAUNCH_LOG overrides. */
export function launchLogPath(
	env: { [key: string]: string | undefined } = process.env,
): string {
	return env.PI_NVIM_LAUNCH_LOG ?? join(homedir(), ".cache", "pi", "nvim-open-launches.log");
}

/** One provenance event, as known at the launch decision point. */
export interface LaunchLogEvent {
	route: string;
	cwd: string;
	outcome: "split" | "existing" | "sidebar" | "failed";
	/** New pane id / --listen socket — recorded for split and failed only. */
	pane?: string;
	socket?: string;
	files: number;
}

/** Quote a value that would otherwise break key=value token scanning:
 *  empty, or containing whitespace, quotes, backslash, or "=". */
function quoteLogValue(value: string): string {
	if (value === "" || /[\s'"\\=]/.test(value)) {
		return `'${value.replace(/'/g, "'\\''")}'`;
	}
	return value;
}

/** Build one grep-friendly provenance line: space-separated key=value
 *  pairs, values with spaces single-quoted (shell style). Pure, so it
 *  is unit-tested directly, mirroring tuicr-core.mjs. */
export function buildLaunchLogLine(
	event: LaunchLogEvent,
	env: { [key: string]: string | undefined } = process.env,
): string {
	const pairs: Array<[string, string]> = [
		["ts", new Date().toISOString()],
		["pid", String(process.pid)],
		["route", event.route],
		["session", env.PI_SUBAGENT_SESSION ?? env.PI_SESSION_FILE ?? "-"],
		["subagent", env.PI_SUBAGENT_NAME ?? "-"],
		["callerPane", env.HERDR_PANE_ID ?? "-"],
		["cwd", event.cwd],
		["outcome", event.outcome],
	];
	if (event.outcome === "split" || event.outcome === "failed") {
		pairs.push(["pane", event.pane ?? "-"], ["socket", event.socket ?? "-"]);
	}
	pairs.push(["files", String(event.files)]);
	return pairs.map(([key, value]) => `${key}=${quoteLogValue(value)}`).join(" ");
}

/** Record one launch at its decision point (the outcome is now known).
 *  Best-effort: any failure is swallowed and never delays the launch. */
function logLaunch(event: LaunchLogEvent): void {
	try {
		const path = launchLogPath();
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${buildLaunchLogLine(event)}\n`, { encoding: "utf-8" });
	} catch {
		// Swallowed by design.
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
/** Route files/focus to an already-present editor pane (registry hit or
 *  scan detection): send `:e <file>` keystrokes, focus the pane, log the
 *  existing-editor outcome. `note` prefixes the message when the routing
 *  came from the post-split duplicate guard. */
function routeToExistingEditor(
	current: PaneInfo,
	editorPaneId: string,
	finalFiles: string[],
	cwd: string,
	route: string,
	note = "",
): { message: string; ok: boolean; launched: boolean } {
	if (finalFiles.length > 0) {
		const ok = sendFilesViaText(editorPaneId, finalFiles);
		if (ok) focusEditorPane(editorPaneId, current.pane_id);
		logLaunch(ok
			? { route, cwd, outcome: "existing", files: finalFiles.length }
			: { route, cwd, outcome: "failed", pane: editorPaneId, socket: "-", files: finalFiles.length });
		return {
			message: ok
				? `${note}Sent ${finalFiles.length} file(s) to existing editor (pane ${editorPaneId}).`
				: `${note}Could not send files to existing editor (pane ${editorPaneId}).`,
			ok,
			launched: false,
		};
	}
	const ok = focusEditorPane(editorPaneId, current.pane_id);
	logLaunch(ok
		? { route, cwd, outcome: "existing", files: 0 }
		: { route, cwd, outcome: "failed", pane: editorPaneId, socket: "-", files: 0 });
	return {
		message: ok
			? `${note}Focused existing editor pane (${editorPaneId}).`
			: `${note}Could not focus existing editor pane (${editorPaneId}).`,
		ok,
		launched: false,
	};
}

/** Register a fresh split as this tab's editor — after the cross-process
 *  duplicate guard: re-list the tab's panes and, if another process's
 *  editor pane appeared alongside ours, close OUR pane (the new one) and
 *  route to the pre-existing editor instead. */
function registerLaunchedEditor(
	current: PaneInfo,
	launch: SplitAttempt & { ran: true; paneId: string; socket: string },
	finalFiles: string[],
	cwd: string,
	route: string,
): { message: string; ok: boolean; launched: boolean } {
	const rivals = editorPanesInTab(current.tab_id, launch.paneId);
	if (rivals.length > 0) {
		const winner = rivals[0];
		herdrOk(["pane", "close", launch.paneId]);
		editorRegistry.set(current.tab_id, { paneId: winner, socket: null, created: false });
		return routeToExistingEditor(
			current, winner, finalFiles, cwd, route,
			`Closed duplicate pane ${launch.paneId} (a concurrent launch raced this one). `,
		);
	}
	editorRegistry.set(current.tab_id, {
		paneId: launch.paneId, socket: launch.socket, created: true,
	});
	const fileNote = finalFiles.length > 0 ? ` with ${finalFiles.length} file(s)` : "";
	logLaunch({
		route, cwd, outcome: "split",
		pane: launch.paneId, socket: launch.socket,
		files: finalFiles.length,
	});
	return {
		message: `Launched vim in a vertical split (pane ${launch.paneId}) at ${cwd}${fileNote}.`,
		ok: true,
		launched: true,
	};
}

/** The detect→split critical section for one tab, run under the tab's
 *  launch lock. Returns null to fall through to the tmux fallback (herdr
 *  scan error, or a split whose pane could not be programmed). */
async function openEditorInTab(
	current: PaneInfo,
	finalFiles: string[],
	cwd: string,
	route: string,
	noteAttempt: (attempt: SplitAttempt) => void,
): Promise<{ message: string; ok: boolean; launched: boolean } | null> {
	// Registry-first: an editor pane this process launched or attached to
	// is trusted without a pane scan. The scan once missed a pane this
	// process had split 27 ms earlier — its nvim had not reached the pane's
	// foreground processes yet — and a second split landed on top of it.
	const known = editorRegistry.get(current.tab_id);
	if (known) {
		if (registryPaneAlive(known.paneId)) {
			return routeToExistingEditor(current, known.paneId, finalFiles, cwd, route);
		}
		// Stale entry: the pane is gone (closed with its editor, or killed).
		editorRegistry.delete(current.tab_id);
	}
	const detection = findEditorPane(current.tab_id);
	if (detection.status === "found") {
		// Remember the pane we attached to so later calls skip the scan.
		editorRegistry.set(current.tab_id, {
			paneId: detection.editor.paneId, socket: null, created: false,
		});
		return routeToExistingEditor(current, detection.editor.paneId, finalFiles, cwd, route);
	}
	// Only launch a new editor if we definitively confirmed no editor exists.
	// On error, fall through to tmux fallback rather than risking a duplicate.
	if (detection.status === "absent") {
		const launch = launchEditor(cwd, finalFiles);
		if (launch.ran && launch.paneId) {
			return registerLaunchedEditor(
				current,
				launch as SplitAttempt & { ran: true; paneId: string; socket: string },
				finalFiles, cwd, route,
			);
		}
		if (launch.paneId) noteAttempt(launch);
	}
	return null;
}

export async function openEditor(
	cwd: string,
	rawArgs: string[],
	route = "library:unknown",
): Promise<{ message: string; ok: boolean; launched: boolean }> {
	const finalFiles = resolveFilePaths(cwd, rawArgs);
	// Provenance: remembered from a partial herdr attempt so even the
	// final failure line can name the pane it left behind.
	let herdrAttempt: SplitAttempt | null = null;
	// Try Herdr — getCurrentPane returns null if herdr is unavailable
	const current = getCurrentPane();
	if (current) {
		// A live herdr-nvim sidebar daemon owns editing for this tab:
		// attach to it instead of detecting or launching a split editor.
		const daemon = liveSidebarDaemon(current);
		if (daemon) {
			const result = attachToSidebarDaemon(daemon, current, finalFiles);
			logLaunch(result.ok
				? { route, cwd, outcome: "sidebar", files: finalFiles.length }
				: { route, cwd, outcome: "failed", pane: "-", socket: daemon.socket, files: finalFiles.length });
			return result;
		}
		// Everything below can split a pane. Two concurrent callers in one
		// tab once double-split 27 ms apart (the second scan ran before the
		// first split's nvim reached foreground processes), so the whole
		// detect→split section runs under a per-tab launch lock with a
		// registry-first lookup.
		const outcome = await withTabLaunchLock(
			current.tab_id,
			() => openEditorInTab(current, finalFiles, cwd, route, (attempt) => {
				herdrAttempt = attempt;
			}),
		);
		if (outcome) return outcome;
	}
	// Herdr unavailable or failed — try tmux.
	const tmuxSocket = tmuxFallback(cwd, finalFiles);
	if (tmuxSocket !== null) {
		logLaunch({ route, cwd, outcome: "split", pane: "-", socket: tmuxSocket, files: finalFiles.length });
		return { message: `Launched vim in a tmux split at ${cwd}.`, ok: true, launched: true };
	}
	logLaunch({
		route, cwd, outcome: "failed",
		pane: herdrAttempt?.paneId ?? "-",
		socket: herdrAttempt?.socket ?? "-",
		files: finalFiles.length,
	});
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
	promptSnippet: "Open vim in the current Herdr tab (sidebar daemon, existing editor, or vertical split)",
	promptGuidelines: [
		"Use nvim_open when the user wants to open an editor (vim) for editing, either at the current working directory or for specific files.",
		"If an editor is already running in the current Herdr tab, this tool sends files to the existing instance rather than launching a duplicate.",
		"When the tab has a live herdr-nvim sidebar daemon, the tool attaches to it: files open in the sidebar and no second editor is launched.",
		"With no files provided, it opens or focuses the editor at the agent's cwd. With file paths, it opens those specific files.",
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
		const result = await openEditor(cwd, files, "tool");
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
		description: "Open vim in the current Herdr tab (sidebar daemon, existing editor, or vertical split)",
		handler: async (args: unknown, ctx: { cwd?: string; ui: { notify: (msg: string, level: string) => void } }) => {
			const cwd = ctx?.cwd ?? process.cwd();
			const fileList: string[] = (() => {
				if (Array.isArray(args)) return args.map(String);
				if (typeof args === "string") return args.trim() ? parseArgs(args.trim()) : [];
				return [];
			})();
			const result = await openEditor(cwd, fileList, "command");
			ctx?.ui?.notify(result.message, "info");
		},
	});
}
