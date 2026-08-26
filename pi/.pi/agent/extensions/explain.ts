import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	Loader,
	Text,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ────────────────────────────────────────────────────────────────────────────
// explain — a PROSE sibling of quiz, with a grader fork.
//
// Where quiz grades a selection against known options, explain asks for an
// answer in the user's OWN WORDS. That is a more demanding retrieval act: no
// options to recognize, no shape to pattern-match — the user must produce the
// concept and the terminology themselves.
//
// Grading: the caller supplies `expected` — the claims a correct answer must
// contain. On submit, the tool makes ONE quick model call (a "grader fork":
// ctx.modelRegistry.complete with the session's active model, no session, no
// tools) that grades the answer against those claims and returns a verdict
// plus per-quote terminology refinements. A spinner is shown while grading.
// The verdict travels back with the question/answer pair; the calling agent
// still owns the pedagogical response (re-asking, naming misconceptions).
//
// UI: a floating panel above the prompt shows the question (and optional
// context). The response field is focused immediately — there is nothing to
// navigate. Enter submits, Ctrl+J inserts a newline (pi convention), Esc
// cancels. During grading a spinner replaces the editor; Esc aborts the
// grade. After grading, the verdict and refinements are shown in the panel;
// Enter or Esc dismisses.
// ────────────────────────────────────────────────────────────────────────────

type ExplainStatus = "answered" | "cancelled" | "unavailable";
type Verdict = "correct" | "partially_correct" | "incorrect";
type LetterGrade = "A" | "B" | "C" | "D" | "F";

interface Refinement {
	quote: string;
	issue: string;
	correction: string;
}

interface Grading {
	verdict: Verdict;
	grade: LetterGrade;
	summary: string;
	refinements: Refinement[];
}

interface ExplainDetails {
	status: ExplainStatus;
	question: string;
	context?: string;
	answer?: string;
	grading?: Grading;
	message?: string;
}

const ExplainParams = Type.Object({
	question: Type.String({
		description:
			"The single question the user must answer in their own words. Ask exactly one question per tool call. Phrase it to force precise terminology — 'name the kernel construct and explain why', not 'what do you think about X'.",
	}),
	expected: Type.String({
		description:
			"The claims a correct answer must contain, in your own words — the grader fork grades the user's prose against this. Include the exact terminology you expect and any misconceptions to watch for. Not shown to the user.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
});

const GRADER_SYSTEM_PROMPT = `You are grading a learner's free-text answer to a technical question. The teacher supplies the claims a correct answer must contain ("expected"). Grade the learner's answer against those claims, not against your own general knowledge.

Output ONLY a JSON object — no markdown fences, no prose before or after — with exactly these keys:

{
  "verdict": "correct" | "partially_correct" | "incorrect",
  "grade": "A" | "B" | "C" | "D" | "F",
  "summary": "1-2 sentences: why this verdict",
  "refinements": [
    {
      "quote": "an exact substring copied from the learner's answer",
      "issue": "what is wrong or loose about it",
      "correction": "the precise terminology or claim that should replace it"
    }
  ]
}

Grading rules:
- "correct" means every required claim is present and accurately stated, with acceptable terminology. Minor phrasing differences are fine.
- "partially_correct" means the core idea is right but a required claim is missing, or terminology is loose enough to matter.
- "incorrect" means a required claim is wrong or the core mechanism is misunderstood.

Letter grade rubric:
- A: every required claim present, accurate, and stated with precise terminology.
- B: all required claims present and right, but terminology is loose in places.
- C: the core idea is right, but a required claim is missing or one claim is off.
- D: mostly wrong, but shows a fragment of real understanding worth building on.
- F: fundamentally wrong, a systematic misconception, or no engagement with the question.
The verdict and grade must agree: correct = A or B; partially_correct = C; incorrect = D or F.
- refinements must quote the learner's own words verbatim — never invent quotes. Include every spot where terminology is wrong, loose, or a claim is factually off. An empty array means nothing needs refinement.
- Do not penalize the learner for omitting things the expected claims do not require.`;

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
	grading?: Grading,
	message?: string,
): ExplainDetails {
	return { status, question, context, answer, grading, message };
}

function cancelledResult(question: string, context?: string) {
	const message = "User cancelled explain";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("cancelled", question, context, undefined, undefined, message),
	};
}

function unavailableResult(question: string, message: string, context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("unavailable", question, context, undefined, undefined, message),
	};
}

function extractGrading(raw: string): Grading | undefined {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		const parsed = JSON.parse(raw.slice(start, end + 1));
		const verdict: Verdict =
			parsed.verdict === "correct" || parsed.verdict === "incorrect" ? parsed.verdict : "partially_correct";
		const grade: LetterGrade = ["A", "B", "C", "D", "F"].includes(parsed.grade)
			? parsed.grade
			: verdict === "correct"
				? "B"
				: verdict === "partially_correct"
					? "C"
					: "F";
		const refinements: Refinement[] = Array.isArray(parsed.refinements)
			? parsed.refinements
					.filter((r: any) => r && typeof r.quote === "string" && r.quote.length > 0)
					.map((r: any) => ({
						quote: String(r.quote),
						issue: String(r.issue ?? ""),
						correction: String(r.correction ?? ""),
					}))
			: [];
		return { verdict, grade, summary: String(parsed.summary ?? ""), refinements };
	} catch {
		return undefined;
	}
}

