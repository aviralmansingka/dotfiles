import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { buildNvimTerminalScript, extractMarkedOutput, NVIM_RUN_TIMEOUT_MS } from "./run-command/nvim-terminal";
import {
	Editor,
	type EditorTheme,
	Key,
	Text,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ────────────────────────────────────────────────────────────────────────────
// run-command — a hands-on sibling of quiz.
//
// Where quiz verifies the HEAD (concepts, terminology), run-command verifies
// the HANDS: the agent presents ONE command with a grounded prediction and the
// user runs it. Two capture paths share the panel:
//   - Manual: `y` yanks the command to the clipboard and focuses the response
//     field; the user runs it in their own terminal, returns, types/pastes
//     output, and submits. The agent never executes the command — the user
//     types everything, which is the point.
//   - Auto: `r` opens a Neovim `:term dm` pane, runs the command there, and
//     captures output + exit status back into the grading flow (see
//     runViaNvimTerminal and ./run-command/nvim-terminal.ts); the user need not
//     paste by hand. Esc cancels; a hard timeout bounds long-running commands.
// On submit, the command and observed output travel together so the agent
// grades output vs. prediction without having seen the terminal.
// ────────────────────────────────────────────────────────────────────────────

interface RunCommandResponse {
	output: string;
	exitCode?: number;
	autoRun?: boolean;
}

type RunCommandStatus = "answered" | "cancelled" | "unavailable";

interface RunCommandDetails {
	status: RunCommandStatus;
	command: string;
	prediction?: string;
	context?: string;
	output?: string;
	exitCode?: number;
	autoRun?: boolean;
	copied?: boolean; // user pressed `y` — the command was yanked at least once
	message?: string;
}

const execFileAsync = promisify(execFile);
const HERDR_TIMEOUT_MS = 5000;
const NVIM_START_TIMEOUT_MS = 10_000;
const POLL_MS = 250;

interface NvimRunResult {
	output: string;
	exitCode: number;
	// Present only for a pane we own and must close (the split fallback); the
	// float path leaves the existing nvim pane open so paneId is undefined.
	paneId?: string;
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Neovim run cancelled");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(abortError(signal));
	let onAbort: (() => void) | undefined;
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		onAbort = () => {
			clearTimeout(timer);
			reject(abortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	}).finally(() => {
		if (onAbort) signal.removeEventListener("abort", onAbort);
	});
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason ?? new Error("Neovim run cancelled"));
	if (signal?.aborted) onAbort();
	signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(new Error(`Neovim terminal run timed out after ${timeoutMs / 1000}s`)), timeoutMs);
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}

async function execText(command: string, args: string[], signal: AbortSignal, timeout = HERDR_TIMEOUT_MS): Promise<string> {
	const { stdout } = await execFileAsync(command, args, {
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
		signal,
		timeout,
	});
	return String(stdout);
}

async function herdrJson(args: string[], signal: AbortSignal): Promise<any | null> {
	try {
		return JSON.parse(await execText("herdr", args, signal));
	} catch {
		return null;
	}
}

async function herdrOk(args: string[], signal: AbortSignal): Promise<boolean> {
	try {
		await execText("herdr", args, signal);
		return true;
	} catch {
		return false;
	}
}

async function nvimExpr(socket: string, expr: string, signal: AbortSignal): Promise<string> {
	return execText("nvim", ["--server", socket, "--remote-expr", expr], signal);
}

function luaEval(lua: string, arg?: string): string {
	return arg === undefined ? `luaeval(${JSON.stringify(lua)})` : `luaeval(${JSON.stringify(lua)}, ${JSON.stringify(arg)})`;
}

async function waitForSocket(socket: string, signal: AbortSignal): Promise<void> {
	const deadline = Date.now() + NVIM_START_TIMEOUT_MS;
	while (!existsSync(socket)) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for Neovim RPC socket");
		await sleep(POLL_MS, signal);
	}
}

