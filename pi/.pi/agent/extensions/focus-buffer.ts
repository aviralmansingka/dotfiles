import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectEditorProcess } from "./nvim-open";

// ────────────────────────────────────────────────────────────────────────────
// focus-buffer — the learner's scoped node views.
//
// Named scratch buffers (buftype=nofile, never written to disk) inside the
// running nvim editor pane:
//
//   pi-focus://<key>/<node-slug>  — ONE BUFFER PER TEACHING NODE. Each
//                                   `lesson` call creates or updates its
//                                   node's buffer and focuses it. Earlier
//                                   node buffers persist, so the learner can
//                                   cycle them in nvim (:bnext/:bprev or
//                                   personal buffer bindings) — no panel keys
//                                   are claimed for cycling.
//
//   pi-focus://<key>/overview     — THE ARC AT A GLANCE: nodes taught in
//                                   order, per-node quiz verdicts, and the
//                                   current position. md-log rebuilds its
//                                   content from the durable journal, so a
//                                   refreshed or resumed session still shows
//                                   where the learner is. This is what h and
//                                   ctrl+h focus BEFORE the first lesson
//                                   exists — the big journal file is never
//                                   the fallback view.
//
// The durable record still lives in the session journal and the probes file
// (md-log); these buffers are the ephemeral "what am I working on right now"
// views.
//
// Mechanism (same as the nvimr skill): resolve the editor pane's nvim RPC
// socket, then run a lua file remotely via
//   nvim --server SOCK --remote-expr 'luaeval("load(...)()", join(readfile(F), "\n"))'
// The lua creates-or-reuses the buffer, opens it in a right-hand split, and
// (for show*) sets its lines from a temp content file.
// ────────────────────────────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 4000;

export interface FocusBufferResult {
	ok: boolean;
	message: string;
}

/** Resolve the live nvim RPC socket for a pane pid. */
export function editorSocketPath(pid: number): string | undefined {
	try {
		const cmdline = readFileSync(`/proc/${pid}/cmdline`);
		const args = cmdline.toString("utf-8").split("\0").filter(Boolean);
		for (let i = 0; i < args.length - 1; i++) {
			if (args[i] === "--listen") return args[i + 1];
		}
	} catch {
		// Not Linux or process gone — fall through to platform defaults.
	}
	if (process.platform === "darwin" && process.env.USER) {
		const root = join(tmpdir(), `nvim.${process.env.USER}`);
		try {
			for (const entry of readdirSync(root)) {
				const socket = join(root, entry, `nvim.${pid}.0`);
				if (existsSync(socket) && nvimAlive(socket)) return socket;
			}
		} catch {
			// No Neovim socket directory — fall through to other defaults.
		}
	}
	const uid = process.getuid?.();
	if (uid === undefined) return undefined;
	const fallback = `/run/user/${uid}/nvim.${pid}.0`;
	return existsSync(fallback) ? fallback : undefined;
}

