import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, Loader, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { openEditor } from "./nvim-open";

// ────────────────────────────────────────────────────────────────────────────
// btw — ask a side question without polluting the chat context.
//
// `/btw <question>` answers ONE question in a floating panel (same merged-box
// look as quiz/explain) using a separate model call — the "fork" pattern from
// explain's grader: ctx.modelRegistry.complete with a fresh message list, no
// session, no tools. Neither the question nor the answer ever enters the
// session transcript or the LLM context of the running chat.
//
// The fork is grounded: it receives the question plus a bounded digest of the
// recent session (user/assistant prose only, tool calls omitted), so side
// questions can reference the work in progress. Works mid-stream too —
// commands dispatch immediately, so asking a btw never steers the agent.
//
// Answers are appended to a log file (~/.cache/pi/btw.md) so they remain
// retrievable after the panel closes; `v` reopens that log in vim.
// ────────────────────────────────────────────────────────────────────────────

export const ANSWER_SYSTEM_PROMPT = `You answer quick side questions ("btw" questions) asked out-of-band while the user works on something else. Your answer is shown in a small terminal panel and never enters their main conversation.

Answer rules:
- Lead with the answer in one or two crisp sentences. No preamble, no restating the question.
- Be precise: exact terminology, exact names, exact numbers. If the honest answer is "it depends", say what it depends on in one clause.
- Only if it materially sharpens the answer, add up to three short bullets — one line each.
- Never pad: no filler, no praise, no summary of your own answer.
- If the question is ambiguous, pick the most likely reading and answer it; optionally note the alternate reading in one bullet.
- Maximum ~120 words unless the question genuinely demands more.
- Plain markdown, no code fences unless code IS the answer.`;

// Char budget for the session digest sent to the fork. Generous enough to
// carry the working conversation, small enough to stay cheap.
const DIGEST_MAX_CHARS = 12_000;
// Per-message clip: individual walls of text (pasted logs, long replies)
// must not crowd out the rest of the digest.
const DIGEST_MESSAGE_MAX_CHARS = 2_000;

function messageText(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: any) => block?.type === "text")
		.map((block: any) => String(block.text ?? ""))
		.join("\n")
		.trim();
}

// Build a bounded, oldest-first digest of user/assistant prose from session
// entries (tool results, thinking, and custom entries are omitted). Walks
// from the tail so the newest context survives the budget.
export function buildContextDigest(entries: any[], maxChars: number = DIGEST_MAX_CHARS): string {
	const parts: string[] = [];
	let used = 0;
	let lastText: string | undefined;
	let lastRole: string | undefined;
	for (let i = entries.length - 1; i >= 0; i--) {
		const message = entries[i]?.message ?? entries[i];
		if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
		const text = messageText(message);
		if (!text) continue;
		const clipped =
			text.length > DIGEST_MESSAGE_MAX_CHARS ? `${text.slice(0, DIGEST_MESSAGE_MAX_CHARS)}…` : text;
		const line = `${message.role}: ${clipped}`;
		if (used + line.length > maxChars) {
			if (lastText === undefined) {
				lastText = text;
				lastRole = message.role;
			}
			break;
		}
		parts.unshift(line);
		used += line.length;
	}
	// Degenerate case: even a single message overflows the budget — keep its
	// head rather than sending an empty digest.
	if (parts.length === 0 && lastText !== undefined && lastRole !== undefined) {
		const head = lastText.slice(0, Math.max(0, maxChars - lastRole.length - 2));
		return `${lastRole}: ${head}`;
	}
	return parts.join("\n\n");
}

export function buildQuestionPrompt(question: string, digest: string): string {
	if (!digest) return question;
	return (
		`Recent conversation for context (oldest first, tool calls omitted):\n\n${digest}\n\n` +
		`The user's side question, asked out-of-band:\n\n${question}`
	);
}

// Default to the session's active model: btw answers should be sharp, and the
// session model is the one the user trusts for that. Override with
// PI_BTW_MODEL="provider/model-id".
function pickAnswerModel(ctx: any): any {
	const override = process.env.PI_BTW_MODEL;
	if (override) {
		const slash = override.indexOf("/");
		if (slash > 0) {
			const model = ctx.modelRegistry.find(override.slice(0, slash), override.slice(slash + 1));
			if (model) return model;
		}
	}
	return ctx.model;
}

function logPath(): string {
	const env = process.env.PI_BTW_LOG_PATH;
	if (env) return env;
	return resolve(homedir(), ".cache/pi/btw.md");
}

function appendLog(question: string, answer: string): void {
	const path = logPath();
	const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `\n## ${stamp} — ${question}\n\n${answer}\n`, "utf-8");
}

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
	const contentWidth = Math.max(1, width - indent.length);
	for (const line of wrapTextWithAnsi(text, contentWidth)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}

// Render the panel as two merged rounded boxes over the prompt area (same
// frame quiz/explain use): a narrow content box on top, teed into a
// full-width, prompt-styled input box below.
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
	for (const line of promptLines) {
		const pad = Math.max(0, bw - visibleWidth(line));
		out.push(`${accent("│")} ${line}${" ".repeat(pad)} ${accent("│")}`);
	}
	out.push(accent("╰") + accent("─".repeat(width - 2)) + accent("╯"));
	return out;
}

