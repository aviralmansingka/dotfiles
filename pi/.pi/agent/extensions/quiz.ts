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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { openEditor } from "./nvim-open";
import { contextFileHint, handoutHint, normalizeContextFiles } from "./user-input/context-files";
import { type InputMode, inputModeLabel, nextInputMode } from "./user-input/input-modes";
import { joinHints, numberShortcutHint, numberShortcutIndex } from "./user-input/option-shortcuts";

// ────────────────────────────────────────────────────────────────────────────
// quiz — a GRADED sibling of ask_user_question.
//
// Where ask_user_question collects a preference/decision with no notion of
// right or wrong, `quiz` poses a question that HAS a correct answer, grades the
// user's selection instantly, and shows tight feedback (✓/✗ + the correct
// answer + an optional explanation) to both the user and the agent.
//
// It is intentionally options-only: single-select or multi-select. There is no
// free-text mode and no "Other" option, because a free-text answer can't be
// graded against a correct index.
// ────────────────────────────────────────────────────────────────────────────

interface QuizOption {
	label: string;
	value: string;
	description?: string;
}

interface DisplayOption extends QuizOption {
	id: string;
	index: number;
	isSubmit?: boolean;
}

interface OptionAnswer {
	label: string;
	value: string;
	index: number; // 1-based, matches the number shown to the user
}

// The always-present "I don't know" choice. It is NOT a real option: it never
// participates in shuffling, has no correct-answer value, and produces a
// distinct signal (dontKnow) rather than a right/wrong grade — so an honest
// "I don't know" is never confused with a lucky or unlucky guess.
const DONT_KNOW_VALUE = "__dont_know__";
const DONT_KNOW_LABEL = "I don't know";
const DONT_KNOW_INDEX = 0; // real options are 1-based; submit uses -1

// Unified response from either ask* component. answers holds the real
// selections (empty when dontKnow); note is the optional free-text the user
// typed in the always-present note field (kept only when non-empty).
interface QuizResponse {
	dontKnow: boolean;
	note?: string;
	answers: OptionAnswer[];
	followUp?: string; // set when the captain sends a follow-up instead of answering
}

type QuizStatus = "answered" | "cancelled" | "unavailable" | "follow-up";
type QuizMode = "single-select" | "multi-select";

interface DisplayedOption {
	index: number; // 1-based, in the final (possibly shuffled) display order
	label: string;
}

interface QuizResultDetails {
	status: QuizStatus;
	question: string;
	context?: string;
	mode: QuizMode;
	answers: OptionAnswer[];
	correctIndices: number[];
	options?: DisplayedOption[]; // full option list in display order, for the transcript
	correct?: boolean;
	dontKnow?: boolean; // user selected "I don't know" instead of guessing
	note?: string; // optional free-text from the always-present note field (any answer)
	followUp?: string; // set when the captain sent a follow-up instead of answering
	explanation?: string;
	message?: string;
}

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the answer option." }),
	value: Type.Optional(
		Type.String({ description: "Optional machine-readable value returned for the option. Defaults to the label." }),
	),
	description: Type.Optional(Type.String({ description: "Optional extra detail shown below the option." })),
});

const QuizParams = Type.Object({
	question: Type.String({
		description: "The single quiz question to ask. Ask exactly one question per tool call.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
	options: Type.Array(OptionSchema, {
		description:
			"The answer options (2 or more). Options only — there is no free-text mode. Give each option a stable `value`; you reference the correct one by that value in correctAnswer.",
		minItems: 2,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Set to true when more than one option is correct and the user must select all of them." }),
	),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			'REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); the user is only correct if their selection matches this set exactly. Always pass the value, not a position number — this is self-checking and prevents miscounting.',
	}),
	explanation: Type.String({
		description:
			"REQUIRED. Explanation revealed AFTER the user answers (shown whether they got it right or wrong). Use it to reinforce why the correct answer is correct.",
	}),
	shuffle: Type.Optional(
		Type.Boolean({
			description:
				"Defaults to true: options are randomly reordered before display so the correct answer isn't always in the same position. Set to false only when option order is meaningful (e.g. ordered numeric values, or an 'All/None of the above' option that must stay last).",
		}),
	),
	contextFiles: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Optional file paths that provide context for this quiz question. When present, the quiz panel shows an `o` shortcut; pressing `o` opens these files in vim using the existing /nvim opener. Relative paths resolve from the session cwd.",
		}),
	),
});

function normalizeOptions(
	options: Array<{ label: string; value?: string; description?: string }> | undefined,
): QuizOption[] {
	const seen = new Set<string>();
	return (options || [])
		.map((option) => ({
			label: option.label.trim(),
			value: option.value?.trim() || option.label.trim(),
			description: option.description?.trim() || undefined,
		}))
		.filter((option) => {
			if (option.label.length === 0) return false;
			if (seen.has(option.value)) throw new Error(`duplicate option value "${option.value}"`);
			seen.add(option.value);
			return true;
		});
}

async function openContextFiles(ctx: any, files: string[]): Promise<void> {
	if (files.length === 0) return;
	const result = await openEditor(ctx?.cwd ?? process.cwd(), files);
	ctx?.ui?.notify?.(result.message, "info");
}

// ────────────────────────────────────────────────────────────────────────
// `h` handout — LLM-generated teaching handout for the active quiz.
//
// Pressing `h` mid-quiz (steering mode) generates a deeper explanation of
// the quiz's core concepts via ctx.modelRegistry.complete (the same grader
// fork pattern explain.ts uses), writes it to ~/.cache/pi/quiz-handout.md,
// and opens that file in vim. The quiz itself stays active and ungraded —
// this is the captain's explicit choice to read more, never an answer leak.
// On model-unavailable or call failure we notify and keep the quiz running.
// ────────────────────────────────────────────────────────────────────────

