import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Editor, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { NUMBER_SHORTCUT_LIMIT, numberShortcutIndex } from "./user-input/option-shortcuts";
import {
	addWrapped,
	createEditorTheme,
	editorInnerLines,
	frameMerged,
} from "./ask-user-question";
import {
	isObservableNoMistakesRun,
	parseNoMistakesGate,
	parseNoMistakesStatus,
	type NoMistakesGate,
	type NoMistakesGateFinding,
} from "./no-mistakes-pane/status";

// ---------------------------------------------------------------------------
// no-mistakes-gate — surface every parked no-mistakes gate to the user as a
// customized decision panel, and steer their decision back with the result.
//
// The no-mistakes-pane extension owns the async axi watcher. When a run or
// respond result parks the run at a `gate:`, it calls this extension through
// a small API registered on globalThis (same loose-coupling pattern as the
// shared UI lock):
//
//   - handleGate(): open the gate panel and resolve with the user's decision:
//     approve, fix (+ selected finding ids, + optional fix guidance), skip,
//     or yolo. The panel pages: an overview page lists every finding as one
//     short line, then Tab/⇧Tab step through per-finding pages where each
//     finding is approved, marked fix, or ignored. Ctrl-A accepts every
//     finding and approves the step from any page (never while the fix
//     guidance editor has focus). Returns null when no panel can open (no
//     TUI), so the pane falls back to steering the raw result for text relay.
//   - yolo state: the `y` shortcut inside the panel grants standing consent
//     for the rest of the run (`respond --yes` at every gate, no more
//     panels); `/no-mistakes yolo` enables it and `yolo off` disables it.
//     Consent is bound to one
//     run: a terminal outcome or a fresh `axi run` retires it, and a consent
//     set while no run is active stays pending for the next run.
//
// The pane defers steering the gate result until the panel resolves, then
// sends one message: the TOON output plus the user's decision. The agent
// executes the decision; it never relays findings the panel already showed.
//
// Reload safety mirrors no-mistakes-pane: module state lives on globalThis
// and a re-import tears the previous registration down. A panel that is open
// during a reload is left to resolve on its own — the daemon run is never
// touched.
// ---------------------------------------------------------------------------

/** Decision types the panel can resolve to. `null` (from handleGate, not a
 *  decision) means "not handled — no panel could open". */
export type NoMistakesGateDecision =
	| { type: "approve" }
	| { type: "fix"; findings: string[]; instructions?: string }
	| { type: "skip" }
	| { type: "yolo" };

export interface NoMistakesGateApi {
	/** Open the gate panel for a parked-gate result and resolve with the
	 *  user's decision, or null when no panel can open. */
	handleGate(payload: {
		output: string;
		cwd: string;
		subcommand: string;
		branch?: string;
		runId?: string;
	}): Promise<NoMistakesGateDecision | null>;
	/** Standing --yes consent currently covers this exact run. */
	yoloActive(runId: string | undefined): boolean;
	/** Set standing consent. Resolves whether an active run is bound now
	 *  (false = the consent stays pending for the next run). */
	setYolo(cwd: string, on: boolean): Promise<{ on: boolean; activeRun: boolean }>;
	/** Bind pending consent to an observed run, or retire another run's consent. */
	runObserved(cwd: string, runId?: string): Promise<string | undefined>;
	/** The run in this worktree reached a terminal state: consent expires. */
	runFinished(cwd: string, runId?: string): Promise<void>;
}

export const GATE_API_KEY = Symbol.for("pi-no-mistakes/gate-api");
const GATE_STATE_KEY = Symbol.for("pi-no-mistakes/gate-state");

interface GateState {
	pi: ExtensionAPI;
	/** Stashed ExtensionContext (from session_start/turn_start) — the only
	 *  place a watcher-side panel can get a `ctx.ui` from. */
	ctx: { hasUI: boolean; mode: string; ui: any } | undefined;
	yolo: Map<string, { runId?: string }>;
}

