import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
	buildAttachScript,
	buildBackgroundScript,
	buildPaneScript,
	extractMarkedOutput,
	hasStartMarker,
	NM_PANE_TIMEOUT_MS,
	wantsTuiPane,
} from "./no-mistakes-pane/capture";
import {
	isObservableNoMistakesRun,
	observeNoMistakesTiming,
	parseNoMistakesStatus,
	phaseProgress,
	summarizeNoMistakesSnapshot,
	type NoMistakesSnapshot,
} from "./no-mistakes-pane/status";

// ---------------------------------------------------------------------------
// no-mistakes-pane — run `no-mistakes axi` in a visible Herdr pane beside the
// agent, live, and return the structured TOON result so the agent can keep
// driving the gate.
//
// Mirrors nvim-open.ts (Herdr pane split + run + close) and reuses the marked
// capture machinery from no-mistakes-pane/capture.ts (pattern borrowed from
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

/** Cached result of `no-mistakes attach --help` — true when this no-mistakes
 *  build has the `attach` subcommand at all. Help is a local cobra call that
 *  does not touch the daemon run state, so checking it is daemon-safe. */
let attachAvailableCache: boolean | undefined;
function attachAvailable(): boolean {
	if (attachAvailableCache !== undefined) return attachAvailableCache;
	try {
		execFileSync("no-mistakes", ["attach", "--help"], {
			timeout: HERDR_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
		});
		attachAvailableCache = true;
	} catch {
		attachAvailableCache = false;
	}
	return attachAvailableCache;
}

/** Spawn a detached background bash script (the axi capture driver) that
 *  survives this tool call. Returns its process-group pid for cleanup, or
 *  null if the spawn failed. */
