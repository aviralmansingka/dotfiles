import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

// ────────────────────────────────────────────────────────────────────────────
// run-command — a hands-on sibling of quiz.
//
// Where quiz verifies the HEAD (concepts, terminology), run-command verifies
// the HANDS: the agent presents ONE command with a grounded prediction, the
// user runs it in their own terminal, and pastes the output back. The agent
// never executes the command — the user types everything, which is the point.
//
// UI: a floating panel above the prompt shows the command (and optional
// context/prediction). Pressing `y` yanks the command to the system clipboard
// as-is. The user runs it elsewhere, returns, types/pastes the output into the
// response field (Tab to focus), and submits. On submit, the command and the
// user's pasted output travel together so the agent grades output vs.
// prediction without ever having seen the terminal.
// ────────────────────────────────────────────────────────────────────────────

interface RunCommandResponse {
	output: string;
}

type RunCommandStatus = "answered" | "cancelled" | "unavailable";

interface RunCommandDetails {
	status: RunCommandStatus;
	command: string;
	prediction?: string;
	context?: string;
	output?: string;
	copied?: boolean; // user pressed `y` — the command was yanked at least once
	message?: string;
}

const RunCommandParams = Type.Object({
	command: Type.String({
		description:
			"The single command the user should run, exactly as they should type it. One command per tool call — never a batch.",
	}),
	prediction: Type.String({
		description:
			"REQUIRED. What output you expect, grounded in observed host state (you ran the idempotent/read-side equivalent yourself) or flagged as inferred from docs. Grading is output vs. this prediction.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or safety notes shown above the command." }),
	),
});

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

// Strip the Editor's own flat ─ borders (and scroll-rule variants) so the
// outer rounded box is the only frame — the bottom box then reads as a clean
// prompt, exactly like the real one.
function editorInnerLines(editor: Editor, width: number): string[] {
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
	return editor
		.render(width)
		.filter((l) => !/^─+$/.test(stripAnsi(l)) && !/^─── [↑↓] \d+ more /.test(stripAnsi(l)));
}

// Shared UI mutex. ctx.ui.custom()/editor can only handle one active call at
// a time, so ALL pop-up-style tools (quiz, ask_user_question, run-command, ...)
// must serialize against each other, not just against themselves. We stash one
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

interface AskResult {
	response: RunCommandResponse | null;
	copied: boolean;
}

async function askRunCommand(
	ctx: any,
	command: string,
	prediction: string,
	context: string | undefined,
): Promise<AskResult> {
	let copied = false;

	const result = await ctx.ui.custom<RunCommandResponse | null>(
		(tui: any, theme: any, _kb: any, done: (result: RunCommandResponse | null) => void) => {
			// The response field. Enter must NOT submit inside the editor (its submit
			// path clears the buffer), so disableSubmit and let the host own Enter.
			// Ctrl+J still inserts a newline (pi convention) for multi-line output.
			const editor = new Editor(tui, createEditorTheme(theme));
			editor.focused = false;
			editor.disableSubmit = true;

			let focus: "editor" | "none" = "none";

			function outputText(): string | undefined {
				const t = editor.getText().trim();
				return t.length ? t : undefined;
			}

			return {
				render(width: number): string[] {
					const tw = Math.max(8, width - 8);
					const bw = Math.max(8, width - 4);
					const top: string[] = [];
					const bottom: string[] = [];
					const addT = (s: string) => top.push(truncateToWidth(s, tw));
					const addB = (s: string) => bottom.push(truncateToWidth(s, bw));

					addT(theme.fg("toolTitle", theme.bold(" run this command")));
					if (context) {
						top.push("");
						addWrapped(top, theme.fg("muted", context), tw, " ");
					}
					top.push("");
					// The command, verbatim, in a visually distinct block.
					for (const line of command.split("\n")) {
						addT(` ${theme.fg("success", theme.bold(line))}`);
					}
					top.push("");
					addWrapped(
						top,
						theme.fg("dim", "y — copy command · run it in your own terminal · paste the output below"),
						tw,
						" ",
					);
					if (copied) {
						addT(theme.fg("success", " ✓ copied to clipboard"));
					}
					const label =
						focus === "editor"
							? theme.fg("accent", "Output (paste what you saw below):")
							: theme.fg("muted", "Output (paste what you saw below) — Tab to focus:");
					addWrapped(top, label, tw, " ");
					addT(
						theme.fg(
							"dim",
							focus === "editor" ? " Enter — submit · Tab — unfocus · Esc — cancel" : " Tab — focus output · Esc — cancel",
						),
					);
					if (focus !== "editor" && editor.getText().trim().length === 0) {
						bottom.push(theme.fg("dim", " output — Tab to paste"));
					} else {
						for (const line of editorInnerLines(editor, bw)) bottom.push(line);
					}
					return frameMerged(top, bottom, width, theme);
				},

				invalidate: () => {
					editor.invalidate();
				},

				handleInput(data: string) {
					if (focus === "editor") {
						if (matchesKey(data, Key.enter)) {
							done({ output: outputText() ?? "" });
							return;
						}
						if (matchesKey(data, Key.tab)) {
							focus = "none";
							editor.focused = false;
							return;
						}
						if (matchesKey(data, Key.escape)) {
							done(null);
							return;
						}
						editor.handleInput(data);
						return;
					}

					// Unfocused: y yanks the command as-is, Tab focuses the field.
					if (data === "y") {
						copyToClipboard(command)
							.then(() => {
								copied = true;
								tui.requestRender();
							})
							.catch(() => {});
						return;
					}
					if (matchesKey(data, Key.tab)) {
						focus = "editor";
						editor.focused = true;
						return;
					}
					if (matchesKey(data, Key.enter)) {
						// Submitting with an empty field is almost always an accident —
						// focus the field instead of submitting nothing.
						if (!outputText()) {
							focus = "editor";
							editor.focused = true;
							return;
						}
						done({ output: outputText()! });
						return;
					}
					if (matchesKey(data, Key.escape)) {
						done(null);
						return;
					}
				},
			};
		},
	);

	return { response: result, copied };
}

