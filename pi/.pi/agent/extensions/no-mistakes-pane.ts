import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
	buildPaneScript,
	extractMarkedOutput,
	NM_PANE_TIMEOUT_MS,
} from "./no-mistakes-pane-capture";

// ---------------------------------------------------------------------------
// no-mistakes-pane — run `no-mistakes axi` in a visible Herdr pane beside the
// agent, live, and return the structured TOON result so the agent can keep
// driving the gate.
//
// Mirrors nvim-open.ts (Herdr pane split + run + close) and reuses the marked
// capture machinery from no-mistakes-pane-capture.ts (pattern borrowed from
// run-command-nvim-terminal.ts): stdout is teed to a temp file between
// START/END markers while stderr streams live to the pane, so the captain
// watches the run happen and the agent still gets a clean TOON to parse.
// ---------------------------------------------------------------------------

const HERDR_TIMEOUT_MS = 5000;
const POLL_MS = 250;
const execFileAsync = promisify(execFile);

interface PaneSplitResult {
	result?: { pane?: { pane_id?: string } };
}

function herdrJsonSync(args: string[]): unknown | null {
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

function herdrOkSync(args: string[]): boolean {
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

function getCurrentPane(): { pane_id: string; tab_id: string } | null {
	const res = herdrJsonSync(["pane", "current"]) as
		| { result?: { pane?: { pane_id?: string; tab_id?: string } } }
		| null;
	const pane = res?.result?.pane;
	if (!pane?.pane_id) return null;
	return { pane_id: pane.pane_id, tab_id: pane.tab_id ?? "" };
}

/** Detect the no-mistakes axi subcommand for pane labeling (e.g. "run"). */
function subcommandOf(args: string[]): string {
	const first = args.find((a) => !a.startsWith("-"));
	return first ?? "axi";
}

/**
 * Split a pane to the right of the current one, label it as a no-mistakes run,
 * and launch the capture script. Returns the new pane id, or null if Herdr
 * could not open one. The pane is launched without stealing focus so the
 * agent pane stays active while the captain watches the run beside it.
 *
 * `herdr pane run` types a space-joined command into the pane's shell, so a
 * multiline quoted script would be re-parsed and mangled. We side-step that
 * by writing the script to a temp file and running `bash <file>` — a single
 * token the shell can type verbatim.
 */
function launchNmPane(cwd: string, scriptFile: string, label: string): string | null {
	const split = herdrJsonSync([
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		cwd,
		"--no-focus",
	]) as PaneSplitResult | null;
	const paneId = split?.result?.pane?.pane_id;
	if (!paneId) return null;
	herdrOkSync(["pane", "rename", paneId, `no-mistakes: ${label}`]);
	if (!herdrOkSync(["pane", "run", paneId, "bash", scriptFile])) {
		herdrOkSync(["pane", "close", paneId]);
		return null;
	}
	return paneId;
}

/** Send Ctrl-C then close the pane so a stuck run is always cancellable. */
function cancelPane(paneId: string): void {
	herdrOkSync(["pane", "send-text", paneId, "\x03"]);
	herdrOkSync(["pane", "close", paneId]);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(abortError(signal));
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	}).finally(() => {});
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("no-mistakes pane run cancelled");
}

interface PaneRunResult {
	output: string;
	exitCode: number;
	paneId: string;
	timedOut: boolean;
}

/**
 * Poll the captured stdout file for the END marker until the command
 * completes, the timeout elapses, or the call is aborted. On abort/timeout
 * the pane is cancelled (Ctrl-C + close) and whatever partial stdout was
 * captured is returned.
 */