function spawnBackground(scriptFile: string, cwd: string): number | null {
	try {
		const child = spawn("bash", [scriptFile], {
			cwd,
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return child.pid ?? null;
	} catch {
		return null;
	}
}

/** Send SIGINT to the background script's process group (mirrors the Ctrl-C
 *  the text pane sends to an in-pane axi run), then best-effort kill the pid.
 *  This disconnects the axi client; it never restarts the shared daemon. */
function killBackground(pid: number): void {
	try {
		process.kill(-pid, "SIGINT");
	} catch {
		/* process group may already be gone */
	}
	try {
		process.kill(pid, "SIGINT");
	} catch {
		/* pid may already be gone */
	}
}

/** Poll the capture file for the START marker so we know the background axi
 *  run actually began (and did not fail to spawn) before we attach a TUI to
 *  it. Bounded by `timeoutMs` so a spawn failure falls back quickly. */
async function waitForStart(
	outFile: string,
	token: string,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		if (signal.aborted) return false;
		if (existsSync(outFile) && hasStartMarker(readFileSync(outFile, "utf-8"), token)) {
			return true;
		}
		if (Date.now() >= deadline) return false;
		await sleep(POLL_MS, signal).catch(() => {});
	}
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

type InlineRun = { cancelled: true; error: Error } | { cancelled: false; result: PaneRunResult };

async function runNmInlineSafe(
	args: string[],
	signal: AbortSignal,
	timeoutMs: number,
): Promise<InlineRun> {
	try {
		return { cancelled: false, result: await runNmInline(args, signal, timeoutMs) };
	} catch (err) {
		return { cancelled: true, error: err instanceof Error ? err : new Error(String(err)) };
	}
}

/** Attach-pane retry budget: 240 tries × 0.5s = up to 2min of startup-race
 *  retries. Once `no-mistakes attach` attaches it blocks for the whole run
 *  (up to NM_PANE_TIMEOUT_MS), so the loop count only advances on failed
 *  attach attempts, not while the TUI is live. */
const ATTACH_MAX_TRIES = 240;
const ATTACH_INTERVAL_SEC = "0.5";
/** How long to wait for the background axi run to print its START marker
 *  before deciding the spawn failed and falling back to the text pane. */
const START_WAIT_MS = 3000;

type TuiPaneOutcome =
	| { fallback: true }
	| { result: PaneRunResult; cancelled?: boolean; message?: string };

/**
 * TUI-pane path (run/respond): run `no-mistakes axi <args>` detached in the
 * background so it drives the daemon run and captures the TOON to a marked
 * temp file, while `no-mistakes attach` runs in the visible Herdr pane so the
 * captain watches the rich TUI of that same run. Returns the captured result
 * (same shape as the text pane), or `{ fallback: true }` when the background
 * run could not start or the pane could not be opened — in which case the
 * caller falls back to the current text-pane behavior. Never restarts the
 * shared daemon; on timeout/abort only the detached axi client is signaled.
 */
async function runTuiPane(
	args: string[],
	subcommand: string,
	cwd: string,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<TuiPaneOutcome> {
	const token = randomUUID().replace(/-/g, "");
	const outFile = `${tmpdir()}/pi-nm-${token}.out`;
	const errFile = `${tmpdir()}/pi-nm-${token}.err`;
	const doneFile = `${tmpdir()}/pi-nm-${token}.done`;
	const bgScript = `${tmpdir()}/pi-nm-${token}.bg.sh`;
	const attachScript = `${tmpdir()}/pi-nm-${token}.attach.sh`;
	writeFileSync(outFile, "");
	writeFileSync(bgScript, buildBackgroundScript(args, token, outFile, errFile, doneFile));
	writeFileSync(attachScript, buildAttachScript(doneFile, ATTACH_MAX_TRIES, ATTACH_INTERVAL_SEC));

	const bgPid = spawnBackground(bgScript, cwd);
	if (!bgPid) {
		unlinkSafe(outFile);
		unlinkSafe(bgScript);
		unlinkSafe(attachScript);
		return { fallback: true };
	}

	// Wait for the background axi run to begin before attaching the TUI, so
	// `no-mistakes attach` finds an active run to attach to.
	const started = await waitForStart(outFile, token, START_WAIT_MS, signal);
	if (!started) {
		killBackground(bgPid);
		unlinkSafe(outFile);
		unlinkSafe(errFile);
		unlinkSafe(doneFile);
		unlinkSafe(bgScript);
		unlinkSafe(attachScript);
		return { fallback: true };
	}

	const paneId = launchNmPane(cwd, attachScript, `attach ${subcommand}`);
	if (!paneId) {
		killBackground(bgPid);
		unlinkSafe(outFile);
		unlinkSafe(errFile);
		unlinkSafe(doneFile);
		unlinkSafe(bgScript);
		unlinkSafe(attachScript);
		return { fallback: true };
	}

	try {
		const r = await pollNmPane(outFile, token, paneId, signal, timeoutMs);
		if (r.timedOut) {
			cancelPane(paneId);
			killBackground(bgPid);
		}
		return { result: r };
	} catch (err) {
		cancelPane(paneId);
		killBackground(bgPid);
		const partial = partialOutput(outFile, token);
		return {
			result: { output: partial, exitCode: -1, paneId, timedOut: false },
			cancelled: true,
			message: err instanceof Error ? err.message : "cancelled",
		};
	} finally {
		unlinkSafe(outFile);
		unlinkSafe(errFile);
		unlinkSafe(doneFile);
		unlinkSafe(bgScript);
		unlinkSafe(attachScript);
		herdrOkSync(["pane", "close", paneId]);
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

interface NmPipelineProgress {
	kind: "pipeline";
	status: "running" | "completed" | "failed";
	startedAt: number;
	completedAt?: number;
	output: string;
	recentTools: ReturnType<typeof phaseProgress>;
}

interface NmAxiDetails {
	status: "visible" | "inline" | "cancelled" | "timeout" | "error";
	subcommand: string;
	exitCode?: number;
	paneId?: string;
	output?: string;
	message?: string;
	progress?: NmPipelineProgress;
	snapshot?: NoMistakesSnapshot;
}

const NM_ACTIVITY_UPDATE_EVENT = "no-mistakes:activity-update";
const STATUS_POLL_MS = 1000;
const STATUS_TIMEOUT_MS = 5000;
const STATUS_INTERVAL_KEY = Symbol.for("pi-no-mistakes/status-interval");
const STATUS_ABORT_KEY = Symbol.for("pi-no-mistakes/status-abort-controller");

{
	const previousInterval = (globalThis as any)[STATUS_INTERVAL_KEY];
	if (previousInterval) clearInterval(previousInterval);
	const previousAbort = (globalThis as any)[STATUS_ABORT_KEY] as AbortController | undefined;
	previousAbort?.abort();
	(globalThis as any)[STATUS_INTERVAL_KEY] = undefined;
	(globalThis as any)[STATUS_ABORT_KEY] = undefined;
}

function pipelineProgress(
	snapshot: NoMistakesSnapshot,
	status: NmPipelineProgress["status"],
	startedAt: number,
): NmPipelineProgress {
	return {
		kind: "pipeline",
		status,
		startedAt,
		...(status === "running" ? {} : { completedAt: Date.now() }),
		output: summarizeNoMistakesSnapshot(snapshot),
		recentTools: phaseProgress(snapshot),
	};
}

function textResult(text: string, details: NmAxiDetails) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

interface NmToolObserver {
	startedAt: number;
	subcommand: string;
	cwd: string;
	snapshot?: NoMistakesSnapshot;
	refresh?: Promise<void>;
	onUpdate: (result: ReturnType<typeof textResult>) => void;
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
	let monitorTimer: ReturnType<typeof setInterval> | undefined;
	let monitorController: AbortController | undefined;
	let monitorGeneration = 0;
	let pollingStatus = false;
	let queuedRefresh: {
		cwd: string;
		generation: number;
		resolve: Array<() => void>;
	} | undefined;
	let latestSnapshot: NoMistakesSnapshot | undefined;
	const toolObservers = new Map<string, NmToolObserver>();

	const publishSnapshot = (snapshot: NoMistakesSnapshot | undefined) => {
		const observedSnapshot = snapshot
			? observeNoMistakesTiming(snapshot, latestSnapshot)
			: undefined;
		latestSnapshot = isObservableNoMistakesRun(observedSnapshot) ? observedSnapshot : undefined;
		pi.events.emit(NM_ACTIVITY_UPDATE_EVENT, {
			snapshot: latestSnapshot
				? { ...latestSnapshot, summary: summarizeNoMistakesSnapshot(latestSnapshot) }
				: undefined,
			observedAt: Date.now(),
		});
		if (!observedSnapshot) return;
		for (const observer of toolObservers.values()) {
			observer.snapshot = observedSnapshot;
			observer.onUpdate(
				textResult(summarizeNoMistakesSnapshot(observedSnapshot), {
					status: "visible",
					subcommand: observer.subcommand,
					progress: pipelineProgress(observedSnapshot, "running", observer.startedAt),
					snapshot: observedSnapshot,
				}),
			);
		}
	};

	const refreshStatus = async (
		ctx: { cwd: string },
		expectedGeneration = monitorGeneration,
		queueIfBusy = false,
	): Promise<void> => {
		if (expectedGeneration !== monitorGeneration) return;
		if (pollingStatus) {
			if (!queueIfBusy) return;
			return new Promise<void>((resolve) => {
				if (queuedRefresh?.generation === expectedGeneration && queuedRefresh.cwd === ctx.cwd) {
					queuedRefresh.resolve.push(resolve);
				} else {
					queuedRefresh?.resolve.forEach((done) => done());
					queuedRefresh = { cwd: ctx.cwd, generation: expectedGeneration, resolve: [resolve] };
				}
			});
		}
		pollingStatus = true;
		const controller = new AbortController();
		monitorController = controller;
		(globalThis as any)[STATUS_ABORT_KEY] = controller;
		try {
			const result = await pi.exec("no-mistakes", ["axi", "status"], {
				cwd: ctx.cwd,
				signal: controller.signal,
				timeout: STATUS_TIMEOUT_MS,
			});
			if (!controller.signal.aborted && expectedGeneration === monitorGeneration && result.code === 0) {
				publishSnapshot(parseNoMistakesStatus(result.stdout));
			}
		} catch {
		} finally {
			if (monitorController === controller) monitorController = undefined;
			if ((globalThis as any)[STATUS_ABORT_KEY] === controller) {
				(globalThis as any)[STATUS_ABORT_KEY] = undefined;
			}
			pollingStatus = false;
			const queued = queuedRefresh;
			queuedRefresh = undefined;
			if (!controller.signal.aborted && queued?.generation === monitorGeneration) {
				void refreshStatus({ cwd: queued.cwd }, queued.generation)
					.finally(() => queued.resolve.forEach((done) => done()));
			} else {
				queued?.resolve.forEach((done) => done());
			}
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const generation = ++monitorGeneration;
		void refreshStatus(ctx, generation);
		monitorTimer = setInterval(() => void refreshStatus(ctx, generation), STATUS_POLL_MS);
		(globalThis as any)[STATUS_INTERVAL_KEY] = monitorTimer;
		monitorTimer.unref?.();
	});

	pi.on("session_shutdown", () => {
		monitorGeneration++;
		monitorController?.abort();
		if ((globalThis as any)[STATUS_ABORT_KEY] === monitorController) {
			(globalThis as any)[STATUS_ABORT_KEY] = undefined;
		}
		monitorController = undefined;
		pollingStatus = false;
		queuedRefresh?.resolve.forEach((done) => done());
		queuedRefresh = undefined;
		if (monitorTimer) clearInterval(monitorTimer);
		if ((globalThis as any)[STATUS_INTERVAL_KEY] === monitorTimer) {
			(globalThis as any)[STATUS_INTERVAL_KEY] = undefined;
		}
		monitorTimer = undefined;
		toolObservers.clear();
		publishSnapshot(undefined);
	});

	pi.registerTool({
		name: "no_mistakes_axi",
		label: "no-mistakes (visible pane)",
		description:
			"Drive a `no-mistakes axi` subcommand (run/respond/status/logs/abort/sync) and return the structured TOON result the agent drives the gate on. Use this INSTEAD of running `no-mistakes axi` in the bash tool so the captain can watch the pipeline. For `run`/`respond`, the visible Herdr pane shows the rich `no-mistakes` TUI (`no-mistakes attach`) of the same daemon run the axi call is driving; for quick inspections (status/logs/sync/abort) the pane shows the raw axi text. In either case the agent receives the same structured TOON (findings, gate, outcome, branch_sync, help) plus the exit code, and drives the gate exactly as if it had read bash stdout. Falls back to the current text pane when `attach` is unavailable, and to an inline run when no TUI/Herdr is available.",
		promptSnippet:
			"Use no_mistakes_axi (not bash) to drive every no-mistakes axi call so the run is visible in a Herdr pane beside the agent.",
		promptGuidelines: [
			"Pass `args` = everything after `no-mistakes axi` (e.g. `run --intent \"...\"`, `respond --action fix --findings r1`, `status`). Quote multi-word values.",
			"The command opens in a Herdr pane to the right of the agent and runs visibly; for `run`/`respond` the pane shows the `no-mistakes` TUI (`no-mistakes attach`), and for other subcommands it shows the raw axi text. Either way you still receive the structured TOON result to drive the gate (read every return; on a gate:, respond; loop until an outcome:).",
			"axi run and axi respond block for several minutes at review/test/CI steps — that is normal; do not cancel or re-issue because it seems slow. Allow a long timeout.",
			"If a return has no parseable TOON (cancelled/timeout), the tool says so explicitly; use `no-mistakes axi status` via this same tool to inspect, or re-drive.",
			"ask-user findings are never yours to resolve — escalate per the no-mistakes skill; this tool only changes the invocation surface, not gate authority.",
		],
		parameters: NoMistakesAxiParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const startedAt = Date.now();
			const observerId = typeof toolCallId === "string" ? toolCallId : randomUUID();
			let pipelineCall = false;
			let observesSession = false;
			const finishText = async (text: string, details: NmAxiDetails) => {
				const observer = toolObservers.get(observerId);
				const failed = details.status === "cancelled" || details.status === "timeout" || details.status === "error" ||
					(details.exitCode != null && details.exitCode !== 0);
				const outputSnapshot = pipelineCall && observesSession && details.output
					? parseNoMistakesStatus(details.output)
					: undefined;
				if (pipelineCall && observesSession && observer && !outputSnapshot) {
					await observer.refresh;
					await refreshStatus({ cwd: observer.cwd }, monitorGeneration, true);
				}
				const observedSnapshot = observer?.snapshot;
				toolObservers.delete(observerId);
				const parsed = pipelineCall && observesSession
					? outputSnapshot ?? observedSnapshot ?? latestSnapshot
					: undefined;
				return textResult(text, {
					...details,
					...(parsed
						? {
							progress: pipelineProgress(parsed, failed ? "failed" : "completed", startedAt),
							snapshot: parsed,
						}
						: {}),
				});
			};

			const rawArgs = (params.args ?? "").trim();
			if (!rawArgs) {
				return finishText("no_mistakes_axi requires non-empty `args` (e.g. `status`).", {
					status: "error",
					subcommand: "",
					message: "empty args",
				});
			}
			const args = parseArgs(rawArgs);
			const subcommand = subcommandOf(args);
			pipelineCall = wantsTuiPane(args, subcommand);
			const sessionCwd = ctx?.cwd ?? process.cwd();
			const cwd = params.cwd ?? sessionCwd;
			observesSession = resolve(cwd) === resolve(sessionCwd);
			const timeoutMs = (params.timeoutMs ?? NM_PANE_TIMEOUT_MS / 1000) * 1000;
			const sig = signal ?? new AbortController().signal;
			if (observesSession && pipelineCall) {
				const observer: NmToolObserver = {
					startedAt,
					subcommand,
					cwd,
					snapshot: latestSnapshot,
					onUpdate: onUpdate ?? (() => {}),
				};
				toolObservers.set(observerId, observer);
				observer.refresh = refreshStatus({ cwd }, monitorGeneration, true);
			}

			const hasUI = (ctx as { hasUI?: boolean })?.hasUI ?? false;
			const current = hasUI ? getCurrentPane() : null;

			// No TUI / no Herdr — fall back to an inline run so gate-driving still works.
			if (!current) {
				const ran = await runNmInlineSafe(args, sig, timeoutMs);
				if (ran.cancelled) {
					return finishText(
						`no-mistakes axi ${subcommand} was cancelled or failed inline: ${ran.error.message}`,
						{ status: "cancelled", subcommand, message: "inline run cancelled" },
					);
				}
				const r = ran.result;
				const text = formatOutput(r.output, r.exitCode, "inline");
				return finishText(text, {
					status: "inline",
					subcommand,
					exitCode: r.exitCode,
					output: r.output,
				});
			}

			// Visible-pane path.
			//
			// run/respond get the rich `no-mistakes attach` TUI in the visible pane
			// while the axi capture runs detached in the background and the agent
			// still reads the marked TOON to drive the gate. Falls back to the
			// text-pane path below if `attach` is unavailable or the background run
			// cannot start — the gate must never fail because the TUI could not be
			// shown. status/logs/sync/abort keep the text pane (attaching a TUI to
			// a status query does not make sense).
			if (wantsTuiPane(args, subcommand) && attachAvailable()) {
				const tui = await runTuiPane(args, subcommand, cwd, sig, timeoutMs);
				if (!("fallback" in tui)) {
					const r = tui.result;
					if (tui.cancelled) {
						const text = formatOutput(r.output, r.exitCode, "cancelled");
						return finishText(
							`no-mistakes axi ${subcommand} was cancelled; TUI pane closed.\n${text}`,
							{ status: "cancelled", subcommand, paneId: r.paneId, output: r.output, message: tui.message },
						);
					}
					if (r.timedOut) {
						const text = formatOutput(r.output, r.exitCode, "timeout");
						return finishText(
							`no-mistakes axi ${subcommand} timed out after ${timeoutMs / 1000}s; TUI pane cancelled.\n${text}`,
							{ status: "timeout", subcommand, exitCode: r.exitCode, paneId: r.paneId, output: r.output, message: "timed out" },
						);
					}
					const text = formatOutput(r.output, r.exitCode, "visible (tui)");
					return finishText(text, {
						status: "visible",
						subcommand,
						exitCode: r.exitCode,
						paneId: r.paneId,
						output: r.output,
						message: "TUI pane (no-mistakes attach)",
					});
				}
				// fallback: continue to the text-pane path below.
			}

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
				const ran = await runNmInlineSafe(args, sig, timeoutMs);
				if (ran.cancelled) {
					return finishText(
						`no-mistakes axi ${subcommand} was cancelled or failed inline: ${ran.error.message}`,
						{ status: "cancelled", subcommand, message: "inline run cancelled" },
					);
				}
				const r = ran.result;
				const text = formatOutput(r.output, r.exitCode, "inline (pane launch failed)");
				return finishText(text, {
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
					return finishText(
						`no-mistakes axi ${subcommand} timed out after ${timeoutMs / 1000}s; pane cancelled.\n${text}`,
						{ status: "timeout", subcommand, exitCode: r.exitCode, paneId, output: r.output, message: "timed out" },
					);
				}
				const text = formatOutput(r.output, r.exitCode, "visible");
				return finishText(text, {
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
				return finishText(
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
