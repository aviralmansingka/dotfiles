import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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
	ensureBridgeServer,
	teardownBridgeForRun,
	teardownBridgeServers,
} from "./no-mistakes-pane/bridge";
import {
	applyRunPaneLabels,
	clearRunPaneLabels,
	PaneReportActions,
	PaneReportState,
	setCiBlocked,
} from "./no-mistakes-pane/herdr-report";
import {
	isObservableNoMistakesRun,
	observeNoMistakesTiming,
	parseNoMistakesResult,
	parseNoMistakesStatus,
	summarizeNoMistakesSnapshot,
	type NoMistakesResultReport,
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
//     through messages. When a result parks the run at a gate and the
//     no-mistakes-gate extension is loaded, the gate panel surfaces the
//     findings to the user first and the steer carries their decision.
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
const NM_TOGGLE_EVENT = "no-mistakes:toggle-rows";

/** Ctrl+Q visibility class for the result rows: hidden rows render as one
 *  ghost line. The ctrl+q shortcut in tool-call-renderer-public sends the
 *  absolute hidden state through NM_TOGGLE_EVENT, so this stays in sync with
 *  its commandsHidden; the rows re-render cache-free. */
let nmRowsHidden = true;

// ---------------------------------------------------------------------------
// Gate panel bridge — the no-mistakes-gate extension registers a decision
// panel API on globalThis under the Symbol.for key below. It is optional:
// without it (or without a TUI) every gate result steers immediately and the
// agent relays findings as text, exactly as before. Structurally identical
// to the api type exported by no-mistakes-gate.ts; duplicated here so the
// two extensions stay decoupled.
// ---------------------------------------------------------------------------
const GATE_API_KEY = Symbol.for("pi-no-mistakes/gate-api");

type NmGateDecision =
	| { type: "approve" }
	| { type: "fix"; findings: string[]; instructions?: string }
	| { type: "skip" }
	| { type: "yolo" };

interface NmGateApi {
	handleGate(payload: {
		output: string;
		cwd: string;
		subcommand: string;
		branch?: string;
		runId?: string;
	}): Promise<NmGateDecision | null>;
	yoloActive(runId: string | undefined): boolean;
	setYolo(cwd: string, on: boolean): Promise<{ on: boolean; activeRun: boolean }>;
	runObserved(cwd: string, runId?: string): Promise<string | undefined>;
	runFinished(cwd: string, runId?: string): Promise<void>;
}

function gateApi(): NmGateApi | undefined {
	return (globalThis as any)[GATE_API_KEY] as NmGateApi | undefined;
}

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
	/** Dedupe gate for pane labels / CI red state transitions. */
	paneReport: PaneReportState;
	/** Run id whose interactive bridge (step-agent tabs) is live. */
	bridgeRunId: string | undefined;
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
	// Release the pane-state surfaces and close every step-agent tab. Unlike
	// the attach pane (left alone on purpose), a live tab owns a pi session
	// file: a later headless --session resume from the daemon must never meet
	// a second writer, so tabs close here. The daemon run itself continues
	// headless and a later observer re-creates the bridge for new steps.
	if (state.bridgeRunId) {
		teardownBridgeForRun(state.bridgeRunId);
		state.bridgeRunId = undefined;
	}
	teardownBridgeServers();
	if (state.paneReport) {
		applyPaneReportActions(state, state.paneReport.next(undefined));
	}
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
		paneReport: new PaneReportState(),
		bridgeRunId: undefined,
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
	const runId = state.observers.get(call.key)?.runId ??
		(call.observesSession ? state.trackedRunId : undefined);
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
	const outcome = /^outcome:\s*(\S+)/m.exec(r.output)?.[1];
	if (outcome || call.subcommand === "abort") void gateApi()?.runFinished(call.cwd, runId);
	if (parkedAtGate) {
		// The gate panel owns this result until the user decides; the steer
		// (TOON + decision) lands when the panel resolves. Detached so the
		// watcher keeps serving other calls and status polling meanwhile.
		void driveParkedGate(state, call, r, paneClosed, runId);
		return;
	}
	steerResult(state, call, r, parkedAtGate, paneClosed, undefined, false);
}