const HANDOUT_SYSTEM_PROMPT = `You are a patient technical teacher. The user is taking a short multiple-choice quiz and has asked for a HANDOUT that explains the quiz's core concepts in more depth than the quiz's own one-line explanation.

Write a teaching handout in clean Markdown. Cover:
- The core concept(s) the question is testing, explained from first principles.
- Why the correct answer is correct — name the precise mechanism or terminology.
- For each distractor, why it is plausible-but-wrong: the specific misconception it trades on, and how it differs from the correct answer.
- A short worked example or analogy if it clarifies the mechanism.
- A one-line takeaway the reader should remember.

Rules:
- Be concrete and precise. Use the exact terminology the correct answer relies on.
- Go deeper than the quiz's explanation field — that field is a one-liner; this is the handout.
- Output ONLY Markdown. No preamble like "Here is the handout:". Start with a top-level # heading.
- Do not reveal which option number was correct by position; refer to answers by their labels.`;

// Prefer a fast, cheap model for handout generation (mirrors explain.ts's
// pickGraderModel). Override with PI_QUIZ_HANDOUT_MODEL="provider/model-id".
function pickHandoutModel(ctx: any): any {
	const override = process.env.PI_QUIZ_HANDOUT_MODEL;
	if (override) {
		const slash = override.indexOf("/");
		const m = slash > 0 ? ctx.modelRegistry.find(override.slice(0, slash), override.slice(slash + 1)) : undefined;
		if (m) return m;
	}
	for (const [provider, id] of [
		["fireworks", "glm-fast-latest"],
		["anthropic", "claude-haiku-4-5"],
		["openai", "gpt-4o-mini"],
		["google", "gemini-2.5-flash"],
		["fireworks", "deepseek-v4-flash-0731"],
	] as const) {
		const m = ctx.modelRegistry.find(provider, id);
		if (m && (!ctx.modelRegistry.hasConfiguredAuth || ctx.modelRegistry.hasConfiguredAuth(m))) return m;
	}
	return ctx.model;
}

function handoutPath(): string {
	const cache = process.env.PI_QUIZ_HANDOUT_PATH;
	if (cache) return cache;
	return resolve(homedir(), ".cache/pi/quiz-handout.md");
}

function buildHandoutPrompt(
	question: string,
	context: string | undefined,
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
	contextFileContents: Array<{ path: string; content: string }>,
): string {
	const lines: string[] = [];
	lines.push(`Quiz question:`);
	lines.push(question);
	if (context) {
		lines.push("");
		lines.push(`Extra context shown to the learner:`);
		lines.push(context);
	}
	lines.push("");
	lines.push(`Answer options (label + description):`);
	for (let i = 0; i < options.length; i++) {
		const opt = options[i];
		const desc = opt.description ? ` — ${opt.description}` : "";
		lines.push(`- ${opt.label}${desc}`);
	}
	lines.push("");
	const correctLabels = correctIndices.map((idx) => options[idx - 1]?.label ?? `(option ${idx})`);
	lines.push(`Correct answer label(s): ${correctLabels.join(", ")}`);
	if (explanation) {
		lines.push("");
		lines.push(`Quiz's own one-line explanation (go deeper than this in the handout):`);
		lines.push(explanation);
	}
	if (contextFileContents.length > 0) {
		lines.push("");
		lines.push(`Reference material (from the quiz's context files) — use as grounding:`);
		for (const ref of contextFileContents) {
			lines.push("");
			lines.push(`### ${ref.path}`);
			lines.push(ref.content);
		}
	}
	return lines.join("\n");
}

async function generateHandout(
	ctx: any,
	signal: AbortSignal | undefined,
	question: string,
	context: string | undefined,
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
	contextFiles: string[],
): Promise<{ message: string }> {
	if (!ctx?.modelRegistry?.complete) {
		return { message: "handout unavailable: no model registry" };
	}
	const model = pickHandoutModel(ctx);
	if (!model) {
		return { message: "handout unavailable: no model" };
	}

	const cwd = ctx?.cwd ?? process.cwd();
	const contextFileContents: Array<{ path: string; content: string }> = [];
	for (const file of contextFiles) {
		const abs = isAbsolute(file) ? file : resolve(cwd, file);
		try {
			const content = readFileSync(abs, "utf-8");
			contextFileContents.push({ path: file, content });
		} catch {
			// best-effort: skip unreadable context files
		}
	}

	const prompt = buildHandoutPrompt(question, context, options, correctIndices, explanation, contextFileContents);
	let raw: string;
	try {
		const response = await ctx.modelRegistry.complete(
			model,
			{
				systemPrompt: HANDOUT_SYSTEM_PROMPT,
				messages: [{ role: "user", content: prompt, timestamp: Date.now() } as any],
			},
			{ signal, maxTokens: 2000, temperature: 0.2, reasoning: "medium" } as any,
		);
		raw = response.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n");
	} catch (err: any) {
		if (signal?.aborted) return { message: "handout generation aborted" };
		return { message: `handout generation failed: ${err?.message ?? String(err)}` };
	}
	if (!raw.trim()) {
		return { message: "handout generation failed: model returned empty output" };
	}

	const path = handoutPath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, raw, "utf-8");
	} catch (err: any) {
		return { message: `handout write failed: ${err?.message ?? String(err)}` };
	}

	const result = await openEditor(cwd, [path]);
	return { message: `handout generated and opened in vim (${path}); ${result.message}` };
}

// Fire-and-forget wrapper used by the `h` keypress: shows a working notify,
// runs the generation, and notifies the outcome. Never throws into the quiz.
function requestHandout(
	ctx: any,
	signal: AbortSignal | undefined,
	question: string,
	context: string | undefined,
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
	contextFiles: string[],
): void {
	ctx?.ui?.notify?.("Generating handout…", "info");
	void generateHandout(ctx, signal, question, context, options, correctIndices, explanation, contextFiles)
		.then((res) => ctx?.ui?.notify?.(res.message, res.message.startsWith("handout generated") ? "info" : "warning"))
		.catch((err) => ctx?.ui?.notify?.(`handout generation failed: ${err?.message ?? String(err)}`, "warning"));
}

