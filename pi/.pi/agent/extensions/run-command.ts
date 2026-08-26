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
// the HANDS: the agent presents ONE command with a grounded prediction, the
// user runs it in their own terminal, and pastes the output back. The agent
// never executes the command — the user types everything, which is the point.
//
// UI: a floating panel above the prompt shows the command (and optional
// context/prediction). Pressing `y` yanks the command to the system clipboard
// as-is. The user runs it elsewhere, returns, types/pastes the output into the
// response field (Tab to focus), and submits. On submit, the command and the
// user's pasted output travel together so the agent grades output vs.
// prediction without ever having seen the terminal.
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
	paneId: string;
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

async function waitForTerminalJob(socket: string, signal: AbortSignal): Promise<void> {
	const deadline = Date.now() + NVIM_START_TIMEOUT_MS;
	while (Date.now() <= deadline) {
		const job = await nvimExpr(socket, "exists('b:terminal_job_id') ? b:terminal_job_id : 0", signal).catch(() => "0");
		if (Number.parseInt(job.trim(), 10) > 0) return;
		await sleep(POLL_MS, signal);
	}
	throw new Error("Timed out waiting for `:term dm` terminal job");
}

async function readNvimBuffer(socket: string, signal: AbortSignal): Promise<string> {
	return nvimExpr(socket, luaEval('table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n")'), signal);
}

async function runViaNvimTerminal(
	cwd: string,
	command: string,
	signal: AbortSignal | undefined,
	onProgress: (message: string) => void,
): Promise<NvimRunResult> {
	const timeout = withTimeout(signal, NVIM_RUN_TIMEOUT_MS);
	const runSignal = timeout.signal;
	let paneId: string | undefined;
	// Keep the RPC socket path short: UNIX domain sockets cap at ~103 bytes
	// (sun_path[104] minus NUL), and macOS' /var/folders/.../T tmpdir is already
	// ~48 bytes, so a `pi-run-command-<uuid>.sock` name blows the limit and
	// `nvim --listen` silently fails to create the socket. Use a short prefix
	// and a hyphen-less hex token so the full path stays well under the cap.
	const socket = `${tmpdir()}/pi-rc-${randomUUID().replace(/-/g, "")}.sock`;
	const token = randomUUID().replace(/-/g, "");
	// Capture command stdout+stderr to a temp file and read it back via fs once
	// the END marker fires. We do not scrape the echoed terminal buffer for
	// output: the terminal driver echoes the bulk-pasted wrapper before the
	// shell runs it, so buffer scraping corrupts the captured text.
	const outputFile = `${tmpdir()}/pi-rc-out-${token}.txt`;
	try {
		onProgress("Opening Neovim terminal pane…");
		const split = await herdrJson(["pane", "split", "--current", "--direction", "right", "--cwd", cwd, "--focus"], runSignal);
		paneId = split?.result?.pane?.pane_id;
		if (!paneId) throw new Error("Could not open a Herdr pane for Neovim");
		const launched = await herdrOk(["pane", "run", paneId, "nvim", "--listen", socket, "-n", "+term dm", "+startinsert"], runSignal);
		if (!launched) throw new Error("Could not launch Neovim in the new pane");

		onProgress("Starting `:term dm`…");
		await waitForSocket(socket, runSignal);
		await waitForTerminalJob(socket, runSignal);

		onProgress("Running command in the Neovim terminal…");
		const script = buildNvimTerminalScript(command, token, outputFile);
		await nvimExpr(socket, luaEval("vim.api.nvim_chan_send(vim.b.terminal_job_id, _A)", script), runSignal);

		onProgress(`Waiting for output (timeout ${NVIM_RUN_TIMEOUT_MS / 1000}s)…`);
		while (true) {
			const parsed = extractMarkedOutput(await readNvimBuffer(socket, runSignal), token);
			if (parsed.complete) {
				let output = "";
				try {
					output = readFileSync(outputFile, "utf8");
				} catch {
					output = "";
				}
				return { output: output.trim(), exitCode: parsed.exitCode ?? -1, paneId };
			}
			await sleep(POLL_MS, runSignal);
		}
	} finally {
		timeout.cleanup();
		if (paneId) await herdrOk(["pane", "close", paneId], new AbortController().signal).catch(() => false);
		rmSync(outputFile, { force: true });
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
				const t = editor.getText().trim();
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
						theme.fg("dim", "y — copy · r — run in Neovim :term dm and auto-capture · paste output below"),
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

					// Unfocused: y yanks the command as-is, r runs it via Neovim, Tab focuses the field.
					if (data === "y") {
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
			"Have the user run ONE command hands-on and report what they saw. A floating panel shows the command; y copies it for the manual terminal workflow, and r opens a Neovim terminal pane with `:term dm`, runs the command there, and captures output automatically. You receive the command and observed output together — grade output vs. prediction.",
		promptSnippet:
			"Use run-command to have the user execute one command hands-on (with a grounded prediction); they can paste output manually or press r for Neovim-terminal auto-capture.",
		promptGuidelines: [
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
