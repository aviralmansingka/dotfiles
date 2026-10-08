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
import { openEditor } from "./nvim-open";
import { openJournalInEditor } from "./md-log";
import { contextFileHint, lessonFileHint, normalizeContextFiles } from "./user-input/context-files";
import { type InputMode, inputModeLabel, nextInputMode } from "./user-input/input-modes";
import {
	joinHints,
	NAVIGATION_HINT,
	numberShortcutHint,
	numberShortcutIndex,
} from "./user-input/option-shortcuts";

// ────────────────────────────────────────────────────────────────────────────
// quiz — a GRADED sibling of ask_user_question.
//
// Where ask_user_question collects a preference/decision with no notion of
// right or wrong, `quiz` poses a question that HAS a correct answer, grades
// submitted selections instantly, and shows tight feedback (✓/✗ + the correct
// answer + an optional explanation) to both the user and the agent.
//
// It is intentionally options-only: single-select or multi-select. The
// automatic Other choice is an explicit, ungraded "I don't know" signal.
// ────────────────────────────────────────────────────────────────────────────

interface QuizOption {
	label: string;
	value: string;
	description?: string;
}

interface DisplayOption extends QuizOption {
	id: string;
	index: number;
}

interface OptionAnswer {
	label: string;
	value: string;
	index: number; // 1-based, matches the number shown to the user
}

// Other is always last. It is not gradable: selecting it reports an honest
// knowledge gap instead of manufacturing a right/wrong result.
const DONT_KNOW_VALUE = "__dont_know__";
const DONT_KNOW_LABEL = "Other";
const DONT_KNOW_INDEX = 0; // real options are 1-based

interface QuizResponse {
	dontKnow: boolean;
	tooHard?: boolean; // Ctrl+P: pause so the agent teaches and retries at a simpler level
	answers: OptionAnswer[];
	followUp?: string; // set when the captain submits Steering guidance instead of answering
}

type QuizStatus = "answered" | "cancelled" | "unavailable" | "follow-up" | "too-hard";
type QuizMode = "single-select" | "multi-select";

interface DisplayedOption {
	index: number; // 1-based, in the final (possibly shuffled) display order
	label: string;
}

interface QuizResultDetails {
	status: QuizStatus;
	title?: string; // short node/goal title from the tool call; journal heading
	question: string;
	context?: string;
	mode: QuizMode;
	answers: OptionAnswer[];
	correctIndices: number[];
	options?: DisplayedOption[]; // full option list in display order, for the transcript
	correct?: boolean;
	dontKnow?: boolean; // user selected the ungraded Other option instead of guessing
	note?: string; // retained when rendering results from older sessions
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
	title: Type.Optional(
		Type.String({
			description:
				"Short title for this quiz. Keep it under 40 characters. Name the node under test and the teaching goal. Example: 'Node E — ROV drop scope'. The panel shows it as the heading. The journal records it as the entry heading. Headings carry no timestamp.",
		}),
	),
	question: Type.String({
		description: "The single quiz question. Ask exactly one question per tool call.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions. The panel shows it under the question." }),
	),
	options: Type.Array(OptionSchema, {
		description:
			"The answer options. Supply 2 or more. There is no free-text mode. Give each option a stable `value`. You reference the correct option by that value in correctAnswer.",
		minItems: 2,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Set to true when more than one option is correct. The user must then select all correct options." }),
	),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			'REQUIRED. The correct answer as the option value or values. Pass the `value` field of the intended option. Single-select: one string, for example "mercury". Multi-select: an array of strings, for example ["belize", "niue"]. The user is correct only when the selection matches this set exactly. Always pass the value, not a position number. The check is automatic and prevents miscounting.',
	}),
	explanation: Type.String({
		description:
			"REQUIRED. The tool shows it after the user answers. It shows for a correct and for an incorrect answer. Use it to say why the correct answer is correct.",
	}),
	shuffle: Type.Optional(
		Type.Boolean({
			description:
				"Defaults to true. The tool reorders the options at random before display, so the correct answer does not stay in one position. Set to false only when the order carries meaning. Examples: ordered numeric values, or 'All/None of the above' as the last option.",
		}),
	),
	contextFiles: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Optional file paths that give context for this question. When present, the panel shows an `o` shortcut. Pressing `o` opens these files in vim. Relative paths resolve from the session cwd.",
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
// `h` lesson view — opens the session's lesson journal in the learner's editor.
//
// Pressing `h` mid-quiz in Answer mode opens the per-session LESSON JOURNAL
// (<session>.md, the live file md-log appends to as the session runs) so
// the learner can read the whole running transcript while answering — the
// journal first, not the focus-buffer node view. The quiz itself stays
// active and ungraded. Fire-and-forget: never throws into the quiz, no LLM
// call, no waiting.
// ────────────────────────────────────────────────────────────────────────
function openLessonFileShortcut(ctx: any): void {
	ctx?.ui?.notify?.("Opening lesson journal…", "info");
	void openJournalInEditor(ctx)
		.then((res) => ctx?.ui?.notify?.(res.message, "info"))
		.catch((err) => ctx?.ui?.notify?.(`lesson journal open failed: ${err?.message ?? String(err)}`, "warning"));
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

function buildStructuredResult(details: QuizResultDetails): QuizResultDetails {
	return details;
}

function cancelledResult(
	question: string,
	mode: QuizMode,
	correctIndices: number[],
	context?: string,
	title?: string,
) {
	const message = "User cancelled the quiz";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult({
			status: "cancelled",
			title,
			question,
			context,
			mode,
			answers: [],
			correctIndices,
			message,
		}),
	};
}