// Fisher-Yates shuffle over a copy. Safe to reorder for display because
// correctAnswer is keyed by value, not position — indices are resolved AFTER
// shuffling, so grading always matches what the user actually sees.
function shuffleOptions(options: QuizOption[]): QuizOption[] {
	const out = [...options];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// Resolve author-supplied option value(s) to 1-based indices. Keying by value
// (not position) makes the correct answer self-documenting: the author writes
// `correctAnswer: "mercury"` and a typo becomes a hard error instead of a
// silent wrong grade.
// The harness sometimes delivers a multi-select `correctAnswer` array as a
// JSON-stringified string (e.g. '["a", "b"]') instead of a real array, because
// the schema union lists String first. Detect that case and parse it back into
// an array so grading resolves against real option values. A plain single value
// is wrapped as-is.
function coerceCorrectAnswer(correctAnswer: string | string[]): string[] {
	if (Array.isArray(correctAnswer)) return correctAnswer;
	const trimmed = correctAnswer.trim();
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((v) => String(v));
		} catch {
			// Not valid JSON — fall through and treat as a single literal value.
		}
	}
	return [correctAnswer];
}

function resolveCorrect(
	correctAnswer: string | string[] | undefined,
	options: QuizOption[],
): { indices: number[]; error?: string } {
	if (correctAnswer === undefined) return { indices: [], error: "correctAnswer is required" };
	const arr = coerceCorrectAnswer(correctAnswer);
	if (arr.length === 0) return { indices: [], error: "correctAnswer is required" };
	const byValue = new Map(options.map((o, i) => [o.value, i + 1]));
	const indices: number[] = [];
	for (const raw of arr) {
		const v = typeof raw === "string" ? raw.trim() : raw;
		const idx = byValue.get(v);
		if (idx === undefined) {
			const known = options.map((o) => `"${o.value}"`).join(", ");
			return { indices: [], error: `correctAnswer "${v}" does not match any option value (${known})` };
		}
		indices.push(idx);
	}
	return { indices: Array.from(new Set(indices)).sort((a, b) => a - b) };
}

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

function isCorrect(selectedIndices: number[], correctIndices: number[]): boolean {
	if (selectedIndices.length !== correctIndices.length) return false;
	const a = [...selectedIndices].sort((x, y) => x - y);
	const b = [...correctIndices].sort((x, y) => x - y);
	return a.every((v, i) => v === b[i]);
}

function buildStructuredResult(
	status: QuizStatus,
	question: string,
	mode: QuizMode,
	answers: OptionAnswer[],
	correctIndices: number[],
	correct: boolean | undefined,
	explanation: string | undefined,
	context?: string,
	message?: string,
	options?: DisplayedOption[],
	dontKnow?: boolean,
	note?: string,
	followUp?: string,
): QuizResultDetails {
	return { status, question, context, mode, answers, correctIndices, options, correct, dontKnow, note, followUp, explanation, message };
}

function cancelledResult(question: string, mode: QuizMode, correctIndices: number[], context?: string) {
	const message = "User cancelled the quiz";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult("cancelled", question, mode, [], correctIndices, undefined, undefined, context, message),
	};
}

function unavailableResult(question: string, mode: QuizMode, message: string, correctIndices: number[], context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult("unavailable", question, mode, [], correctIndices, undefined, undefined, context, message),
	};
}

// The captain typed a follow-up and submitted it (Follow-up mode, Enter). This
// genuinely ends the quiz: the tool call returns with the follow-up text so the
// agent can act on it. The outcome is visible — renderResult surfaces it as a
// Follow-up line, never a silent close.
function followUpResult(
	question: string,
	mode: QuizMode,
	followUp: string,
	note: string | undefined,
	correctIndices: number[],
	context?: string,
) {
	const message = `User sent a follow-up instead of answering: ${followUp}`;
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult(
			"follow-up",
			question,
			mode,
			[],
			correctIndices,
			undefined,
			undefined,
			context,
			message,
			undefined,
			undefined,
			note,
			followUp,
		),
	};
}

function formatOptionRef(options: QuizOption[], index: number): string {
	const opt = options.find((o, i) => i + 1 === index);
	return `${index}. ${opt ? opt.label : "(unknown)"}`;
}

function buildResult(
	question: string,
	context: string | undefined,
	mode: QuizMode,
	options: QuizOption[],
	response: QuizResponse,
	correctIndices: number[],
	explanation: string | undefined,
) {
	const { dontKnow, note, answers } = response;
	const selectedIndices = answers.map((a) => a.index);
	// "I don't know" is never counted as correct — it's a distinct outcome.
	const correct = dontKnow ? false : isCorrect(selectedIndices, correctIndices);
	const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
	const displayedOptions: DisplayedOption[] = options.map((o, i) => ({ index: i + 1, label: o.label }));

	let text: string;
	if (dontKnow) {
		// Make the signal explicit for the agent: the user did NOT guess, so this
		// is a genuine knowledge gap, not a wrong answer to correct against.
		text = `User selected "I don't know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).`;
		text += `\nCorrect: ${correctStr}`;
		if (note) text += `\nUser's note: ${note}`;
	} else {
		const verdict = correct ? "correctly" : "incorrectly";
		const selectedStr = answers.map((a) => `${a.index}. ${a.label}`).join(", ");
		text = `User answered ${verdict}.\nSelected: ${selectedStr}\nCorrect: ${correctStr}`;
		if (note) text += `\nUser's note: ${note}`;
	}
	if (explanation) text += `\nExplanation: ${explanation}`;

	return {
		content: [{ type: "text" as const, text }],
		details: buildStructuredResult(
			"answered",
			question,
			mode,
			answers,
			correctIndices,
			correct,
			explanation,
			context,
			undefined,
			displayedOptions,
			dontKnow,
			note,
		),
	};
}