function buildDetails(
	status: RunCommandStatus,
	command: string,
	prediction: string | undefined,
	context: string | undefined,
	output?: string,
	copied?: boolean,
	message?: string,
): RunCommandDetails {
	return { status, command, prediction, context, output, copied, message };
}

function cancelledResult(command: string, prediction: string | undefined, context?: string) {
	const message = "User cancelled run-command";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("cancelled", command, prediction, context, undefined, undefined, message),
	};
}

function unavailableResult(command: string, prediction: string | undefined, message: string, context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildDetails("unavailable", command, prediction, context, undefined, undefined, message),
	};
}

export default function runCommand(pi: ExtensionAPI) {
	pi.registerTool({
		name: "run-command",
		label: "run-command",
		description:
			"Have the user run ONE command hands-on and report what they saw. A floating panel shows the command; the user presses y to copy it as-is, runs it in their own terminal, pastes the output into the response field, and submits. You receive the command and the pasted output together — grade the output against your prediction. You NEVER execute the command yourself: the user typing and running everything is the point. Use it for teaching labs and any hands-on verification where the user must do the doing.",
		promptSnippet:
			"Use run-command to have the user execute one command hands-on (with a grounded prediction) and paste back the output. You never run it yourself.",
		promptGuidelines: [
			"ONE command per call — never a batch. The panel shows exactly what you pass in `command`, verbatim.",
			"prediction is REQUIRED and must be grounded: run the idempotent/read-only equivalent yourself first and predict the actual observed output; for state-modifying commands, run the read-side (current ruleset/sysctl value) and predict a concrete diff. When no safe read exists, say the prediction is inferred from docs.",
			"Grade the returned output against your prediction. A mismatch is diagnostic: either host state drifted or your model was wrong — determine which before moving on.",
			"The user may submit partial or empty output if something went wrong on their side — treat that as data, not as disobedience.",
			"Follow up with a quiz to cement the concept when the node needs it — run-command proves the hands, not the head.",
		],
		parameters: RunCommandParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const command = params.command.trim();
			const prediction = params.prediction.trim();
			const context = params.details?.trim() || undefined;

			if (signal?.aborted) {
				return cancelledResult(command, prediction, context);
			}
			if (!command) {
				return unavailableResult(command, prediction, "run-command requires a non-empty command", context);
			}
			if (!ctx.hasUI) {
				return unavailableResult(command, prediction, "run-command requires interactive mode UI", context);
			}

			return withUILock(async () => {
				const { response, copied } = await askRunCommand(ctx, command, prediction, context);
				if (!response) {
					return cancelledResult(command, prediction, context);
				}
				const output = response.output.trim();
				let text: string;
				if (output) {
					text = `User ran the command and pasted output.\nCommand: ${command}\nOutput:\n${output}`;
				} else {
					text = `User submitted WITHOUT output — the command produced nothing they could paste, or something went wrong on their side.\nCommand: ${command}`;
				}
				if (copied) text += `\n(They copied the command via the panel's y key.)`;
				text += `\nYour prediction was: ${prediction}`;
				return {
					content: [{ type: "text" as const, text }],
					details: buildDetails("answered", command, prediction, context, output || undefined, copied),
				};
			});
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("run-command ")) + theme.fg("muted", String(args.command ?? ""));
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as RunCommandDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", details.message || "Cancelled"), 0, 0);
			}
			if (details.status === "unavailable") {
				return new Text(theme.fg("warning", details.message || "Unavailable"), 0, 0);
			}
			const lines: string[] = [];
			lines.push(theme.fg("toolTitle", theme.bold("run-command ")) + theme.fg("text", details.command));
			if (details.output) {
				lines.push(theme.fg("muted", `─ output (${details.output.split("\n").length} lines) ─`));
				for (const line of details.output.split("\n").slice(0, 20)) {
					lines.push(theme.fg("dim", ` ${line}`));
				}
				const extra = details.output.split("\n").length - 20;
				if (extra > 0) lines.push(theme.fg("dim", ` … ${extra} more lines`));
			} else {
				lines.push(theme.fg("warning", " (no output submitted)"));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
