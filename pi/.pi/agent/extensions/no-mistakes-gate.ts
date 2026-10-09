import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	joinHints,
	NAVIGATION_HINT,
	numberShortcutHint,
	numberShortcutIndex,
} from "./user-input/option-shortcuts";
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
//   - handleGate(): open the gate panel (findings highlighted by severity and
//     pipeline action classification) and resolve with the user's decision:
//     approve, fix (+ selected finding ids, + optional fix guidance), skip,
//     yolo, or dismissed (Esc). Returns null when no panel can open (no TUI)
//     so the pane falls back to steering the raw result for text relay.
//   - yolo state: the `y` shortcut inside the panel grants standing consent
//     for the rest of the run (`respond --yes` at every gate, no more
//     panels); `/no-mistakes yolo` toggles it too. Consent is bound to one
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
	| { type: "yolo" }
	| { type: "dismissed" };

export interface NoMistakesGateApi {
	/** Open the gate panel for a parked-gate result and resolve with the
	 *  user's decision, "dismissed", or null when no panel can open. */
	handleGate(payload: {
		output: string;
		cwd: string;
		subcommand: string;
		branch?: string;
		runId?: string;
	}): Promise<NoMistakesGateDecision | null>;
	/** Standing --yes consent currently covers the run in this worktree. */
	yoloActive(cwd: string): boolean;
	/** Toggle standing consent. Resolves whether an active run is bound now
	 *  (false = the consent stays pending for the next run). */
	setYolo(cwd: string, on: boolean): Promise<{ on: boolean; activeRun: boolean }>;
	/** A fresh `axi run` started: retire consent earned by the previous
	 *  run, keep consent that was set while idle (pending). */
	runStarted(cwd: string): void;
	/** The run in this worktree reached a terminal state: consent expires. */
	runFinished(cwd: string): void;
}

export const GATE_API_KEY = Symbol.for("pi-no-mistakes/gate-api");
const GATE_STATE_KEY = Symbol.for("pi-no-mistakes/gate-state");

