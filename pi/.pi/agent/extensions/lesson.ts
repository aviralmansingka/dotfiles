import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	Markdown,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveJournalPath } from "./md-log";

import { QUESTION_PANEL_OVERLAY } from "./question-overlay";

// ────────────────────────────────────────────────────────────────────────────
// lesson — teaching content as a FIRST-CLASS surface, not transcript cargo.
//
// Before this tool, a lesson was assistant markdown emitted in the same
// message as the quiz/explain call. tool-call-renderer collapses that text
// to a one-line step row (with a dim 12-line-capped surplus), so the content
// the learner must read to answer the question was effectively invisible
// while the question panel was up (the "missing lesson" bug).
//
// The lesson tool fixes the ordering: the agent calls `lesson` with the
// teaching markdown; it renders in its own overlay panel as real Markdown;
// the user presses Enter to acknowledge it; only then does the agent proceed
// (typically straight into quiz/explain, whose panel mounts next).
//
// md-log.ts (a separate listener extension) appends every lesson to the
// per-session markdown journal, next to the session file.
// ────────────────────────────────────────────────────────────────────────────

const LessonParams = Type.Object({
	title: Type.String({
		description:
			"Short lesson title (a few words, shown in the panel header).",
	}),
	body: Type.String({
		description:
			"The lesson itself, in Markdown. This is what the user reads before answering any follow-up quiz/explain, so it must be complete and self-contained.",
	}),
});

type LessonStatus = "read" | "cancelled" | "unavailable";

interface LessonResultDetails {
	status: LessonStatus;
	title: string;
	journalPath?: string;
}

// Shared UI mutex — same globalThis key as quiz/ask_user_question/explain, so
// the lesson panel serializes against every other pop-up-style tool.
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

// A single rounded box with 2-column side padding, matching the visual
// language of explain/quiz's frameMerged content box.
function frameBox(lines: string[], width: number, theme: any): string[] {
	if (width < 24) return lines.map((line) => truncateToWidth(` ${line}`, width));
	const cw = width - 6;
	const accent = (s: string) => theme.fg("accent", s);
	const out: string[] = [];
	out.push(`  ${accent("╭")}${accent("─".repeat(cw + 2))}${accent("╮")}`);
	for (const line of lines) {
		const pad = Math.max(0, cw - visibleWidth(line));
		out.push(`  ${accent("│")} ${line}${" ".repeat(pad)} ${accent("│")}`);
	}
	out.push(`  ${accent("╰")}${accent("─".repeat(cw + 2))}${accent("╯")}`);
	return out.map((line) => truncateToWidth(line, width));
}