// Run a multi-statement lua chunk on the remote nvim and return its result.
// `nvim --remote-expr` only evaluates a single vim expression, so we use the
// `load(...)()` trick: the chunk source is passed as the arg and compiled +
// executed, and whatever the chunk `return`s comes back as the expr result.
// `bufId`/`winId` are trusted integers we inline directly (no _A plumbing).
async function nvimLua(socket: string, chunk: string, signal: AbortSignal): Promise<string> {
	return nvimExpr(socket, `luaeval("load(...)()", ${JSON.stringify(chunk)})`, signal);
}

async function nvimLive(socket: string, signal: AbortSignal): Promise<boolean> {
	try {
		await execText("nvim", ["--server", socket, "--remote-expr", "1"], signal, HERDR_TIMEOUT_MS);
		return true;
	} catch {
		return false;
	}
}

// Pull the `--listen <path>` RPC socket out of an nvim process's argv, handling
// both `--listen /path` (separate arg) and `--listen=/path` (joined arg).
function listenSocketFromArgv(argv: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--listen") return argv[i + 1];
		if (a.startsWith("--listen=")) return a.slice("--listen=".length);
	}
	return undefined;
}

// nvim's default RPC socket when no `--listen` is passed (Linux/has-XDG_RUNTIME
// only). On macOS nvim does not auto-open a socket, so this is a best-effort
// fallback — the nvim skill's launcher always passes `--listen` explicitly.
function defaultNvimSocketForPid(pid: number | string | undefined): string | undefined {
	if (pid === undefined || pid === null) return undefined;
	const runtime = process.env.XDG_RUNTIME_DIR ?? (process.getuid ? `/run/user/${process.getuid()}` : undefined);
	return runtime ? `${runtime}/nvim.${pid}.0` : undefined;
}

async function waitForTerminalJob(socket: string, bufId: number, signal: AbortSignal): Promise<void> {
	const deadline = Date.now() + NVIM_START_TIMEOUT_MS;
	while (Date.now() <= deadline) {
		const job = await nvimLua(
			socket,
			`local ok, j = pcall(vim.api.nvim_buf_get_var, ${bufId}, 'terminal_job_id'); return (ok and j) and j or 0`,
			signal,
		).catch(() => "0");
		if (Number.parseInt(job.trim(), 10) > 0) return;
		await sleep(POLL_MS, signal);
	}
	throw new Error("Timed out waiting for `:term dm` terminal job");
}

// Read a buffer's lines back as one newline-joined string. The join separator
// MUST be the Lua escape `\n` (written `\\n` in this template literal), NOT a
// raw newline: the chunk travels JS template -> JSON.stringify (-> `\n`) ->
// Vim double-quoted string in `--remote-expr`, and Vim unescapes `\n` back to a
// raw newline. A raw newline inside a Lua short-string literal is a syntax
// error, so `load(...)` returns nil and `load(...)()` throws "attempt to call a
// nil value". See issue #184.
async function readNvimBuffer(socket: string, bufId: number, signal: AbortSignal): Promise<string> {
	return nvimLua(socket, `return table.concat(vim.api.nvim_buf_get_lines(${bufId}, 0, -1, false), "\\n")`, signal);
}