async function pollNmPane(
	outFile: string,
	token: string,
	paneId: string,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<PaneRunResult> {
	const deadline = Date.now() + timeoutMs;
	try {
		while (true) {
			if (signal.aborted) throw abortError(signal);
			if (existsSync(outFile)) {
				const parsed = extractMarkedOutput(readFileSync(outFile, "utf-8"), token);
				if (parsed.complete) {
					return {
						output: parsed.output ?? "",
						exitCode: parsed.exitCode ?? -1,
						paneId,
						timedOut: false,
					};
				}
			}
			if (Date.now() >= deadline) {
				return { output: partialOutput(outFile, token), exitCode: -1, paneId, timedOut: true };
			}
			await sleep(POLL_MS, signal);
		}
	} catch (err) {
		// Abort during sleep — fall through to partial return.
		if (!signal.aborted) throw err;
		return { output: partialOutput(outFile, token), exitCode: -1, paneId, timedOut: false };
	}
}

function partialOutput(outFile: string, token: string): string {
	if (!existsSync(outFile)) return "";
	const parsed = extractMarkedOutput(readFileSync(outFile, "utf-8"), token);
	return parsed.output ?? "";
}

/**
 * Fallback when Herdr is unavailable (print/rpc/json modes, no TUI): run
 * `no-mistakes axi` inline and return its stdout + exit code directly. Keeps
 * the agent's gate-driving working when the visible pane cannot be opened.
 */
async function runNmInline(args: string[], signal: AbortSignal, timeoutMs: number): Promise<PaneRunResult> {
	try {
		const { stdout } = await execFileAsync("no-mistakes", ["axi", ...args], {
			encoding: "utf-8",
			maxBuffer: 16 * 1024 * 1024,
			signal,
			timeout: timeoutMs,
		});
		return { output: stdout.trim(), exitCode: 0, paneId: "", timedOut: false };
	} catch (err) {
		const e = err as { stdout?: string; code?: number; signal?: string; killed?: boolean };
		if (e.signal === "SIGTERM" || e.killed) {
			throw abortError(signal);
		}
		const out = (e.stdout ?? "").toString().trim();
		return { output: out, exitCode: typeof e.code === "number" ? e.code : -1, paneId: "", timedOut: false };
	}
}

// ---------------------------------------------------------------------------
// quote-aware argument parsing (so the agent can pass --intent "long string")
// ---------------------------------------------------------------------------
function parseArgs(input: string): string[] {
	const args: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (inSingle) {
			if (ch === "'") inSingle = false;
			else current += ch;
		} else if (inDouble) {
			if (ch === '"') inDouble = false;
			else if (ch === "\\" && i + 1 < input.length) current += input[++i];
			else current += ch;
		} else if (ch === "'" && !inDouble) {
			inSingle = true;
		} else if (ch === '"' && !inSingle) {
			inDouble = true;
		} else if (ch === "\\") {
			if (i + 1 < input.length) current += input[++i];
		} else if (/\s/.test(ch)) {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) args.push(current);
	return args;
}

interface NmAxiDetails {
	status: "visible" | "inline" | "cancelled" | "timeout" | "error";
	subcommand: string;
	exitCode?: number;
	paneId?: string;
	output?: string;
	message?: string;
}

function textResult(text: string, details: NmAxiDetails) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

const NoMistakesAxiParams = Type.Object({
	args: Type.String({
		description:
			'Everything after `no-mistakes axi` — the subcommand and its flags, e.g. `run --intent "ship the visible pane feature"` or `respond --action fix --findings r1` or `status`. Quote multi-word values.',
	}),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the pane. Defaults to the agent's cwd.",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: "Max wall-clock seconds for this axi call. Defaults to 1800 (30 min); axi run/respond can block for several minutes at a step.",
		}),
	),
});