interface PanelResult {
	answer: string;
	grading?: Grading;
	gradeError?: string;
}

export default function explain(pi: ExtensionAPI) {
	pi.registerTool({
		name: "explain",
		label: "explain",
		description:
			"Ask the user to answer ONE question in their own words — a prose retrieval check, more demanding than quiz's multiple choice because there are no options to recognize. Use it to ground terminology ('name the kernel construct this touches and why') and to surface misconceptions that multiple choice can't reach. You MUST supply `expected`: the claims a correct answer must contain. On submit, a quick grader model call grades the answer against those claims and returns a verdict (correct / partially_correct / incorrect) plus per-quote terminology refinements — you still own the pedagogical follow-up. For gradable questions with a known correct option set, use quiz; for preferences with no right answer, use ask_user_question.",
		promptSnippet:
			"Use explain to make the user answer one question in their own words; a grader fork scores it against your `expected` claims and returns a verdict plus terminology refinements.",
		promptGuidelines: [
			"ONE question per call. Phrase it to force precise terminology and mechanism, not vibes — 'why does X need Y' or 'name the construct and what it does', never 'what are your thoughts on X'.",
			"Always supply `expected`: the claims a correct answer must contain, including the exact terms you want and the misconceptions to watch for. The grader grades against this, not general knowledge.",
			"Prefer explain over quiz when you are somewhat confident where the user's understanding sits and want to verify precision of language; prefer quiz when you are still mapping the edge.",
			"Act on the verdict: correct-but-loose refinements get named and sharpened in your reply; partially_correct or incorrect means stop, diagnose, and re-ask in a different form before moving on.",
			"An empty or near-empty submission is an honest 'I don't know' — treat it as a genuine gap to teach into, not a failure. Empty answers skip grading.",
		],
		parameters: ExplainParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const question = params.question.trim();
			const expected = params.expected.trim();
			const context = params.details?.trim() || undefined;

			if (signal?.aborted) {
				return cancelledResult(question, context);
			}
			if (!question) {
				return unavailableResult(question, "explain requires a non-empty question", context);
			}
			if (!expected) {
				return unavailableResult(question, "explain requires `expected` (the claims a correct answer must contain)", context);
			}
			if (!ctx.hasUI) {
				return unavailableResult(question, "explain requires interactive mode UI", context);
			}
			if (!ctx.model) {
				return unavailableResult(question, "explain requires an active model for the grader fork", context);
			}

			const grade = async (answer: string): Promise<{ grading?: Grading; gradeError?: string }> => {
				const graderPrompt =
					`Question asked of the learner:\n${question}\n\n` +
					`Expected — the claims a correct answer must contain:\n${expected}\n\n` +
					`Learner's answer (their own words):\n${answer}`;
				try {
					const response = await ctx.modelRegistry.complete(ctx.model!, {
						systemPrompt: GRADER_SYSTEM_PROMPT,
						messages: [{ role: "user", content: graderPrompt, timestamp: Date.now() } as any],
					});
					const raw = response.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n");
					const grading = extractGrading(raw);
					if (!grading) return { gradeError: `grader returned unparseable output: ${raw.slice(0, 200)}` };
					return { grading };
				} catch (err: any) {
					if (signal?.aborted) return { gradeError: "aborted" };
					return { gradeError: `grader call failed: ${err?.message ?? String(err)}` };
				}
			};

			return withUILock(async () => {
				const result = await ctx.ui.custom<PanelResult | null>(
					(tui: any, theme: any, _kb: any, done: (result: PanelResult | null) => void) => {
						// The response field owns the first phase — there is nothing else
						// to navigate, so it is focused immediately. Enter must NOT submit
						// inside the editor (its submit path clears the buffer), so
						// disableSubmit and let the host own Enter. Ctrl+J still inserts a
						// newline (pi convention) for multi-line prose.
						const editor = new Editor(tui, createEditorTheme(theme));
						editor.focused = true;
						editor.disableSubmit = true;

						const loader = new Loader(
							tui,
							(s: string) => theme.fg("accent", s),
							(s: string) => theme.fg("muted", s),
							" grading…",
						);

						let phase: "answering" | "grading" | "verdict" = "answering";
						let grading: Grading | undefined;
						let gradeError: string | undefined;

						const verdictIcon = (g: Grading): string => {
							if (g.verdict === "correct") return theme.fg("success", `✓ correct — grade ${g.grade}`);
							if (g.verdict === "incorrect") return theme.fg("error", `✗ incorrect — grade ${g.grade}`);
							return theme.fg("warning", `◐ partially correct — grade ${g.grade}`);
						};

						const startGrading = (answer: string) => {
							phase = "grading";
							loader.start();
							tui.requestRender();
							void grade(answer).then((res) => {
								loader.stop();
								if (res.gradeError === "aborted") {
									done(null);
									return;
								}
								grading = res.grading;
								gradeError = res.gradeError;
								phase = "verdict";
								tui.requestRender();
							});
						};

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

								if (phase === "answering") {
									for (const line of editor.render(width)) lines.push(line);
									lines.push("");
									add(theme.fg("dim", " Enter — submit · Ctrl+J — new line · Esc — cancel"));
								} else if (phase === "grading") {
									addWrapped(lines, theme.fg("dim", editor.getText().trim()), width, " ");
									lines.push("");
									for (const line of loader.render(width)) lines.push(line);
									lines.push("");
									add(theme.fg("dim", " Esc — abort grading"));
								} else {
									addWrapped(lines, theme.fg("dim", editor.getText().trim()), width, " ");
									lines.push("");
									if (grading) {
										add(` ${verdictIcon(grading)}`);
										if (grading.summary) {
											lines.push("");
											addWrapped(lines, theme.fg("text", grading.summary), width, " ");
										}
										if (grading.refinements.length > 0) {
											lines.push("");
											add(theme.fg("muted", " terminology:"));
											for (const r of grading.refinements) {
												addWrapped(lines, theme.fg("warning", `“${r.quote}”`), width, "  ");
												const note = [r.issue, r.correction && `→ ${r.correction}`]
													.filter(Boolean)
													.join(" — ");
												if (note) addWrapped(lines, theme.fg("dim", note), width, "    ");
											}
										}
									} else {
										add(theme.fg("warning", ` grading unavailable — ${gradeError ?? "unknown error"}`));
										add(theme.fg("dim", " (returned ungraded; the agent will evaluate your answer itself)"));
									}
									lines.push("");
									add(theme.fg("dim", " Enter — continue"));
								}
								return lines;
							},

							invalidate: () => {
								editor.invalidate();
							},

							handleInput(data: string) {
								if (phase === "answering") {
									if (matchesKey(data, Key.enter)) {
										const answer = editor.getText().trim();
										if (!answer) {
											// Empty answer = honest "I don't know"; skip grading.
											done({ answer: "" });
											return;
										}
										startGrading(answer);
										return;
									}
									if (matchesKey(data, Key.escape)) {
										done(null);
										return;
									}
									editor.handleInput(data);
									return;
								}
								if (phase === "grading") {
									if (matchesKey(data, Key.escape)) {
										loader.stop();
										done(null);
									}
									return;
								}
								// verdict
								if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
									done({ answer: editor.getText().trim(), grading, gradeError });
								}
							},
						};
					},
				);

				if (result === null) {
					return cancelledResult(question, context);
				}
				let text: string;
				if (result.answer) {
					text = `Question: ${question}\nUser's answer (their own words):\n${result.answer}`;
					if (result.grading) {
						const g = result.grading;
						text += `\n\nGrader verdict: ${g.verdict.toUpperCase()} (grade: ${g.grade})\n${g.summary}`;
						if (g.refinements.length > 0) {
							text += `\nTerminology refinements:`;
							for (const r of g.refinements) {
								text += `\n- "${r.quote}" — ${r.issue}${r.correction ? ` → ${r.correction}` : ""}`;
							}
						}
						text +=
							`\n\nAct on the verdict: correct = affirm and extend; partially_correct = name what was ` +
							`missing or loose and sharpen it; incorrect = stop, diagnose the misconception, and re-ask ` +
							`in a different form before moving on. The verdict is advisory — you own the final call.`;
					} else {
						text +=
							`\n\n(Grader fork unavailable: ${result.gradeError ?? "unknown error"}. Evaluate the prose ` +
							`yourself against your expected claims.)`;
					}
				} else {
					text = `Question: ${question}\nUser submitted an EMPTY answer — treat this as an honest "I don't know": a genuine gap to teach into, not a failure.`;
				}
				return {
					content: [{ type: "text" as const, text }],
					details: buildDetails("answered", question, context, result.answer || undefined, result.grading),
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
			if (details.grading) {
				const g = details.grading;
				const icon =
					g.verdict === "correct"
						? theme.fg("success", `✓ correct — grade ${g.grade}`)
						: g.verdict === "incorrect"
							? theme.fg("error", `✗ incorrect — grade ${g.grade}`)
							: theme.fg("warning", `◐ partially correct — grade ${g.grade}`);
				lines.push(theme.fg("muted", "─ grader ─"));
				lines.push(` ${icon}`);
				if (g.summary) lines.push(theme.fg("dim", ` ${g.summary}`));
				for (const r of g.refinements) {
					lines.push(theme.fg("warning", `  “${r.quote}”`));
					const note = [r.issue, r.correction && `→ ${r.correction}`].filter(Boolean).join(" — ");
					if (note) lines.push(theme.fg("dim", `    ${note}`));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