// Find an already-open nvim the captain can see (e.g. a `/nvim` split in this
// tab) and return its RPC socket. Preference order: the `NVIM_LISTEN_ADDRESS`
// env override, then a Herdr pane whose foreground process is nvim — focused
// pane first, then a pane in the agent's own tab, then any other. Returns null
// when no drivable nvim is open, so the caller falls back to a fresh split.
async function discoverExistingNvim(signal: AbortSignal): Promise<{ socket: string; paneId?: string } | null> {
	const envSock = process.env.NVIM_LISTEN_ADDRESS;
	if (envSock && existsSync(envSock) && (await nvimLive(envSock, signal))) return { socket: envSock };

	const current = await herdrJson(["pane", "current"], signal);
	const myTab = current?.result?.pane?.tab_id;
	const list = await herdrJson(["pane", "list"], signal);
	const panes: any[] = Array.isArray(list?.result?.panes) ? list.result.panes : [];
	if (panes.length === 0) return null;
	// focused first, then same-tab, then everything else.
	const ranked = [...panes].sort((a, b) => {
		const f = Number(b?.focused ? 1 : 0) - Number(a?.focused ? 1 : 0);
		if (f !== 0) return f;
		return Number(a?.tab_id === myTab ? 0 : 1) - Number(b?.tab_id === myTab ? 0 : 1);
	});
	for (const pane of ranked) {
		const paneId: string | undefined = pane?.pane_id;
		if (!paneId) continue;
		const info = await herdrJson(["pane", "process-info", "--pane", paneId], signal);
		const procs: any[] = Array.isArray(info?.result?.process_info?.foreground_processes) ? info.result.process_info.foreground_processes : [];
		for (const proc of procs) {
			if (String(proc?.name ?? "") !== "nvim") continue;
			const argv: string[] = Array.isArray(proc?.argv) ? proc.argv.map(String) : [];
			const sock = listenSocketFromArgv(argv) ?? defaultNvimSocketForPid(proc?.pid);
			if (sock && existsSync(sock) && (await nvimLive(sock, signal))) return { socket: sock, paneId };
		}
	}
	return null;
}

interface TerminalHandle {
	socket: string;
	bufId: number;
	paneId?: string; // present only for a pane we own and must close (split fallback)
	cleanup: () => Promise<void>;
}

// Fallback path (no existing nvim open): split a new Herdr pane to the right
// and launch a fresh `nvim +term dm` in it, exactly as before. Output still
// streams live via the shared `tee` wrapper.
async function openSplitPaneTerminal(cwd: string, signal: AbortSignal): Promise<TerminalHandle> {
	// Keep the RPC socket path short: UNIX domain sockets cap at ~103 bytes
	// (sun_path[104] minus NUL), and macOS' /var/folders/.../T tmpdir is already
	// ~48 bytes, so a `pi-run-command-<uuid>.sock` name blows the limit and
	// `nvim --listen` silently fails to create the socket. Use a short prefix
	// and a hyphen-less hex token so the full path stays well under the cap.
	const socket = `${tmpdir()}/pi-rc-${randomUUID().replace(/-/g, "")}.sock`;
	const split = await herdrJson(["pane", "split", "--current", "--direction", "right", "--cwd", cwd, "--focus"], signal);
	const paneId = split?.result?.pane?.pane_id;
	if (!paneId) throw new Error("Could not open a Herdr pane for Neovim");
	const launched = await herdrOk(["pane", "run", paneId, "nvim", "--listen", socket, "-n", "+term dm", "+startinsert"], signal);
	if (!launched) throw new Error("Could not launch Neovim in the new pane");
	await waitForSocket(socket, signal);
	const bufId = Number.parseInt((await nvimExpr(socket, "bufnr('%')", signal)).trim(), 10);
	if (!Number.isFinite(bufId)) throw new Error("Could not resolve the Neovim terminal buffer");
	return {
		socket,
		bufId,
		paneId,
		cleanup: async () => {
			await herdrOk(["pane", "close", paneId], new AbortController().signal).catch(() => false);
		},
	};
}