// Shared feedback block, rendered after the user submits.
function renderFeedback(
	lines: string[],
	theme: any,
	width: number,
	options: QuizOption[],
	selectedIndices: number[],
	correctIndices: number[],
	explanation: string | undefined,
	dontKnow = false,
	note?: string,
): void {
	const add = (text: string) => lines.push(truncateToWidth(text, width));
	const correct = !dontKnow && isCorrect(selectedIndices, correctIndices);
	const selectedSet = new Set(selectedIndices);
	const correctSet = new Set(correctIndices);

	lines.push("");
	for (let i = 0; i < options.length; i++) {
		const index = i + 1;
		const opt = options[i];
		const isSelected = selectedSet.has(index);
		const isKey = correctSet.has(index);
		let marker: string;
		let color: string;
		if (dontKnow) {
			// No guess was made — only reveal the correct answer(s); never show ✗.
			marker = isKey ? "✓" : " ";
			color = isKey ? "success" : "dim";
		} else if (isSelected && isKey) {
			marker = "✓";
			color = "success";
		} else if (isSelected && !isKey) {
			marker = "✗";
			color = "error";
		} else if (!isSelected && isKey) {
			// correct answer the user missed
			marker = "✓";
			color = "success";
		} else {
			marker = " ";
			color = "dim";
		}
		add(theme.fg(color, ` ${marker} ${index}. ${opt.label}`));
	}

	lines.push("");
	if (dontKnow) {
		add(theme.fg("warning", " · You said: I don't know"));
		const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
		addWrapped(lines, theme.fg("muted", `Correct answer: ${correctStr}`), width, " ");
	} else if (correct) {
		add(theme.fg("success", " ✓ Correct!"));
	} else {
		add(theme.fg("error", " ✗ Incorrect."));
		const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
		addWrapped(lines, theme.fg("muted", `Correct answer: ${correctStr}`), width, " ");
	}
	if (note) {
		addWrapped(lines, theme.fg("muted", `Your note: ${note}`), width, " ");
	}
	if (explanation) {
		lines.push("");
		addWrapped(lines, theme.fg("text", explanation), width, " ");
	}
	lines.push("");
	add(theme.fg("dim", " Enter/Esc to continue"));
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

// Question + optional context. Shared by both components. (The frame provides
// the border now; no flat top bar.)
function pushHeader(lines: string[], theme: any, width: number, question: string, context: string | undefined): void {
	addWrapped(lines, theme.fg("text", question), width, " ");
	if (context) {
		lines.push("");
		addWrapped(lines, theme.fg("muted", context), width, " ");
	}
}

// The "I don't know" row in the selection list — visually separated and dimmed
// so it reads as distinct from the real, gradable options.
function pushDontKnowRow(lines: string[], theme: any, width: number, focused: boolean): void {
	lines.push("");
	const prefix = focused ? theme.fg("accent", "> ") : "  ";
	const styled = focused ? theme.fg("accent", DONT_KNOW_LABEL) : theme.fg("dim", DONT_KNOW_LABEL);
	lines.push(truncateToWidth(`${prefix}${styled}`, width));
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

// Render the bottom-box text editor for the note OR follow-up field. The note
// is always-present (shown unfocused as a dim placeholder in steering mode),
// attaches to ANY answer (including "I don't know"), and reaches the agent only
// when non-empty; the follow-up editor is rendered only in follow-up mode.
// Empty + unfocused collapses to a placeholder so the bottom box keeps the
// prompt silhouette.
function pushNoteField(lines: string[], theme: any, width: number, editor: Editor, focused: boolean): void {
	if (!focused && editor.getText().trim().length === 0) {
		lines.push(theme.fg("dim", " note (optional) — Tab to write"));
		return;
	}
	for (const line of editorInnerLines(editor, width)) lines.push(line);
}

// Build the text Editor shared by the note and follow-up fields. `disableSubmit`
// is set because Enter must NOT submit here: the editor's submit path clears the
// buffer, which would wipe the text. The host intercepts Enter with mode-specific
// behavior: note mode returns to steering keeping the text; follow-up mode sends
// the follow-up (ending the quiz) when non-empty, else returns to steering.
// Ctrl+J still inserts a newline (pi convention), so multi-line text works.
function makeNoteEditor(tui: any, theme: any): Editor {
	const editor = new Editor(tui, createEditorTheme(theme));
	editor.focused = false;
	editor.disableSubmit = true;
	return editor;
}

// Visible mode indicator line. Always rendered in the bottom hint row so the
// captain knows which mode is active before typing. The active mode is
// accent-colored; the rest stay dim.
function modeIndicator(theme: any, mode: InputMode): string {
	return theme.fg("accent", `Mode: ${inputModeLabel(mode)}`);
}

async function askSingleChoice(
	ctx: any,
	signal: AbortSignal | undefined,
	question: string,
	context: string | undefined,
	contextFiles: string[],
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
): Promise<QuizResponse | null> {
	const allOptions: DisplayOption[] = options.map((option, index) => ({
		...option,
		id: `option:${index}`,
		index: index + 1,
	}));
	const dontKnowNav = allOptions.length; // nav index of the "I don't know" row

	return ctx.ui.custom<QuizResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: QuizResponse | null) => void) => {
			let optionIndex = 0;
			let phase: "select" | "feedback" = "select";
			// Tab cycles the input mode: steering (options focused) -> note ->
			// follow-up -> steering. "steering" replaces the old "options" focus
			// and keeps the question visible; the quiz is never removed in it.
			let mode: InputMode = "steering";
			let chosen: OptionAnswer | null = null;
			let dontKnow = false;
			const noteEditor = makeNoteEditor(tui, theme);
			const followUpEditor = makeNoteEditor(tui, theme);
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function noteText(): string | undefined {
				const t = noteEditor.getText().trim();
				return t.length ? t : undefined;
			}

			function activeEditor(): Editor {
				return mode === "note" ? noteEditor : followUpEditor;
			}

			function toSteering() {
				mode = "steering";
				noteEditor.focused = false;
				followUpEditor.focused = false;
				refresh();
			}

			function response(): QuizResponse {
				const note = noteText();
				return dontKnow
					? { dontKnow: true, note, answers: [] }
					: { dontKnow: false, note, answers: chosen ? [chosen] : [] };
			}

			function handleInput(data: string) {
				if (phase === "feedback") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						done(response());
					}
					return;
				}

				// Tab cycles the input mode: steering -> note -> follow-up -> steering.
				if (matchesKey(data, Key.tab)) {
					mode = nextInputMode(mode);
					noteEditor.focused = mode === "note";
					followUpEditor.focused = mode === "follow-up";
					refresh();
					return;
				}

				if (mode !== "steering") {
					// Enter and Esc both return to steering and keep the typed text.
					// In follow-up mode, Enter with non-empty text ENDS the quiz and
					// sends the follow-up (a visible outcome, never a silent close).
					// (Enter must be intercepted here: the editor's own submit clears
					// the buffer. Ctrl+J still reaches the editor as a newline.)
					if (matchesKey(data, Key.enter)) {
						if (mode === "follow-up") {
							const text = followUpEditor.getText().trim();
							if (text.length) {
								done({ dontKnow: false, note: noteText(), answers: [], followUp: text });
								return;
							}
						}
						toSteering();
						return;
					}
					if (matchesKey(data, Key.escape)) {
						toSteering();
						return;
					}
					activeEditor().handleInput(data);
					tui.requestRender();
					return;
				}

				// mode === "steering"
				if (data === "o" && contextFiles.length > 0) {
					void openContextFiles(ctx, contextFiles).catch((error) =>
						ctx?.ui?.notify?.(`Could not open context files: ${error}`, "warning"),
					);
					return;
				}

				if (data === "h") {
					requestHandout(ctx, signal, question, context, options, correctIndices, explanation, contextFiles);
					return;
				}

				const shortcutIndex = numberShortcutIndex(data, allOptions.length);
				if (shortcutIndex !== undefined) {
					const selected = allOptions[shortcutIndex];
					chosen = { label: selected.label, value: selected.value, index: selected.index };
					dontKnow = false;
					phase = "feedback";
					refresh();
					return;
				}

				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(dontKnowNav, optionIndex + 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (optionIndex === dontKnowNav) {
						dontKnow = true;
						chosen = null;
					} else {
						const selected = allOptions[optionIndex];
						chosen = { label: selected.label, value: selected.value, index: selected.index };
						dontKnow = false;
					}
					phase = "feedback";
					refresh();
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done(null);
				}
			}

			function render(width: number): string[] {
				// The cache MUST be keyed on width: pi-tui calls requestRender() but NOT
				// invalidate() on terminal resize, so render() can be re-entered with a
				// new width. Returning stale wider lines trips the TUI width guard and
				// crashes the process.
				if (cachedLines && cachedWidth === width) return cachedLines;

				const tw = Math.max(8, width - 8);
				const bw = Math.max(8, width - 4);
				const top: string[] = [];
				const bottom: string[] = [];
				const add = (text: string) => top.push(truncateToWidth(text, tw));
				pushHeader(top, theme, tw, question, context);

				if (phase === "feedback") {
					renderFeedback(
						top,
						theme,
						tw,
						options,
						chosen ? [chosen.index] : [],
						correctIndices,
						explanation,
						dontKnow,
						noteText(),
					);
					const framed = frameMerged(top, bottom, width, theme);
					cachedLines = framed;
					cachedWidth = width;
					return framed;
				}

				top.push("");
				for (let i = 0; i < allOptions.length; i++) {
					const option = allOptions[i];
					const selected = mode === "steering" && i === optionIndex;
					const prefix = selected ? theme.fg("accent", "> ") : "  ";
					const label = `${option.index}. ${option.label}`;
					const styled = selected ? theme.fg("accent", label) : theme.fg("text", label);
					add(`${prefix}${styled}`);
					if (option.description) {
						addWrapped(top, theme.fg("muted", option.description), tw, "     ");
					}
				}

				pushDontKnowRow(top, theme, tw, mode === "steering" && optionIndex === dontKnowNav);

				top.push("");
				if (mode === "note") {
					add(theme.fg("dim", ` ${modeIndicator(theme, mode)} • type your note (attaches to answer) • Ctrl+J newline • Enter back • Tab → follow-up • Esc back`));
				} else if (mode === "follow-up") {
					add(theme.fg("dim", ` ${modeIndicator(theme, mode)} • type a follow-up (Enter sends, ends quiz) • Ctrl+J newline • Tab → steering • Esc back`));
				} else {
					add(theme.fg("dim", ` ${joinHints(modeIndicator(theme, mode), "↑↓ navigate", numberShortcutHint(allOptions.length, "answer"), "Enter answer", contextFileHint(contextFiles), handoutHint(), "Tab → note", "Esc cancel")}`));
				}

				if (mode === "note") {
					pushNoteField(bottom, theme, bw, noteEditor, true);
				} else if (mode === "follow-up") {
					pushNoteField(bottom, theme, bw, followUpEditor, true);
				} else {
					pushNoteField(bottom, theme, bw, noteEditor, false);
				}
				const framed = frameMerged(top, bottom, width, theme);
				// Not cached when a text editor is focused: it renders a live cursor.
				if (mode === "steering") {
					cachedLines = framed;
					cachedWidth = width;
				}
				return framed;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					noteEditor.invalidate();
					followUpEditor.invalidate();
				},
				handleInput,
			};
		},
	);
}