/** True when the socket answers a trivial remote-expr — i.e. a live nvim. */
function nvimAlive(socket: string): boolean {
	try {
		execFileSync("nvim", ["--server", socket, "--remote-expr", "1"], {
			timeout: RPC_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

/** Sanitize a session key into a buffer-name-safe fragment. */
function safeKey(key: string): string {
	return key.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "session";
}

/**
 * Sanitize a node title into a stable per-node buffer-name fragment. The
 * slug keeps letters, digits, dots, dashes — everything else collapses to
 * single dashes — so `Node E — ROV drop scope` and `Node E — ROV drop  scope`
 * land in the SAME buffer.
 */
export function nodeSlug(node: string): string {
	const slug = node
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.toLowerCase();
	return slug || "node";
}

/** The learner-side buffer name for one node of one session. */
export function nodeBufferName(key: string, node: string): string {
	return `pi-focus://${safeKey(key)}/${nodeSlug(node)}`;
}

/** The learner-side buffer name for a session's overview. */
export function overviewBufferName(key: string): string {
	return `pi-focus://${safeKey(key)}/overview`;
}

interface EditorTarget {
	socket: string;
}

/** Resolve the live editor socket or explain why it is unavailable. */
function resolveEditor(): EditorTarget | { error: string } {
	if (process.env.PI_DISABLE_FOCUS_BUFFER === "1") {
		return { error: "focus buffer disabled (PI_DISABLE_FOCUS_BUFFER=1)" };
	}
	const editor = detectEditorProcess();
	if (!editor) return { error: "no editor pane found" };
	if (editor.name !== "nvim") {
		return { error: "editor pane is not nvim (no RPC socket)" };
	}
	const socket = editorSocketPath(editor.pid);
	if (!socket || !nvimAlive(socket)) {
		return { error: "no live nvim RPC socket for the editor pane" };
	}
	return { socket };
}

/** Run one lua file in the live nvim; returns its remote-expr result. */
function runLua(socket: string, lua: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-focus-"));
	const luaPath = join(dir, "node.lua");
	try {
		writeFileSync(luaPath, lua.join("\n"), "utf-8");
		const expr = `luaeval("load(...)()", join(readfile(${JSON.stringify(luaPath)}), "\\n"))`;
		const out = execFileSync("nvim", ["--server", socket, "--remote-expr", expr], {
			timeout: RPC_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "ignore"],
		});
		return out.toString("utf-8").trim();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Shared lua preamble: create-or-reuse the buffer named `name`, open it in a
 * right-hand split unless a window already shows it. Lines:
 *   "local name = <quoted>" must be FIRST.
 */
function bufferOpenLua(name: string): string[] {
	return [
		`local name = ${JSON.stringify(name)}`,
		"local buf",
		"for _, b in ipairs(vim.api.nvim_list_bufs()) do",
		"  if vim.api.nvim_buf_get_name(b) == name then buf = b break end",
		"end",
		"if not buf then",
		"  buf = vim.api.nvim_create_buf(false, true)",
		"  pcall(vim.api.nvim_buf_set_name, buf, name)",
		"end",
		"local win",
		"for _, w in ipairs(vim.api.nvim_list_wins()) do",
		"  if vim.api.nvim_win_get_buf(w) == buf then win = w break end",
		"end",
		"if not win then",
		'  vim.cmd("rightbelow vertical split")',
		"  win = vim.api.nvim_get_current_win()",
		"  vim.api.nvim_win_set_buf(win, buf)",
		"end",
	];
}

function bufferOptionsLua(): string[] {
	return [
		'vim.bo[buf].buftype = "nofile"',
		'vim.bo[buf].filetype = "markdown"',
		'vim.bo[buf].bufhidden = "hide"',
		"vim.bo[buf].swapfile = false",
		"vim.bo[buf].modifiable = true",
	];
}

/**
 * Show `title` + `body` in the session's buffer named `name`, replacing its
 * whole content and focusing it. Used for per-node lessons and for the
 * overview. `what` names the buffer in the result message.
 */
function showBuffer(
	key: string,
	name: string,
	what: string,
	title: string,
	body: string,
): FocusBufferResult {
	const target = resolveEditor();
	if ("error" in target) return { ok: false, message: target.error };

	const dir = mkdtempSync(join(tmpdir(), "pi-focus-"));
	const contentPath = join(dir, "node.md");
	try {
		const heading = `# ${title.trim()}`;
		writeFileSync(contentPath, `${heading}\n\n${body.trim()}\n`, "utf-8");
		// The lua reads the content from the temp file, so the markdown never
		// has to survive argv or lua-string escaping.
		const result = runLua(target.socket, [
			...bufferOpenLua(name),
			"local lines = {}",
			`local f = io.open(${JSON.stringify(contentPath)}, "r")`,
			"if f then",
			"  for line in f:lines() do lines[#lines + 1] = line end",
			"  f:close()",
			"end",
			'if #lines == 0 then lines = { "" } end',
			...bufferOptionsLua(),
			"vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)",
			"vim.bo[buf].modified = false",
			"vim.api.nvim_win_set_cursor(win, { 1, 0 })",
			'return "ok"',
		]);
		if (result === "ok") {
			return { ok: true, message: `${what} buffer "${title.trim()}" updated` };
		}
		return { ok: false, message: `${what} buffer update failed: ${result || "no result"}` };
	} catch (err: any) {
		return { ok: false, message: `${what} buffer update failed: ${err?.message ?? String(err)}` };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Focus the session's EXISTING buffer named `name` without rewriting its
 * content: cursor to the top, split opened if no window shows it. Returns
 * ok:false when the buffer does not exist yet — the caller decides the
 * fallback (the overview, never the whole journal).
 */
function focusExisting(key: string, name: string, what: string): FocusBufferResult {
	const target = resolveEditor();
	if ("error" in target) return { ok: false, message: target.error };
	try {
		// Pure focus: find the buffer, bail BEFORE any create or split when
		// it does not exist — a missing node must not leave an empty buffer.
		const result = runLua(target.socket, [
			`local name = ${JSON.stringify(name)}`,
			"local buf",
			"for _, b in ipairs(vim.api.nvim_list_bufs()) do",
			"  if vim.api.nvim_buf_get_name(b) == name then buf = b break end",
			"end",
			'if not buf then return "missing" end',
			"local win",
			"for _, w in ipairs(vim.api.nvim_list_wins()) do",
			"  if vim.api.nvim_win_get_buf(w) == buf then win = w break end",
			"end",
			"if not win then",
			'  vim.cmd("rightbelow vertical split")',
			"  win = vim.api.nvim_get_current_win()",
			"  vim.api.nvim_win_set_buf(win, buf)",
			"end",
			"vim.api.nvim_win_set_cursor(win, { 1, 0 })",
			'return "ok"',
		]);
		if (result === "ok") {
			return { ok: true, message: `${what} buffer focused` };
		}
		return { ok: false, message: `no ${what} buffer yet` };
	} catch (err: any) {
		return { ok: false, message: `${what} buffer focus failed: ${err?.message ?? String(err)}` };
	}
}

/**
 * Show one teaching node: creates or updates `pi-focus://<key>/<node-slug>`
 * with the node's content and focuses it. Earlier nodes' buffers persist for
 * nvim-side cycling. Used by the lesson tool.
 */
export function showNodeBuffer(
	key: string,
	node: string,
	title: string,
	body: string,
): FocusBufferResult {
	return showBuffer(key, nodeBufferName(key, node), `node "${node.trim()}"`, title, body);
}

/**
 * Focus the session's existing node buffer without rewriting it. Returns
 * ok:false when that node was never shown — the caller falls back to the
 * overview buffer.
 */
export function focusNodeBuffer(key: string, node: string): FocusBufferResult {
	return focusExisting(key, nodeBufferName(key, node), `node "${node.trim()}"`);
}

/**
 * (Re)build and focus the session's overview buffer with `content` built by
 * md-log from the durable journal. This is the h/ctrl+h view before the
 * first lesson exists, and the fallback when a node buffer is gone (nvim
 * restarted).
 */
export function showOverviewBuffer(key: string, title: string, content: string): FocusBufferResult {
	return showBuffer(key, overviewBufferName(key), "overview", title, content);
}

// pi's extension loader scans every .ts file in this directory and requires
// a default factory. This module is a library consumed by md-log and lesson;
// register nothing, but keep a valid factory so the file loads cleanly.
export default function focusBuffer(_pi: ExtensionAPI) {
	// no commands, no tools, no listeners — see the functions above
}