/** Parked at a gate: surface the findings through the no-mistakes gate
 *  panel (when that extension is loaded and yolo standing consent has not
 *  taken over), then steer the result with the user's decision attached.
 *  Without a panel the result steers immediately, as before. */
async function driveParkedGate(
	state: WatchState,
	call: InFlightCall,
	r: { output: string; exitCode: number; timedOut: boolean },
	paneClosed: boolean,
	runId: string | undefined,
): Promise<void> {
	const api = gateApi();
	let decision: NmGateDecision | undefined;
	let yoloStanding = false;
	if (api) {
		const observedRunId = await api.runObserved(call.cwd, runId);
		if (api.yoloActive(observedRunId)) {
			yoloStanding = true;
		} else {
			decision = (await api
				.handleGate({
					output: r.output,
					cwd: call.cwd,
					subcommand: call.subcommand,
					branch: state.latestSnapshot?.branch,
					runId: observedRunId,
				})
				.catch(() => null)) ?? undefined;
		}
	}
	steerResult(state, call, r, true, paneClosed, decision, yoloStanding);
}

function steerResult(
	state: WatchState,
	call: InFlightCall,
	r: { output: string; exitCode: number; timedOut: boolean },
	parkedAtGate: boolean,
	paneClosed: boolean,
	decision: NmGateDecision | undefined = undefined,
	yoloStanding = false,
): void {
	const baseHeader = r.timedOut
		? `no-mistakes axi ${call.subcommand} timed out after ${Math.round(call.timeoutMs / 1000)}s and the background axi client was disconnected (the daemon run keeps its state). Partial output follows — inspect with no_mistakes_axi \`status\` before re-driving.`
		: `no-mistakes axi ${call.subcommand} finished (exit ${r.exitCode}).`;
	const decisionNote = r.timedOut
		? ""
		: decision
			? " — the user decided at the gate panel"
			: yoloStanding
				? " — yolo standing consent is active for this run"
				: "";
	const guidance = call.pipeline || call.subcommand === "abort" ? resultGuidance(r, decision, yoloStanding) : "";
	const content = [baseHeader + decisionNote, r.output, gateDecisionBlock(decision, yoloStanding), guidance]
		.filter(Boolean)
		.join("\n");
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
				gateDecision: decision,
				yolo: yoloStanding || decision?.type === "yolo" || undefined,
				paneClosed,
			},
		},
		{ triggerTurn: true, deliverAs: "steer" },
	);
}