interface GateState {
	pi: ExtensionAPI;
	/** Stashed ExtensionContext (from session_start/turn_start) — the only
	 *  place a watcher-side panel can get a `ctx.ui` from. */
	ctx: { hasUI: boolean; mode: string; ui: any } | undefined;
	yolo: Map<string, { pending: boolean }>;
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
// The gate panel
// ---------------------------------------------------------------------------
type DecideOption = "approve" | "fix" | "skip";

const OPTION_LABEL: Record<DecideOption, string> = {
	approve: "Approve — accept this step as-is and continue",
	fix: "Fix — select findings for the pipeline to fix",
	skip: "Skip — skip this step",
};

function askGateDecision(
	ctx: { hasUI: boolean; mode: string; ui: any },
	gate: NoMistakesGate,
	payload: { branch?: string; runId?: string },
): Promise<NoMistakesGateDecision> {
	return ctx.ui.custom<NoMistakesGateDecision>(
		(tui: any, theme: any, _kb: any, done: (result: NoMistakesGateDecision) => void) => {
			type Phase = "decide" | "select" | "instructions";
			type Row = { kind: "finding"; finding: NoMistakesGateFinding } | { kind: "submit" };

			let phase: Phase = "decide";
			let optionIndex = 0;
			let rowIndex = 0;
			let panelFocused = false;
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;
			const selected = new Map<string, NoMistakesGateFinding>();
			const editor = new Editor(tui, createEditorTheme(theme));

			const actionable = gate.findings.filter(
				(finding) => finding.action.toLowerCase() !== "no-op",
			);
			const decideOptions: DecideOption[] =
				actionable.length > 0 ? ["approve", "fix", "skip"] : ["approve", "skip"];
			const rows: Row[] = [
				...gate.findings.map((finding): Row => ({ kind: "finding", finding })),
				{ kind: "submit" },
			];

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function toggle(finding: NoMistakesGateFinding) {
				if (selected.has(finding.id)) selected.delete(finding.id);
				else selected.set(finding.id, finding);
				refresh();
			}

			function finishFix(instructions?: string): NoMistakesGateDecision {
				return {
					type: "fix",
					findings: gate.findings
						.filter((finding) => selected.has(finding.id))
						.map((finding) => finding.id),
					instructions,
				};
			}

			function chooseOption(option: DecideOption) {
				if (option === "approve") {
					done({ type: "approve" });
					return;
				}
				if (option === "skip") {
					done({ type: "skip" });
					return;
				}
				phase = "select";
				rowIndex = 0;
				refresh();
			}

			function findingLines(
				finding: NoMistakesGateFinding,
				opts: { focused: boolean; checkbox: boolean; index?: number },
				tw: number,
			): string[] {
				const head: string[] = [];
				if (opts.checkbox) {
					const marker = selected.has(finding.id) ? "[x]" : "[ ]";
					head.push(opts.focused ? theme.fg("accent", marker) : marker);
				}
				if (opts.index) head.push(theme.fg("dim", `${opts.index}.`));
				head.push(severityGlyph(finding.severity, theme));
				head.push(actionBadge(finding.action, theme));
				head.push(theme.fg("muted", finding.id));
				const location = findingLocation(finding);
				if (location) head.push(theme.fg("muted", location));
				const prefix = opts.focused ? theme.fg("accent", "> ") : "  ";
				const lines = [truncateToWidth(`${prefix}${head.join(" ")}`, tw)];
				addWrapped(lines, theme.fg("text", finding.description), tw, "     ");
				return lines;
			}

			function handleInput(data: string) {
				if (phase === "instructions") {
					if (matchesKey(data, Key.escape)) {
						phase = "select";
						editor.focused = false;
						editor.setText("");
						refresh();
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

				// Yolo shortcut: standing consent for the rest of this run.
				if (matchesKey(data, "y")) {
					done({ type: "yolo" });
					return;
				}

				if (phase === "decide") {
					const shortcut = numberShortcutIndex(data, decideOptions.length);
					if (shortcut !== undefined) {
						chooseOption(decideOptions[shortcut]);
						return;
					}
					if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
						optionIndex = Math.max(0, optionIndex - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
						optionIndex = Math.min(decideOptions.length - 1, optionIndex + 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.enter)) {
						chooseOption(decideOptions[optionIndex]);
						return;
					}
					if (matchesKey(data, Key.escape)) {
						done({ type: "dismissed" });
					}
					return;
				}

				// select phase
				const shortcut = numberShortcutIndex(data, actionable.length);
				if (shortcut !== undefined) {
					const finding = actionable[shortcut];
					rowIndex = rows.findIndex(
						(row) => row.kind === "finding" && row.finding.id === finding.id,
					);
					toggle(finding);
					return;
				}
				if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
					rowIndex = Math.max(0, rowIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
					rowIndex = Math.min(rows.length - 1, rowIndex + 1);
					refresh();
					return;
				}
				const row = rows[rowIndex];
				if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
					if (row.kind === "submit") {
						if (selected.size === 0) {
							refresh();
							return;
						}
						phase = "instructions";
						editor.setText("");
						editor.focused = panelFocused;
						refresh();
						return;
					}
					if (row.finding.action.toLowerCase() !== "no-op") toggle(row.finding);
					return;
				}
				if (matchesKey(data, Key.escape)) {
					phase = "decide";
					optionIndex = 0;
					refresh();
				}
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
				const counts = findingCounts(gate);
				if (counts) add(theme.fg("muted", ` ${counts}`));
				if (gate.note) {
					top.push("");
					addWrapped(top, theme.fg("muted", ` ${gate.note}`), tw);
				}
				top.push("");

				const showCheckboxes = phase === "select" || phase === "instructions";
				for (const [index, row] of rows.entries()) {
					if (row.kind === "submit") {
						if (!showCheckboxes) continue;
						const label =
							selected.size > 0
								? `✓ Submit fix (${selected.size} selected)`
								: "○ Submit fix (nothing selected)";
						const focused = index === rowIndex && phase === "select";
						const styled = focused
							? theme.fg("accent", label)
							: theme.fg(selected.size > 0 ? "success" : "dim", label);
						add(`${focused ? theme.fg("accent", "> ") : "  "}${styled}`);
						continue;
					}
					const finding = row.finding;
					const actionableIndex = actionable.indexOf(finding);
					for (const line of findingLines(
						finding,
						{
							focused: showCheckboxes && index === rowIndex && phase === "select",
							checkbox: showCheckboxes,
							index: showCheckboxes && actionableIndex >= 0 ? actionableIndex + 1 : undefined,
						},
						tw,
					)) {
						top.push(line);
					}
				}

				if (phase === "instructions") {
					top.push("");
					add(theme.fg("muted", " Optional guidance for the fix round — Enter submits (empty = none)"));
					for (const [index, line] of editorInnerLines(editor, Math.max(1, bw - 2)).entries()) {
						bottom.push(`${index === 0 ? "› " : "  "}${line}`);
					}
				} else {
					top.push("");
					if (phase === "select" && selected.size === 0) {
						add(theme.fg("warning", " Select at least one finding before submitting."));
					}
					const hints = joinHints(
						NAVIGATION_HINT,
						numberShortcutHint(
							phase === "decide" ? decideOptions.length : actionable.length,
							phase === "decide" ? "select" : "toggle",
						),
						...(phase === "decide"
							? ["Enter select", "y yolo this run", "Esc dismiss"]
							: ["Space toggle", "Enter toggle/submit", "y yolo this run", "Esc back"]),
					);
					add(theme.fg("dim", ` ${hints}`));
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
async function resolveActiveRun(state: GateState, cwd: string): Promise<boolean> {
	try {
		const result = await state.pi.exec("no-mistakes", ["axi", "status"], {
			cwd,
			timeout: 5000,
		});
		return isObservableNoMistakesRun(parseNoMistakesStatus(result.stdout));
	} catch {
		return false;
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
					// The y shortcut grants standing consent for this run.
					state.yolo.set(payload.cwd, { pending: false });
				}
				return decision;
			} catch {
				// Panel could not open (UI busy/failed): fall back to the
				// plain result steer so the agent relays findings as text.
				return null;
			}
		},

		yoloActive(cwd) {
			return state.yolo.has(cwd);
		},

		async setYolo(cwd, on) {
			if (!on) {
				state.yolo.delete(cwd);
				return { on: false, activeRun: false };
			}
			const activeRun = await resolveActiveRun(state, cwd);
			state.yolo.set(cwd, { pending: !activeRun });
			return { on: true, activeRun };
		},

		runStarted(cwd) {
			const consent = state.yolo.get(cwd);
			if (!consent) return;
			// Consent earned inside the previous run dies with it; consent
			// set while idle was meant for this run and binds to it now.
			if (consent.pending) consent.pending = false;
			else state.yolo.delete(cwd);
		},

		runFinished(cwd) {
			state.yolo.delete(cwd);
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