export default function lesson(pi: ExtensionAPI) {
	pi.registerTool({
		name: "lesson",
		label: "lesson",
		description:
			"Present teaching content (a lesson) to the user in its own Markdown panel. The user presses Enter to acknowledge it before you continue. Use this BEFORE quiz or explain whenever the question depends on content the user must read — do not emit that content as ordinary assistant text alongside the tool call, because it collapses in the trace and becomes hard to read. The lesson is also appended to the session's markdown journal by md-log.",
		promptSnippet:
			"Use the lesson tool to show teaching content in its own Markdown panel before asking a dependent quiz/explain question.",
		promptGuidelines: [
			"When a quiz or explain question depends on content the user must read, deliver that content with the lesson tool first — not as assistant text in the same turn as the question tool, which the trace collapses.",
			"Keep the pre-question assistant text to a single connective line and put the actual teaching markdown in `body`.",
			"The lesson panel blocks until the user presses Enter, so the user has read the content before the question mounts.",
			"A cancelled lesson (Esc) means the user chose to skip it — restate the essential idea in one line and continue.",
		],
		parameters: LessonParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const journalPath = resolveJournalPath(ctx);
			if (signal?.aborted) {
				return {
					content: [{ type: "text" as const, text: `Lesson "${params.title}" aborted before display.` }],
					details: { status: "cancelled", title: params.title, journalPath } satisfies LessonResultDetails,
				};
			}
			if (ctx.mode !== "tui") {
				return {
					content: [{ type: "text" as const, text: "lesson requires interactive TUI mode" }],
					details: { status: "unavailable", title: params.title, journalPath } satisfies LessonResultDetails,
				};
			}

			return sharedUiLock.withLock(async () => {
				const acknowledged = await ctx.ui.custom<boolean | null>(
					(tui: any, theme: any, _kb: any, done: (result: boolean | null) => void) => {
						const markdown = new Markdown(params.body, 0, 0, getMarkdownTheme(), {
							color: (text: string) => theme.fg("text", text),
						});
						let scrollTop = 0;
						let pageSize = 1;
						let bodyLineCount = 0;

						const scrollBy = (delta: number) => {
							const next = Math.max(0, Math.min(scrollTop + delta, Math.max(0, bodyLineCount - pageSize)));
							if (next === scrollTop) return;
							scrollTop = next;
							tui.requestRender();
						};

						return {
							render(width: number): string[] {
								const cw = Math.max(8, width - 6);
								const bodyLines = markdown.render(cw);
								bodyLineCount = bodyLines.length;
								pageSize = Math.max(1, Math.floor(tui.terminal.rows * 0.9) - 6);
								scrollTop = Math.min(scrollTop, Math.max(0, bodyLineCount - pageSize));
								const visibleBody = bodyLines.slice(scrollTop, scrollTop + pageSize);
								const position = bodyLineCount > pageSize
									? ` · ${scrollTop + 1}-${scrollTop + visibleBody.length}/${bodyLineCount}`
									: "";
								const top = [
									truncateToWidth(
										theme.fg("toolTitle", theme.bold(` lesson · ${params.title}`)),
										cw,
									),
									"",
									...visibleBody,
									"",
									truncateToWidth(
										theme.fg("dim", ` ↑↓/j/k · PgUp/PgDn${position} · Enter — continue · Esc — cancel`),
										cw,
									),
								];
								return frameBox(top, width, theme);
							},
							invalidate: () => markdown.invalidate(),
							handleInput(data: string) {
								if (matchesKey(data, Key.enter)) {
									done(true);
								} else if (matchesKey(data, Key.escape)) {
									done(null);
								} else if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
									scrollBy(-1);
								} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
									scrollBy(1);
								} else if (matchesKey(data, Key.pageUp)) {
									scrollBy(-pageSize);
								} else if (matchesKey(data, Key.pageDown)) {
									scrollBy(pageSize);
								} else if (matchesKey(data, Key.home)) {
									scrollBy(-bodyLineCount);
								} else if (matchesKey(data, Key.end)) {
									scrollBy(bodyLineCount);
								}
							},
						};
					},
					{
						...QUESTION_PANEL_OVERLAY,
						overlayOptions: {
							...QUESTION_PANEL_OVERLAY.overlayOptions,
							maxHeight: "90%",
						},
					},
				);

				const status: LessonStatus = acknowledged === true ? "read" : "cancelled";
				const text =
					status === "read"
						? `User read and acknowledged the lesson "${params.title}".`
						: `User cancelled the lesson "${params.title}" — restate the essential idea in one line and continue.`;
				// The journal is written by md-log on tool_execution_start, so by the
				// time the user dismisses the panel the lesson is already in the file.
				// Surface the path so the agent can link it (Ctrl-click opens the
				// herdr-annotate reviewer via the markdown-file link handler).
				const textWithJournal = journalPath ? `${text}\nJournal: ${journalPath}` : text;
				return {
					content: [{ type: "text" as const, text: textWithJournal }],
					details: { status, title: params.title, journalPath } satisfies LessonResultDetails,
				};
			});
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
			const text = details.status === "read"
				? theme.fg("success", `Read — ${details.title}`)
				: details.status === "unavailable"
					? theme.fg("warning", `Unavailable — ${details.title}`)
					: theme.fg("warning", `Skipped — ${details.title}`);
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