async function askMultiChoice(
	ctx: any,
	signal: AbortSignal | undefined,
	question: string,
	context: string | undefined,
	contextFiles: string[],
	options: QuizOption[],
	correctIndices: number[],
	explanation: string | undefined,
): Promise<QuizResponse | null> {
	const DONT_KNOW_ID = "dont-know";
	const choiceItems: DisplayOption[] = options.map((option, index) => ({
		...option,
		id: `option:${index}`,
		index: index + 1,
	}));
	const dontKnowItem: DisplayOption = {
		id: DONT_KNOW_ID,
		label: DONT_KNOW_LABEL,
		value: DONT_KNOW_VALUE,
		index: DONT_KNOW_INDEX,
	};
	const submitItem: DisplayOption = { id: "submit", label: "Submit", value: "__submit__", index: -1, isSubmit: true };
	const allItems: DisplayOption[] = [...choiceItems, dontKnowItem, submitItem];

	return ctx.ui.custom<QuizResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: QuizResponse | null) => void) => {
			let optionIndex = 0;
			let phase: "select" | "feedback" = "select";
			// Tab cycles the input mode: steering (options focused) -> note ->
			// follow-up -> steering. Mirrors askSingleChoice.
			let mode: InputMode = "steering";
			const noteEditor = makeNoteEditor(tui, theme);
			const followUpEditor = makeNoteEditor(tui, theme);
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;
			const selected = new Map<string, OptionAnswer>();

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function noteText(): string | undefined {
				const t = noteEditor.getText().trim();
				return t.length ? t : undefined;
			}

			function activeEditor(): Editor {
				return mode === "note" ? noteEditor : followUpEditor;
			}

			function toSteering() {
				mode = "steering";
				noteEditor.focused = false;
				followUpEditor.focused = false;
				refresh();
			}

			const choseDontKnow = () => selected.has(DONT_KNOW_ID);
			const realAnswers = () =>
				sortAnswers(Array.from(selected.values()).filter((a) => a.index !== DONT_KNOW_INDEX));

			function response(): QuizResponse {
				const note = noteText();
				return choseDontKnow()
					? { dontKnow: true, note, answers: [] }
					: { dontKnow: false, note, answers: realAnswers() };
			}

			// "I don't know" is exclusive: choosing it clears real selections, and
			// choosing any real option clears "I don't know".
			function toggleOption(item: DisplayOption) {
				if (item.id === DONT_KNOW_ID) {
					if (selected.has(DONT_KNOW_ID)) {
						selected.delete(DONT_KNOW_ID);
					} else {
						selected.clear();
						selected.set(DONT_KNOW_ID, { label: item.label, value: item.value, index: item.index });
					}
				} else {
					selected.delete(DONT_KNOW_ID);
					if (selected.has(item.id)) {
						selected.delete(item.id);
					} else {
						selected.set(item.id, { label: item.label, value: item.value, index: item.index });
					}
				}
				refresh();
			}

			function submit() {
				if (selected.size === 0) return;
				phase = "feedback";
				refresh();
			}

			function handleInput(data: string) {
				if (phase === "feedback") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
						done(response());
					}
					return;
				}

				// Tab cycles the input mode: steering -> note -> follow-up -> steering.
				if (matchesKey(data, Key.tab)) {
					mode = nextInputMode(mode);
					noteEditor.focused = mode === "note";
					followUpEditor.focused = mode === "follow-up";
					refresh();
					return;
				}

				if (mode !== "steering") {
					// Enter and Esc both return to steering and keep the typed text.
					// In follow-up mode, Enter with non-empty text ENDS the quiz and
					// sends the follow-up (a visible outcome, never a silent close).
					// (Enter must be intercepted here: the editor's own submit clears
					// the buffer. Ctrl+J still reaches the editor as a newline.)
					if (matchesKey(data, Key.enter)) {
						if (mode === "follow-up") {
							const text = followUpEditor.getText().trim();
							if (text.length) {
								done({ dontKnow: false, note: noteText(), answers: [], followUp: text });
								return;
							}
						}
						toSteering();
						return;
					}
					if (matchesKey(data, Key.escape)) {
						toSteering();
						return;
					}
					activeEditor().handleInput(data);
					tui.requestRender();
					return;
				}

				// mode === "steering"
				if (data === "o" && contextFiles.length > 0) {
					void openContextFiles(ctx, contextFiles).catch((error) =>
						ctx?.ui?.notify?.(`Could not open context files: ${error}`, "warning"),
					);
					return;
				}

				if (data === "h") {
					requestHandout(ctx, signal, question, context, options, correctIndices, explanation, contextFiles);
					return;
				}

				const shortcutIndex = numberShortcutIndex(data, choiceItems.length);
				if (shortcutIndex !== undefined) {
					optionIndex = shortcutIndex;
					toggleOption(choiceItems[shortcutIndex]);
					return;
				}

				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(allItems.length - 1, optionIndex + 1);
					refresh();
					return;
				}

				const current = allItems[optionIndex];
				if (matchesKey(data, Key.space)) {
					if (current.isSubmit) return;
					toggleOption(current);
					return;
				}

				if (matchesKey(data, Key.enter)) {
					if (current.isSubmit) {
						submit();
						return;
					}
					toggleOption(current);
					return;
				}

				if (matchesKey(data, Key.escape)) {
					done(null);
				}
			}

			function render(width: number): string[] {
				// The cache MUST be keyed on width: pi-tui calls requestRender() but NOT
				// invalidate() on terminal resize, so render() can be re-entered with a
				// new width. Returning stale wider lines trips the TUI width guard and
				// crashes the process.
				if (cachedLines && cachedWidth === width) return cachedLines;

				const tw = Math.max(8, width - 8);
				const bw = Math.max(8, width - 4);
				const top: string[] = [];
				const bottom: string[] = [];
				const add = (text: string) => top.push(truncateToWidth(text, tw));
				pushHeader(top, theme, tw, question, context);

				if (phase === "feedback") {
					renderFeedback(
						top,
						theme,
						tw,
						options,
						realAnswers().map((a) => a.index),
						correctIndices,
						explanation,
						choseDontKnow(),
						noteText(),
					);
					const framed = frameMerged(top, bottom, width, theme);
					cachedLines = framed;
					cachedWidth = width;
					return framed;
				}

				top.push("");
				for (let i = 0; i < allItems.length; i++) {
					const item = allItems[i];
					const isFocused = mode === "steering" && i === optionIndex;
					const prefix = isFocused ? theme.fg("accent", "> ") : "  ";

					if (item.isSubmit) {
						const label = selected.size > 0 ? `✓ ${item.label} (${selected.size} selected)` : `○ ${item.label}`;
						const styled = isFocused
							? theme.fg("accent", label)
							: theme.fg(selected.size > 0 ? "success" : "dim", label);
						add(`${prefix}${styled}`);
						continue;
					}

					if (item.id === DONT_KNOW_ID) {
						top.push(""); // visual separation from the real options
						const checked = selected.has(item.id);
						const label = `${checked ? "[x]" : "[ ]"} ${item.label}`;
						const styled = isFocused ? theme.fg("accent", label) : theme.fg(checked ? "warning" : "dim", label);
						add(`${prefix}${styled}`);
						continue;
					}

					const checked = selected.has(item.id);
					const marker = checked ? "[x]" : "[ ]";
					const label = `${marker} ${item.index}. ${item.label}`;
					const styled = isFocused ? theme.fg("accent", label) : theme.fg(checked ? "success" : "text", label);
					add(`${prefix}${styled}`);
					if (item.description) {
						addWrapped(top, theme.fg("muted", item.description), tw, "     ");
					}
				}

				top.push("");
				if (mode === "note") {
					add(theme.fg("dim", ` ${modeIndicator(theme, mode)} • type your note (attaches to answer) • Ctrl+J newline • Enter back • Tab → follow-up • Esc back`));
				} else if (mode === "follow-up") {
					add(theme.fg("dim", ` ${modeIndicator(theme, mode)} • type a follow-up (Enter sends, ends quiz) • Ctrl+J newline • Tab → steering • Esc back`));
				} else {
					add(theme.fg("dim", ` ${joinHints(modeIndicator(theme, mode), "↑↓ navigate", numberShortcutHint(choiceItems.length, "toggle"), "Space toggle", "Enter submit", contextFileHint(contextFiles), handoutHint(), "Tab → note", "Esc cancel")}`));
				}

				if (mode === "note") {
					pushNoteField(bottom, theme, bw, noteEditor, true);
				} else if (mode === "follow-up") {
					pushNoteField(bottom, theme, bw, followUpEditor, true);
				} else {
					pushNoteField(bottom, theme, bw, noteEditor, false);
				}
				if (selected.size === 0 && mode === "steering") {
					bottom.push(theme.fg("warning", " Select at least one answer before submitting."));
				}
				const framed = frameMerged(top, bottom, width, theme);
				// Not cached when a text editor is focused: it renders a live cursor.
				if (mode === "steering") {
					cachedLines = framed;
					cachedWidth = width;
				}
				return framed;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					noteEditor.invalidate();
					followUpEditor.invalidate();
				},
				handleInput,
			};
		},
	);
}