// Preferred path: open a centered floating terminal inside an already-open
// nvim (the captain's `/nvim` split) over its RPC socket. The float shows the
// command output streaming live via `tee`; we close the float + wipe its
// scratch buffer on completion. The existing nvim pane itself is never closed.
async function openFloatTerminal(socket: string, _cwd: string, signal: AbortSignal): Promise<TerminalHandle> {
	// Create a scratch buffer, open a centered float over it, and `termopen dm`
	// in that buffer. `nvim_open_win(buf, true, …)` makes the float the current
	// window so `termopen` (which always uses the current buffer) runs in buf.
	// Return a `job|win|buf` string so the caller can target the exact terminal
	// job/buffer regardless of where the captain later moves focus. (luaeval
	// surfaces only the first return value of a chunk, so we join into one
	// string rather than returning a multi-value/tuple.)
	const chunk = [
		"local cols = vim.o.columns",
		"local lines = vim.o.lines",
		"local width = math.floor(cols * 0.8)",
		"local height = math.floor(lines * 0.6)",
		"local row = math.floor((lines - height) / 2)",
		"local col = math.floor((cols - width) / 2)",
		"local buf = vim.api.nvim_create_buf(false, true)",
		"vim.bo[buf].bufhidden = 'wipe'",
		"local win = vim.api.nvim_open_win(buf, true, {relative='editor', width=width, height=height, row=row, col=col, border='rounded', title=' run-command ', title_pos='center', style='minimal'})",
		"vim.fn.termopen({'dm'})",
		"local ok, j = pcall(vim.api.nvim_buf_get_var, buf, 'terminal_job_id')",
		"return tostring((ok and j) and j or 0) .. '|' .. tostring(win) .. '|' .. tostring(buf)",
	].join("\n");
	const out = await nvimLua(socket, chunk, signal);
	const parts = out.trim().split("|");
	const win = Number.parseInt(parts[1] ?? "", 10);
	const buf = Number.parseInt(parts[2] ?? "", 10);
	if (!Number.isFinite(buf)) throw new Error("Could not open a floating terminal in the existing Neovim");
	return {
		socket,
		bufId: buf,
		cleanup: async () => {
			const lua = [
				`if vim.api.nvim_win_is_valid(${win}) then vim.api.nvim_win_close(${win}, true) end`,
				`if vim.api.nvim_buf_is_valid(${buf}) then vim.api.nvim_buf_delete(${buf}, {force=true, unload=true}) end`,
			].join("\n");
			await nvimLua(socket, lua, new AbortController().signal).catch(() => false);
		},
	};
}

async function runViaNvimTerminal(
	cwd: string,
	command: string,
	signal: AbortSignal | undefined,
	onProgress: (message: string) => void,
): Promise<NvimRunResult> {
	const timeout = withTimeout(signal, NVIM_RUN_TIMEOUT_MS);
	const runSignal = timeout.signal;
	const token = randomUUID().replace(/-/g, "");
	// Capture command stdout+stderr to a temp file (via `tee`, so output is also
	// visible live in the terminal) and read it back via fs once the END marker
	// fires. We do not scrape the echoed terminal buffer for output: the
	// terminal driver echoes the bulk-pasted wrapper before the shell runs it,
	// so buffer scraping corrupts the captured text. `statusFile` holds the
	// command's real exit code (see buildNvimTerminalScript).
	const outputFile = `${tmpdir()}/pi-rc-out-${token}.txt`;
	const statusFile = `${tmpdir()}/pi-rc-st-${token}.txt`;
	let handle: TerminalHandle | undefined;
	try {
		onProgress("Finding a Neovim to run in…");
		const existing = await discoverExistingNvim(runSignal);
		if (existing) {
			onProgress("Opening floating terminal in existing Neovim…");
			handle = await openFloatTerminal(existing.socket, cwd, runSignal);
		} else {
			onProgress("Opening Neovim terminal pane…");
			handle = await openSplitPaneTerminal(cwd, runSignal);
		}

		onProgress("Starting `:term dm`…");
		await waitForTerminalJob(handle.socket, handle.bufId, runSignal);

		onProgress("Running command in the Neovim terminal…");
		const script = buildNvimTerminalScript(command, token, outputFile, statusFile);
		// Target the float/split's own terminal job by buffer so a focus change
		// in the existing nvim can't misroute the pasted wrapper. luaeval's first
		// arg must be a single expression (no statements/`local`), so resolve the
		// job inline and pass the script text as `_A`.
		const sendExpr = `vim.api.nvim_chan_send(vim.api.nvim_buf_get_var(${handle.bufId}, 'terminal_job_id'), _A)`;
		await nvimExpr(handle.socket, luaEval(sendExpr, script), runSignal);

		onProgress(`Waiting for output (timeout ${NVIM_RUN_TIMEOUT_MS / 1000}s)…`);
		while (true) {
			const parsed = extractMarkedOutput(await readNvimBuffer(handle.socket, handle.bufId, runSignal), token);
			if (parsed.complete) {
				let output = "";
				try {
					output = readFileSync(outputFile, "utf8");
				} catch {
					output = "";
				}
				return { output: output.trim(), exitCode: parsed.exitCode ?? -1, paneId: handle.paneId };
			}
			await sleep(POLL_MS, runSignal);
		}
	} finally {
		timeout.cleanup();
		if (handle) await handle.cleanup().catch(() => {});
		rmSync(outputFile, { force: true });
		rmSync(statusFile, { force: true });
	}
}

