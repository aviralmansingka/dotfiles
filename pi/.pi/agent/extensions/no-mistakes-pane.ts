import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
	buildAttachScript,
	buildBackgroundScript,
	extractMarkedOutput,
	hasStartMarker,
	NM_PANE_TIMEOUT_MS,
	wantsTuiPane,
} from "./no-mistakes-pane/capture";
import {
	isObservableNoMistakesRun,
	observeNoMistakesTiming,
	parseNoMistakesStatus,
	summarizeNoMistakesSnapshot,
	type NoMistakesSnapshot,
} from "./no-mistakes-pane/status";

// ---------------------------------------------------------------------------
// no-mistakes-pane — run `no-mistakes axi` detached, beside the agent, and
// steer every result back into the session. Mirrors the tuicr and
// interactive-subagents design:
//
//   - Every `no_mistakes_axi` call spawns its axi capture script DETACHED in
//     the background (the marked-capture machinery from capture.ts) and
//     returns immediately — the agent session stays free and never blocks on
//     a review/test/CI step.
//   - A single module-level watcher polls the capture files. When a call's
//     END marker lands, its structured TOON result (findings, gate, outcome,
//     branch_sync, help) is delivered as a `no_mistakes_axi_result` steer
//     message that triggers a new turn — the pipeline talks to the agent only
//     through messages.
//   - For `run`/`respond`, a visible Herdr pane beside the agent runs
//     `no-mistakes attach` (the rich TUI of the same daemon run). The pane
//     stays open while the run is parked at a gate and closes when the run
//     reaches a terminal outcome (or is aborted).
//   - `/no-mistakes` focuses that pane, or re-opens it (attached to the
//     active daemon run) when it was closed.
//
// The status monitor (1s `axi status` polling while a pipeline call is in
// flight) is kept: it feeds the shared activity UI (NM_ACTIVITY_UPDATE_EVENT,
// consumed by interactive-subagents) exactly as before.
//
// Session shutdown / extension reload tears down the watcher but leaves the
// background axi clients and the attach pane alone — the daemon run keeps its
// state, a human can keep watching, and a later session reattaches.
// ---------------------------------------------------------------------------

const HERDR_TIMEOUT_MS = 5000;
const POLL_MS = 250;
const STATUS_POLL_MS = 1000;
const STATUS_TIMEOUT_MS = 5000;
const execFileAsync = promisify(execFile);

const NM_ACTIVITY_UPDATE_EVENT = "no-mistakes:activity-update";
const NM_RESULT_MESSAGE = "no_mistakes_axi_result";

/** Attach-pane retry budget: 240 tries × 0.5s = up to 2min of startup-race
 *  retries. Once `no-mistakes attach` attaches it blocks for the whole run,
 *  so the loop count only advances on failed attach attempts. */
const ATTACH_MAX_TRIES = 240;
const ATTACH_INTERVAL_SEC = "0.5";
/** How long to wait for the background axi run to print its START marker
 *  before giving up on opening the attach pane (the run itself continues
 *  headless either way). */
const START_WAIT_MS = 3000;