function doubleQuoteArg(value: string): string {
	return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/** The decision block appended to a steered gate result. It names the exact
 *  respond call so the agent executes the user's decision verbatim. */
function gateDecisionBlock(decision: NmGateDecision | undefined, yoloStanding: boolean): string {
	if (yoloStanding) {
		return "YOLO ACTIVE: standing consent covers this run. Submit no_mistakes_axi `respond --yes` at this gate and at every later gate of this run; do not ask the user and do not relay its findings as questions.";
	}
	if (!decision) return "";
	switch (decision.type) {
		case "approve":
			return "GATE DECISION (user): approve — accept this step as-is.\nSubmit through no_mistakes_axi: `respond --action approve`";
		case "fix": {
			const ids = decision.findings.join(",");
			const instructions = decision.instructions
				? ` --instructions ${doubleQuoteArg(decision.instructions)}`
				: "";
			return `GATE DECISION (user): fix findings ${ids}.\nSubmit through no_mistakes_axi: \`respond --action fix --findings ${ids}${instructions}\``;
		}
		case "skip":
			return "GATE DECISION (user): skip this step.\nSubmit through no_mistakes_axi: `respond --action skip`";
		case "yolo":
			return "GATE DECISION (user): yolo — standing consent for the rest of this run.\nSubmit through no_mistakes_axi: `respond --yes` at this gate and at every later gate of this run. Drive the run unattended: do not ask the user at gates and do not relay its findings as questions.";
	}
}

function resultGuidance(
	r: { output: string; timedOut: boolean },
	decision: NmGateDecision | undefined,
	yoloStanding: boolean,
): string {
	if (r.timedOut) return "";
	if (/^gate:/m.test(r.output)) {
		if (decision || yoloStanding) {
			return "The gate decision above is the user's instruction — execute it exactly through no_mistakes_axi, then keep reading results and driving gates the same way until an `outcome:` result arrives.";
		}
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
	syncRunVisibility(state, visibleSnapshot);
	state.publishedRunId = visibleSnapshot?.id;
	if (observedSnapshot?.id === state.trackedRunId && !visibleSnapshot) state.trackedRunId = undefined;
	if (state.trackedRunId && state.observers.size === 0 && observedSnapshot?.id !== state.trackedRunId) {
		state.trackedRunId = undefined;
	}
}

/** Apply one pane-report transition set: each action is confirmed only
 *  after it reached Herdr, so a failed herdr call leaves it unconfirmed and
 *  the next poll re-emits it. */
function applyPaneReportActions(state: WatchState, actions: PaneReportActions): void {
	const paneId = process.env.HERDR_PANE_ID;
	if (actions.label !== undefined && paneId && applyRunPaneLabels(paneId, actions.label)) {
		state.paneReport.confirm({ label: actions.label });
	}
	if (actions.clearLabels && paneId && clearRunPaneLabels(paneId)) {
		state.paneReport.confirm({ clearLabels: true });
	}
	if (actions.ciBlocked !== undefined) {
		setCiBlocked(state.pi, actions.ciBlocked);
		state.paneReport.confirm({ ciBlocked: actions.ciBlocked });
	}
}

/** Drive the two Herdr visibility surfaces for the tracked run:
 *  the interactive bridge (daemon step agents hosted as visible subagent
 *  tabs) and the pane-state report (phase labels + the CI red state). Runs
 *  on every status poll but only acts on transitions — the bridge server is
 *  idempotent per run id, and PaneReportState dedupes label/blocked changes.
 *  Without Herdr both are no-ops and nothing changes for the run. */
function syncRunVisibility(state: WatchState, visible: NoMistakesSnapshot | undefined): void {
	if (process.env.HERDR_ENV !== "1" || !state.paneReport) return;
	// Only a live interactive session drives Herdr surfaces; the flag is set
	// by the default export on session_start (see above).
	if (!interactiveTuiSession) return;
	if (visible && visible.id === state.trackedRunId) {
		if (state.bridgeRunId && state.bridgeRunId !== visible.id) {
			teardownBridgeForRun(state.bridgeRunId);
		}
		state.bridgeRunId = visible.id;
		ensureBridgeServer(visible.id);
		applyPaneReportActions(state, state.paneReport.next(visible));
		return;
	}
	// No visible tracked run: release every surface (run terminal, aborted,
	// or superseded by a different run's snapshot).
	if (state.bridgeRunId) {
		teardownBridgeForRun(state.bridgeRunId);
		state.bridgeRunId = undefined;
	}
	applyPaneReportActions(state, state.paneReport.next(undefined));
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

// Herdr surface work (bridge server, pane labels, CI red state) belongs to
// a real interactive TUI session — the same gate herdr-agent-state.ts uses.
// Headless hosts (tests, JSON mode) never touch real Herdr state, even when
// they inherit HERDR_* from a Herdr-hosted parent shell. Set by the default
// export on session_start; reset naturally on module reload.
let interactiveTuiSession = false;

export default function noMistakesPane(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx?.mode === "tui") interactiveTuiSession = true;
	});

	pi.registerTool({
		name: "no_mistakes_axi",
		label: "no-mistakes (background)",
		description:
			"Submit a `no-mistakes axi` subcommand (run/respond/status/logs/abort/sync) to run detached in the background and return immediately — the session stays free and never blocks on a review/test/CI step. Use this INSTEAD of running `no-mistakes axi` in the bash tool. The structured TOON result (findings, gate, outcome, branch_sync, help) arrives later as a `no_mistakes_axi_result` steer message that triggers a new turn: read every one. Gate results carry the user's decision from the no-mistakes gate panel (or yolo standing consent) — submit the `respond` call it names until an `outcome:` arrives; without a decision, relay ask-user findings verbatim and wait. For `run`/`respond` a visible Herdr pane beside the agent shows the rich `no-mistakes` TUI of the same daemon run; it stays open while the run is parked at a gate, and `/no-mistakes` focuses or re-opens it.",
		promptSnippet:
			"Use no_mistakes_axi (not bash) to drive every no-mistakes axi call; it runs in the background and results arrive as steer messages.",
		promptGuidelines: [
			"Pass `args` = everything after `no-mistakes axi` (e.g. `run --intent \"...\"`, `respond --action fix --findings r1`, `status`). Quote multi-word values.",
			"Every call returns immediately with an ack — never wait, poll, or re-issue while a call is in flight. The result arrives as a `no_mistakes_axi_result` steer message; read every one.",
			"On a `gate:` result, read the attached GATE DECISION (the user decided in the gate panel) and submit the exact `respond` call it names. When a gate result carries no decision (no panel was available), relay ask-user findings verbatim and wait for the user. Loop until an `outcome:` result arrives.",
			"When a result says yolo standing consent is active (or the user chose yolo), submit `respond --yes` at this and every later gate of that run without asking.",
			"`--intent` is required on `run`: pass what the user set out to accomplish, in their terms — goal, decisions, constraints — not a diff summary.",
			"run/respond can take several minutes at a step — that is normal. Check progress any time with `no_mistakes_axi status`; never cancel or re-issue because it seems slow.",
			"While a run is active, never fix findings by editing code yourself — the pipeline owns findings and fixes; use `respond --action fix`.",
			"Findings marked ask-user are never yours to resolve: the gate panel already surfaced them in TUI sessions — execute its decision; otherwise relay them verbatim to the user and wait.",
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
				if (/^outcome:\s*\S+/m.test(r.output) || subcommand === "abort") {
					await gateApi()?.runFinished(cwd);
				}
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
			"Focus the visible no-mistakes pane for the active run, re-open it when it was closed, or enable or disable yolo standing consent (`/no-mistakes yolo` / `yolo off`).",
		handler: async (args, ctx) => {
			const state = ensureWatchState(pi);
			const arg = (args ?? "").trim();
			if (arg === "stop") {
				ctx.ui.notify(
					"/no-mistakes stop is not available — use the no_mistakes_axi tool with `abort` to cancel the run itself.",
					"info",
				);
				return;
			}
			if (arg === "yolo" || arg === "yolo off") {
				const api = gateApi();
				if (!api) {
					ctx.ui.notify(
						"/no-mistakes yolo needs the no-mistakes-gate extension, which is not loaded.",
						"warning",
					);
					return;
				}
				const on = arg !== "yolo off";
				const result = await api.setYolo(ctx.cwd, on);
				ctx.ui.notify(
					on
						? result.activeRun
							? "Yolo enabled for the active run in this worktree — later gates are driven with --yes, without panels."
							: "Yolo armed for the next run in this worktree — its gates will be driven with --yes, without panels."
						: "Yolo disabled — gates surface the decision panel again.",
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

	// Structured transcript row for each delivered result (prototype A): the
	// row renders a summary built from the TOON — never the raw TOON schema
	// or the agent-facing guidance prose. The steer content stays unchanged;
	// only the human-facing rendering differs.
	//
	//   collapsed: one compressed line — state, severity/ask-user counts,
	//             inline error note, and the Ctrl+O hint
	//   Ctrl+O (options.expanded, driven by CustomMessageComponent): the
	//             framed error/findings/steps/help report with wrapped rows;
	//             unparsed output falls back to the raw body
	//   Ctrl+Q  (shortcut registered by tool-call-renderer-public): emits
	//             NM_TOGGLE_EVENT with the absolute hidden state; the handler
	//             assigns nmRowsHidden and the shortcut's notify-triggered
	//             render pass re-renders these cache-free rows as a one-line
	//             ghost row.
	pi.events.on(NM_TOGGLE_EVENT, (hidden: unknown) => {
		if (typeof hidden === "boolean") nmRowsHidden = hidden;
	});
	pi.registerMessageRenderer(NM_RESULT_MESSAGE, (message, options, theme) => {
		const details = message.details as
			| {
				subcommand?: string;
				exitCode?: number;
				timedOut?: boolean;
				gate?: boolean;
				outcome?: string;
				gateDecision?: { type: string; findings?: string[] };
				yolo?: boolean;
			}
			| undefined;
		const content = String(message.content ?? "");
		const report = parseNoMistakesResult(content);
		const subcommand = details?.subcommand ?? "axi";
		const gate = report.gate ?? report.run?.gate;
		const outcome = report.outcome ?? report.run?.outcome;
		const decision = details?.gateDecision;
		const decisionLabel = decision
			? decision.type === "fix" && decision.findings
				? `fix ${decision.findings.join(",")}`
				: decision.type
			: details?.yolo
				? "yolo · standing"
				: undefined;
		const state = details?.timedOut
			? "timed out"
			: details?.gate && decisionLabel
				? `gate · ${decisionLabel}`
				: gate
					? `gate: ${gate}`
					: outcome
						? `outcome: ${outcome}`
						: report.error
							? "error"
							: details?.gate
								? "gate · awaiting decision"
								: details?.outcome
									? `outcome: ${details.outcome}`
									: `exit ${details?.exitCode ?? -1}`;
		return {
			render(width: number): string[] {
				return renderNmResultRow(theme, { subcommand, state, report, content, expanded: options.expanded, width });
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

// ---------------------------------------------------------------------------
// Structured result-row rendering (prototype A). All state is read inside
// render() with no caching, so a Ctrl+Q visibility flip shows on the next
// render pass without per-row invalidation.
// ---------------------------------------------------------------------------

interface NmRowTheme {
	fg(name: string, text: string): string;
	bold(text: string): string;
}

function severityMark(severity: string): { mark: string; color: string } {
	const normalized = severity.toLowerCase();
	if (normalized.includes("err") || normalized === "fatal") return { mark: "!", color: "error" };
	if (normalized.includes("warn")) return { mark: "▲", color: "warning" };
	return { mark: "·", color: "muted" };
}

function phaseMark(status: string): { mark: string; color: string } {
	if (["completed", "passed", "checks-passed", "skipped"].includes(status)) return { mark: "✓", color: "success" };
	if (["awaiting_approval", "fix_review"].includes(status)) return { mark: "◆", color: "warning" };
	if (["running", "fixing"].includes(status)) return { mark: "◇", color: "accent" };
	if (status === "failed" || status === "cancelled") return { mark: "×", color: "error" };
	return { mark: "⋯", color: "muted" };
}

function formatMs(ms: number | undefined): string {
	if (ms == null || !Number.isFinite(ms)) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function phaseStrip(theme: NmRowTheme, report: NoMistakesResultReport): string | undefined {
	const phases = report.run?.phases ?? [];
	if (!phases.length) return undefined;
	return phases
		.map((phase) => {
			const { mark, color } = phaseMark(phase.status);
			const duration = formatMs(phase.durationMs);
			return theme.fg("dim", `${theme.fg(color, `${mark} ${phase.name}`)}${duration ? ` ${duration}` : ""}`);
		})
		.join(theme.fg("dim", " · "));
}

/** Compact severity/action counts for the one-line collapsed row:
 *  `!1 ▲2 ·1 ?1` — errors, warnings, info, ask-user. */
function findingCounts(
	theme: NmRowTheme,
	findings: Array<{ severity: string; action?: string }>,
): string | undefined {
	if (!findings.length) return undefined;
	const errors = findings.filter((finding) => severityMark(finding.severity).mark === "!").length;
	const warnings = findings.filter((finding) => severityMark(finding.severity).mark === "▲").length;
	const infos = findings.length - errors - warnings;
	const askUser = findings.filter((finding) => finding.action === "ask-user").length;
	const bits: string[] = [];
	if (errors) bits.push(theme.fg("error", `!${errors}`));
	if (warnings) bits.push(theme.fg("warning", `▲${warnings}`));
	if (infos) bits.push(theme.fg("muted", `·${infos}`));
	if (askUser) bits.push(theme.fg("customMessageLabel", `?${askUser}`));
	return bits.join(" ") || undefined;
}

function wrapRow(prefix: string, body: string, width: number): string[] {
	return wrapTextWithAnsi(body, Math.max(1, width - visibleWidth(prefix)))
		.map((line) => `${prefix}${line}`);
}

function findingRow(
	theme: NmRowTheme,
	finding: { id?: string; severity: string; file?: string; action?: string; description: string },
	width: number,
): string[] {
	const { color } = severityMark(finding.severity);
	const id = (finding.id ?? "  ").padEnd(2);
	const severity = finding.severity.padEnd(7);
	const action = (finding.action ?? "").padEnd(9);
	const actionColor = finding.action === "ask-user" ? "customMessageLabel" : "muted";
	const prefix = `   ${theme.fg("borderMuted", "│")} `;
	const head = `${theme.fg("warning", id)} ${theme.fg(color, severity)} ${theme.fg(actionColor, action)} ${theme.fg("mdLink", finding.file ?? "")}`;
	const lines = wrapRow(prefix, head, width);
	if (finding.description) {
		lines.push(...wrapRow(`${prefix}    `, theme.fg("text", finding.description), width));
	}
	return lines;
}

function renderNmResultRow(
	theme: NmRowTheme,
	args: {
		subcommand: string;
		state: string;
		report: NoMistakesResultReport;
		content: string;
		expanded: boolean;
		width: number;
	},
): string[] {
	const { subcommand, state, report, content, expanded, width } = args;
	const title = theme.fg("toolTitle", theme.bold(`no-mistakes · ${subcommand}`));
	const counts = findingCounts(theme, report.findings);
	const countsSuffix = counts ? theme.fg("dim", " · ") + counts : "";

	// Ctrl+Q hidden class: one ghost line, nothing else.
	if (nmRowsHidden) {
		return ["", ` ${theme.fg("muted", `▹ no-mistakes · ${subcommand} — ${state}`)}${theme.fg("muted", counts ? ` · ${counts}` : "")}`]
			.map((line) => truncateAnsi(line, width));
	}

	const header = ` ${theme.fg("accent", "◆")} ${title}${theme.fg("dim", `  ${state}`)}${countsSuffix}`;
	const structured = Boolean(
		report.gate || report.outcome || report.error || report.findings.length || report.help.length || report.run,
	);

	if (!structured) {
		const raw = content.split("\n");
		const shown = expanded ? raw : raw.slice(0, 6);
		const lines = [
			"",
			header,
			...shown.flatMap((line) => wrapTextWithAnsi(theme.fg("dim", line), Math.max(1, width))),
		];
		if (!expanded) lines.push(`   ${theme.fg("muted", "Ctrl+O full report")}`);
		else lines.push(` ${theme.fg("muted", "Ctrl+O collapse · Ctrl+Q hide all nm rows")}`);
		return lines.map((line) => truncateAnsi(line, width));
	}

	if (!expanded) {
		// Compressed: everything on one line — state, severity/ask-user
		// counts, and the expand hint. Details live behind Ctrl+O, except an
		// error message, which stays visible on the line.
		const errorNote = report.error
			? theme.fg("error", ` — ${report.error}`)
			: "";
		const line = `${header}${errorNote}  ${theme.fg("muted", "Ctrl+O")}`;
		return ["", truncateAnsi(line, width)];
	}

	const lines = ["", header];
	if (report.error) {
		lines.push(`   ${theme.fg("borderMuted", "┌ error ────")}`);
		lines.push(...wrapRow(`   ${theme.fg("borderMuted", "│")} `, theme.fg("error", report.error), width));
	}
	if (report.findings.length) {
		lines.push(`   ${theme.fg("borderMuted", report.error ? "├ findings ─" : "┌ findings ─")}`);
		for (const finding of report.findings) lines.push(...findingRow(theme, finding, width));
	}
	const strip = phaseStrip(theme, report);
	if (strip) {
		lines.push(`   ${theme.fg("borderMuted", report.error || report.findings.length ? "├ steps ───" : "┌ steps ───")}`);
		lines.push(...wrapRow(`   ${theme.fg("borderMuted", "│")} `, strip, width));
	}
	if (report.help.length) {
		lines.push(`   ${theme.fg("borderMuted", "└ help:")}`);
		for (const hint of report.help) {
			lines.push(...wrapRow(`   ${theme.fg("borderMuted", "  ")}`, theme.fg("dim", hint), width));
		}
	} else if (report.error || report.findings.length || strip) {
		lines.push(`   ${theme.fg("borderMuted", "└")}`);
	}
	lines.push(`   ${theme.fg("muted", "Ctrl+O collapse · Ctrl+Q hide all nm rows")}`);
	return lines.map((line) => truncateAnsi(line, width));
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