// Shared UI mutex. ctx.ui.custom() can only handle one active call at a time,
// so ALL pop-up-style extensions (quiz, ask_user_question, explain, ...) must
// serialize against each other. Stashed on globalThis so separate extension
// files share it without importing each other.
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

interface BtwState {
	phase: "thinking" | "answer" | "error";
	answer?: string;
	error?: string;
	refresh?: () => void;
}

export default function btw(pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: "Ask a side question answered in a panel — never enters the chat context",
		handler: async (args, ctx) => {
			const question = (args ?? "").trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <question>", "warning");
				return;
			}
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify("btw requires interactive TUI mode", "warning");
				return;
			}
			if (!ctx.modelRegistry?.complete) {
				ctx.ui.notify("btw unavailable: no model registry", "warning");
				return;
			}
			const model = pickAnswerModel(ctx);
			if (!model) {
				ctx.ui.notify("btw unavailable: no model", "warning");
				return;
			}

			const entries = ctx.sessionManager?.buildContextEntries?.() ?? [];
			const digest = buildContextDigest(entries);
			const controller = new AbortController();
			const state: BtwState = { phase: "thinking" };
			const logFile = logPath();

			const answerPromise = (async () => {
				try {
					const response = await ctx.modelRegistry.complete(
						model,
						{
							systemPrompt: ANSWER_SYSTEM_PROMPT,
							messages: [
								{ role: "user", content: buildQuestionPrompt(question, digest), timestamp: Date.now() } as any,
							],
						},
						{ signal: controller.signal, maxTokens: 900, temperature: 0, reasoningEffort: "low" } as any,
					);
					if (controller.signal.aborted) return; // panel already dismissed
					const text = response.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n")
						.trim();
					if (!text) {
						state.phase = "error";
						state.error = "model returned empty output";
					} else {
						state.phase = "answer";
						state.answer = text;
					}
				} catch (err: any) {
					if (controller.signal.aborted) return; // panel already dismissed
					state.phase = "error";
					state.error = err?.message ?? String(err);
				}
				state.refresh?.();
			})();
			void answerPromise; // fire-and-forget: the panel owns the lifecycle

			const dismissed = await withUILock(() =>
				ctx.ui.custom<boolean | null>(
					(tui: any, theme: any, _kb: any, done: (result: boolean | null) => void) => {
						const loader = new Loader(
							tui,
							(s: string) => theme.fg("accent", s),
							(s: string) => theme.fg("muted", s),
							` answering… (${model.id})`,
						);
						loader.start();
						state.refresh = () => {
							loader.stop();
							tui.requestRender();
						};

						const openLog = () => {
							void openEditor(ctx.cwd, [logFile])
								.then((result) => ctx.ui.notify?.(result.message, "info"))
								.catch((error) =>
									ctx.ui.notify?.(`Could not open btw log: ${error}`, "warning"),
								);
						};

						function handleInput(data: string) {
							if (state.phase === "thinking") {
								if (matchesKey(data, Key.escape)) {
									controller.abort();
									loader.stop();
									done(null);
								}
								return;
							}
							if (matchesKey(data, "v")) {
								openLog();
								return;
							}
							if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
								done(true);
							}
						}

						function render(width: number): string[] {
							const tw = Math.max(8, width - 8);
							const top: string[] = [];
							const add = (s: string) => top.push(truncateToWidth(s, tw));
							add(theme.fg("toolTitle", theme.bold(" btw")));
							top.push("");
							addWrapped(top, theme.fg("accent", question), tw, " ");

							if (state.phase === "thinking") {
								top.push("");
								for (const line of loader.render(tw)) top.push(line);
								top.push("");
								addWrapped(top, theme.fg("dim", " Esc — abort"), tw, " ");
							} else if (state.phase === "answer") {
								top.push("");
								addWrapped(top, theme.fg("text", state.answer ?? ""), tw, " ");
								top.push("");
								addWrapped(
									top,
									theme.fg("dim", ` Enter — dismiss · v — open log · answers appended to ${logFile}`),
									tw,
									" ",
								);
							} else {
								top.push("");
								addWrapped(top, theme.fg("warning", ` btw failed — ${state.error ?? "unknown error"}`), tw, " ");
								top.push("");
								addWrapped(top, theme.fg("dim", " Enter — dismiss"), tw, " ");
							}

							const bottom = [theme.fg("accent", "› btw")];
							return frameMerged(top, bottom, width, theme);
						}

						return {
							render,
							invalidate: () => {},
							handleInput,
						};
					},
				),
			);

			// Cancel any outstanding fork work once the panel is gone (no-op if
			// the answer already arrived).
			controller.abort();

			if (dismissed !== null && state.answer) {
				try {
					appendLog(question, state.answer);
				} catch (err: any) {
					ctx.ui.notify?.(`btw log write failed: ${err?.message ?? String(err)}`, "warning");
				}
			}
		},
	});
}
