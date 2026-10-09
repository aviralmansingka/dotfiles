import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { openEditor } from "./nvim-open";
import { focusNodeBuffer, showNodeBuffer } from "./focus-buffer";

// ────────────────────────────────────────────────────────────────────────────
// md-log — a per-session markdown journal of lessons and graded questions.
//
// The journal file lives NEXT TO the session file (same directory, .md
// extension instead of the session's), so every conversation that teaches
// gets its own course transcript: each lesson appears when it is shown, and
// each quiz/explain result (question, the user's answer, the verdict, the
// correct answer) is appended beneath it as the conversation continues.
//
// Override the location with PI_LESSON_JOURNAL=/path/to/file.md.
//
// Journal writes stay event-driven: tool_execution_start records lesson
// content, and tool_execution_end records quiz/explain results. The lesson,
// quiz, and explain tools import only the presentation helpers below. Quiz
// publishes its options in tool_execution_update in display order BEFORE
// blocking; the end result's details already carry the same display order,
// so this extension writes only from the end event.
// ────────────────────────────────────────────────────────────────────────────

const JOURNAL_TOOLS = new Set(["quiz", "explain"]);

/** Session file `/a/b/xyz.jsonl` → journal `/a/b/xyz.md`. */
export function journalPathFor(sessionFile: string): string {
	const ext = extname(sessionFile);
	const stem = sessionFile.slice(0, sessionFile.length - ext.length);
	return `${stem || sessionFile}.md`;
}

/**
 * Resolve the journal path for the CURRENT session from an extension ctx
 * (tool execute or event handler): PI_LESSON_JOURNAL wins, else the session
 * file's sibling. Returns undefined outside a session (no journal).
 */
export function resolveJournalPath(ctx: any): string | undefined {
	const override = process.env.PI_LESSON_JOURNAL;
	if (override) return resolve(ctx?.cwd ?? process.cwd(), override);
	try {
		const file = ctx?.sessionManager?.getSessionFile?.();
		return typeof file === "string" && file.startsWith("/")
			? journalPathFor(resolve(file))
			: undefined;
	} catch {
		return undefined;
	}
}