interface PaneSplitResult {
	result?: { pane?: { pane_id?: string; tab_id?: string } };
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

/** Detect the no-mistakes axi subcommand for labeling (e.g. "run"). */
function subcommandOf(args: string[]): string {
	const first = args.find((a) => !a.startsWith("-"));
	return first ?? "axi";
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
 *  a text pane would send to an in-pane axi run), then best-effort kill the
 *  pid. This disconnects the axi client; it never restarts the shared daemon
 *  and the daemon run keeps its state. */
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
	return signal.reason instanceof Error ? signal.reason : new Error("no-mistakes background run cancelled");
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

// ---------------------------------------------------------------------------
// Watch state — one per loaded module, registered on globalThis so a reload
// (which re-imports this file) tears the previous watcher down instead of
// leaking timers. The /reload replacement keeps running background clients
// and the attach pane untouched; only the polling stops.
// ---------------------------------------------------------------------------

interface NmPane {
	paneId: string;
	agentPaneId: string;
	tabId: string;
	/** Attach script this pane runs (owned by the pane; unlinked on close). */
	script?: string;
}

interface InFlightCall {
	key: string;
	subcommand: string;
	pipeline: boolean;
	cwd: string;
	startedAt: number;
	timeoutMs: number;
	token: string;
	outFile: string;
	errFile: string;
	doneFile: string;
	bgScript: string;
	bgPid: number;
	observesSession: boolean;
	paneId?: string;
}

/** Pipeline call registered with the status monitor so the shared activity
 *  UI keeps rendering live phase progress while the call is in flight. */
interface NmObserver {
	startedAt: number;
	subcommand: string;
	cwd: string;
	baselineRunId?: string;
	runId?: string;
	refresh?: Promise<void>;
}

interface WatchState {
	pi: ExtensionAPI;
	calls: Map<string, InFlightCall>;
	observers: Map<string, NmObserver>;
	timer: ReturnType<typeof setInterval> | undefined;
	ticking: boolean;
	lastStatusPoll: number;
	pollingStatus: boolean;
	statusController: AbortController | undefined;
	queuedRefresh: { cwd: string; resolve: Array<() => void> } | undefined;
	latestSnapshot: NoMistakesSnapshot | undefined;
	trackedRunId: string | undefined;
	publishedRunId: string | undefined;
	pane: NmPane | undefined;
}

const WATCH_STATE_KEY = Symbol.for("pi-no-mistakes/watch-state");
const STATUS_INTERVAL_KEY = Symbol.for("pi-no-mistakes/status-interval");
const STATUS_ABORT_KEY = Symbol.for("pi-no-mistakes/status-abort-controller");

{
	const previous = (globalThis as any)[WATCH_STATE_KEY] as WatchState | undefined;
	if (previous) teardownWatch(previous);
	(globalThis as any)[WATCH_STATE_KEY] = undefined;
	// Legacy keys from the pre-async module may still hold a live interval.
	const previousInterval = (globalThis as any)[STATUS_INTERVAL_KEY];
	if (previousInterval) clearInterval(previousInterval);
	const previousAbort = (globalThis as any)[STATUS_ABORT_KEY] as AbortController | undefined;
	previousAbort?.abort();
	(globalThis as any)[STATUS_INTERVAL_KEY] = undefined;
	(globalThis as any)[STATUS_ABORT_KEY] = undefined;
}

function teardownWatch(state: WatchState): void {
	if (state.timer) clearInterval(state.timer);
	state.timer = undefined;
	state.statusController?.abort();
	state.statusController = undefined;
	state.pollingStatus = false;
	state.queuedRefresh?.resolve.forEach((done) => done());
	state.queuedRefresh = undefined;
	state.calls.clear();
	state.observers.clear();
	state.trackedRunId = undefined;
	publishSnapshot(state, undefined);
	// Deliberately leave background axi clients and the attach pane alone:
	// the daemon run keeps its state and a human can keep watching it.
}

function ensureWatchState(pi: ExtensionAPI): WatchState {
	let state = (globalThis as any)[WATCH_STATE_KEY] as WatchState | undefined;
	if (state) {
		state.pi = pi;
		return state;
	}
	state = {
		pi,
		calls: new Map(),
		observers: new Map(),
		timer: undefined,
		ticking: false,
		lastStatusPoll: 0,
		pollingStatus: false,
		statusController: undefined,
		queuedRefresh: undefined,
		latestSnapshot: undefined,
		trackedRunId: undefined,
		publishedRunId: undefined,
		pane: undefined,
	};
	(globalThis as any)[WATCH_STATE_KEY] = state;
	return state;
}

function ensureWatchTimer(state: WatchState): void {
	if (state.timer) return;
	state.timer = setInterval(() => void watchTick(state), POLL_MS);
	state.timer.unref?.();
}

function stopWatchTimer(state: WatchState): void {
	if (state.timer) clearInterval(state.timer);
	state.timer = undefined;
}

async function watchTick(state: WatchState): Promise<void> {
	if (state.ticking) return;
	state.ticking = true;
	try {
		const now = Date.now();
		for (const call of Array.from(state.calls.values())) {
			if (existsSync(call.outFile)) {
				const parsed = extractMarkedOutput(readFileSync(call.outFile, "utf-8"), call.token);
				if (parsed.complete) {
					finishCall(state, call, {
						output: parsed.output ?? "",
						exitCode: parsed.exitCode ?? -1,
						timedOut: false,
					});
					continue;
				}
			}
			if (now - call.startedAt >= call.timeoutMs) {
				killBackground(call.bgPid);
				finishCall(state, call, {
					output: partialOutput(call.outFile, call.token),
					exitCode: -1,
					timedOut: true,
				});
			}
		}
		if (
			(state.trackedRunId || state.observers.size > 0) &&
			now - state.lastStatusPoll >= STATUS_POLL_MS
		) {
			state.lastStatusPoll = now;
			const cwd = firstObserverCwd(state) ?? process.cwd();
			void refreshStatus(state, { cwd });
		}
		if (state.calls.size === 0 && state.observers.size === 0 && !state.trackedRunId) {
			stopWatchTimer(state);
		}
	} finally {
		state.ticking = false;
	}
}

function firstObserverCwd(state: WatchState): string | undefined {
	for (const observer of state.observers.values()) return observer.cwd;
	return undefined;
}

function partialOutput(outFile: string, token: string): string {
	if (!existsSync(outFile)) return "";
	const parsed = extractMarkedOutput(readFileSync(outFile, "utf-8"), token);
	return parsed.output ?? "";
}

/** A pipeline result keeps the pane open only when the run is parked at a
 *  gate; outcomes, errors, timeouts, and aborts are terminal for the watch
 *  pane (the daemon run itself may continue, e.g. the post-checks-passed CI
 *  monitor, but there is no gate left to drive). */
function paneShouldClose(call: InFlightCall, output: string, timedOut: boolean): boolean {
	if (call.subcommand === "abort") return true;
	if (!call.pipeline) return false;
	if (timedOut) return true;
	return !/^gate:/m.test(output);
}

function finishCall(
	state: WatchState,
	call: InFlightCall,
	r: { output: string; exitCode: number; timedOut: boolean },
): void {
	state.calls.delete(call.key);
	state.observers.delete(call.key);
	for (const file of [call.outFile, call.errFile, call.doneFile, call.bgScript]) unlinkSafe(file);
	const parkedAtGate = call.pipeline && !r.timedOut && /^gate:/m.test(r.output);
	const paneClosed = Boolean(state.pane) && paneShouldClose(call, r.output, r.timedOut);
	if (paneClosed) closeWatchPane(state);
	// Feed the shared activity UI from the result itself; a gate response has
	// no `run:` header, so fall back to a fresh status poll in that case.
	if (call.pipeline && call.observesSession) {
		const snapshot = parseNoMistakesStatus(r.output);
		if (snapshot) publishSnapshot(state, snapshot);
		else void refreshStatus(state, { cwd: call.cwd }, true);
	}
	steerResult(state, call, r, parkedAtGate, paneClosed);
}

function steerResult(
	state: WatchState,
	call: InFlightCall,
	r: { output: string; exitCode: number; timedOut: boolean },
	parkedAtGate: boolean,
	paneClosed: boolean,
): void {
	const header = r.timedOut
		? `no-mistakes axi ${call.subcommand} timed out after ${Math.round(call.timeoutMs / 1000)}s and the background axi client was disconnected (the daemon run keeps its state). Partial output follows — inspect with no_mistakes_axi \`status\` before re-driving.`
		: `no-mistakes axi ${call.subcommand} finished (exit ${r.exitCode}).`;
	const guidance = call.pipeline || call.subcommand === "abort" ? resultGuidance(r) : "";
	const content = [header, r.output, guidance].filter(Boolean).join("\n");
	state.pi.sendMessage(
		{
			customType: NM_RESULT_MESSAGE,
			content,
			display: true,
			details: {
				subcommand: call.subcommand,
				pipeline: call.pipeline,
				exitCode: r.exitCode,
				timedOut: r.timedOut,
				cwd: call.cwd,
				gate: parkedAtGate,
				outcome: /^outcome:\s*(\S+)/m.exec(r.output)?.[1],
				paneClosed,
			},
		},
		{ triggerTurn: true, deliverAs: "steer" },
	);
}

function resultGuidance(r: { output: string; timedOut: boolean }): string {
	if (r.timedOut) return "";
	if (/^gate:/m.test(r.output)) {
		return "The run is parked at this gate. Read the findings table, decide, and submit the next call through no_mistakes_axi: `respond --action approve|fix|skip` with `--findings <ids>` and `--instructions` as needed. Findings marked ask-user belong to the user — relay them verbatim and wait for their decision. Never edit the code yourself while the run is active; the pipeline owns findings and fixes.";
	}
	const outcome = /^outcome:\s*(\S+)/m.exec(r.output)?.[1];
	if (outcome === "checks-passed" || outcome === "passed") {
		return "Terminal outcome — the pipeline is done. Close the loop with the user: summarize what was validated and list any `fixes` the pipeline applied. checks-passed means the PR is ready for human review and merge; do not wait for the merge.";
	}
	if (outcome) {
		return "Terminal outcome — read the output, address what it points at (commit fixes on the same branch), then start a fresh run or `rerun` as the help lines suggest. Do not leave the user at a failed outcome without retrying or explaining what blocks it.";
	}
	if (/^error:/m.test(r.output)) {
		return "The call returned an error — read its `help` lines and act on them; re-submit through no_mistakes_axi once the cause is fixed.";
	}
	return "";
}

// ---------------------------------------------------------------------------
// Status monitor — feeds the shared activity UI (NM_ACTIVITY_UPDATE_EVENT)
// with live snapshots of the daemon-owned run while a pipeline call is in
// flight. Read-only: `axi status` never advances or parks the run.
// ---------------------------------------------------------------------------

function observesInvocation(observer: NmObserver, snapshot: NoMistakesSnapshot): boolean {
	if (observer.runId) return observer.runId === snapshot.id;
	if (observer.subcommand === "respond") {
		observer.runId = snapshot.id;
		return true;
	}
	if (snapshot.id === observer.baselineRunId) return false;
	if (observer.baselineRunId == null && (snapshot.pipelineStartedAt ?? 0) < observer.startedAt) {
		observer.baselineRunId = snapshot.id;
		return false;
	}
	observer.runId = snapshot.id;
	return true;
}

function publishSnapshot(state: WatchState, snapshot: NoMistakesSnapshot | undefined): void {
	const observedSnapshot = snapshot
		? observeNoMistakesTiming(snapshot, state.latestSnapshot)
		: undefined;
	state.latestSnapshot = isObservableNoMistakesRun(observedSnapshot) ? observedSnapshot : undefined;
	if (observedSnapshot) {
		for (const observer of state.observers.values()) {
			if (!observesInvocation(observer, observedSnapshot)) continue;
			state.trackedRunId = observedSnapshot.id;
		}
	}

	const visibleSnapshot = observedSnapshot?.id === state.trackedRunId &&
		isObservableNoMistakesRun(observedSnapshot)
		? observedSnapshot
		: undefined;
	if (visibleSnapshot || state.publishedRunId) {
		state.pi.events.emit(NM_ACTIVITY_UPDATE_EVENT, {
			snapshot: visibleSnapshot
				? { ...visibleSnapshot, summary: summarizeNoMistakesSnapshot(visibleSnapshot) }
				: undefined,
			observedAt: Date.now(),
		});
	}
	state.publishedRunId = visibleSnapshot?.id;
	if (observedSnapshot?.id === state.trackedRunId && !visibleSnapshot) state.trackedRunId = undefined;
	if (state.trackedRunId && state.observers.size === 0 && observedSnapshot?.id !== state.trackedRunId) {
		state.trackedRunId = undefined;
	}
}

async function refreshStatus(
	state: WatchState,
	ctx: { cwd: string },
	queueIfBusy = false,
): Promise<void> {
	if (state.pollingStatus) {
		if (!queueIfBusy) return;
		return new Promise<void>((resolve) => {
			if (state.queuedRefresh) {
				state.queuedRefresh.resolve.push(resolve);
			} else {
				state.queuedRefresh = { cwd: ctx.cwd, resolve: [resolve] };
			}
		});
	}
	state.pollingStatus = true;
	const controller = new AbortController();
	state.statusController = controller;
	try {
		const result = await state.pi.exec("no-mistakes", ["axi", "status"], {
			cwd: ctx.cwd,
			signal: controller.signal,
			timeout: STATUS_TIMEOUT_MS,
		});
		if (!controller.signal.aborted && result.code === 0) {
			publishSnapshot(state, parseNoMistakesStatus(result.stdout));
		}
	} catch {
	} finally {
		if (state.statusController === controller) state.statusController = undefined;
		state.pollingStatus = false;
		const queued = state.queuedRefresh;
		state.queuedRefresh = undefined;
		if (!controller.signal.aborted && queued) {
			void refreshStatus(state, { cwd: queued.cwd }).finally(() =>
				queued.resolve.forEach((done) => done()),
			);
		} else {
			queued?.resolve.forEach((done) => done());
		}
	}
}

// ---------------------------------------------------------------------------
// Watch pane — the visible `no-mistakes attach` TUI pane beside the agent.
// ---------------------------------------------------------------------------

function paneAlive(paneId: string): boolean {
	return herdrOkSync(["pane", "get", paneId]);
}

/** Split a pane to the right of the agent pane and run the attach script in
 *  it, or reuse the existing live pane (the attach TUI stays attached to the
 *  same daemon run across `run` → gate → `respond` cycles). Returns the pane
 *  plus whether this call opened it (so the caller can unlink an unused
 *  attach script), or null when Herdr could not open one. */
function openWatchPane(
	state: WatchState,
	cwd: string,
	label: string,
	attachScript: string,
): { pane: NmPane; opened: boolean } | null {
	if (state.pane) {
		if (paneAlive(state.pane.paneId)) return { pane: state.pane, opened: false };
		closeWatchPane(state);
	}
	const agent = getCurrentPane();
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
	const tabId = split?.result?.pane?.tab_id ?? agent?.tab_id ?? "";
	herdrOkSync(["pane", "rename", paneId, `no-mistakes: attach ${label}`]);
	if (!herdrOkSync(["pane", "run", paneId, "bash", attachScript])) {
		herdrOkSync(["pane", "close", paneId]);
		return null;
	}
	state.pane = { paneId, agentPaneId: agent?.pane_id ?? "", tabId, script: attachScript };
	return { pane: state.pane, opened: true };
}

function closeWatchPane(state: WatchState): void {
	const pane = state.pane;
	if (!pane) return;
	herdrOkSync(["pane", "close", pane.paneId]);
	if (pane.script) unlinkSafe(pane.script);
	state.pane = undefined;
}

/** Focus the watch pane: when it is still a direct neighbor of the agent
 *  pane, focus across that split; otherwise focus its tab and zoom it (zoom
 *  also moves focus). */
function focusWatchPane(state: WatchState): boolean {
	const pane = state.pane;
	if (!pane) return false;
	if (pane.agentPaneId) {
		for (const direction of ["right", "left", "up", "down"]) {
			const neighbor = herdrJsonSync([
				"pane",
				"neighbor",
				"--direction",
				direction,
				"--pane",
				pane.agentPaneId,
			]) as { result?: { neighbor?: { pane_id?: string } } } | null;
			if (neighbor?.result?.neighbor?.pane_id === pane.paneId) {
				if (herdrOkSync(["pane", "focus", "--pane", pane.agentPaneId, "--direction", direction])) {
					return true;
				}
			}
		}
	}
	if (pane.tabId) herdrOkSync(["tab", "focus", pane.tabId]);
	return herdrOkSync(["pane", "zoom", "--pane", pane.paneId]);
}

// ---------------------------------------------------------------------------
// Inline fallback — only when the detached spawn itself fails, so the agent
// still receives a result instead of a silently dropped call.
// ---------------------------------------------------------------------------

interface PaneRunResult {
	output: string;
	exitCode: number;
}

async function runNmInline(args: string[], signal: AbortSignal, timeoutMs: number): Promise<PaneRunResult> {
	try {
		const { stdout } = await execFileAsync("no-mistakes", ["axi", ...args], {
			encoding: "utf-8",
			maxBuffer: 16 * 1024 * 1024,
			signal,
			timeout: timeoutMs,
		});
		return { output: stdout.trim(), exitCode: 0 };
	} catch (err) {
		const e = err as { stdout?: string; code?: number; signal?: string; killed?: boolean };
		if (e.signal === "SIGTERM" || e.killed) {
			throw abortError(signal);
		}
		const out = (e.stdout ?? "").toString().trim();
		return { output: out, exitCode: typeof e.code === "number" ? e.code : -1 };
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

// ---------------------------------------------------------------------------
// Tool + command registration
// ---------------------------------------------------------------------------

interface NmAxiDetails {
	status: "started" | "inline" | "cancelled" | "error";
	subcommand: string;
	pipeline?: boolean;
	key?: string;
	paneId?: string;
	exitCode?: number;
	output?: string;
	message?: string;
	timeoutMs?: number;
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
			'Everything after `no-mistakes axi` — the subcommand and its flags, e.g. `run --intent "ship the feature"` or `respond --action fix --findings r1` or `status`. Quote multi-word values.',
	}),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the call. Defaults to the agent's cwd.",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: "Max wall-clock seconds for this axi call before its background client is disconnected. Defaults to 1800 (30 min); run/respond can block for several minutes at a step.",
		}),
	),
});