const RunCommandParams = Type.Object({
	command: Type.String({
		description:
			"The single command the user should run, exactly as they should type it. One command per tool call — never a batch.",
	}),
	prediction: Type.String({
		description:
			"REQUIRED. What output you expect, grounded in observed host state (you ran the idempotent/read-side equivalent yourself) or flagged as inferred from docs. Grading is output vs. this prediction.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or safety notes shown above the command." }),
	),
});

function createEditorTheme(theme: any): EditorTheme {
	return {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
}

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
	const contentWidth = Math.max(1, width - indent.length);
	for (const line of wrapTextWithAnsi(text, contentWidth)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}

// Render the panel as two merged rounded boxes over the prompt area: a narrow
// content box (inset 2 columns each side) on top, its bottom corners becoming
// tees in the top border of a full-width, prompt-styled input box below.
// Top content must be laid out at (width - 8) columns, bottom at (width - 4).
function frameMerged(top: string[], bottom: string[], width: number, theme: any): string[] {
	if (width < 24) return [...top, ...bottom];
	const tw = width - 8;
	const bw = width - 4;
	const accent = (s: string) => theme.fg("accent", s);
	const out: string[] = [];
	out.push(`  ${accent("╭")}${accent("─".repeat(tw + 2))}${accent("╮")}`);
	for (const line of top) {
		const pad = Math.max(0, tw - visibleWidth(line));
		out.push(`  ${accent("│")} ${line}${" ".repeat(pad)} ${accent("│")}`);
	}
	const rightTee = width - 3;
	out.push(
		accent("╭") +
			accent("─") +
			accent("┴") +
			accent("─".repeat(rightTee - 3)) +
			accent("┴") +
			accent("─") +
			accent("╮"),
	);
	for (const line of bottom) {
		const pad = Math.max(0, bw - visibleWidth(line));
		out.push(`${accent("│")} ${line}${" ".repeat(pad)} ${accent("│")}`);
	}
	out.push(accent("╰") + accent("─".repeat(width - 2)) + accent("╯"));
	return out;
}

// Strip the Editor's own flat ─ borders (and scroll-rule variants) so the
// outer rounded box is the only frame — the bottom box then reads as a clean
// prompt, exactly like the real one.
function editorInnerLines(editor: Editor, width: number): string[] {
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
	return editor
		.render(width)
		.filter((l) => !/^─+$/.test(stripAnsi(l)) && !/^─── [↑↓] \d+ more /.test(stripAnsi(l)));
}

// Shared UI mutex. ctx.ui.custom()/editor can only handle one active call at
// a time, so ALL pop-up-style tools (quiz, ask_user_question, run-command, ...)
// must serialize against each other, not just against themselves. We stash one
// mutex on globalThis so separate extension files can share it without
// importing each other.
const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let chain: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			withLock<T>(fn: () => T | Promise<T>): Promise<T> {
				const prev = chain;
				let release: () => void;
				chain = new Promise<void>((r) => {
					release = r;
				});
				return prev.then(fn).finally(() => release!());
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY] as { withLock<T>(fn: () => T | Promise<T>): Promise<T> };
}
const sharedUiLock = getSharedUiLock();