// Entry stamp with a date — arcs can span days, and a time-only stamp
// makes next-day entries read as if they came first.
function entryStamp(): string {
	const iso = new Date().toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Escape emphasis/inline-code metacharacters in short user-facing labels
 *  (option labels are full of `*` for multiplication, which must not
 *  render as italics). Questions and lesson bodies stay verbatim — their
 *  markdown (code spans, bold) is authored deliberately. */
function escapeLabel(label: string): string {
	return label.replace(/([*_`])/g, "\\$1");
}

/** Demote a lesson body's headings one level so its sections nest under
 *  the entry heading instead of colliding with it. */
function demoteHeadings(body: string): string {
	return body
		.split("\n")
		.map((line) => (line.match(/^#{1,5} /) ? `#${line}` : line))
		.join("\n");
}

/** Markdown for one lesson, as it is shown to the user. The heading is the
 *  lesson's own short title; the stamp rides a metadata line under it so the
 *  heading stays content-focused and scannable. */
export function formatLessonEntry(title: string, body: string): string {
	return [
		`## ${title.trim()}`,
		"",
		`_Lesson · ${entryStamp()}_`,
		"",
		demoteHeadings(body.trim()),
		"",
	].join("\n");
}

interface QuizDetails {
	status: string;
	title?: string;
	question: string;
	context?: string;
	mode?: string;
	answers?: Array<{ index: number; label: string }>;
	correctIndices?: number[];
	options?: Array<{ index: number; label: string }>;
	correct?: boolean;
	dontKnow?: boolean;
	explanation?: string;
	followUp?: string;
	message?: string;
}

function quizVerdict(details: QuizDetails): string {
	if (details.dontKnow) return "◐ Other — I don't know";
	if (details.status === "answered") return details.correct ? "✓ Correct" : "✗ Incorrect";
	return details.status;
}

/** Markdown for one quiz result, in the order the user actually saw. The
 *  heading is the quiz's own short title (node + teaching goal) when the
 *  tool call supplied one; the verdict and stamp ride a metadata line under
 *  it. No timestamp in the heading. */
export function formatQuizEntry(details: QuizDetails): string {
	const lines: string[] = [];
	const mode = details.mode === "multi-select" ? "multi-select" : "Quiz";
	lines.push(`## ${details.title?.trim() || mode}`);
	lines.push("");
	lines.push(`_${mode} · ${quizVerdict(details)} · ${entryStamp()}_`);
	lines.push("");
	lines.push(`**Question:** ${details.question.trim()}`);
	if (details.context?.trim()) {
		lines.push("");
		lines.push(`**Context:** ${details.context.trim()}`);
	}
	lines.push("");
	const displayed = details.options?.length
		? details.options
		: (details.answers ?? []);
	const selected = new Set((details.answers ?? []).map((a) => a.index));
	const correct = new Set(details.correctIndices ?? []);
	for (const opt of displayed) {
		const label = escapeLabel(opt.label);
		const num = `**${opt.index}.**`;
		if (correct.has(opt.index) && selected.has(opt.index)) {
			lines.push(`- ✓ ${num} ${label}`);
		} else if (correct.has(opt.index)) {
			lines.push(`- ✓ ${opt.index}. ${label}`);
		} else if (selected.has(opt.index)) {
			lines.push(`- ✗ ${num} ${label}`);
		} else {
			lines.push(`- ${opt.index}. ${label}`);
		}
	}
	if (details.explanation) {
		lines.push("");
		lines.push(`**Why:** ${details.explanation.trim()}`);
	}
	if (details.followUp) {
		lines.push("");
		lines.push(`**Steering:** ${details.followUp}`);
	}
	lines.push("");
	return lines.join("\n");
}

interface ExplainDetails {
	status: string;
	title?: string;
	question: string;
	context?: string;
	answer?: string;
	grading?: {
		verdict: string;
		grade: string;
		summary: string;
		correctAnswer: string;
		refinements?: Array<{ quote: string; issue: string; correction: string }>;
	};
	message?: string;
}

function explainVerdict(details: ExplainDetails): string {
	const g = details.grading;
	if (!g) return details.status;
	const glyph =
		g.verdict === "correct" ? "✓" : g.verdict === "incorrect" ? "✗" : "◐";
	return `${glyph} ${g.verdict.replace(/_/g, " ")} — grade ${g.grade}`;
}

/** Markdown for one explain result: the prose answer plus its grading. The
 *  heading is the question's own short title (node + teaching goal) when the
 *  tool call supplied one; the verdict and stamp ride a metadata line under
 *  it. No timestamp in the heading. */
export function formatExplainEntry(details: ExplainDetails): string {
	const lines: string[] = [];
	lines.push(`## ${details.title?.trim() || "Explain"}`);
	lines.push("");
	lines.push(`_Explain · ${explainVerdict(details)} · ${entryStamp()}_`);
	lines.push("");
	lines.push(`**Question:** ${details.question.trim()}`);
	lines.push("");
	if (details.answer?.trim()) {
		lines.push("**Your answer:**");
		lines.push("");
		lines.push(`> ${details.answer.trim().replace(/\n/g, "\n> ")}`);
	} else if (details.status === "answered") {
		lines.push(`**Your answer:** _(no answer — honest \"I don't know\")_`);
	}
	const g = details.grading;
	if (g) {
		lines.push("");
		lines.push(`**Correct answer:** ${g.correctAnswer}`);
		if (g.summary) lines.push(`**Why:** ${g.summary}`);
		for (const r of g.refinements ?? []) {
			lines.push(`  - “${r.quote}” — ${r.issue} → ${r.correction}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function appendEntry(path: string | undefined, entry: string): void {
	if (!path) return;
	try {
		if (!existsSync(path)) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(
				path,
				`# Lesson journal\n\n_Created ${new Date().toISOString()}_\n\n`,
				"utf-8",
			);
		}
		// Horizontal rules between entries keep the transcript scannable;
		// the leading blank line keeps `---` from turning the last text line
		// into a setext heading.
		appendFileSync(path, `\n---\n\n${entry}`, "utf-8");
	} catch {
		// The journal is an at-most-once convenience: never let a logging
		// failure break the conversation.
	}
}

/** Buffer-name key for this session's focus buffer (journal path stem). */
function focusKey(ctx: any): string {
	const journal = resolveJournalPath(ctx);
	if (!journal) return "session";
	const base = journal.split("/").pop() ?? "session";
	return base.replace(/\.md$/, "");
}

/** Present a lesson as the current node: focus buffer first (an in-memory
 *  scratch buffer holding only this node), the journal file as fallback.
 *  Used by the lesson tool. */
export async function presentLesson(
	ctx: any,
	title: string,
	body: string,
): Promise<{ mode: "buffer" | "journal" | "none"; message: string }> {
	const buffer = showNodeBuffer(focusKey(ctx), title, body);
	if (buffer.ok) {
		return {
			mode: "buffer",
			message: `${buffer.message} — the learner's side buffer shows only this node`,
		};
	}
	const journal = await openJournalInEditor(ctx);
	if (!journal.ok) return { mode: "none", message: `${buffer.message}; ${journal.message}` };
	return {
		mode: "journal",
		message: `${buffer.message}; opened the journal instead — ${journal.message}`,
		};
}

/**
 * Open the session's CURRENT NODE in the learner's editor: focus the
 * existing in-memory node buffer (the one the last `lesson` call filled)
 * without rewriting it, and fall back to the journal file when no node
 * buffer exists yet or no nvim RPC editor is available. Non-blocking.
 * Used by quiz `h`, explain `h`, and the global ctrl+h shortcut.
 */
export async function openNodeView(
	ctx: any,
): Promise<{ mode: "buffer" | "journal" | "none"; message: string }> {
	const buffer = focusNodeBuffer(focusKey(ctx));
	if (buffer.ok) return { mode: "buffer", message: buffer.message };
	const journal = await openJournalInEditor(ctx);
	if (!journal.ok) {
		return { mode: "none", message: `${buffer.message}; ${journal.message}` };
	}
	return {
		mode: "journal",
		message: `${buffer.message}; opened the journal instead — ${journal.message}`,
	};
}

/**
 * Open the session's lesson journal in the user's editor pane (existing pane
 * if one is open, else a split). Non-blocking: resolves as soon as the file
 * is sent, never waits for the user to finish reading. Used by the Shift+H
 * panel shortcut and the /lessons command; node-view surfaces (panel `h`,
 * global ctrl+h) use it only as their fallback (see openNodeView).
 */
export async function openJournalInEditor(
	ctx: any,
): Promise<{ message: string; ok: boolean; launched: boolean }> {
	const journalPath = resolveJournalPath(ctx);
	if (!journalPath) {
		return { message: "No lesson journal for this session", ok: false, launched: false };
	}
	if (!existsSync(journalPath)) {
		return {
			message: `Lesson journal not written yet (${journalPath})`,
			ok: false,
			launched: false,
		};
	}
	const result = await openEditor(ctx?.cwd ?? process.cwd(), [journalPath]);
	return {
		message: `${result.message} — lesson journal ${journalPath}`,
		ok: result.ok,
		launched: result.launched,
	};
}

export default function mdLog(pi: ExtensionAPI) {
	// Any-time command to open the session's lesson journal in the user's
	// editor pane. The Shift+H panel shortcut and this command share the
	// helper. The lesson tool uses it only when the focus buffer is unavailable.
	pi.registerCommand("lessons", {
		description: "Open this session's lesson journal in the editor pane",
		handler: async (_args: string, ctx: any) => {
			const result = await openJournalInEditor(ctx);
			ctx?.ui?.notify?.(result.message, result.ok ? "info" : "warning");
		},
	});

	// Global shortcut: from anywhere in pi, focus the session's current node
	// buffer (the last lesson shown). Alt is not an option — the learner's
	// window manager owns the Option key — and Shift+H already serves the
	// journal on the quiz/explain panels. Kitty-protocol terminals deliver
	// ctrl+h distinctly from backspace; in legacy terminals the byte is
	// ambiguous (0x08) and pi keeps it as backspace there.
	pi.registerShortcut("ctrl+h", {
		description: "Open the current lesson node buffer (journal fallback)",
		handler: async (ctx: any) => {
			const result = await openNodeView(ctx);
			ctx?.ui?.notify?.(result.message, result.mode === "none" ? "warning" : "info");
		},
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (event.toolName !== "lesson") return;
		const args = event.args as { title?: string; body?: string } | undefined;
		if (!args?.title || !args.body) return;
		appendEntry(resolveJournalPath(ctx), formatLessonEntry(args.title, args.body));
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (!JOURNAL_TOOLS.has(event.toolName)) return;
		const details = event.result?.details;
		if (!details?.question) return;
		const entry =
			event.toolName === "quiz"
				? formatQuizEntry(details as QuizDetails)
				: formatExplainEntry(details as ExplainDetails);
		appendEntry(resolveJournalPath(ctx), entry);
	});
}
