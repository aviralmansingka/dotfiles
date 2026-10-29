import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
// practice — retrieval demands for earned propositions (revision mode).
//
// `problem` poses ONE practice demand: a fresh situation whose solution runs
// through named target propositions. The learner's working comes back as the
// tool result. The committed model solution stays hidden — from the panel, from
// the transcript render, and from the tool result — until `conclude` reveals it.
//
// Re-calling `problem` with the SAME statement, targets, and mode is the next
// attempt on the same problem: the attempt counter advances and the original
// commitment stands. A different problem is refused until `conclude` closes the
// active one. One problem at a time; the commitment never changes mid-problem.
//
// State is per session: the active problem lives in a module-level map keyed by
// the session file (cwd, then "anon"), so a resumed session or a parallel one
// never shares a problem.
// ────────────────────────────────────────────────────────────────────────────

export type PracticeMode = "recall" | "discrimination" | "composition";

export interface ActiveProblem {
	title: string;
	statement: string;
	modelSolution: string;
	targets: string[];
	mode: PracticeMode;
	attempt: number;
}

// The single active problem per practice session.
const activeProblems = new Map<string, ActiveProblem>();

/** Test seam: forget every active problem. */
export function __resetPracticeState(): void {
	activeProblems.clear();
}

/** Session identity for the active-problem map: session file, then cwd, then "anon". */
function stateKey(ctx: any): string {
	try {
		const file = ctx?.sessionManager?.getSessionFile?.();
		if (typeof file === "string" && file.length > 0) return file;
	} catch {
		// A failing session manager falls through to the cwd.
	}
	const cwd = ctx?.cwd;
	return typeof cwd === "string" && cwd.length > 0 ? cwd : "anon";
}

const ProblemParams = Type.Object({
	title: Type.String({
		description:
			"Short name of the target under practice. Keep it under 40 characters. The panel shows it as the heading and the journal records it as the entry heading.",
	}),
	statement: Type.String({
		description:
			"The situation that carries the demand. State it fresh: a situation that was not in the note. Markdown and LaTeX are allowed. Never restate the note's own statement.",
	}),
	modelSolution: Type.String({
		description:
			"The committed worked solution. Solve the statement yourself before you pass it. The learner never sees it until `conclude` reveals it.",
	}),
	targets: Type.Array(Type.String(), {
		description:
			"The proposition slugs from the vault that the solution runs through. At least one. A problem whose solution skips every target is unsound.",
		minItems: 1,
	}),
	mode: Type.Union(
		[Type.Literal("recall"), Type.Literal("discrimination"), Type.Literal("composition")],
		{
			description:
				"The demand type. recall: retrieve the proposition from a weak cue. discrimination: separate near-twin situations by the feature that carries the signal. composition: run the whole chain under load. Recall comes before discrimination, discrimination before composition.",
		},
	),
});