function unavailableResult(
	question: string,
	mode: QuizMode,
	message: string,
	correctIndices: number[],
	context?: string,
	title?: string,
) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult({
			status: "unavailable",
			title,
			question,
			context,
			mode,
			answers: [],
			correctIndices,
			message,
		}),
	};
}

// Ctrl+P ends the quiz without grading or revealing the answer, and tells the
// agent to teach the prerequisite before retrying at a simpler level.
function tooHardResult(
	question: string,
	mode: QuizMode,
	correctIndices: number[],
	context?: string,
	title?: string,
) {
	const message =
		"User passed with Ctrl+P because the question was too hard. Explain the prerequisite more simply, then ask an easier quiz question. Do not grade this as wrong or reveal the original answer.";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult({
			status: "too-hard",
			title,
			question,
			context,
			mode,
			answers: [],
			correctIndices,
			message,
		}),
	};
}

// Steering mode lets the captain replace or pause the question. Submitting it
// ends this quiz and returns the guidance to the agent.
function followUpResult(
	question: string,
	mode: QuizMode,
	followUp: string,
	correctIndices: number[],
	context?: string,
	title?: string,
) {
	const message = `User steered instead of answering: ${followUp}`;
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult({
			status: "follow-up",
			title,
			question,
			context,
			mode,
			answers: [],
			correctIndices,
			followUp,
			message,
		}),
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
	title?: string,
) {
	const { dontKnow, answers } = response;
	const selectedIndices = answers.map((a) => a.index);
	// Other is ungraded and never counted as correct.
	const correct = dontKnow ? false : isCorrect(selectedIndices, correctIndices);
	const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
	const displayedOptions: DisplayedOption[] = options.map((o, i) => ({ index: i + 1, label: o.label }));

	let text: string;
	if (dontKnow) {
		// Make the signal explicit for the agent: the user did NOT guess, so this
		// is a genuine knowledge gap, not a wrong answer to correct against.
		text = `User selected Other (I don't know) — a genuine knowledge gap, not a wrong guess.`;
		text += `\nCorrect: ${correctStr}`;
	} else {
		const verdict = correct ? "correctly" : "incorrectly";
		const selectedStr = answers.map((a) => `${a.index}. ${a.label}`).join(", ");
		text = `User answered ${verdict}.\nSelected: ${selectedStr}\nCorrect: ${correctStr}`;
	}
	if (explanation) text += `\nExplanation: ${explanation}`;

	return {
		content: [{ type: "text" as const, text }],
		details: buildStructuredResult({
			status: "answered",
			title,
			question,
			context,
			mode,
			answers,
			correctIndices,
			options: displayedOptions,
			correct,
			dontKnow,
			explanation,
		}),
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
		add(theme.fg("warning", " · You chose Other (I don't know)"));
		const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
		addWrapped(lines, theme.fg("muted", `Correct answer: ${correctStr}`), width, " ");
	} else if (correct) {
		add(theme.fg("success", " ✓ Correct!"));
	} else {
		add(theme.fg("error", " ✗ Incorrect."));
		const correctStr = correctIndices.map((i) => formatOptionRef(options, i)).join(", ");
		addWrapped(lines, theme.fg("muted", `Correct answer: ${correctStr}`), width, " ");
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
	// Every prompt gets a content row and one column of left padding.
	for (const line of promptLines) {
		const pad = Math.max(0, bw - visibleWidth(line));
		out.push(`${accent("│")} ${line}${" ".repeat(pad)} ${accent("│")}`);
	}
	out.push(accent("╰") + accent("─".repeat(width - 2)) + accent("╯"));
	return out;
}

// Title + question + optional context. Shared by both components. (The frame
// provides the border now; no flat top bar.) The title names the node under
// test so the learner knows which lesson the question belongs to.
function pushHeader(
	lines: string[],
	theme: any,
	width: number,
	title: string | undefined,
	question: string,
	context: string | undefined,
): void {
	if (title) {
		addWrapped(lines, theme.fg("toolTitle", theme.bold(title)), width, " ");
		lines.push("");
	}
	addWrapped(lines, theme.fg("text", question), width, " ");
	if (context) {
		lines.push("");
		addWrapped(lines, theme.fg("muted", context), width, " ");
	}
}

// Other is always the final answer row and means "I don't know".
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

function pushPromptLine(lines: string[], theme: any, width: number, mode: InputMode, editor: Editor): void {
	if (mode === "answer") {
		lines.push(truncateToWidth(theme.fg("accent", "› answer"), width));
		return;
	}
	for (const [index, line] of editorInnerLines(editor, Math.max(1, width - 2)).entries()) {
		lines.push(`${index === 0 ? "› " : "  "}${line}`);
	}
}

function makeSteeringEditor(tui: any, theme: any): Editor {
	const editor = new Editor(tui, createEditorTheme(theme));
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
	title?: string,
): Promise<QuizResponse | null> {
	const allOptions: DisplayOption[] = options.map((option, index) => ({
		...option,
		id: `option:${index}`,
		index: index + 1,
	}));
	const dontKnowNav = allOptions.length;

	return ctx.ui.custom<QuizResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: QuizResponse | null) => void) => {
			let optionIndex = 0;
			let phase: "select" | "feedback" = "select";
			let mode: InputMode = "answer";
			let chosen: OptionAnswer | null = null;
			let dontKnow = false;
			let panelFocused = false;
			const steeringEditor = makeSteeringEditor(tui, theme);
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function setMode(next: InputMode) {
				mode = next;
				steeringEditor.focused = panelFocused && mode === "steering";
				refresh();
			}

			function response(): QuizResponse {
				return dontKnow
					? { dontKnow: true, answers: [] }
					: { dontKnow: false, answers: chosen ? [chosen] : [] };
			}

			function handleInput(data: string) {
				if (phase === "feedback") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(response());
					return;
				}

				if (matchesKey(data, Key.ctrl("p"))) {
					done({ dontKnow: false, tooHard: true, answers: [] });
					return;
				}
				if (matchesKey(data, Key.tab)) {
					setMode(nextInputMode(mode));
					return;
				}

				if (mode === "steering") {
					if (matchesKey(data, Key.enter)) {
						const text = steeringEditor.getText().trim();
						if (text) done({ dontKnow: false, answers: [], followUp: text });
						return;
					}
					if (matchesKey(data, Key.escape)) {
						setMode("answer");
						return;
					}
					steeringEditor.handleInput(data);
					tui.requestRender();
					return;
				}

				// mode === "answer"
				if (matchesKey(data, "o") && contextFiles.length > 0) {
					void openContextFiles(ctx, contextFiles).catch((error) =>
						ctx?.ui?.notify?.(`Could not open context files: ${error}`, "warning"),
					);
					return;
				}

				if (matchesKey(data, "h")) {
					openLessonFileShortcut(ctx);
					return;
				}

				const shortcutIndex = numberShortcutIndex(data, allOptions.length);
				if (shortcutIndex !== undefined) {
					const selected = allOptions[shortcutIndex];
					optionIndex = shortcutIndex;
					chosen = { label: selected.label, value: selected.value, index: selected.index };
					dontKnow = false;
					refresh();
					return;
				}

				if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
					optionIndex = Math.max(0, optionIndex - 1);
					chosen = null;
					dontKnow = false;
					refresh();
					return;
				}
				if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
					optionIndex = Math.min(dontKnowNav, optionIndex + 1);
					chosen = null;
					dontKnow = false;
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
				pushHeader(top, theme, tw, title, question, context);

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
					);
					bottom.push(theme.fg("accent", "› feedback"));
					const framed = frameMerged(top, bottom, width, theme);
					cachedLines = framed;
					cachedWidth = width;
					return framed;
				}

				top.push("");
				for (let i = 0; i < allOptions.length; i++) {
					const option = allOptions[i];
					const focused = mode === "answer" && i === optionIndex;
					const prefix = focused ? theme.fg("accent", "> ") : "  ";
					const label = `${chosen?.index === option.index ? "● " : ""}${option.index}. ${option.label}`;
					const styled = focused ? theme.fg("accent", label) : theme.fg("text", label);
					add(`${prefix}${styled}`);
					if (option.description) {
						addWrapped(top, theme.fg("muted", option.description), tw, "     ");
					}
				}

				pushDontKnowRow(top, theme, tw, mode === "answer" && optionIndex === dontKnowNav);

				top.push("");
				addWrapped(
					top,
					theme.fg("dim", mode === "answer"
						? joinHints(modeIndicator(theme, mode), "Ctrl+P pause", NAVIGATION_HINT, numberShortcutHint(allOptions.length, "select"), "Enter feedback", "Tab steering", contextFileHint(contextFiles), lessonFileHint(), "Esc cancel")
						: joinHints(modeIndicator(theme, mode), "type guidance", "Enter send", "Tab answer", "Esc answer")),
					tw,
					" ",
				);

				pushPromptLine(bottom, theme, bw, mode, steeringEditor);
				const framed = frameMerged(top, bottom, width, theme);
				if (mode === "answer") {
					cachedLines = framed;
					cachedWidth = width;
				}
				return framed;
			}

			return {
				get focused() { return panelFocused; },
				set focused(value: boolean) {
					panelFocused = value;
					steeringEditor.focused = value && mode === "steering";
				},
				render,
				invalidate: () => {
					cachedLines = undefined;
					steeringEditor.invalidate();
				},
				handleInput,
			};
		}
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
	title?: string,
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
	const allItems: DisplayOption[] = [...choiceItems, dontKnowItem];

	return ctx.ui.custom<QuizResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: QuizResponse | null) => void) => {
			let optionIndex = 0;
			let phase: "select" | "feedback" = "select";
			let mode: InputMode = "answer";
			let panelFocused = false;
			const steeringEditor = makeSteeringEditor(tui, theme);
			let cachedLines: string[] | undefined;
			let cachedWidth = -1;
			const selected = new Map<string, OptionAnswer>();

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function setMode(next: InputMode) {
				mode = next;
				steeringEditor.focused = panelFocused && mode === "steering";
				refresh();
			}

			const choseDontKnow = () => selected.has(DONT_KNOW_ID);
			const realAnswers = () =>
				sortAnswers(Array.from(selected.values()).filter((a) => a.index !== DONT_KNOW_INDEX));

			function response(): QuizResponse {
				return choseDontKnow()
					? { dontKnow: true, answers: [] }
					: { dontKnow: false, answers: realAnswers() };
			}

			// Other is exclusive: choosing it clears real selections, and choosing
			// any real option clears Other.
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
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(response());
					return;
				}

				if (matchesKey(data, Key.ctrl("p"))) {
					done({ dontKnow: false, tooHard: true, answers: [] });
					return;
				}
				if (matchesKey(data, Key.tab)) {
					setMode(nextInputMode(mode));
					return;
				}

				if (mode === "steering") {
					if (matchesKey(data, Key.enter)) {
						const text = steeringEditor.getText().trim();
						if (text) done({ dontKnow: false, answers: [], followUp: text });
						return;
					}
					if (matchesKey(data, Key.escape)) {
						setMode("answer");
						return;
					}
					steeringEditor.handleInput(data);
					tui.requestRender();
					return;
				}

				// mode === "answer"
				if (matchesKey(data, "o") && contextFiles.length > 0) {
					void openContextFiles(ctx, contextFiles).catch((error) =>
						ctx?.ui?.notify?.(`Could not open context files: ${error}`, "warning"),
					);
					return;
				}

				if (matchesKey(data, "h")) {
					openLessonFileShortcut(ctx);
					return;
				}

				const shortcutIndex = numberShortcutIndex(data, choiceItems.length);
				if (shortcutIndex !== undefined) {
					optionIndex = shortcutIndex;
					toggleOption(choiceItems[shortcutIndex]);
					return;
				}

				if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
					optionIndex = Math.min(allItems.length - 1, optionIndex + 1);
					refresh();
					return;
				}

				const current = allItems[optionIndex];
				if (matchesKey(data, Key.space)) {
					toggleOption(current);
					return;
				}

				if (matchesKey(data, Key.enter)) {
					if (selected.size === 0) toggleOption(current);
					submit();
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
				pushHeader(top, theme, tw, title, question, context);

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
					);
					bottom.push(theme.fg("accent", "› feedback"));
					const framed = frameMerged(top, bottom, width, theme);
					cachedLines = framed;
					cachedWidth = width;
					return framed;
				}

				top.push("");
				for (let i = 0; i < allItems.length; i++) {
					const item = allItems[i];
					const isFocused = mode === "answer" && i === optionIndex;
					const prefix = isFocused ? theme.fg("accent", "> ") : "  ";

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
				addWrapped(
					top,
					theme.fg("dim", mode === "answer"
						? joinHints(modeIndicator(theme, mode), "Ctrl+P pause", NAVIGATION_HINT, numberShortcutHint(choiceItems.length, "toggle"), "Space toggle", "Enter feedback", "Tab steering", contextFileHint(contextFiles), lessonFileHint(), "Esc cancel")
						: joinHints(modeIndicator(theme, mode), "type guidance", "Enter send", "Tab answer", "Esc answer")),
					tw,
					" ",
				);

				pushPromptLine(bottom, theme, bw, mode, steeringEditor);
				const framed = frameMerged(top, bottom, width, theme);
				if (mode === "answer") {
					cachedLines = framed;
					cachedWidth = width;
				}
				return framed;
			}

			return {
				get focused() { return panelFocused; },
				set focused(value: boolean) {
					panelFocused = value;
					steeringEditor.focused = value && mode === "steering";
				},
				render,
				invalidate: () => {
					cachedLines = undefined;
					steeringEditor.invalidate();
				},
				handleInput,
			};
		}
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
			"Ask the user a graded question. The question must have a known correct answer. The tool grades the answer and shows feedback. Answer mode: number shortcuts and j/k navigation. Enter shows feedback. Other is always the last choice. It reports an honest knowledge gap, not a guess. Tab opens steering mode. There the user types guidance. It ends the quiz and returns as `followUp`. Ctrl+P marks the quiz as too hard. It does not show the answer. There is no free-text answer mode. For a question without a correct answer, use ask_user_question.",
		promptSnippet:
			"Use quiz to test the user with a graded multiple-choice or multi-select question. Supply the correct answer and an explanation. For a question without a correct answer, use ask_user_question.",
		promptGuidelines: [
			"quiz is graded; ask_user_question is not. Use quiz when the question has a correct answer. Use ask_user_question for a preference, a decision, or open input.",
			"Always pass `title`. Keep it under 40 characters. Name the node under test and the teaching goal. Example: 'Node E — ROV drop scope'. Never use 'Question 3'. The panel and the journal entry carry this title.",
			"Write the question, the options, and the explanation in Simplified Technical English at full compliance. Use short sentences, the active voice, approved verbs, and one term per concept. The general 80% relaxation does not apply to quiz prose.",
			'correctAnswer is required. Pass the option `value`, not a position number. Single-select: one string, for example "mercury". Multi-select: an array of strings, for example ["belize", "niue"].',
			"The tool checks the value against the options. A value that matches no option is a hard error. This prevents miscounting.",
			"explanation is required. Say why the correct answer is correct.",
			"Multi-select grading is an exact-set match. The user is correct only when they select every correct option and no incorrect one.",
			"The tool adds an ungraded Other choice at the bottom. Supply only the real, gradable options. A dontKnow result means the user did not guess. Treat it as a genuine knowledge gap.",
			"A `too-hard` status means the user pressed Ctrl+P. The question was above their level. Do not grade it. Do not reveal the original answer. Teach the prerequisite in simpler words, then ask an easier question.",
			"A result with `followUp` set means the captain steered the quiz. Answer that guidance directly. Do not grade it.",
			"Treat each distractor as a diagnostic probe, not filler. Make it a specific mistake the user might hold: a common misconception, or an easily confused concept. The distractor the user picks tells you which gap to teach next. It also tells you what the explanation must address.",
			"Guardrail: each distractor must be clearly wrong on the intended reading. Make it tempting, but a real error. Do not write a defensible alternative. Do not write a trick question.",
			"Do not let the correct answer stand out by form. Keep the options similar in length, detail, and phrasing. The user must not pick the answer from shape alone.",
			"Set multiSelect: true only when more than one option is correct.",
			"The tool shuffles the options by default. Do not worry about the list position of the correct answer. Set shuffle: false only when the order carries meaning. Examples: ordered values, or 'All/None of the above' as the last option.",
			'When the question needs file context, pass `contextFiles: ["path/to/file"]`. The user presses `o` to open those files in vim. The quiz stays active.',
			"The user can press `h` mid-quiz. It opens the session journal (<session>.md) in the editor pane. md-log maintains this journal. The quiz stays active and ungraded.",
			"To probe nuance, ask several short questions. Adapt each one to the previous answer. Do not write one large question.",
			"Do not leak the answer through formatting. Keep the option phrasing and length even. Do not hint at the correct option.",
		],
		parameters: QuizParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const context = params.details?.trim() || undefined;
			const contextFiles = normalizeContextFiles((params as any).contextFiles);
			const explanation = params.explanation.trim();
			const title = (params as any).title?.trim() || undefined;
			const mode: QuizMode = params.multiSelect ? "multi-select" : "single-select";

			let options: QuizOption[];
			try {
				options = normalizeOptions(params.options);
			} catch (e) {
				return unavailableResult(params.question, mode, `quiz ${(e as Error).message}`, [], context, title);
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
				details: { title, options: options.map((o, i) => ({ index: i + 1, label: o.label })) },
			});

			const { indices: correctIndices, error: correctError } = resolveCorrect(
				params.correctAnswer as string | string[],
				options,
			);

			if (signal?.aborted) {
				return cancelledResult(params.question, mode, correctIndices, context, title);
			}

			if (options.length < 2) {
				return unavailableResult(
					params.question,
					mode,
					"quiz requires at least two options",
					correctIndices,
					context,
					title,
				);
			}

			if (correctError) {
				return unavailableResult(params.question, mode, `quiz ${correctError}`, correctIndices, context, title);
			}

			if (!ctx.hasUI) {
				return unavailableResult(params.question, mode, "quiz requires interactive mode UI", correctIndices, context, title);
			}

			return withUILock(async () => {
				const response =
					mode === "single-select"
						? await askSingleChoice(ctx, signal, params.question, context, contextFiles, options, correctIndices, explanation, title)
						: await askMultiChoice(ctx, signal, params.question, context, contextFiles, options, correctIndices, explanation, title);
				if (!response) {
					return cancelledResult(params.question, mode, correctIndices, context, title);
				}
				if (response.followUp) {
					return followUpResult(params.question, mode, response.followUp, correctIndices, context, title);
				}
				if (response.tooHard) {
					return tooHardResult(params.question, mode, correctIndices, context, title);
				}
				return buildResult(params.question, context, mode, options, response, correctIndices, explanation, title);
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
			let text = theme.fg("toolTitle", theme.bold("quiz "));
			if (args.title) text += theme.fg("accent", String(args.title)) + " ";
			text += theme.fg("muted", args.question);
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
				const body = details.followUp ? `Steering: ${details.followUp}` : (details.message || "Steering");
				return new Text(theme.fg("accent", body), 0, 0);
			}
			if (details.status === "too-hard") {
				return new Text(theme.fg("warning", "Passed — question was too hard; simplifying next"), 0, 0);
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
				? theme.fg("warning", "Other — I don't know")
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
