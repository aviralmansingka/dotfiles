import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { openEditor } from "./nvim-open";
import { focusNodeBuffer, showNodeBuffer, showOverviewBuffer } from "./focus-buffer";

// ────────────────────────────────────────────────────────────────────────────
// md-log — the durable teaching record plus the scoped learner views.
//
// Durable files, both beside the session file:
//   <session>.md         — the journal: every lesson and every TEACHING
//                          quiz/explain verdict, append-only, in order.
//   <session>-probes.md  — the probe log: every quiz/explain called with
//                          stage:"probe" (the Phase-1 cold probes). Probes
//                          never mix into the journal.
//
// In-memory views (focus-buffer), rebuilt from the journal so a refreshed or
// resumed session still makes sense:
//   pi-focus://<key>/<node-slug>  — one buffer per teaching node; h/ctrl+h
//                                   focus the CURRENT one; earlier ones stay
//                                   available for nvim-side cycling.
//   pi-focus://<key>/overview     — the arc at a glance: nodes taught, per-
//                                   node verdicts, current position. This is
//                                   what h/ctrl+h show BEFORE the first
//                                   lesson exists. The whole journal file is
//                                   never the fallback view; it opens only
//                                   via H / /lessons, and only headless runs
//                                   fall back to it.
//
// Override the journal location with PI_LESSON_JOURNAL=/path/to/file.md.
//
// Journal writes stay event-driven: tool_execution_start records lesson
// content (and the current node), and tool_execution_end records quiz/explain
// results — routed to the journal or the probes file by the call's stage.
// ────────────────────────────────────────────────────────────────────────────

const JOURNAL_TOOLS = new Set(["quiz", "explain"]);
const PROBE_STAGE = "probe";

/** Session file `/a/b/xyz.jsonl` → journal `/a/b/xyz.md`. */
export function journalPathFor(sessionFile: string): string {
	const ext = extname(sessionFile);
	const stem = sessionFile.slice(0, sessionFile.length - ext.length);
	return `${stem || sessionFile}.md`;
}

