import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { openJournalInEditor, resolveJournalPath } from "./md-log";

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
// tool_execution_start; the tool opens that journal in the user's editor
// pane and returns IMMEDIATELY — the user reads at their own pace while the
// conversation continues. The journal is also where every quiz/explain
// verdict lands, so it reads as the course transcript. The user can reopen
// it any time: mid-quiz `h`, /journal (herdr-annotate reviewer), or
// Ctrl-click the file:// link in the result row.
// ────────────────────────────────────────────────────────────────────────────

const LessonParams = Type.Object({
	title: Type.String({
		description:
			"Short lesson title (a few words, used as the journal heading).",
	}),
	body: Type.String({
		description:
			"The lesson itself, in Markdown. It lands verbatim in the session journal, which the user reads in their editor — complete and self-contained.",
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
			"Write teaching content (a lesson) into the session's markdown journal and open that journal in the user's editor pane. Returns immediately — the user reads at their own pace while you continue. Use this BEFORE quiz or explain whenever the question depends on content the user must read — do not emit that content as ordinary assistant text alongside the tool call, because it collapses in the trace. The journal is shared with every quiz/explain verdict, and the user can reopen it mid-quiz with `h` or via /journal.",
		promptSnippet:
			"Use the lesson tool to append teaching content to the session journal and open it in the user's editor before asking a dependent quiz/explain question.",
		promptGuidelines: [
			"When a quiz or explain question depends on content the user must read, deliver that content with the lesson tool first — not as assistant text in the same turn as the question tool, which the trace collapses.",
			"Keep the pre-question assistant text to a single connective line and put the actual teaching markdown in `body`.",
			"The tool returns as soon as the journal is open — give the user a beat to read it before firing the dependent question, but do not wait for acknowledgement.",
			"If the result is `unavailable` (no session journal), restate the essential idea in the conversation instead.",
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

			const result = await openJournalInEditor(ctx);
			const text = `Lesson "${params.title}" appended to the journal and opened in the user's editor (${result.message}). Continue — the user reads at their own pace.`;
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

		renderResult(result, _options, theme) {
			const details = result.details as LessonResultDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			const text = details.status === "opened"
				? theme.fg("success", `Opened in editor — ${details.title}`)
				: theme.fg("warning", `Unavailable — ${details.title}`);
			if (!details.journalPath) return new Text(text, 0, 0);
			const label = basename(details.journalPath).replace(/[\\[\]`*_]/g, "\\$&");
			const url = pathToFileURL(resolve(details.journalPath)).href;
			const rendered = new Container();
			rendered.addChild(new Text(text, 0, 0));
			rendered.addChild(new Markdown(`[${label}](${url})`, 0, 0, getMarkdownTheme()));
			return rendered;
		},
	});
}
