import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	Text,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ────────────────────────────────────────────────────────────────────────────
// explain — a PROSE sibling of quiz.
//
// Where quiz grades a selection against known options, explain asks for an
// answer in the user's OWN WORDS. That is a more demanding retrieval act: no
// options to recognize, no shape to pattern-match — the user must produce the
// concept and the terminology themselves. The tool deliberately does NOT
// grade: evaluating the prose (precision of terms, hidden misconceptions) is
// the agent's job, and it happens after submit.
//
// UI: a floating panel above the prompt shows the question (and optional
// context). The response field is focused immediately — there is nothing to
// navigate. Enter submits, Ctrl+J inserts a newline (pi convention), Esc
// cancels. On submit, the question and the user's answer travel together as a
// question/answer pair for the agent to evaluate.
// ────────────────────────────────────────────────────────────────────────────

type ExplainStatus = "answered" | "cancelled" | "unavailable";

interface ExplainDetails {
	status: ExplainStatus;
	question: string;
	context?: string;
	answer?: string;
	message?: string;
}

const ExplainParams = Type.Object({
	question: Type.String({
		description:
			"The single question the user must answer in their own words. Ask exactly one question per tool call. Phrase it to force precise terminology — 'name the kernel construct and explain why', not 'what do you think about X'.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
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

// Shared UI mutex. ctx.ui.custom()/editor can only handle one active call at
// a time, so ALL pop-up-style tools (quiz, ask_user_question, run-command,
// explain, ...) must serialize against each other, not just against
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

function buildDetails(
	status: ExplainStatus,
	question: string,
	context: string | undefined,
	answer?: string,
	message?: string,
): ExplainDetails {
	return { status, question, context, answer, message };
}

function cancelledResult(question: string, context?: string) {
	const message = "User cancelled explain";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("cancelled", question, context, undefined, message),
	};
}

function unavailableResult(question: string, message: string, context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("unavailable", question, context, undefined, message),
	};
}

export default function explain(pi: ExtensionAPI) {
	pi.registerTool({
		name: "explain",
		label: "explain",
		description:
			"Ask the user to answer ONE question in their own words — a prose retrieval check, more demanding than quiz's multiple choice because there are no options to recognize. Use it to ground terminology ('name the kernel construct this touches and why') and to surface misconceptions that multiple choice can't reach. The tool does not grade: you receive the question and the user's prose answer together and evaluate precision yourself. For gradable questions with a known correct option set, use quiz; for preferences with no right answer, use ask_user_question.",
		promptSnippet:
			"Use explain to make the user answer one question in their own words (terminology grounding, mechanism explanations). You grade the prose yourself after submit.",
		promptGuidelines: [
			"ONE question per call. Phrase it to force precise terminology and mechanism, not vibes — 'why does X need Y' or 'name the construct and what it does', never 'what are your thoughts on X'.",
			"Prefer explain over quiz when you are somewhat confident where the user's understanding sits and want to verify precision of language; prefer quiz when you are still mapping the edge.",
			"Evaluate the returned answer against bounded terminology: right-but-loose language gets corrected ('right idea, the exact term is X because Y'); a revealed misconception gets named and re-asked in a different form.",
			"An empty or near-empty submission is an honest 'I don't know' — treat it as a genuine gap to teach into, not a failure.",
		],
		parameters: ExplainParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const question = params.question.trim();
			const context = params.details?.trim() || undefined;

			if (signal?.aborted) {
				return cancelledResult(question, context);
			}
			if (!question) {
				return unavailableResult(question, "explain requires a non-empty question", context);
			}
			if (!ctx.hasUI) {
				return unavailableResult(question, "explain requires interactive mode UI", context);
			}

			return withUILock(async () => {
				const answer = await ctx.ui.custom<string | null>(
					(tui: any, theme: any, _kb: any, done: (result: string | null) => void) => {
						// The response field owns the whole interaction — there is nothing
						// else to navigate, so it is focused immediately. Enter must NOT
						// submit inside the editor (its submit path clears the buffer), so
						// disableSubmit and let the host own Enter. Ctrl+J still inserts a
						// newline (pi convention) for multi-line prose.
						const editor = new Editor(tui, createEditorTheme(theme));
						editor.focused = true;
						editor.disableSubmit = true;

						return {
							render(width: number): string[] {
								const lines: string[] = [];
								const add = (s: string) => lines.push(truncateToWidth(s, width));

								add(theme.fg("accent", "─".repeat(width)));
								add(theme.fg("toolTitle", theme.bold(" explain in your own words")));
								lines.push("");
								addWrapped(lines, theme.fg("text", question), width, " ");
								if (context) {
									lines.push("");
									addWrapped(lines, theme.fg("muted", context), width, " ");
								}
								lines.push("");
								for (const line of editor.render(width)) lines.push(line);
								lines.push("");
								add(theme.fg("dim", " Enter — submit · Ctrl+J — new line · Esc — cancel"));
								return lines;
							},

							invalidate: () => {
								editor.invalidate();
							},

							handleInput(data: string) {
								if (matchesKey(data, Key.enter)) {
									done(editor.getText().trim());
									return;
								}
								if (matchesKey(data, Key.escape)) {
									done(null);
									return;
								}
								editor.handleInput(data);
							},
						};
					},
				);

				if (answer === null) {
					return cancelledResult(question, context);
				}
				let text: string;
				if (answer) {
					text = `Question: ${question}\nUser's answer (their own words):\n${answer}`;
				} else {
					text = `Question: ${question}\nUser submitted an EMPTY answer — treat this as an honest "I don't know": a genuine gap to teach into, not a failure.`;
				}
				return {
					content: [{ type: "text" as const, text }],
					details: buildDetails("answered", question, context, answer || undefined),
				};
			});
		},

		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("explain ")) + theme.fg("muted", String(args.question ?? "")), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as ExplainDetails | undefined;
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
			lines.push(theme.fg("toolTitle", theme.bold("explain ")) + theme.fg("text", details.question));
			if (details.answer) {
				lines.push(theme.fg("muted", "─ answer ─"));
				for (const line of details.answer.split("\n")) {
					lines.push(theme.fg("dim", ` ${line}`));
				}
			} else {
				lines.push(theme.fg("warning", " (empty answer — treated as “I don't know”)"));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