/** Journal `/a/b/xyz.md` → probe log `/a/b/xyz-probes.md`. */
export function probesPathFor(journal: string): string {
	return journal.replace(/\.md$/, "-probes.md");
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
 *  lesson's own short title; the stamp rides a metadata line under it so
 *  the heading stays content-focused and scannable. */
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
		lines.push(`**Steering:** ${details.followUp.trim()}`);
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
		lines.push("**Your answer:** _(no answer — honest \"I don't know\")_");
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

function appendEntry(path: string | undefined, entry: string, header: string): void {
	if (!path) return;
	try {
		if (!existsSync(path)) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `# ${header}\n\n_Created ${new Date().toISOString()}_\n\n`, "utf-8");
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

// ── per-session view state ───────────────────────────────────────────────────
// Keyed by journal path so concurrent sessions never share state. The
// current node is the title of the most recent lesson; a quiz verdict
// attaches to the node taught just before it (the skill teaches a node,
// then quizzes it). Lost on restart — the overview rebuilds it from the
// durable journal instead.

const currentNode = new Map<string, string>();
const probeCalls = new Map<string, boolean>();

/** Buffer-name key for this session's focus buffers (journal path stem). */
function focusKey(ctx: any): string {
	const journal = resolveJournalPath(ctx);
	if (!journal) return "session";
	const base = journal.split("/").pop() ?? "session";
	return base.replace(/\.md$/, "");
}

interface OverviewNode {
	title: string;
	verdicts: string[];
}

/**
 * Rebuild the arc overview from the durable journal: nodes taught in order,
 * each node's verdicts (from the teaching quizzes/explains that followed
 * its lesson), and the current position. Parsing — not in-memory state — is
 * the source of truth, so a refreshed or resumed session still makes sense.
 */
export function buildOverview(journal: string | undefined): string {
	const probesNote = journal
		? `Probes live in ${probesPathFor(journal).split("/").pop()}. `
		: "";
	if (!journal || !existsSync(journal)) {
		return [
			"No lesson history yet — the probe phase has not produced teaching nodes.",
			"",
			`${probesNote}The journal is created with the first lesson.`,
		].join("\n");
	}

	const ordered: OverviewNode[] = [];
	let lastHeading: string | undefined;
	let lastLessonNode: string | undefined;
	for (const line of readFileSync(journal, "utf-8").split("\n")) {
		const heading = line.match(/^## (.+)$/);
		if (heading) {
			lastHeading = heading[1].trim();
			continue;
		}
		// Lesson metadata carries no verdict glyph — it opens a node.
		if (/^_Lesson · /.test(line)) {
			if (!lastHeading) continue;
			lastLessonNode = lastHeading;
			ordered.push({ title: lastHeading, verdicts: [] });
			continue;
		}
		// Quiz/explain metadata opens with a verdict glyph.
		const m = line.match(/^_(?:Quiz|multi-select|Explain) · (✓|✗|◐)/);
		if (!m) continue;
		// A teaching check attaches to the node it follows — normally the
		// lesson of the same node, occasionally a later confirm.
		const owner = lastLessonNode
			? ordered.find((n) => n.title === lastLessonNode)
			: undefined;
		if (owner) owner.verdicts.push(m[1]);
	}

	if (ordered.length === 0) {
		return [
			"No lesson history yet — the probe phase has not produced teaching nodes.",
			"",
			`${probesNote}The journal is created with the first lesson.`,
		].join("\n");
	}

	const lines: string[] = [];
	lines.push(`Current position: ${ordered[ordered.length - 1].title}`);
	lines.push("");
	lines.push("Node progress:");
	for (const node of ordered) {
		const marks = node.verdicts.length > 0 ? node.verdicts.join("") : "—";
		lines.push(`- ${node.title} ${marks}`);
	}
	lines.push("");
	lines.push(
		`${probesNote}The full transcript stays in the journal; earlier node buffers remain open in nvim for cycling.`,
	);
	return lines.join("\n");
}

/**
 * Present a lesson as its own node buffer: creates or updates
 * `pi-focus://<key>/<node-slug>` and focuses it. Earlier node buffers
 * persist for nvim-side cycling. Headless fallback: the journal file.
 * Used by the lesson tool.
 */
export async function presentLesson(
	ctx: any,
	title: string,
	body: string,
): Promise<{ mode: "buffer" | "journal" | "none"; message: string }> {
	const key = focusKey(ctx);
	const buffer = showNodeBuffer(key, title, title, body);
	if (buffer.ok) {
		return {
			mode: "buffer",
			message: `${buffer.message} — the learner's side buffer holds only this node`,
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
 * Open the learner's CURRENT view: the current node's buffer when a lesson
 * has been shown, else the overview buffer rebuilt from the journal. The
 * whole journal file is NOT a fallback here — it opens only via H or
 * /lessons. The journal fallback below fires only when no editor surface
 * exists at all (headless runs). Used by quiz `h`, explain `h`, and the
 * global ctrl+h shortcut.
 */
export async function openNodeView(
	ctx: any,
): Promise<{ mode: "node" | "overview" | "journal" | "none"; message: string }> {
	const journal = resolveJournalPath(ctx);
	const key = focusKey(ctx);
	const node = journal ? currentNode.get(journal) : undefined;
	if (node) {
		const buffer = focusNodeBuffer(key, node);
		if (buffer.ok) return { mode: "node", message: buffer.message };
		// Buffer gone (nvim restarted): fall through to the overview, which
		// rebuilds the position from the journal.
	}
	const title = `${key} — lesson arc overview`;
	const overview = showOverviewBuffer(key, title, buildOverview(journal));
	if (overview.ok) {
		return { mode: "overview", message: `${overview.message} — nodes, verdicts, current position` };
	}
	// Headless / no editor: last resort, the journal file.
	const file = await openJournalInEditor(ctx);
	if (!file.ok) return { mode: "none", message: `${overview.message}; ${file.message}` };
	return { mode: "journal", message: `${overview.message}; opened the journal — ${file.message}` };
}

/**
 * Open the session's lesson journal in the user's editor pane (existing pane
 * if one is open, else a split). Non-blocking: resolves as soon as the file
 * is sent, never waits for the user to finish reading. Used by the Shift+H
 * panel shortcut and the /lessons command.
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

/**
 * Open the session's probe log in the user's editor pane. Used by the
 * /probes command.
 */
export async function openProbesInEditor(
	ctx: any,
): Promise<{ message: string; ok: boolean; launched: boolean }> {
	const journalPath = resolveJournalPath(ctx);
	if (!journalPath) {
		return { message: "No probe log for this session", ok: false, launched: false };
	}
	const probesPath = probesPathFor(journalPath);
	if (!existsSync(probesPath)) {
		return {
			message: `Probe log not written yet (${probesPath})`,
			ok: false,
			launched: false,
		};
	}
	const result = await openEditor(ctx?.cwd ?? process.cwd(), [probesPath]);
	return {
		message: `${result.message} — probe log ${probesPath}`,
		ok: result.ok,
		launched: result.launched,
	};
}

export default function mdLog(pi: ExtensionAPI) {
	// /lessons opens the full journal; /probes opens the probe log.
	pi.registerCommand("lessons", {
		description: "Open this session's lesson journal in the editor pane",
		handler: async (_args: string, ctx: any) => {
			const result = await openJournalInEditor(ctx);
			ctx?.ui?.notify?.(result.message, result.ok ? "info" : "warning");
		},
	});
	pi.registerCommand("probes", {
		description: "Open this session's probe log in the editor pane",
		handler: async (_args: string, ctx: any) => {
			const result = await openProbesInEditor(ctx);
			ctx?.ui?.notify?.(result.message, result.ok ? "info" : "warning");
		},
	});

	// Global shortcut: from anywhere in pi, focus the learner's current view —
	// the current node buffer, or the overview before the first lesson. Alt
	// is not an option — the learner's window manager owns the Option key —
	// and Shift+H already serves the journal on the quiz/explain panels.
	// Kitty-protocol terminals deliver ctrl+h distinctly from backspace; in
	// legacy terminals the byte is ambiguous (0x08) and pi keeps it as
	// backspace there.
	pi.registerShortcut("ctrl+h", {
		description: "Open the current node buffer (overview before the first lesson)",
		handler: async (ctx: any) => {
			const result = await openNodeView(ctx);
			ctx?.ui?.notify?.(result.message, result.mode === "none" ? "warning" : "info");
		},
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (event.toolName === "lesson") {
			const args = event.args as { title?: string; body?: string } | undefined;
			if (!args?.title || !args.body) return;
			const journal = resolveJournalPath(ctx);
			appendEntry(journal, formatLessonEntry(args.title, args.body), "Lesson journal");
			if (journal) currentNode.set(journal, args.title);
			return;
		}
		if (JOURNAL_TOOLS.has(event.toolName)) {
			// Route the eventual verdict by the call's stage: probe entries
			// land in the probe log, teaching entries in the journal.
			const args = event.args as { stage?: string } | undefined;
			probeCalls.set(event.toolCallId, args?.stage === PROBE_STAGE);
		}
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (!JOURNAL_TOOLS.has(event.toolName)) return;
		const details = event.result?.details;
		if (!details?.question) return;
		const entry =
			event.toolName === "quiz"
				? formatQuizEntry(details as QuizDetails)
				: formatExplainEntry(details as ExplainDetails);
		const journal = resolveJournalPath(ctx);
		const isProbe = probeCalls.get(event.toolCallId) ?? false;
		probeCalls.delete(event.toolCallId);
		appendEntry(
			isProbe ? (journal ? probesPathFor(journal) : undefined) : journal,
			entry,
			isProbe ? "Probe log" : "Lesson journal",
		);
	});
}
