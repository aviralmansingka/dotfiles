import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

export interface RunCommandDetails {
	status: "answered" | "cancelled" | "unavailable";
	command: string;
	prediction?: string;
	context?: string;
	output?: string;
	exitCode?: number;
	autoRun?: boolean;
	copied?: boolean;
	message?: string;
}

type CommandRow = { text: string; op: string };

// ponytail: a display splitter, not a shell parser. Track quotes, parentheses,
// escapes and ordinary heredocs; leave other shell grammar verbatim.
export function splitCommand(command: string): CommandRow[] {
	const rows: CommandRow[] = [];
	let quote = "", depth = 0, op = "$";
	const heredocs: string[] = [];
	for (const line of command.split("\n")) {
		if (heredocs.length) {
			rows.push({ text: line, op: "" });
			if (line.trim() === heredocs[0]) heredocs.shift();
			continue;
		}
		let start = 0;
		const emit = (end: number) => {
			const segment = line.slice(start, end);
			const text = op ? (quote ? segment.trimStart() : segment.trim())
				: end < line.length ? segment.trimEnd() : segment;
			if (text === "\\" && op && op !== "$") return; // carry the operator across a shell line wrap
			if (text.trim() || quote || (!op && start === 0)) {
				rows.push({ text, op });
				op = "";
			}
		};
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === "\\" && quote !== "'") { i++; continue; }
			if (quote) {
				if (ch === quote) quote = "";
				continue;
			}
			if (ch === "'" || ch === '"') { quote = ch; continue; }
			if (ch === "(") { depth++; continue; }
			if (ch === ")") { depth = Math.max(0, depth - 1); continue; }
			if (ch === "<" && line[i - 1] !== "<") {
				const tag = /^<<-?\s*(['"]?)([\w-]+)\1/.exec(line.slice(i));
				if (tag) { heredocs.push(tag[2]); i += tag[0].length - 1; continue; }
			}
			if (depth === 0 && (ch === "|" || (ch === "&" && line[i + 1] === "&"))) {
				emit(i);
				op = line.slice(i, i + 2) === "||" || ch === "&" ? line.slice(i, i + 2) : "|";
				i += op.length - 1;
				start = i + 1;
			}
		}
		emit(line.length);
	}
	// Keep an operator visible while its next operand is still streaming.
	if (op && op !== "$") rows.push({ text: "", op });
	return rows;
}

export function outputLines(output: string, command: string): string[] {
	const lines = output.replace(/\r\n/g, "\n").split("\n")
		.map(line => line.replace(/^((?:\x1b\[[0-?]*[ -/]*[@-~])*)[>❯]((?:\x1b\[[0-?]*[ -/]*[@-~])*) /, "$1$2"));
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
	const echo = command.trim().split("\n").map(line => line.trim());
	const comparable = (line: string) => stripVTControlCharacters(line).trim().replace(/^\$ /, "");
	// Drop only complete command echoes at the head, never matching real output
	// later in the transcript or deleting a partially matching multiline block.
	while (lines.length) {
		if (!lines[0].trim()) { lines.shift(); continue; }
		if (!command.trim() || !echo.every((line, i) => i < lines.length && comparable(lines[i]) === line)) break;
		lines.splice(0, echo.length);
	}
	return lines;
}

function leaves(command: CommandRow[], context: string | undefined, prediction: string | undefined, theme: Theme, width: number, full: boolean): string[] {
	const rows: string[] = [];
	const dim = (text: string) => theme.fg("dim", text);
	const leaf = (marker: string) => dim(`├─ ${marker.padEnd(2)} `);
	const spine = dim("│     ");
	const bodyWidth = Math.max(1, Math.min(100, width) - 6);
	for (const [marker, body] of [["§", context], ["¶", prediction]]) {
		if (!body) continue;
		const first = body.split("\n", 1)[0];
		const parts = full ? wrapTextWithAnsi(body, bodyWidth)
			: [truncateToWidth(first + (body.includes("\n") ? "…" : ""), bodyWidth, "…")];
		parts.forEach((part, i) => rows.push((i ? spine : leaf(marker!)) + theme.fg("text", part)));
	}
	for (const { text, op } of command) {
		const prefix = op === "$" ? leaf("$") : op ? dim(`│  ${op.padEnd(2)} `) : spine;
		wrapTextWithAnsi(text, bodyWidth).forEach((part, i) => rows.push(
			(i ? spine : prefix) + theme.fg(op && !i ? "text" : "dim", part),
		));
	}
	return rows.map(line => truncateToWidth(line, width));
}

export function renderCommandCall(args: { command?: string; prediction?: string; details?: string }, theme: Theme) {
	const command = splitCommand(args.command ?? "");
	return {
		render: (width = 100) => leaves(command, args.details, args.prediction, theme, width, false),
		invalidate() {},
	};
}

export function renderCommandResult(details: RunCommandDetails, theme: Theme) {
	const command = splitCommand(details.command);
	const output = outputLines(details.output ?? "", details.command);
	return {
		render(width = 100) {
			const rows = leaves(command, details.context, details.prediction, theme, width, true);
			const dim = (text: string) => theme.fg("dim", text);
			let banner: string;
			if (details.status !== "answered") {
				banner = dim(`└─ ● ${details.status}${details.message ? ` · ${details.message}` : ""}`);
			} else if (details.autoRun) {
				const failed = details.exitCode !== undefined && details.exitCode !== 0;
				banner = dim("└─ ") + theme.fg(failed ? "error" : "success", failed ? "✗" : "✓")
					+ theme.fg("text", ` via :term dm · exit ${details.exitCode ?? "unknown"} · ${output.length} lines`);
			} else if (output.length) {
				banner = dim("└─ ") + theme.fg("success", "✓") + theme.fg("text", ` output pasted · ${output.length} lines`)
					+ (details.copied ? dim(" · y-copied") : "");
			} else {
				banner = dim("└─ ") + theme.fg("muted", "● no output submitted");
			}
			rows.push(...wrapTextWithAnsi(banner, Math.max(1, width)));
			if (details.status === "answered") {
				const folded = output.length > 60
					? [...output.slice(0, 30), dim(`… ${output.length - 60} lines hidden …`), ...output.slice(-30)] : output;
				for (const line of folded) {
					for (const part of wrapTextWithAnsi(line, Math.max(1, width - 2))) {
						rows.push(truncateToWidth(`  ${part}`, width));
					}
				}
			}
			return rows;
		},
		invalidate() {},
	};
}