export default function noMistakesPane(pi: ExtensionAPI) {
	pi.registerTool({
		name: "no_mistakes_axi",
		label: "no-mistakes (visible pane)",
		description:
			"Run a `no-mistakes axi` subcommand (run/respond/status/logs/abort/sync/home) in a visible Herdr pane beside the agent pane, live, and return the structured TOON result the agent drives the gate on. Use this INSTEAD of running `no-mistakes axi` in the bash tool so the captain can watch the pipeline run. The pane shows progress live; the agent receives the same TOON (findings, gate, outcome, branch_sync, help) it would have read from bash stdout, plus the exit code. Falls back to an inline run when no TUI/Herdr is available.",
		promptSnippet:
			"Use no_mistakes_axi (not bash) to drive every no-mistakes axi call so the run is visible in a Herdr pane beside the agent.",
		promptGuidelines: [
			"Pass `args` = everything after `no-mistakes axi` (e.g. `run --intent \"...\"`, `respond --action fix --findings r1`, `status`). Quote multi-word values.",
			"The command opens in a Herdr pane to the right of the agent and runs visibly; you still receive the structured TOON result to drive the gate (read every return; on a gate:, respond; loop until an outcome:).",
			"axi run and axi respond block for several minutes at review/test/CI steps — that is normal; do not cancel or re-issue because it seems slow. Allow a long timeout.",
			"If a return has no parseable TOON (cancelled/timeout), the tool says so explicitly; use `no-mistakes axi status` via this same tool to inspect, or re-drive.",
			"ask-user findings are never yours to resolve — escalate per the no-mistakes skill; this tool only changes the invocation surface, not gate authority.",
		],
		parameters: NoMistakesAxiParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const rawArgs = (params.args ?? "").trim();
			if (!rawArgs) {
				return textResult("no_mistakes_axi requires non-empty `args` (e.g. `status`).", {
					status: "error",
					subcommand: "",
					message: "empty args",
				});
			}
			const args = parseArgs(rawArgs);
			const subcommand = subcommandOf(args);
			const cwd = params.cwd ?? ctx?.cwd ?? process.cwd();
			const timeoutMs = (params.timeoutMs ?? NM_PANE_TIMEOUT_MS / 1000) * 1000;
			const sig = signal ?? new AbortController().signal;

			const hasUI = (ctx as { hasUI?: boolean })?.hasUI ?? false;
			const current = hasUI ? getCurrentPane() : null;

			// No TUI / no Herdr — fall back to an inline run so gate-driving still works.
			if (!current) {
				const result = await runNmInline(args, sig, timeoutMs).catch((err) => {
					return { output: "", exitCode: -1, paneId: "", timedOut: false, error: err };
				});
				if ((result as { error?: Error }).error) {
					return textResult(
						`no-mistakes axi ${subcommand} was cancelled or failed inline: ${(result as { error: Error }).error.message}`,
						{ status: "cancelled", subcommand, message: "inline run cancelled" },
					);
				}
				const r = result as PaneRunResult;
				const text = formatOutput(r.output, r.exitCode, "inline");
				return textResult(text, {
					status: "inline",
					subcommand,
					exitCode: r.exitCode,
					output: r.output,
				});
			}

			// Visible-pane path.
			const token = randomUUID().replace(/-/g, "");
			const outFile = `${tmpdir()}/pi-nm-${token}.out`;
			const scriptFile = `${tmpdir()}/pi-nm-${token}.sh`;
			writeFileSync(outFile, "");
			writeFileSync(scriptFile, buildPaneScript(args, token, outFile));
			const paneId = launchNmPane(cwd, scriptFile, `axi ${subcommand}`);
			if (!paneId) {
				// Herdr was present but the split/launch failed — fall back to inline.
				unlinkSafe(outFile);
				unlinkSafe(scriptFile);
				const r = await runNmInline(args, sig, timeoutMs);
				const text = formatOutput(r.output, r.exitCode, "inline (pane launch failed)");
				return textResult(text, {
					status: "inline",
					subcommand,
					exitCode: r.exitCode,
					output: r.output,
					message: "Herdr pane launch failed; ran inline",
				});
			}

			try {
				const r = await pollNmPane(outFile, token, paneId, sig, timeoutMs);
				if (r.timedOut) {
					cancelPane(paneId);
					const text = formatOutput(r.output, r.exitCode, "timeout");
					return textResult(
						`no-mistakes axi ${subcommand} timed out after ${timeoutMs / 1000}s; pane cancelled.\n${text}`,
						{ status: "timeout", subcommand, exitCode: r.exitCode, paneId, output: r.output, message: "timed out" },
					);
				}
				const text = formatOutput(r.output, r.exitCode, "visible");
				return textResult(text, {
					status: "visible",
					subcommand,
					exitCode: r.exitCode,
					paneId,
					output: r.output,
				});
			} catch (err) {
				cancelPane(paneId);
				const partial = partialOutput(outFile, token);
				const text = formatOutput(partial, -1, "cancelled");
				return textResult(
					`no-mistakes axi ${subcommand} was cancelled; pane closed.\n${text}`,
					{
						status: "cancelled",
						subcommand,
						paneId,
						output: partial,
						message: err instanceof Error ? err.message : "cancelled",
					},
				);
			} finally {
				unlinkSafe(outFile);
				unlinkSafe(scriptFile);
				// Best-effort: ensure no dead pane lingers if it did not self-close.
				herdrOkSync(["pane", "close", paneId]);
			}
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("no-mistakes ")) +
					theme.fg("muted", `axi ${String(args.args ?? "")}`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as NmAxiDetails | undefined;
			const first = result.content[0];
			const text = first?.type === "text" ? first.text : "";
			if (!details) {
				return new Text(text, 0, 0);
			}
			const head = theme.fg("toolTitle", theme.bold(`no-mistakes axi ${details.subcommand}`));
			const tag = details.status === "visible"
				? theme.fg("success", " (visible pane)")
				: details.status === "inline"
					? theme.fg("muted", " (inline)")
					: theme.fg("warning", ` (${details.status})`);
			return new Text(`${head}${tag}\n${text}`, 0, 0);
		},
	});
}

function formatOutput(output: string, exitCode: number, mode: string): string {
	const header = `[no-mistakes axi — ${mode}, exit ${exitCode}]`;
	if (!output) return `${header}\n(no structured output captured)`;
	return `${header}\n${output}`;
}

function unlinkSafe(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// best-effort
	}
}
