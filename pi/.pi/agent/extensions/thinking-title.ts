/**
 * Thinking titles: a spinner while a thinking run streams, a compact
 * title once it closes.
 *
 * Pi renders each thinking run as Markdown when hideThinkingBlock is off,
 * and `registerMarkdownTransformer` runs before that render. So this
 * extension owns the row without touching pi's bundle: it survives every
 * `pi update`. Keep `hideThinkingBlock` OFF (settings default) — the
 * hidden path renders one global label shared by every row and cannot
 * show per-block titles.
 *
 * Render rules:
 * - streaming run, no title yet: animated spinner line (frame advances
 *   on every streamed delta re-render)
 * - closed run, 15 words or fewer: the thinking text itself, collapsed to
 *   one line (codex-style blocks are already titles)
 * - closed run, longer: a local heuristic title at once, then the
 *   model-written 10-15 word title replaces it when the nested call lands
 *   (never awaited inside the event handler, so streaming never stalls)
 *
 * Titles come from a pinned cheap model (fireworks deepseek-v4-flash) and
 * are cached by content hash. Any failure, offline run, or missing model
 * keeps the heuristic title. The transform is render-only: session
 * entries and model context keep the full thinking text.
 *
 * `/titles` toggles between title rows and full thinking text (pi's
 * built-in `/thinking` command controls the thinking level, so this one
 * keeps a distinct name). Pi's
 * native hidden row (Ctrl+T, or clicking a title row) shows the
 * HIDDEN_ROW_LABEL — it must stay non-blank, or empty structural rows
 * come back (#thinking-space).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Pinned title model: cheap, fast, summarization-capable. */
const TITLE_MODEL = { provider: "fireworks", id: "deepseek-v4-flash-0731" };

const MAX_TITLE_WORDS = 15;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_LABEL = "thinking";
const SPINNER_FRAME_MS = 100;
/** Non-blank: a blank hidden label re-creates the extra-blank-line bug. */
const HIDDEN_ROW_LABEL = "✺ thinking";
const GENERIC_TITLE = "reasoning through the request";
const TITLE_TIMEOUT_MS = 8000;
const MAX_TITLE_INPUT_CHARS = 4000;
const REPAINT_COALESCE_MS = 50;
const MAX_CACHED_TITLES = 512;

const TITLE_PROMPT =
	"You write titles for AI reasoning traces. Reply with exactly one " +
	"plain-text title of 10 to 15 words. No quotes, no markdown, no list " +
	"markers, no trailing punctuation. The title states what the reasoning " +
	"is about, not what it concludes.";

export function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