function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	return sharedUiLock.withLock(fn);
}

interface AskResult {
	response: RunCommandResponse | null;
	copied: boolean;
}

type AutoRunState =
	| { status: "idle" }
	| { status: "running"; message: string }
	| { status: "error"; message: string };

async function askRunCommand(
	ctx: any,
	command: string,
	prediction: string,
	context: string | undefined,
	signal: AbortSignal | undefined,
): Promise<AskResult> {
	let copied = false;

	const result = await ctx.ui.custom<RunCommandResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: RunCommandResponse | null) => void) => {
			let finished = false;
			let autoRun: AutoRunState = { status: "idle" };
			let autoController: AbortController | undefined;
			const finish = (value: RunCommandResponse | null) => {
				if (finished) return;
				finished = true;
				autoController?.abort(new Error("run-command panel closed"));
				done(value);
			};

			function refresh() {
				tui.requestRender();
			}

			function startAutoRun() {
				if (autoRun.status === "running" || finished) return;
				autoController = new AbortController();
				const onAbort = () => autoController?.abort(signal?.reason ?? new Error("run-command cancelled"));
				if (signal?.aborted) onAbort();
				signal?.addEventListener("abort", onAbort, { once: true });
				autoRun = { status: "running", message: "Opening Neovim terminal pane…" };
				refresh();
				runViaNvimTerminal(ctx.cwd ?? process.cwd(), command, autoController.signal, (message) => {
					autoRun = { status: "running", message };
					refresh();
				})
					.then((result) => {
						signal?.removeEventListener("abort", onAbort);
						finish({ output: result.output, exitCode: result.exitCode, autoRun: true });
					})
					.catch((error) => {
						signal?.removeEventListener("abort", onAbort);
						if (finished) return;
						autoRun = { status: "error", message: error instanceof Error ? error.message : String(error) };
						refresh();
					});
			}

			// The response field. Enter must NOT submit inside the editor (its submit
			// path clears the buffer), so disableSubmit and let the host own Enter.
			// Ctrl+J still inserts a newline (pi convention) for multi-line output.
			const editor = new Editor(tui, createEditorTheme(theme));
			editor.focused = false;
			editor.disableSubmit = true;

			let focus: "editor" | "none" = "none";

			function outputText(): string | undefined {
				const t = editor.getExpandedText().trim();
				return t.length ? t : undefined;
			}

			return {
				render(width: number): string[] {
					const tw = Math.max(8, width - 8);
					const bw = Math.max(8, width - 4);
					const top: string[] = [];
					const bottom: string[] = [];
					const addT = (s: string) => top.push(truncateToWidth(s, tw));
					const addB = (s: string) => bottom.push(truncateToWidth(s, bw));

					addT(theme.fg("toolTitle", theme.bold(" run this command")));
					if (context) {
						top.push("");
						addWrapped(top, theme.fg("muted", context), tw, " ");
					}
					top.push("");
					// The command, verbatim, in a visually distinct block.
					for (const line of command.split("\n")) {
						addT(` ${theme.fg("success", theme.bold(line))}`);
					}
					top.push("");
					addWrapped(
						top,
						theme.fg("dim", "y — copy and focus output · r — run in Neovim :term dm and auto-capture"),
						tw,
						" ",
					);
					if (autoRun.status === "running") {
						addWrapped(top, theme.fg("warning", `${autoRun.message} Esc cancels; hard timeout ${NVIM_RUN_TIMEOUT_MS / 1000}s.`), tw, " ");
					}
					if (autoRun.status === "error") {
						addWrapped(top, theme.fg("warning", `Neovim run failed: ${autoRun.message}. Manual copy/paste still works.`), tw, " ");
					}
					if (copied) {
						addT(theme.fg("success", " ✓ copied to clipboard"));
					}
					const label =
						focus === "editor"
							? theme.fg("accent", "Output (paste what you saw below):")
							: theme.fg("muted", "Output (paste what you saw below) — Tab to focus:");
					addWrapped(top, label, tw, " ");
					addT(
						theme.fg(
							"dim",
							focus === "editor" ? " Enter — submit · Tab — unfocus · Esc — cancel" : " Tab — focus output · Esc — cancel",
						),
					);
					if (focus !== "editor" && editor.getText().trim().length === 0) {
						bottom.push(theme.fg("dim", " output — Tab to paste"));
					} else {
						for (const line of editorInnerLines(editor, bw)) bottom.push(line);
					}
					return frameMerged(top, bottom, width, theme);
				},

				invalidate: () => {
					editor.invalidate();
				},

				handleInput(data: string) {
					if (focus === "editor") {
						if (matchesKey(data, Key.enter)) {
							finish({ output: outputText() ?? "" });
							return;
						}
						if (matchesKey(data, Key.tab)) {
							focus = "none";
							editor.focused = false;
							return;
						}
						if (matchesKey(data, Key.escape)) {
							finish(null);
							return;
						}
						editor.handleInput(data);
						return;
					}

					// Unfocused: y yanks and focuses output, r runs via Neovim, Tab only focuses.
					if (data === "y") {
						focus = "editor";
						editor.focused = true;
						copyToClipboard(command)
							.then(() => {
								copied = true;
								tui.requestRender();
							})
							.catch(() => {});
						return;
					}
					if (data === "r") {
						startAutoRun();
						return;
					}
					if (matchesKey(data, Key.tab)) {
						focus = "editor";
						editor.focused = true;
						return;
					}
					if (matchesKey(data, Key.enter)) {
						// Submitting with an empty field is almost always an accident —
						// focus the field instead of submitting nothing.
						if (!outputText()) {
							focus = "editor";
							editor.focused = true;
							return;
						}
						finish({ output: outputText()! });
						return;
					}
					if (matchesKey(data, Key.escape)) {
						finish(null);
						return;
					}
				},
			};
		},
	);

	return { response: result, copied };
}