{
	const previous = (globalThis as any)[GATE_STATE_KEY] as GateState | undefined;
	if (previous) previous.yolo.clear();
	(globalThis as any)[GATE_STATE_KEY] = undefined;
	(globalThis as any)[GATE_API_KEY] = undefined;
}

function ensureGateState(pi: ExtensionAPI): GateState {
	let state = (globalThis as any)[GATE_STATE_KEY] as GateState | undefined;
	if (state) {
		state.pi = pi;
		return state;
	}
	state = { pi, ctx: undefined, yolo: new Map() };
	(globalThis as any)[GATE_STATE_KEY] = state;
	return state;
}

// ---------------------------------------------------------------------------
// Shared UI mutex — same globalThis lock every pop-up tool uses, so the gate
// panel queues behind (and blocks) quiz/ask/run-command panels.
// ---------------------------------------------------------------------------
const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let chain: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			withLock<U>(lockFn: () => U | Promise<U>): Promise<U> {
				const prev = chain;
				let release: () => void;
				chain = new Promise<void>((r) => { release = r; });
				return prev.then(lockFn).finally(() => release!());
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY].withLock(fn);
}

// ---------------------------------------------------------------------------
// Finding highlighting
// ---------------------------------------------------------------------------
function boldText(theme: any, text: string): string {
	return typeof theme.bold === "function" ? theme.bold(text) : text;
}

function severityGlyph(severity: string, theme: any): string {
	const value = severity.toLowerCase();
	if (value === "error") return theme.fg("error", "✖");
	if (value === "warning") return theme.fg("warning", "⚠");
	return theme.fg("dim", "ℹ");
}

function actionBadge(action: string, theme: any): string {
	const value = action.toLowerCase();
	if (value === "ask-user") return theme.fg("accent", boldText(theme, "ask-user"));
	if (value === "auto-fix") return theme.fg("success", "auto-fix");
	if (value === "no-op") return theme.fg("dim", "no-op");
	return theme.fg("muted", action || "finding");
}