function sortAnswers(answers: OptionAnswer[]): OptionAnswer[] {
	return [...answers].sort((a, b) => a.index - b.index);
}

// Shared UI mutex. ctx.ui.custom()/editor can only handle one active call at
// a time, so ALL pop-up-style tools (quiz, ask_user_question, ...) must
// serialize against each other, not just against themselves. We stash one
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
				chain = new Promise<void>((r) => { release = r; });
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

export default function quiz(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "quiz",
		description:
			"Ask the user a GRADED question with a known correct answer, then instantly grade and give feedback. Unlike ask_user_question (which collects preferences/decisions with no right answer), quiz always has a correct answer supplied by you, marks the user's selection right/wrong (✓/✗), reveals the correct answer, and can show an explanation. Use it to (1) assess what the learner already understands before teaching, and (2) run tight practice/retrieval loops after explaining, or probe understanding whenever you're unsure they've got it. Options-only: single-select or multi-select, plus an automatic 'I don't know' choice so the user can signal a genuine gap instead of guessing. While a quiz is open, Tab cycles three input modes shown in a visible indicator: steering (options focused — navigate/answer/open context files, generate a handout, question stays visible), note (free-text that attaches to the answer, for 'I don't know' context), and follow-up (a message that ends the quiz and returns to you as `followUp`). The note reaches you only when non-empty. No free-text answers — for non-graded questions use ask_user_question instead.",
		promptSnippet:
			"Use the quiz tool to test the user with a graded multiple-choice or multi-select question (required correct answer + required explanation). For non-graded questions, use ask_user_question.",
		promptGuidelines: [
			"quiz is GRADED; ask_user_question is not. If the question has a correct answer, use quiz. If you just need a preference, decision, or open-ended input, use ask_user_question.",
			'correctAnswer is REQUIRED and is the option value, not a position number. Single-select: one string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]).',
			"Always pass the option's `value` string as correctAnswer — it is self-checking and prevents miscounting positions. A value that matches no option is a hard error.",
			"explanation is REQUIRED — always say why the correct answer is correct.",
			"Multi-select is graded as an exact-set match: the user is correct only if they select every correct option and no incorrect ones.",
			"There is no free-text mode. An 'I don't know' choice is ALWAYS added automatically — provide ONLY the real, gradable options (at least two). Never add your own uncertainty/opt-out option like 'I don't know', 'I'm not sure', or 'Not sure'; that is handled for you and a manual one would be redundant or gradable-as-wrong.",
			"If a result comes back as dontKnow, the user honestly did not know and did NOT guess — treat it as a genuine knowledge gap to teach into, not as a wrong answer.",
			"Any answer (right, wrong, or 'I don't know') may carry an optional free-text `note` the user typed in note mode (Tab cycles steering → note → follow-up). When present it reflects what they were thinking or unsure about — read it and let it steer your follow-up. It is omitted entirely when empty.",
			"If a result comes back with `followUp` set, the captain typed a follow-up in follow-up mode and submitted it (Enter) instead of answering — the quiz ended with that message. Read `followUp` and respond to it directly; do not grade it. This is a visible, deliberate end to the quiz, never a silent close.",
			"Treat each wrong answer (distractor) as a diagnostic probe, not just filler: make it a specific, believable mistake the user might actually hold — a common misconception, or an adjacent/easily-confused concept — so that WHICH wrong answer they pick reveals WHICH nuance of their understanding is off. You learn far more from a targeted wrong choice than from a binary right/wrong, and the choice tells you exactly which gap to teach into next (and what the explanation should address).",
			"Guardrail: every distractor must be unambiguously wrong on the intended reading — tempting, but a real error, not a defensible alternative. Don't drift into trick questions.",
			"Anti-guessing hygiene: don't let the correct answer stand out by form (longest, most precise, most hedged, or the only one in the right format). Keep options similar in length, specificity, and phrasing so it can't be picked from shape alone.",
			"Set multiSelect: true only when more than one option is correct.",
			"Options are shuffled before display by default, so don't worry about which position you list the correct answer in. Set shuffle: false only when option order is meaningful (ordered values, or an 'All/None of the above' option that must stay last).",
			"When a quiz needs file context, pass `contextFiles: [\"path/to/file\"]`; the user can press `o` to open those files in vim while the quiz stays active.",
			"Mid-quiz, the user can press `h` to generate an LLM-written teaching handout that explains the quiz's core concepts in more depth than the `explanation` field, and open it in vim; the quiz stays active and ungraded. This is the user's choice and never leaks the answer before they answer.",
			"To probe nuance, ask several quick quiz questions and adapt each one based on the previous answers, rather than writing one giant question.",
			"Don't leak the answer through formatting: keep option phrasing/length even and don't hint which is correct.",
		],
		parameters: QuizParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const context = params.details?.trim() || undefined;
			const contextFiles = normalizeContextFiles((params as any).contextFiles);
			const explanation = params.explanation.trim();
			const mode: QuizMode = params.multiSelect ? "multi-select" : "single-select";

			let options: QuizOption[];
			try {
				options = normalizeOptions(params.options);
			} catch (e) {
				return unavailableResult(params.question, mode, `quiz ${(e as Error).message}`, [], context);
			}

			// Shuffle for display (default on) BEFORE resolving correct indices, so
			// grading matches the order the user sees.
			if (params.shuffle !== false) {
				options = shuffleOptions(options);
			}

			// Emit the true (post-shuffle) display order immediately, before the UI
			// blocks on the user's answer. Listeners such as md-log rely on this to
			// show the question in the SAME order the user actually sees it, instead
			// of the pre-shuffle order the agent originally wrote in its tool call.
			// Deliberately omits correctIndices/explanation — this fires before the
			// user has answered and must not leak the answer.
			onUpdate?.({
				content: [{ type: "text", text: "Awaiting user response..." }],
				details: { options: options.map((o, i) => ({ index: i + 1, label: o.label })) },
			});

			const { indices: correctIndices, error: correctError } = resolveCorrect(
				params.correctAnswer as string | string[],
				options,
			);

			if (signal?.aborted) {
				return cancelledResult(params.question, mode, correctIndices, context);
			}

			if (options.length < 2) {
				return unavailableResult(
					params.question,
					mode,
					"quiz requires at least two options",
					correctIndices,
					context,
				);
			}

			if (correctError) {
				return unavailableResult(params.question, mode, `quiz ${correctError}`, correctIndices, context);
			}

			if (!ctx.hasUI) {
				return unavailableResult(params.question, mode, "quiz requires interactive mode UI", correctIndices, context);
			}

			return withUILock(async () => {
				const response =
					mode === "single-select"
						? await askSingleChoice(ctx, signal, params.question, context, contextFiles, options, correctIndices, explanation)
						: await askMultiChoice(ctx, signal, params.question, context, contextFiles, options, correctIndices, explanation);
				if (!response) {
					return cancelledResult(params.question, mode, correctIndices, context);
				}
				if (response.followUp) {
					return followUpResult(params.question, mode, response.followUp, response.note, correctIndices, context);
				}
				return buildResult(params.question, context, mode, options, response, correctIndices, explanation);
			});
		},

		renderCall(args, theme) {
			// NOTE: never render correctAnswer or explanation here — it would leak
			// the answer into the transcript before the user responds. We also do NOT
			// enumerate the options here: they are shuffled at execute time, so any
			// order shown during streaming would be stale/misleading. The full option
			// list is rendered — in its true display order — by renderResult after the
			// user answers.
			const options = normalizeOptions(
				args.options as Array<{ label: string; value?: string; description?: string }> | undefined,
			);
			let text = theme.fg("toolTitle", theme.bold("quiz ")) + theme.fg("muted", args.question);
			if (args.multiSelect) {
				text += theme.fg("dim", " [multi-select]");
			}
			if (options.length > 0) {
				const noun = options.length === 1 ? "option" : "options";
				text += theme.fg("dim", ` (${options.length} ${noun})`);
			}
			const contextFiles = normalizeContextFiles((args as any).contextFiles);
			if (contextFiles.length > 0) {
				const noun = contextFiles.length === 1 ? "context file" : "context files";
				text += theme.fg("dim", ` (${contextFiles.length} ${noun})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuizResultDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}

			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", details.message || "Cancelled"), 0, 0);
			}
			if (details.status === "unavailable") {
				return new Text(theme.fg("warning", details.message || "quiz unavailable"), 0, 0);
			}
			if (details.status === "follow-up") {
				// Visible outcome for Follow-up mode: never a silent close.
				const body = details.followUp ? `Follow-up: ${details.followUp}` : (details.message || "Follow-up");
				return new Text(theme.fg("accent", body), 0, 0);
			}

			const correctSet = new Set(details.correctIndices);
			const selectedSet = new Set(details.answers.map((a) => a.index));
			const lines: string[] = [];

			// Full option list in the true (shuffled) display order, with ✓/✗ marks.
			// Falls back to just the selected answers for older results that predate
			// details.options.
			const displayed =
				details.options && details.options.length > 0
					? details.options
					: details.answers.map((a) => ({ index: a.index, label: a.label }));

			for (const opt of displayed) {
				const isSelected = selectedSet.has(opt.index);
				const isKey = correctSet.has(opt.index);
				let mark: string;
				let body: string;
				if (details.dontKnow) {
					// No guess — only reveal the correct answer(s); never show ✗.
					mark = isKey ? theme.fg("success", "✓ ") : "  ";
					body = isKey ? theme.fg("success", `${opt.index}. ${opt.label}`) : theme.fg("dim", `${opt.index}. ${opt.label}`);
				} else if (isSelected && isKey) {
					mark = theme.fg("success", "✓ ");
					body = theme.fg("accent", `${opt.index}. ${opt.label}`);
				} else if (isSelected && !isKey) {
					mark = theme.fg("error", "✗ ");
					body = theme.fg("error", `${opt.index}. ${opt.label}`);
				} else if (!isSelected && isKey) {
					mark = theme.fg("success", "✓ ");
					body = theme.fg("success", `${opt.index}. ${opt.label}`);
				} else {
					mark = "  ";
					body = theme.fg("dim", `${opt.index}. ${opt.label}`);
				}
				lines.push(`${mark}${body}`);
			}

			lines.push("");
			const verdict = details.dontKnow
				? theme.fg("warning", "I don't know")
				: details.correct
					? theme.fg("success", "Correct!")
					: theme.fg("error", "Incorrect");
			lines.push(verdict);

			if (details.note) {
				lines.push(theme.fg("muted", `Note: ${details.note}`));
			}

			if (details.explanation) {
				lines.push(theme.fg("muted", details.explanation));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
