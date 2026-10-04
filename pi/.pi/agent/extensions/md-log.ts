import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

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
// This is a pure listener: quiz/explain/lesson need no changes and no
// imports from here. It consumes tool_execution_start (lesson content) and
// tool_execution_end (quiz/explain results) events. quiz deliberately
// publishes its options in tool_execution_update in display order BEFORE
// blocking; the end result's details already carry the same display order,
// so we only listen to the end event.
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
	if (override) return override;
	try {
		const file = ctx?.sessionManager?.getSessionFile?.();
		return typeof file === "string" && file.startsWith("/")
			? journalPathFor(resolve(file))
			: undefined;
	} catch {
		return undefined;
	}
}

function timestamp(): string {
	return new Date().toISOString().slice(11, 19); // HH:MM:SS, UTC
}

/** Markdown for one lesson, as it is shown to the user. */
export function formatLessonEntry(title: string, body: string): string {
	return [
		`## ${timestamp()} — Lesson: ${title.trim()}`,
		"",
		body.trim(),
		"",
	].join("\n");
}

interface QuizDetails {
	status: string;
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

/** Markdown for one quiz result, in the order the user actually saw. */
export function formatQuizEntry(details: QuizDetails): string {
	const lines: string[] = [];
	const verdict = details.dontKnow
		? "Other — I don't know"
		: details.status === "answered"
			? details.correct
				? "✓ Correct"
				: "✗ Incorrect"
			: details.status;
	lines.push(`### ${timestamp()} — Quiz: ${details.question.trim()} — ${verdict}`);
	if (details.mode === "multi-select") lines.push("_multi-select_");
	lines.push("");
	const displayed = details.options?.length
		? details.options
		: (details.answers ?? []);
	const selected = new Set((details.answers ?? []).map((a) => a.index));
	const correct = new Set(details.correctIndices ?? []);
	for (const opt of displayed) {
		const mark = correct.has(opt.index) ? "✓" : selected.has(opt.index) ? "✗" : " ";
		const picked = selected.has(opt.index) ? "**" : "";
		lines.push(`${mark} ${picked}${opt.index}. ${opt.label}${picked}`);
	}
	if (details.explanation) {
		lines.push("");
		lines.push(`> ${details.explanation.trim()}`);
	}
	if (details.followUp) {
		lines.push("");
		lines.push(`Steering: ${details.followUp}`);
	}
	lines.push("");
	return lines.join("\n");
}

interface ExplainDetails {
	status: string;
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

/** Markdown for one explain result: the prose answer plus its grading. */
export function formatExplainEntry(details: ExplainDetails): string {
	const lines: string[] = [];
	const g = details.grading;
	const verdict = g
		? `${g.verdict} — grade ${g.grade}`
		: details.status;
	lines.push(`### ${timestamp()} — Explain: ${details.question.trim()} — ${verdict}`);
	lines.push("");
	if (details.answer?.trim()) {
		lines.push(`> ${details.answer.trim().replace(/\n/g, "\n> ")}`);
	} else {
		lines.push("> _(no answer — honest \"I don't know\")_");
	}
	if (g) {
		lines.push("");
		lines.push(`**Correct answer:** ${g.correctAnswer}`);
		if (g.summary) lines.push(`**Why:** ${g.summary}`);
		for (const r of g.refinements ?? []) {
			lines.push(`- “${r.quote}” — ${r.issue} → ${r.correction}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

interface JournalState {
	path: string | undefined;
}

function appendEntry(state: JournalState, entry: string): void {
	if (!state.path) return;
	try {
		if (!existsSync(state.path)) {
			mkdirSync(dirname(state.path), { recursive: true });
			writeFileSync(
				state.path,
				`# Lesson journal\n\n_Created ${new Date().toISOString()}_\n\n`,
				"utf-8",
			);
		}
		appendFileSync(state.path, entry, "utf-8");
	} catch {
		// The journal is an at-most-once convenience: never let a logging
		// failure break the conversation.
	}
}

export default function mdLog(pi: ExtensionAPI) {
	const state: JournalState = { path: process.env.PI_LESSON_JOURNAL || undefined };

	function refreshSessionPath(ctx: any): void {
		if (state.path) return; // explicit override wins
		state.path = resolveJournalPath(ctx);
	}

	pi.on("session_start", (_event, ctx) => {
		refreshSessionPath(ctx);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (event.toolName !== "lesson") return;
		refreshSessionPath(ctx);
		const args = event.args as { title?: string; body?: string } | undefined;
		if (!args?.title || !args.body) return;
		appendEntry(state, formatLessonEntry(args.title, args.body));
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (!JOURNAL_TOOLS.has(event.toolName)) return;
		refreshSessionPath(ctx);
		const details = event.result?.details;
		if (!details?.question) return;
		const entry =
			event.toolName === "quiz"
				? formatQuizEntry(details as QuizDetails)
				: formatExplainEntry(details as ExplainDetails);
		appendEntry(state, entry);
	});
}