function findingLocation(finding: NoMistakesGateFinding): string | undefined {
	if (!finding.file) return undefined;
	return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function findingCounts(gate: NoMistakesGate): string | undefined {
	if (gate.findings.length === 0) return undefined;
	const byAction = new Map<string, number>();
	for (const finding of gate.findings) {
		const key = finding.action.toLowerCase() || "other";
		byAction.set(key, (byAction.get(key) ?? 0) + 1);
	}
	const parts = ["ask-user", "auto-fix", "no-op"]
		.filter((key) => byAction.has(key))
		.map((key) => `${byAction.get(key)} ${key}`);
	const other = gate.findings.length - ["ask-user", "auto-fix", "no-op"]
		.reduce((sum, key) => sum + (byAction.get(key) ?? 0), 0);
	if (other > 0) parts.push(`${other} other`);
	return `${gate.findings.length} findings — ${parts.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// The gate panel — paged. The overview page lists every finding as one short
// line with its current choice at the right edge. Tab/⇧Tab step through the
// per-finding pages, where each finding is approved, marked fix, or ignored;
// choosing a finding's option advances to the next finding and wraps home.
// Ctrl-A accepts every finding and approves the step from any page — never
// while the fix guidance editor expects input.
// ---------------------------------------------------------------------------
type OverviewOption = "approve" | "fix" | "skip";
type FindingChoice = "approve" | "fix" | "ignore";

const OVERVIEW_LABEL: Record<OverviewOption, string> = {
	approve: "Approve — accept this step as-is and continue",
	fix: "Fix — pipeline fixes the findings marked fix",
	skip: "Skip — skip this step",
};

const FINDING_LABEL: Record<FindingChoice, string> = {
	approve: "Approve — accept this finding as-is",
	fix: "Fix — mark this finding for the pipeline to fix",
	ignore: "Ignore — pass on this finding, leave it unfixed",
};

function askGateDecision(
	ctx: { hasUI: boolean; mode: string; ui: any },
	gate: NoMistakesGate,
	payload: { branch?: string; runId?: string },
): Promise<NoMistakesGateDecision> {
	return ctx.ui.custom<NoMistakesGateDecision>(
		(tui: any, theme: any, _kb: any, done: (result: NoMistakesGateDecision) => void) => {
			type Phase = "overview" | "finding" | "instructions";

			let phase: Phase = "overview";
			/** Page index: 0 = overview, 1..findings.length = finding pages. */
			let pageIndex = 0;
			let optionIndex = 0;
			let panelFocused = false;
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;
			/** Per-finding choice made on its page. Findings without a mark are
			 *  never fixed; approve and ignore only differ in presentation. */
			const marks = new Map<string, FindingChoice>();
			const editor = new Editor(tui, createEditorTheme(theme));

			const actionable = gate.findings.filter(
				(finding) => finding.action.toLowerCase() !== "no-op",
			);
			const overviewOptions: OverviewOption[] =
				actionable.length > 0 ? ["approve", "fix", "skip"] : ["approve", "skip"];
			const pageCount = 1 + gate.findings.length;

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			/** Choices offered on a finding's page. The pipeline cannot fix a
			 *  no-op finding, so its page offers no Fix option. */
			function findingOptions(finding: NoMistakesGateFinding): FindingChoice[] {
				return finding.action.toLowerCase() === "no-op"
					? ["approve", "ignore"]
					: ["approve", "fix", "ignore"];
			}

			function fixMarkedIds(): string[] {
				return gate.findings
					.filter((finding) => marks.get(finding.id) === "fix")
					.map((finding) => finding.id);
			}

			function finishFix(instructions?: string): NoMistakesGateDecision {
				return { type: "fix", findings: fixMarkedIds(), instructions };
			}

			/** Jump to a page (wrapping in both directions) and focus its first
			 *  option — or the finding's chosen option when revisiting a page. */
			function gotoPage(target: number) {
				pageIndex = ((target % pageCount) + pageCount) % pageCount;
				phase = pageIndex === 0 ? "overview" : "finding";
				optionIndex = 0;
				if (phase === "finding") {
					const finding = gate.findings[pageIndex - 1]!;
					const mark = marks.get(finding.id);
					if (mark) optionIndex = Math.max(0, findingOptions(finding).indexOf(mark));
				}
				refresh();
			}

			function chooseOverviewOption(option: OverviewOption) {
				if (option === "approve") {
					done({ type: "approve" });
					return;
				}
				if (option === "skip") {
					done({ type: "skip" });
					return;
				}
				if (fixMarkedIds().length === 0) {
					refresh(); // nothing marked fix yet: the option stays disabled
					return;
				}
				phase = "instructions";
				editor.setText("");
				editor.focused = panelFocused;
				refresh();
			}

			function chooseFindingOption(finding: NoMistakesGateFinding, choice: FindingChoice) {
				marks.set(finding.id, choice);
				gotoPage(pageIndex + 1); // one finding after the other, wrapping home
			}

			function handleInput(data: string) {
				if (phase === "instructions") {
					if (matchesKey(data, Key.escape)) {
						gotoPage(0);
						editor.focused = false;
						editor.setText("");
						return;
					}
					if (matchesKey(data, Key.enter)) {
						const text = editor.getText().trim();
						done(finishFix(text.length > 0 ? text : undefined));
						return;
					}
					editor.handleInput(data);
					refresh();
					return;
				}

				// Ctrl-A accepts every finding and approves this step as-is,
				// from any page — but never while the editor expects input.
				if (matchesKey(data, Key.ctrl("a"))) {
					done({ type: "approve" });
					return;
				}

				// Yolo shortcut: standing consent for the rest of this run.
				if (matchesKey(data, "y")) {
					done({ type: "yolo" });
					return;
				}

				// Tab / Shift-Tab page between the overview and each finding.
				if (matchesKey(data, Key.tab)) {
					gotoPage(pageIndex + 1);
					return;
				}
				if (matchesKey(data, Key.shift("tab"))) {
					gotoPage(pageIndex - 1);
					return;
				}

				if (phase === "overview") {
					const shortcut = numberShortcutIndex(data, overviewOptions.length);
					if (shortcut !== undefined) {
						optionIndex = shortcut;
						chooseOverviewOption(overviewOptions[shortcut]);
						return;
					}
					if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
						optionIndex = Math.max(0, optionIndex - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
						optionIndex = Math.min(overviewOptions.length - 1, optionIndex + 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
						chooseOverviewOption(overviewOptions[optionIndex]);
					}
					return;
				}

				// finding page
				const finding = gate.findings[pageIndex - 1]!;
				const options = findingOptions(finding);
				const shortcut = numberShortcutIndex(data, options.length);
				if (shortcut !== undefined) {
					optionIndex = shortcut;
					chooseFindingOption(finding, options[shortcut]);
					return;
				}
				if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
					optionIndex = Math.min(options.length - 1, optionIndex + 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
					chooseFindingOption(finding, options[optionIndex]);
					return;
				}
				if (matchesKey(data, Key.escape)) {
					gotoPage(0);
				}
			}

			function choiceMark(choice: FindingChoice | undefined): string {
				if (choice === "fix") return theme.fg("success", "fix");
				if (choice === "approve") return theme.fg("accent", "approve");
				if (choice === "ignore") return theme.fg("muted", "ignore");
				return theme.fg("dim", "—");
			}

			/** One overview line per finding: severity, classification, id,
			 *  location, a one-line description, and the page's choice at the
			 *  right edge. */
			function overviewFindingLine(finding: NoMistakesGateFinding, tw: number): string {
				const head = [
					severityGlyph(finding.severity, theme),
					actionBadge(finding.action, theme),
					theme.fg("muted", finding.id),
				];
				const location = findingLocation(finding);
				if (location) head.push(theme.fg("muted", location));
				const left = truncateToWidth(
					` ${head.join(" ")} · ${finding.description}`,
					Math.max(1, tw - 8),
				);
				const mark = choiceMark(marks.get(finding.id));
				const pad = Math.max(1, tw - visibleWidth(left) - visibleWidth(mark));
				return `${left}${" ".repeat(pad)}${mark}`;
			}

			function render(width: number): string[] {
				// Cache keyed on width: pi-tui re-enters render() with a new
				// width on resize without calling invalidate().
				if (cachedLines && cachedWidth === width) return cachedLines;

				const tw = Math.max(8, width - 8);
				const bw = Math.max(8, width - 4);
				const top: string[] = [];
				const bottom: string[] = [];
				const add = (text: string) => top.push(truncateToWidth(text, tw));

				add(` ${theme.fg("accent", boldText(theme, `no-mistakes gate — ${gate.step}`))}`);
				const context = [
					payload.branch,
					payload.runId ? `run ${payload.runId}` : undefined,
				].filter(Boolean);
				if (context.length > 0) add(theme.fg("muted", ` ${context.join(" · ")}`));

				if (phase === "instructions") {
					top.push("");
					add(theme.fg("muted", ` the pipeline fixes: ${fixMarkedIds().join(", ")}`));
					top.push("");
					add(theme.fg("muted", " Optional fix guidance — Enter submits · Esc back · empty = none"));
					for (const [index, line] of editorInnerLines(editor, Math.max(1, bw - 2)).entries()) {
						bottom.push(`${index === 0 ? "› " : "  "}${line}`);
					}
				} else if (phase === "overview") {
					const counts = findingCounts(gate);
					if (counts) add(theme.fg("muted", ` ${counts}`));
					if (gate.note) {
						top.push("");
						addWrapped(top, theme.fg("muted", ` ${gate.note}`), tw);
					}
					top.push("");
					for (const finding of gate.findings) {
						top.push(overviewFindingLine(finding, tw));
					}
					top.push("");
					const fixable = fixMarkedIds().length > 0;
					for (const [index, option] of overviewOptions.entries()) {
						const focused = index === optionIndex;
						const marker = focused ? theme.fg("accent", "> ") : "  ";
						const num = theme.fg("dim", `${index + 1}.`);
						const label =
							option === "fix" && !fixable
								? "Fix — no findings marked fix yet (Tab to review them)"
								: OVERVIEW_LABEL[option];
						const enabled = option !== "fix" || fixable;
						const styled = !enabled
							? theme.fg("dim", label)
							: focused
								? theme.fg("text", label)
								: theme.fg("muted", label);
						add(`${marker}${num} ${styled}`);
					}
				} else {
					const finding = gate.findings[pageIndex - 1]!;
					add(theme.fg("muted", ` finding ${pageIndex}/${gate.findings.length}`));
					top.push("");
					const meta = [
						severityGlyph(finding.severity, theme),
						actionBadge(finding.action, theme),
						theme.fg("muted", finding.id),
					];
					const location = findingLocation(finding);
					if (location) meta.push(theme.fg("muted", location));
					add(` ${meta.join(" ")}`);
					top.push("");
					addWrapped(top, theme.fg("text", finding.description), tw, "  ");
					top.push("");
					if (finding.action.toLowerCase() === "no-op") {
						add(theme.fg("dim", " the pipeline classifies this finding no-op — it cannot be fixed"));
						top.push("");
					}
					const choice = marks.get(finding.id);
					for (const [index, option] of findingOptions(finding).entries()) {
						const focused = index === optionIndex;
						const marker = focused ? theme.fg("accent", "> ") : "  ";
						const num = theme.fg("dim", `${index + 1}.`);
						const dot = choice === option
							? theme.fg(option === "fix" ? "success" : option === "approve" ? "accent" : "muted", "● ")
							: "  ";
						const label = focused
							? theme.fg("text", FINDING_LABEL[option])
							: theme.fg("muted", FINDING_LABEL[option]);
						add(`${marker}${num} ${dot}${label}`);
					}
				}

				if (phase !== "instructions") {
					top.push("");
					// Shortcut legend: every key the panel accepts, labeled and
					// aligned, so the decision surface is always discoverable.
					const optionCount = phase === "overview"
						? overviewOptions.length
						: findingOptions(gate.findings[pageIndex - 1]!).length;
					const last = Math.min(optionCount, NUMBER_SHORTCUT_LIMIT);
					const pairs: Array<[string, string]> = [["↑↓/jk", "move"]];
					if (last > 0) {
						pairs.push([last === 1 ? "1" : `1-${last}`, phase === "overview" ? "select option" : "choose"]);
					}
					pairs.push(
						["Tab", phase === "overview" ? "review findings" : "next finding"],
						["⇧Tab", phase === "overview" ? "back" : "prev finding"],
						["Ctrl-A", "accept all"],
					);
					if (phase === "finding") pairs.push(["Esc", "overview"]);
					pairs.push(["y", "yolo this run"]);
					for (let i = 0; i < pairs.length; i += 2) {
						const cells = pairs.slice(i, i + 2).map(([key, action]) =>
							`${theme.fg("accent", key.padEnd(7))}${theme.fg("dim", action)}`);
						const prefix = i === 0 ? ` ${theme.fg("muted", "keys")}  ` : " ".repeat(7);
						add(`${prefix}${cells.join("   ")}`);
					}
					bottom.push(theme.fg("accent", "› gate decision"));
				}

				const framed = frameMerged(top, bottom, width, theme);
				cachedLines = framed;
				cachedWidth = width;
				return framed;
			}

			return {
				get focused() { return panelFocused; },
				set focused(value: boolean) {
					panelFocused = value;
					editor.focused = value && phase === "instructions";
				},
				render,
				invalidate: () => {
					cachedLines = undefined;
					editor.invalidate();
				},
				handleInput,
			};
		},
	);
}

// ---------------------------------------------------------------------------
// Extension factory + gate API
// ---------------------------------------------------------------------------
async function worktreeKey(state: GateState, cwd: string): Promise<string> {
	try {
		const result = await state.pi.exec("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 5000,
		});
		const root = result.code === 0 ? result.stdout.trim() : "";
		if (root) return resolve(root);
	} catch {
	}
	return resolve(cwd);
}

async function resolveActiveRun(state: GateState, cwd: string): Promise<string | undefined> {
	try {
		const result = await state.pi.exec("no-mistakes", ["axi", "status"], {
			cwd,
			timeout: 5000,
		});
		const snapshot = parseNoMistakesStatus(result.stdout);
		return isObservableNoMistakesRun(snapshot) ? snapshot.id : undefined;
	} catch {
		return undefined;
	}
}

export default function noMistakesGate(pi: ExtensionAPI) {
	const state = ensureGateState(pi);

	// The watcher has no ctx of its own; remember the freshest one from
	// cheap lifecycle events so handleGate can open a panel from anywhere.
	const rememberCtx = (ctx: { hasUI?: boolean; mode?: string; ui?: any } | undefined) => {
		if (ctx?.ui) state.ctx = ctx as GateState["ctx"];
	};
	pi.on("session_start", (_event, ctx) => rememberCtx(ctx));
	pi.on("turn_start", (_event, ctx) => rememberCtx(ctx));

	const api: NoMistakesGateApi = {
		async handleGate(payload) {
			const gate = parseNoMistakesGate(payload.output);
			if (!gate) return null;
			const ctx = state.ctx;
			if (!ctx?.hasUI || ctx.mode !== "tui") return null;
			try {
				const decision = await withUILock(() =>
					askGateDecision(ctx, gate, {
						branch: payload.branch,
						runId: payload.runId,
					}),
				);
				if (decision?.type === "yolo") {
					const key = await worktreeKey(state, payload.cwd);
					const runId = payload.runId ?? await resolveActiveRun(state, payload.cwd);
					state.yolo.set(key, { runId });
				}
				return decision;
			} catch {
				// Panel could not open (UI busy/failed): fall back to the
				// plain result steer so the agent relays findings as text.
				return null;
			}
		},

		yoloActive(runId) {
			if (!runId) return false;
			return Array.from(state.yolo.values()).some((consent) => consent.runId === runId);
		},

		async setYolo(cwd, on) {
			const key = await worktreeKey(state, cwd);
			if (!on) {
				state.yolo.delete(key);
				return { on: false, activeRun: false };
			}
			const runId = await resolveActiveRun(state, cwd);
			state.yolo.set(key, { runId });
			return { on: true, activeRun: Boolean(runId) };
		},

		async runObserved(cwd, runId) {
			const observedRunId = runId ?? await resolveActiveRun(state, cwd);
			if (!observedRunId) return undefined;
			const key = await worktreeKey(state, cwd);
			const consent = state.yolo.get(key);
			if (!consent) return observedRunId;
			if (!consent.runId) consent.runId = observedRunId;
			else if (consent.runId !== observedRunId) state.yolo.delete(key);
			return observedRunId;
		},

		async runFinished(cwd, runId) {
			const key = await worktreeKey(state, cwd);
			const consent = state.yolo.get(key);
			if (consent && (!runId || consent.runId === runId)) state.yolo.delete(key);
		},
	};
	(globalThis as any)[GATE_API_KEY] = api;

	pi.on("session_shutdown", () => {
		const current = (globalThis as any)[GATE_STATE_KEY] as GateState | undefined;
		if (current) current.yolo.clear();
		if ((globalThis as any)[GATE_API_KEY] === api) {
			(globalThis as any)[GATE_API_KEY] = undefined;
		}
	});
}
