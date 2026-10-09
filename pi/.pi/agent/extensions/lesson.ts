import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { presentLesson, resolveJournalPath } from "./md-log";

// ────────────────────────────────────────────────────────────────────────────
// lesson — teaching content lives in the session's markdown journal, not in
// a popup and not as transcript cargo.
//
// Before this tool, a lesson was assistant markdown emitted in the same
// message as the quiz/explain call. tool-call-renderer collapses that text
// to a one-line step row, so the content the learner must read was
// effectively invisible while the question panel was up (the "missing
// lesson" bug). An interim version rendered the lesson in its own overlay
// panel; that composites badly on short panes and split the lesson from the
// durable record.
//
// Now: the agent calls `lesson` with the teaching markdown; md-log appends
// it to the per-session journal (<session>.md, beside the session file) on
// tool_execution_start; the tool then shows the lesson in the learner's
// FOCUS BUFFER — an in-memory scratch buffer in the running nvim pane that
// holds ONLY the current node — and returns IMMEDIATELY. Each lesson call
// replaces the buffer's whole content, so the side pane always shows the
// node the active quiz/explain is about. When no nvim RPC editor is
// available, the tool falls back to opening the journal file. The journal
// remains the durable course transcript (teaching quiz/explain verdicts land
// there too, append-only; probe-stage checks land in a separate probe log).
// Each lesson gets its OWN buffer — pi-focus://<session>/<node> — so earlier
// nodes persist and the learner can cycle them in nvim (:bnext/:bprev). The
// quiz and explain `h` shortcuts focus the CURRENT node's buffer; before the
// first lesson they show the OVERVIEW buffer (nodes, verdicts, current
// position, rebuilt from the journal — never the whole journal file). `H`
// (Shift+H) opens the journal directly, as do the /lessons and /probes
// commands. In explain, bare `h` works before composing and at the verdict;
// `H` works at any time, including during grading. Alt is not used — the
// learner's window manager owns the Option key. A global ctrl+h shortcut
// focuses the current view from anywhere in pi.
// ────────────────────────────────────────────────────────────────────────────

const LessonParams = Type.Object({
	title: Type.String({
		description:
			"Short lesson title, a few words. Name the teaching node that this lesson covers. It becomes the focus-buffer heading and the journal entry heading.",
	}),
	body: Type.String({
		description:
			"The lesson itself, in Markdown. It lands verbatim in the session journal. The user reads it in their editor. Make it complete and self-contained.",
	}),
});

type LessonStatus = "opened" | "unavailable";

interface LessonResultDetails {
	status: LessonStatus;
	title: string;
	journalPath?: string;
}

export default function lesson(pi: ExtensionAPI) {
	pi.registerTool({
		name: "lesson",
		label: "lesson",
		description:
			"Write teaching content into the session's markdown journal. Then show it in the learner's editor as the current node: an in-memory scratch buffer that holds only this lesson. Each lesson gets its own buffer, so earlier nodes persist and the learner can cycle them in nvim. The tool returns immediately. The user reads at their own pace while you continue. Call this before quiz or explain when the question depends on content the user must read. Do not emit that content as ordinary assistant text next to the tool call. The trace collapses such text. Send one node per call. A batch of nodes hides the current one. The journal stays the durable append-only transcript; probe-stage checks go to a separate probe log. The quiz and explain `h` shortcuts focus the current node buffer, or the overview before the first lesson. `H` (Shift+H) opens the journal. In explain, bare `h` works before composing and at the verdict. `H` works at any time.",
		promptSnippet:
			"Use the lesson tool to write teaching content into the session journal and show it in the user's editor. Do this before a quiz or explain question that depends on it.",
		promptGuidelines: [
			"When a quiz or explain question depends on content the user must read, deliver that content with the lesson tool first. Do not put it in assistant text in the same turn as the question tool. The trace collapses that text.",
			"Send one node per lesson call. The focus buffer replaces its whole content on every call. A lesson that bundles several nodes shows none of them well. Name the node in `title`. It becomes the buffer heading and the journal entry heading.",
			"Write lesson prose in Simplified Technical English at full compliance. Use short sentences, the active voice, approved verbs, and one term per concept. The general 80% relaxation does not apply to teaching prose.",
			"Keep the assistant text before the question to one connective line. Put the teaching markdown in `body`.",
			"The tool returns when the focus buffer opens. When that fails, it opens the journal instead. Give the user time to read before you ask the question.",
			"When the result is `unavailable`, no editor surface opened. Restate the essential idea in the conversation.",
		],
		parameters: LessonParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// md-log appended the lesson to the journal on tool_execution_start,
			// before this execute ran. If no journal exists (headless run, no
			// session file), the content still reached the transcript as the tool
			// call arguments — report that and let the agent teach in chat.
			const journalPath = resolveJournalPath(ctx);
			if (!journalPath) {
				return {
					content: [{
						type: "text" as const,
						text: `No session journal available — the lesson "${params.title}" is recorded only in this tool call. Restate the essential content in the conversation.`,
					}],
					details: { status: "unavailable", title: params.title } satisfies LessonResultDetails,
				};
			}

			const result = await presentLesson(ctx, params.title, params.body);
			if (result.mode === "none") {
				return {
					content: [{
						type: "text" as const,
						text: `The lesson "${params.title}" was not shown (${result.message}). Restate the essential content in the conversation.`,
					}],
					details: { status: "unavailable", title: params.title } satisfies LessonResultDetails,
				};
			}
			const text =
				`Lesson "${params.title}" appended to the journal and shown to the user ` +
				`(${result.message}). Continue — the user reads at their own pace.`;
			return {
				content: [{ type: "text" as const, text }],
				details: { status: "opened", title: params.title, journalPath } satisfies LessonResultDetails,
			};
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("lesson ")) + theme.fg("muted", args.title),
				0,
				0,
			);
		},

		renderResult(result, _options, theme, context) {
			const details = result.details as LessonResultDetails | undefined;
			const title = details?.title ?? context.args?.title ?? "lesson";
			const first = result.content.find((part) => part.type === "text")?.text.split("\n", 1)[0].trim() ?? "";
			const failed = context.isError || details?.status !== "opened";
			// Bound the preview before layout; never scan the full lesson on redraw.
			const preview = (context.args?.body ?? "").slice(0, 2000).split("\n", 3);
			return {
				render(width) {
					const leaf = theme.fg("dim", " ├─ ✎  lesson · ") + theme.fg("text", theme.bold(title));
					const banner = theme.fg("dim", " └─ ") + theme.fg(failed ? "error" : "success", failed ? `✗ ${first || "Lesson unavailable"}` : "✓ journaled");
					const bodyWidth = Math.max(1, width - 4);
					const shown = failed ? [] : [
						...wrapTextWithAnsi("body landed in the session journal", bodyWidth),
						...preview.flatMap((line) => wrapTextWithAnsi(line, bodyWidth)).slice(0, 3),
						"…",
					];
					return [
						truncateToWidth(leaf, width),
						...shown.map((line) => truncateToWidth(theme.fg("dim", ` │  ${line}`), width)),
						truncateToWidth(banner, width),
					];
				},
				invalidate() {},
			};
		},
	});
}