export default function noMistakesPane(pi: ExtensionAPI) {
	pi.registerTool({
		name: "no_mistakes_axi",
		label: "no-mistakes (background)",
		description:
			"Submit a `no-mistakes axi` subcommand (run/respond/status/logs/abort/sync) to run detached in the background and return immediately — the session stays free and never blocks on a review/test/CI step. Use this INSTEAD of running `no-mistakes axi` in the bash tool. The structured TOON result (findings, gate, outcome, branch_sync, help) arrives later as a `no_mistakes_axi_result` steer message that triggers a new turn: read every one, and on a `gate:` decide and submit the next call (`respond --action ...`) until an `outcome:` arrives. For `run`/`respond` a visible Herdr pane beside the agent shows the rich `no-mistakes` TUI of the same daemon run; it stays open while the run is parked at a gate, and `/no-mistakes` focuses or re-opens it.",
		promptSnippet:
			"Use no_mistakes_axi (not bash) to drive every no-mistakes axi call; it runs in the background and results arrive as steer messages.",
		promptGuidelines: [
			"Pass `args` = everything after `no-mistakes axi` (e.g. `run --intent \"...\"`, `respond --action fix --findings r1`, `status`). Quote multi-word values.",
			"Every call returns immediately with an ack — never wait, poll, or re-issue while a call is in flight. The result arrives as a `no_mistakes_axi_result` steer message; read every one.",
			"On a `gate:` result, read the findings and submit the next call: `respond --action approve|fix|skip` with `--findings <ids>` and `--instructions` as needed. Loop until an `outcome:` result arrives.",
			"`--intent` is required on `run`: pass what the user set out to accomplish, in their terms — goal, decisions, constraints — not a diff summary.",
			"run/respond can take several minutes at a step — that is normal. Check progress any time with `no_mistakes_axi status`; never cancel or re-issue because it seems slow.",
			"While a run is active, never fix findings by editing code yourself — the pipeline owns findings and fixes; use `respond --action fix`.",
			"Findings marked ask-user are never yours to resolve: relay them verbatim to the user and wait for their decision before responding.",
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
			const pipeline = wantsTuiPane(args, subcommand);
			const sessionCwd = ctx?.cwd ?? process.cwd();
			const cwd = params.cwd ?? sessionCwd;
			const observesSession = resolve(cwd) === resolve(sessionCwd);
			const timeoutMs = (params.timeoutMs ?? NM_PANE_TIMEOUT_MS / 1000) * 1000;
			const sig = signal ?? new AbortController().signal;
			const state = ensureWatchState(pi);

			const token = randomUUID().replace(/-/g, "");
			const outFile = `${tmpdir()}/pi-nm-${token}.out`;
			const errFile = `${tmpdir()}/pi-nm-${token}.err`;
			const doneFile = `${tmpdir()}/pi-nm-${token}.done`;
			const bgScript = `${tmpdir()}/pi-nm-${token}.bg.sh`;
			writeFileSync(outFile, "");
			writeFileSync(bgScript, buildBackgroundScript(args, token, outFile, errFile, doneFile));

			const bgPid = spawnBackground(bgScript, cwd);
			if (!bgPid) {
				unlinkSafe(outFile);
				unlinkSafe(bgScript);
				const ran = await runNmInlineSafe(args, sig, timeoutMs);
				if (ran.cancelled) {
					return textResult(
						`no-mistakes axi ${subcommand} was cancelled or failed inline: ${ran.error.message}`,
						{ status: "cancelled", subcommand, message: "background spawn failed; inline run cancelled" },
					);
				}
				const r = ran.result;
				return textResult(formatOutput(r.output, r.exitCode, "inline (background spawn failed)"), {
					status: "inline",
					subcommand,
					exitCode: r.exitCode,
					output: r.output,
					message: "background spawn failed; ran inline",
				});
			}

			const call: InFlightCall = {
				key: randomUUID(),
				subcommand,
				pipeline,
				cwd,
				startedAt: Date.now(),
				timeoutMs,
				token,
				outFile,
				errFile,
				doneFile,
				bgScript,
				bgPid,
				observesSession,
			};
			state.calls.set(call.key, call);
			if (pipeline && observesSession) {
				const observer: NmObserver = {
					startedAt: call.startedAt,
					subcommand,
					cwd,
					baselineRunId: state.latestSnapshot?.id,
				};
				state.observers.set(call.key, observer);
				observer.refresh = refreshStatus(state, { cwd }, true);
			}

			let paneNote = "";
			if (pipeline && (ctx as { hasUI?: boolean })?.hasUI && attachAvailable()) {
				try {
					const started = await waitForStart(outFile, token, START_WAIT_MS, sig);
					if (sig.aborted) throw abortError(sig);
					if (started && state.calls.has(call.key)) {
						const attachScript = `${tmpdir()}/pi-nm-${token}.attach.sh`;
						writeFileSync(attachScript, buildAttachScript(doneFile, ATTACH_MAX_TRIES, ATTACH_INTERVAL_SEC));
						const opened = openWatchPane(state, cwd, subcommand, attachScript);
						if (opened) {
							call.paneId = opened.pane.paneId;
							// A reused pane keeps its own attach script; drop the unused one.
							if (!opened.opened) unlinkSafe(attachScript);
							paneNote = ` The run is visible in pane ${opened.pane.paneId} (the no-mistakes attach TUI); the pane stays open while the run is parked at a gate, and /no-mistakes focuses or re-opens it.`;
						} else {
							unlinkSafe(attachScript);
							paneNote = " No Herdr pane could be opened, so the run is headless; its result will still arrive here.";
						}
					} else {
						paneNote = " The background run was slow to start (or already finished), so no pane was attached; inspect it with no_mistakes_axi `status`.";
					}
				} catch (err) {
					// Aborted (or the run vanished) while waiting for the background run to start.
					killBackground(bgPid);
					state.calls.delete(call.key);
					state.observers.delete(call.key);
					for (const file of [outFile, errFile, doneFile, bgScript]) unlinkSafe(file);
					return textResult(
						`no-mistakes axi ${subcommand} was cancelled before the background run started.`,
						{
							status: "cancelled",
							subcommand,
							message: err instanceof Error ? err.message : "cancelled",
						},
					);
				}
			}

			ensureWatchTimer(state);
			return textResult(
				`no-mistakes axi ${subcommand} is running in the background; this session stays free.${paneNote} The structured TOON result (gate, outcome, findings, or error) will arrive as a ${NM_RESULT_MESSAGE} steer message — read it when it lands, and do not re-issue this call while it is in flight.`,
				{
					status: "started",
					subcommand,
					pipeline,
					key: call.key,
					paneId: call.paneId,
					timeoutMs,
				},
			);
		},
	});

	pi.registerCommand("no-mistakes", {
		description:
			"Focus the visible no-mistakes pane for the active run, or re-open it (attached to the active daemon run) when it was closed.",
		handler: async (args, ctx) => {
			const state = ensureWatchState(pi);
			if ((args ?? "").trim() === "stop") {
				ctx.ui.notify(
					"/no-mistakes stop is not available — use the no_mistakes_axi tool with `abort` to cancel the run itself.",
					"info",
				);
				return;
			}
			if (state.pane && paneAlive(state.pane.paneId)) {
				if (focusWatchPane(state)) {
					ctx.ui.notify(`Focused the no-mistakes pane (${state.pane.paneId}).`, "info");
				} else {
					ctx.ui.notify(
						"The no-mistakes pane exists but Herdr could not focus it — find it labeled \"no-mistakes: attach\".",
						"warning",
					);
				}
				return;
			}
			if (state.pane) closeWatchPane(state);

			let snapshot: NoMistakesSnapshot | undefined;
			try {
				const result = await pi.exec("no-mistakes", ["axi", "status"], {
					cwd: ctx.cwd,
					timeout: STATUS_TIMEOUT_MS,
				});
				snapshot = parseNoMistakesStatus(result.stdout);
			} catch {
				ctx.ui.notify("Could not reach the no-mistakes daemon — is it running?", "error");
				return;
			}
			if (!isObservableNoMistakesRun(snapshot)) {
				ctx.ui.notify(
					"No active no-mistakes run on this branch. Start one with the no_mistakes_axi tool (`run --intent \"...\"`).",
					"info",
				);
				return;
			}
			const token = randomUUID().replace(/-/g, "");
			const doneFile = `${tmpdir()}/pi-nm-${token}.done`;
			const attachScript = `${tmpdir()}/pi-nm-${token}.attach.sh`;
			writeFileSync(attachScript, buildAttachScript(doneFile, ATTACH_MAX_TRIES, ATTACH_INTERVAL_SEC));
			const opened = openWatchPane(state, ctx.cwd, "re-open", attachScript);
			if (!opened) {
				unlinkSafe(attachScript);
				ctx.ui.notify(
					`Run ${snapshot.id} is active but Herdr could not open a pane for it.`,
					"error",
				);
				return;
			}
			state.trackedRunId = snapshot.id;
			ensureWatchTimer(state);
			ctx.ui.notify(
				`Re-opened the no-mistakes TUI for run ${snapshot.id} in pane ${opened.pane.paneId}.`,
				"info",
			);
		},
	});

	// Compact visible record of each delivered result; the steer itself is
	// the functional part, this only renders in the transcript.
	pi.registerMessageRenderer(NM_RESULT_MESSAGE, (message, options, theme) => {
		const details = message.details as
			| { subcommand?: string; exitCode?: number; timedOut?: boolean; gate?: boolean; outcome?: string }
			| undefined;
		if (!details) return undefined;
		const state = details.timedOut
			? "timed out"
			: details.gate
				? "gate"
				: details.outcome
					? `outcome: ${details.outcome}`
					: `exit ${details.exitCode ?? -1}`;
		const header = `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold(`no-mistakes · ${details.subcommand ?? "axi"}`))} ${theme.fg("dim", state)}`;
		const body = String(message.content ?? "").split("\n");
		const lines = ["", header, ...(options.expanded ? body : body.slice(0, 6).map((line) => theme.fg("dim", line)))];
		if (!options.expanded && body.length > 6) lines.push(theme.fg("muted", "Ctrl+O to expand"));
		return {
			render(width: number): string[] {
				return lines.map((line) => truncateAnsi(line, width));
			},
		};
	});

	pi.on("session_shutdown", () => {
		const state = (globalThis as any)[WATCH_STATE_KEY] as WatchState | undefined;
		if (state) teardownWatch(state);
	});
}

/** Truncate a styled line to a visible width without cutting ANSI escapes. */
function truncateAnsi(line: string, width: number): string {
	let visible = 0;
	let index = 0;
	while (index < line.length) {
		if (line[index] === "\x1b") {
			const match = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(line.slice(index));
			if (match) {
				index += match[0].length;
				continue;
			}
		}
		visible++;
		if (visible > width) return line.slice(0, index);
		index++;
	}
	return line;
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