const ConcludeParams = Type.Object({
	outcome: Type.Union([Type.Literal("solved"), Type.Literal("unsolved"), Type.Literal("dismissed")], {
		description:
			"How the problem ended. solved: the working ran the target proposition cleanly. unsolved: it did not. dismissed: the learner closed it without a verdict.",
	}),
	verdict: Type.Optional(
		Type.String({
			description:
				"Your short read of the working: where it held and where the first break was. One or two sentences. Never soften or inflate it.",
		}),
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
	const promptLines = bottom.length > 0 ? bottom : [""];
	if (width < 24) return [...top, ...promptLines.map((line) => truncateToWidth(` ${line}`, width))];
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
	for (const line of promptLines) {
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
// a time, so ALL pop-up-style tools (quiz, ask_user_question, explain,
// practice, ...) must serialize against each other, not just against
// themselves. We stash one mutex on globalThis so separate extension files can
// share it without importing each other.
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

function errorResult(message: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text: message }],
		isError: true,
		details: { status: "error", error: message, ...details },
	};
}

const CANCELLED_TEXT = "The learner closed the problem without submitting. It is still active.";

// The demand panel: title, the fresh statement, and one editor for the
// learner's working. No solution, no verdict, no explanation — there is
// nothing to read here but the situation to solve.
function askForWork(ctx: any, title: string, statement: string): Promise<string | null> {
	return ctx.ui.custom<string | null>((tui: any, theme: any, _kb: any, done: (result: string | null) => void) => {
		const editor = new Editor(tui, createEditorTheme(theme));
		editor.focused = true;
		editor.disableSubmit = true;

		return {
			render(width: number): string[] {
				const tw = Math.max(8, width - 8);
				const bw = Math.max(8, width - 4);
				const top: string[] = [];
				const bottom: string[] = [];
				addWrapped(top, theme.fg("toolTitle", theme.bold(title)), tw, " ");
				top.push("");
				addWrapped(top, theme.fg("text", statement), tw, " ");
				top.push("");
				addWrapped(top, theme.fg("dim", "Enter submit · Esc close"), tw, " ");
				bottom.push(truncateToWidth(theme.fg("accent", "› your working"), bw));
				for (const line of editorInnerLines(editor, Math.max(1, bw - 2))) bottom.push(`  ${line}`);
				return frameMerged(top, bottom, width, theme);
			},

			invalidate: () => editor.invalidate(),

			handleInput(data: string) {
				if (matchesKey(data, Key.enter)) {
					done(editor.getText());
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done(null);
					return;
				}
				editor.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

interface RevealView {
	title: string;
	outcome: string;
	attempts: number;
	solution: string;
	verdict?: string;
}

// The reveal panel: the committed solution, shown only after the problem has
// concluded. The solution renders as a Text block so markdown/LaTeX prose wraps
// on its own terms instead of being folded into a hint line.
function showSolution(ctx: any, view: RevealView): Promise<void> {
	return ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: () => void) => {
		const solutionText = new Text(theme.fg("text", view.solution), 1, 0);
		const close = () => done();
		return {
			render(width: number): string[] {
				const tw = Math.max(8, width - 8);
				const top: string[] = [];
				addWrapped(top, theme.fg("toolTitle", theme.bold(view.title)), tw, " ");
				top.push("");
				addWrapped(
					top,
					`${theme.fg("accent", view.outcome)} · ${view.attempts} attempt${view.attempts === 1 ? "" : "s"}`,
					tw,
					" ",
				);
				if (view.verdict) addWrapped(top, theme.fg("muted", view.verdict), tw, " ");
				top.push("");
				addWrapped(top, theme.fg("muted", "Model solution (committed before posing):"), tw, " ");
				for (const line of solutionText.render(tw)) top.push(truncateToWidth(line, tw));
				top.push("");
				addWrapped(top, theme.fg("dim", "Enter close · Esc close"), tw, " ");
				return frameMerged(top, [], width, theme);
			},
			invalidate: () => solutionText.invalidate(),
			handleInput(data: string) {
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
					close();
					return;
				}
				tui.requestRender();
			},
		};
	});
}

export default function practice(pi: ExtensionAPI) {
	pi.registerTool({
		name: "problem",
		label: "problem",
		exposure: "deferred",
		description:
			"Pose one practice demand. The learner's working returns as the tool result. The committed model solution stays hidden until conclude. Re-call with the same problem for the next attempt. Call conclude before a different problem. One problem at a time.",
		promptSnippet:
			"Use problem to pose one retrieval demand on earned propositions. The working comes back; the committed solution stays hidden until conclude.",
		promptGuidelines: [
			"Solve your own statement and shortcut-hunt it before you pose it. Never pose what you have not solved.",
			"Pass the same title, statement, targets, and mode again for the next attempt on the same problem. The attempt counter advances, and the commitment cannot change.",
			"A different problem is refused while one is active. Call conclude first.",
			"Never name the target proposition in the statement, and never show the note's own statement.",
		],
		parameters: ProblemParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const title = (params.title ?? "").trim();
			const statement = (params.statement ?? "").trim();
			const modelSolution = (params.modelSolution ?? "").trim();
			const targets = (params.targets ?? []).map((t: string) => String(t).trim()).filter(Boolean);
			const mode = params.mode as PracticeMode;

			if (!title) return errorResult("problem requires a non-empty `title`.");
			if (!statement) return errorResult("problem requires a non-empty `statement`.", { title });
			if (!modelSolution) {
				return errorResult("problem requires a non-empty `modelSolution`. Solve the statement before you pose it.", {
					title,
				});
			}
			if (targets.length === 0) {
				return errorResult("problem requires at least one target proposition slug.", { title });
			}
			if (!ctx.hasUI) return errorResult("problem requires interactive mode UI.", { title });

			const key = stateKey(ctx);
			const active = activeProblems.get(key);

			if (signal?.aborted) {
				// The turn was interrupted before the panel opened: nothing was posed, so
				// the attempt count does not advance and the stored problem stands.
				return {
					content: [{ type: "text" as const, text: CANCELLED_TEXT }],
					details: { status: "cancelled", title: active?.title ?? title, attempt: active?.attempt ?? 1 },
				};
			}

			let attempt = 1;
			if (active) {
				const sameTargets =
					active.targets.length === targets.length && active.targets.every((t, i) => t === targets[i]);
				if (active.statement !== statement || !sameTargets || active.mode !== mode) {
					return errorResult(`A problem is already active (${active.title}). Call conclude before posing another.`, {
						title: active.title,
					});
				}
				if (active.modelSolution !== modelSolution) {
					return errorResult(
						`This problem is already posed with a committed solution (attempt ${active.attempt}). The commitment cannot change mid-problem: re-pose it verbatim, or conclude it first.`,
						{ title: active.title },
					);
				}
				attempt = active.attempt + 1;
			}

			// Store the problem (or the advanced attempt) before the panel opens: the
			// demand exists whether or not the learner submits it.
			activeProblems.set(key, { title, statement, modelSolution, targets, mode, attempt });

			const work = await withUILock(() => askForWork(ctx, title, statement));
			if (work === null) {
				return {
					content: [{ type: "text" as const, text: CANCELLED_TEXT }],
					details: { status: "cancelled", title, attempt },
				};
			}

			const working = work.trim();
			let text = `Attempt ${attempt} — the learner's working:\n${working}`;
			if (targets.length > 0) text += `\nTargets: ${targets.join(", ")}`;

			return {
				content: [{ type: "text" as const, text }],
				details: {
					status: "submitted",
					title,
					statement,
					mode,
					targets,
					attempt,
					work: working,
				},
			};
		},

		renderCall(args, theme) {
			// NEVER render modelSolution here: it would leak the commitment into
			// the transcript before the learner has worked the problem.
			let text = theme.fg("toolTitle", theme.bold("problem "));
			if (args.title) text += theme.fg("accent", String(args.title)) + " ";
			if (args.mode) text += theme.fg("dim", `[${args.mode}]`);
			const targets = Array.isArray(args.targets) ? args.targets.filter(Boolean) : [];
			if (targets.length > 0) {
				const noun = targets.length === 1 ? "target" : "targets";
				text += theme.fg("dim", ` (${targets.length} ${noun})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", CANCELLED_TEXT), 0, 0);
			}
			if (details.status === "error") {
				return new Text(theme.fg("warning", String(details.error ?? "problem unavailable")), 0, 0);
			}
			const lines: string[] = [];
			let heading = theme.fg("toolTitle", theme.bold("problem "));
			if (details.title) heading += theme.fg("accent", details.title) + " ";
			if (details.mode) heading += theme.fg("dim", `[${details.mode}] `);
			lines.push(heading + theme.fg("dim", `attempt ${details.attempt}`));
			if (details.work) {
				for (const line of String(details.work).split("\n")) lines.push(theme.fg("text", ` ${line}`));
			} else {
				lines.push(theme.fg("warning", " (submitted empty working)"));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "conclude",
		label: "conclude",
		exposure: "deferred",
		description:
			"End the active problem, reveal the committed solution, and record the outcome. After it, stop and wait for the learner's explicit go-ahead before the next problem.",
		promptSnippet:
			"Use conclude to close the active problem: it reveals the committed solution and records the outcome. Then stop until the learner asks for the next problem.",
		promptGuidelines: [
			"Conclude when the working is solved, or when the learner explicitly asks to stop. A claimed answer is not a progress signal by itself.",
			"Give the verdict straight: where the working held, and where the first break was. Never soften or inflate it.",
			"After conclude, stop. The next problem waits for an explicit go-ahead. A clarification question is not a go-ahead.",
		],
		parameters: ConcludeParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const key = stateKey(ctx);
			const active = activeProblems.get(key);
			if (!active) {
				return errorResult("No problem is active. Pose one with the `problem` tool first.");
			}
			const outcome = params.outcome;
			const verdict = params.verdict?.trim() || undefined;

			// Clear the state first: the problem is closed the moment conclude is
			// called, even if the learner leaves the reveal panel untouched.
			activeProblems.delete(key);

			if (ctx.hasUI) {
				try {
					await withUILock(() =>
						showSolution(ctx, {
							title: active.title,
							outcome,
							attempts: active.attempt,
							solution: active.modelSolution,
							verdict,
						}),
					);
				} catch {
					// The reveal panel is a courtesy: a UI failure never blocks the
					// result the agent needs.
				}
			}

			const lines = [`Outcome: ${outcome}.`, "Model solution (committed before posing):", active.modelSolution];
			lines.push("", `Attempts: ${active.attempt}`);
			if (verdict) lines.push(`Verdict: ${verdict}`);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					status: "concluded",
					title: active.title,
					outcome,
					solution: active.modelSolution,
					attempts: active.attempt,
					targets: active.targets,
					mode: active.mode,
					verdict,
				},
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("conclude "));
			if (args.outcome) text += theme.fg("accent", String(args.outcome));
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.status === "error") {
				return new Text(theme.fg("warning", String(details.error ?? "conclude unavailable")), 0, 0);
			}
			const lines: string[] = [];
			let heading = theme.fg("toolTitle", theme.bold("concluded "));
			if (details.title) heading += theme.fg("accent", details.title) + " ";
			heading += theme.fg("dim", `${details.outcome} · ${details.attempts} attempt${details.attempts === 1 ? "" : "s"}`);
			lines.push(heading);
			if (details.verdict) lines.push(theme.fg("muted", ` ${details.verdict}`));
			lines.push(theme.fg("muted", "─ model solution ─"));
			for (const line of String(details.solution ?? "").split("\n")) lines.push(theme.fg("text", ` ${line}`));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