export function collapseWhitespace(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

/** Trim to at most `max` words on one line. */
export function capWords(text: string, max: number): string {
	const collapsed = collapseWhitespace(text);
	const words = collapsed.split(" ");
	return words.length <= max ? collapsed : words.slice(0, max).join(" ");
}

/** First sentence, without its terminator; the whole text if unterminated. */
export function firstSentence(text: string): string {
	const collapsed = collapseWhitespace(text);
	const match = collapsed.match(/[^.!?]*[.!?]/);
	const sentence = match ? match[0] : collapsed;
	return sentence.replace(/[.!?]+$/, "").trim();
}

/** Deterministic fallback title: first sentence, capped. */
export function heuristicTitle(text: string): string {
	const capped = capWords(firstSentence(text) || GENERIC_TITLE, MAX_TITLE_WORDS);
	return capped || GENERIC_TITLE;
}

/** Normalize a model answer into a bare title. */
export function cleanModelTitle(raw: string): string {
	let title = collapseWhitespace(raw ?? "");
	title = title.replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, "");
	title = title.replace(/^[#\->*\s]+/, "");
	title = title.replace(/[.!?]+$/, "");
	return capWords(title, MAX_TITLE_WORDS);
}

/** Keep markdown metacharacters from restyling a one-line title. */
export function escapeTitle(text: string): string {
	return text.replace(/([\\`*_\[\]~#])/g, "\\$1");
}

export function hashText(text: string): string {
	const collapsed = collapseWhitespace(text);
	let hash = 0x811c9dc5;
	for (let index = 0; index < collapsed.length; index++) {
		hash ^= collapsed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16) + ":" + collapsed.length;
}

function spinnerLine(): string {
	const frame = SPINNER_FRAMES[
		Math.floor(Date.now() / SPINNER_FRAME_MS) % SPINNER_FRAMES.length
	];
	return `${frame} ${SPINNER_LABEL}`;
}

export default function (pi: ExtensionAPI) {
	/** content hash -> title. Survives branch switches: same text, same title. */
	const titles = new Map<string, string>();
	const inFlight = new Set<string>();
	let showFullThinking = false;
	let repaintTimer: ReturnType<typeof setTimeout> | undefined;

	/** One rebuild+repaint per title batch: setHiddenThinkingLabel re-renders every message. */
	const scheduleRepaint = (ctx: any) => {
		if (repaintTimer) return;
		repaintTimer = setTimeout(() => {
			repaintTimer = undefined;
			try {
				ctx.ui.setHiddenThinkingLabel(HIDDEN_ROW_LABEL);
			} catch {
				/* headless stub or dead context: nothing to repaint */
			}
		}, REPAINT_COALESCE_MS);
		repaintTimer.unref?.();
	};

	const requestTitle = (text: string, ctx: any) => {
		const key = hashText(text);
		if (titles.has(key) || inFlight.has(key)) return;
		const registry = ctx?.modelRegistry;
		const model = registry?.find?.(TITLE_MODEL.provider, TITLE_MODEL.id);
		if (!model || typeof registry?.complete !== "function") return; // heuristic stays
		inFlight.add(key);
		const timeout = new Promise<never>((_, reject) => {
			const timer = setTimeout(() => reject(new Error("title call timed out")), TITLE_TIMEOUT_MS);
			timer.unref?.();
		});
		Promise.race([
			registry.complete(model, {
				systemPrompt: TITLE_PROMPT,
				messages: [{ role: "user", content: text.slice(0, MAX_TITLE_INPUT_CHARS) }],
			}, { maxTokens: MAX_TITLE_WORDS * 8 }),
			timeout,
		])
			.then((message: any) => {
				const raw = (message?.content ?? [])
					.filter((block: any) => block?.type === "text")
					.map((block: any) => block.text ?? "")
					.join(" ");
				const title = cleanModelTitle(raw);
				if (!title) return;
				if (titles.size >= MAX_CACHED_TITLES) {
					titles.delete(titles.keys().next().value as string);
				}
				titles.set(key, title);
				scheduleRepaint(ctx);
			})
			.catch(() => {
				/* heuristic title stays */
			})
			.finally(() => {
				inFlight.delete(key);
			});
	};

	/** A run is closed when a non-thinking block follows it, or the message ended. */
	const processAssistantMessage = (message: any, allRunsClosed: boolean, ctx: any) => {
		if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
		const content = message.content;
		for (let index = 0; index < content.length; index++) {
			if (content[index]?.type !== "thinking") continue;
			let end = index;
			while (end < content.length && content[end]?.type === "thinking") end++;
			const closed = allRunsClosed || end < content.length;
			if (closed) {
				const text = content
					.slice(index, end)
					.map((block: any) => block?.thinking ?? "")
					.join("\n\n")
					.trim();
				if (text && wordCount(text) > MAX_TITLE_WORDS) requestTitle(text, ctx);
			}
			index = end - 1;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel(HIDDEN_ROW_LABEL);
	});

	pi.on("message_update", (event, ctx) => {
		processAssistantMessage(event.message, false, ctx);
	});

	pi.on("message_end", (event, ctx) => {
		processAssistantMessage(event.message, true, ctx);
	});

	pi.registerMarkdownTransformer((markdown: string, context: any) => {
		if (context.messageType !== "assistant-thinking") return markdown;
		if (showFullThinking) return markdown;
		const text = markdown.trim();
		if (!text) return markdown;
		const cached = titles.get(hashText(text));
		if (cached) return escapeTitle(cached);
		if (context.isStreaming) return spinnerLine();
		if (wordCount(text) <= MAX_TITLE_WORDS) return escapeTitle(collapseWhitespace(text));
		return escapeTitle(heuristicTitle(text));
	});

	pi.registerCommand("titles", {
		description: "Toggle thinking rows between titles and full text",
		handler: async (_args, ctx) => {
			showFullThinking = !showFullThinking;
			ctx.ui.setHiddenThinkingLabel(HIDDEN_ROW_LABEL);
			ctx.ui.notify(
				showFullThinking ? "Showing full thinking text" : "Showing thinking titles",
				"info",
			);
		},
	});
}