function buildDetails(
	status: RunCommandStatus,
	command: string,
	prediction: string | undefined,
	context: string | undefined,
	output?: string,
	copied?: boolean,
	message?: string,
	exitCode?: number,
	autoRun?: boolean,
): RunCommandDetails {
	return { status, command, prediction, context, output, copied, message, exitCode, autoRun };
}

function cancelledResult(command: string, prediction: string | undefined, context?: string) {
	const message = "User cancelled run-command";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("cancelled", command, prediction, context, undefined, undefined, message),
	};
}

function unavailableResult(command: string, prediction: string | undefined, message: string, context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("unavailable", command, prediction, context, undefined, undefined, message),
	};
}

export default function runCommand(pi: ExtensionAPI) {
	pi.registerTool({
		name: "run-command",
		label: "run-command",
		description:
			"Use ONLY when the user has explicitly asked to learn about the commands being run — e.g., a /professor tutoring session, hands-on learning, or a 'teach me' request. In every other case, run commands directly via bash without asking the user; do NOT use this tool. When the user IS learning: have them run ONE command hands-on and report what they saw. A floating panel shows the command; y copies it for the manual terminal workflow, and r opens a Neovim terminal pane with `:term dm`, runs the command there, and captures output automatically. You receive the command and observed output together — grade output vs. prediction.",
		promptSnippet:
			"Use run-command ONLY when the user has asked to learn the commands (tutoring/hands-on learning); otherwise run commands via bash directly. When learning, have the user execute one command hands-on (with a grounded prediction); they can paste output manually or press r for Neovim-terminal auto-capture.",
		promptGuidelines: [
			"Use ONLY in learning contexts — when the user has explicitly asked to learn about the commands being run (e.g., /professor, 'teach me', hands-on practice). In all other cases, run commands directly via bash; never use this tool for ordinary work.",
			"ONE command per call — never a batch. The panel shows exactly what you pass in `command`, verbatim.",
			"The user may press r to run the displayed command through a Neovim `:term dm` pane; output and exit status are captured automatically when available.",
			"prediction is REQUIRED and must be grounded: run the idempotent/read-only equivalent yourself first and predict the actual observed output; for state-modifying commands, run the read-side (current ruleset/sysctl value) and predict a concrete diff. When no safe read exists, say the prediction is inferred from docs.",
			"Grade the returned output against your prediction. A mismatch is diagnostic: either host state drifted or your model was wrong — determine which before moving on.",
			"The user may submit partial or empty output if something went wrong on their side — treat that as data, not as disobedience.",
			"Follow up with a quiz to cement the concept when the node needs it — run-command proves the hands, not the head.",
		],
		parameters: RunCommandParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const command = params.command.trim();
			const prediction = params.prediction.trim();
			const context = params.details?.trim() || undefined;

			if (signal?.aborted) {
				return cancelledResult(command, prediction, context);
			}
			if (!command) {
				return unavailableResult(command, prediction, "run-command requires a non-empty command", context);
			}
			if (!ctx.hasUI) {
				return unavailableResult(command, prediction, "run-command requires interactive mode UI", context);
			}

			return withUILock(async () => {
				const { response, copied } = await askRunCommand(ctx, command, prediction, context, signal);
				if (!response) {
					return cancelledResult(command, prediction, context);
				}
				const output = response.output.trim();
				let text: string;
				if (response.autoRun) {
					text = output
						? `User pressed r; Pi ran the command in a Neovim \`:term dm\` pane and captured output.\nCommand: ${command}\nExit status: ${response.exitCode ?? "unknown"}\nOutput:\n${output}`
						: `User pressed r; Pi ran the command in a Neovim \`:term dm\` pane and captured no output.\nCommand: ${command}\nExit status: ${response.exitCode ?? "unknown"}`;
				} else if (output) {
					text = `User ran the command and pasted output.\nCommand: ${command}\nOutput:\n${output}`;
				} else {
					text = `User submitted WITHOUT output — the command produced nothing they could paste, or something went wrong on their side.\nCommand: ${command}`;
				}
				if (copied) text += `\n(They copied the command via the panel's y key.)`;
				text += `\nYour prediction was: ${prediction}`;
				return {
					content: [{ type: "text" as const, text }],
					details: buildDetails("answered", command, prediction, context, output || undefined, copied, undefined, response.exitCode, response.autoRun),
				};
			});
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("run-command ")) + theme.fg("muted", String(args.command ?? ""));
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as RunCommandDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", details.message || "Cancelled"), 0, 0);
			}
			if (details.status === "unavailable") {
				return new Text(theme.fg("warning", details.message || "Unavailable"), 0, 0);
			}
			const lines: string[] = [];
			lines.push(theme.fg("toolTitle", theme.bold("run-command ")) + theme.fg("text", details.command));
			if (details.autoRun) {
				lines.push(theme.fg("muted", `via Neovim :term dm${details.exitCode === undefined ? "" : ` · exit ${details.exitCode}`}`));
			}
			if (details.output) {
				lines.push(theme.fg("muted", `─ output (${details.output.split("\n").length} lines) ─`));
				for (const line of details.output.split("\n").slice(0, 20)) {
					lines.push(theme.fg("dim", ` ${line}`));
				}
				const extra = details.output.split("\n").length - 20;
				if (extra > 0) lines.push(theme.fg("dim", ` … ${extra} more lines`));
			} else if (details.autoRun) {
				lines.push(theme.fg("muted", "─ captured no output ─"));
			} else {
				lines.push(theme.fg("warning", " (no output submitted)"));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
