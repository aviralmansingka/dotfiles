import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectEditorProcess } from "./nvim-open";

// ────────────────────────────────────────────────────────────────────────────
// focus-buffer — the learner's node view.
//
// A named scratch buffer (buftype=nofile, never written to disk) inside the
// running nvim editor pane. It holds ONLY the current teaching node: each
// `lesson` call replaces its whole content, so the side pane always shows the
// node the active quiz/explain is about — not the full journal. The durable
// record still lives in the session journal (md-log); this buffer is the
// ephemeral "what am I being asked about right now" view.
//
// Mechanism (same as the nvimr skill): resolve the editor pane's nvim RPC
// socket, then run a lua file remotely via
//   nvim --server SOCK --remote-expr 'luaeval("load(...)()", join(readfile(F), "\n"))'
// The lua creates-or-reuses the buffer, opens it in a right-hand split, and
// sets its lines from a temp content file.
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
 * Show `title` + `body` as the current node in the learner's focus buffer.
 * `key` scopes the buffer per session (usually the journal path stem) so
 * concurrent sessions never share a buffer. Falls back with ok:false —
 * the caller then opens the journal file instead.
 */
export function showNodeBuffer(
	key: string,
	title: string,
	body: string,
): FocusBufferResult {
	// Hard off-switch for tests and headless runs: never touch a live editor
	// pane from a non-interactive context.
	if (process.env.PI_DISABLE_FOCUS_BUFFER === "1") {
		return { ok: false, message: "focus buffer disabled (PI_DISABLE_FOCUS_BUFFER=1)" };
	}
	const editor = detectEditorProcess();
	if (!editor) return { ok: false, message: "no editor pane found" };
	if (editor.name !== "nvim") {
		return { ok: false, message: "editor pane is not nvim (no RPC socket)" };
	}
	const socket = editorSocketPath(editor.pid);
	if (!socket || !nvimAlive(socket)) {
		return { ok: false, message: "no live nvim RPC socket for the editor pane" };
	}

	const dir = mkdtempSync(join(tmpdir(), "pi-focus-"));
	const contentPath = join(dir, "node.md");
	const luaPath = join(dir, "node.lua");
	try {
		const heading = `# ${title.trim()}`;
		writeFileSync(contentPath, `${heading}\n\n${body.trim()}\n`, "utf-8");
		// The lua reads the content from the temp file, so the markdown never
		// has to survive argv or lua-string escaping.
		writeFileSync(
			luaPath,
			[
				`local name = "pi-focus://${safeKey(key)}"`,
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
				"local lines = {}",
				`local f = io.open(${JSON.stringify(contentPath)}, "r")`,
				"if f then",
				"  for line in f:lines() do lines[#lines + 1] = line end",
				"  f:close()",
				"end",
				'if #lines == 0 then lines = { "" } end',
				'vim.bo[buf].buftype = "nofile"',
				'vim.bo[buf].filetype = "markdown"',
				'vim.bo[buf].bufhidden = "hide"',
				"vim.bo[buf].swapfile = false",
				"vim.bo[buf].modifiable = true",
				"vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)",
				"vim.bo[buf].modified = false",
				"vim.api.nvim_win_set_cursor(win, { 1, 0 })",
				'return "ok"',
			].join("\n"),
			"utf-8",
		);
		// load(...)() is the only reliable way to run a multi-line lua file
		// through --remote-expr (same trick as the nvimr skill).
		const expr = `luaeval("load(...)()", join(readfile(${JSON.stringify(luaPath)}), "\\n"))`;
		execFileSync("nvim", ["--server", socket, "--remote-expr", expr], {
			timeout: RPC_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "ignore"],
		});
		return { ok: true, message: `node buffer "${title.trim()}" updated` };
	} catch (err: any) {
		return { ok: false, message: `node buffer update failed: ${err?.message ?? String(err)}` };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Focus the session's existing node buffer WITHOUT rewriting its content.
 * The buffer holds whatever the most recent `lesson` call showed. If a
 * window already displays it, the cursor just returns to the top; otherwise
 * it opens in a right-hand split. Returns ok:false when no buffer exists
 * yet for this session (no lesson has been presented) — the caller then
 * falls back to the journal file.
 */
export function focusNodeBuffer(key: string): FocusBufferResult {
	if (process.env.PI_DISABLE_FOCUS_BUFFER === "1") {
		return { ok: false, message: "focus buffer disabled (PI_DISABLE_FOCUS_BUFFER=1)" };
	}
	const editor = detectEditorProcess();
	if (!editor) return { ok: false, message: "no editor pane found" };
	if (editor.name !== "nvim") {
		return { ok: false, message: "editor pane is not nvim (no RPC socket)" };
	}
	const socket = editorSocketPath(editor.pid);
	if (!socket || !nvimAlive(socket)) {
		return { ok: false, message: "no live nvim RPC socket for the editor pane" };
	}

	const dir = mkdtempSync(join(tmpdir(), "pi-focus-"));
	const luaPath = join(dir, "node.lua");
	try {
		writeFileSync(
			luaPath,
			[
				`local name = "pi-focus://${safeKey(key)}"`,
				"local buf",
				"for _, b in ipairs(vim.api.nvim_list_bufs()) do",
				"  if vim.api.nvim_buf_get_name(b) == name then buf = b break end",
				"end",
				"if not buf then return \"missing\" end",
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
			].join("\n"),
			"utf-8",
		);
		const expr = `luaeval("load(...)()", join(readfile(${JSON.stringify(luaPath)}), "\\n"))`;
		const out = execFileSync("nvim", ["--server", socket, "--remote-expr", expr], {
			timeout: RPC_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "ignore"],
		});
		const result = out.toString("utf-8").trim();
		if (result === "ok") {
			return { ok: true, message: `node buffer "${safeKey(key)}" focused` };
		}
		return { ok: false, message: `no node buffer yet for this session (lesson not presented)` };
	} catch (err: any) {
		return { ok: false, message: `node buffer focus failed: ${err?.message ?? String(err)}` };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// pi's extension loader scans every .ts file in this directory and requires
// a default factory. This module is a library consumed by md-log and lesson;
// register nothing, but keep a valid factory so the file loads cleanly.
export default function focusBuffer(_pi: ExtensionAPI) {
	// no commands, no tools, no listeners — see showNodeBuffer above
}
