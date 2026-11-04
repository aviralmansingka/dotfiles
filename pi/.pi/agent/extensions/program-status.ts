/**
 * Program Status Protocol (OSC 7501) reporter.
 *
 * Rex reads this sequence and shows what the block is doing: a spinner on the
 * tab of a working agent, a symbol when the agent waits for the user, and a badge
 * in the session picker. Terminals that do not know the sequence ignore it.
 * Spec: https://www.superlogical.com/rex/docs/build/program-status
 *
 * The record belongs to the terminal, not to the screen. A report replaces its
 * record whole, so every report repeats `app`. Root record only: one pi process
 * owns one terminal.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OSC_OPEN = "\u001b]7501;";
const OSC_CLOSE = "\u001b\\";
const APP = "pi";
const MSG_LIMIT = 2048;

export type RunState = "idle" | "working" | "blocked" | "clear";
export type BlockedKind = "permission" | "question" | "auth";
export type WriteFn = (text: string) => void;

/** Strip control characters and fold whitespace: the spec forbids both. */
export function singleLine(text: string): string {
	return String(text ?? "")
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Cut a message at a UTF-8 byte limit without splitting a character. */
export function truncateUtf8(text: string, limit = MSG_LIMIT): string {
	if (Buffer.byteLength(text, "utf8") <= limit) return text;
	let out = "";
	for (const char of text) {
		if (Buffer.byteLength(out + char, "utf8") > limit) break;
		out += char;
	}
	return out;
}

/** The protocol encodes free text as standard base64 of UTF-8. */
export function encodeText(text: string): string {
	return Buffer.from(truncateUtf8(singleLine(text)), "utf8").toString("base64");
}

export type ReportFields = {
	state: RunState;
	kind?: BlockedKind;
	progress?: number;
	msg?: string;
	title?: string;
};

/** One report as `key=value` pairs. Absent keys are absent, never empty. */
export function encodeReport(fields: ReportFields): string {
	const pairs = [`state=${fields.state}`, `app=${APP}`];
	if (fields.kind) pairs.push(`kind=${fields.kind}`);
	if (typeof fields.progress === "number") {
		const n = Math.max(0, Math.min(100, Math.round(fields.progress)));
		pairs.push(`progress=${n}`);
	}
	if (fields.title) pairs.push(`title=${encodeText(fields.title)}`);
	if (fields.msg) pairs.push(`msg=${encodeText(fields.msg)}`);
	return OSC_OPEN + pairs.join(":") + OSC_CLOSE;
}

/**
 * Report only on a real terminal and only under Rex, unless the operator says
 * otherwise: `PI_PROGRAM_STATUS=1` forces it on, `0` keeps it off.
 */
export function shouldReport(
	env: Record<string, string | undefined> = process.env,
	isTTY: boolean = Boolean(process.stdout.isTTY),
): boolean {
	const override = env.PI_PROGRAM_STATUS;
	if (override === "0") return false;
	if (!isTTY) return false;
	if (override === "1") return true;
	return Boolean(env.REX_SESSION || env.REX_BLOCK || env.TERM_PROGRAM === "rex");
}

export type Reporter = {
	working: (msg?: string) => void;
	blocked: (msg: string, kind?: BlockedKind) => void;
	idle: (msg?: string) => void;
	clear: () => void;
	last: () => string | null;
};

/**
 * Make a reporter over one write function. Identical reports are written once:
 * the protocol asks programs to be quiet when nothing changed.
 */
export function createReporter(write: WriteFn): Reporter {
	let last: string | null = null;
	const send = (fields: ReportFields) => {
		const text = encodeReport(fields);
		if (text === last) return;
		last = text;
		write(text);
	};
	return {
		working: (msg = "Working") => send({ state: "working", msg }),
		blocked: (msg, kind = "question") => send({ state: "blocked", kind, msg }),
		idle: (msg = "Ready") => send({ state: "idle", msg }),
		clear: () => send({ state: "clear" }),
		last: () => last,
	};
}

/**
 * Wire the reporter to pi's lifecycle. Exported with overrides so a test can
 * drive it without a terminal.
 */
export function defineProgramStatus(
	pi: ExtensionAPI,
	options: { write?: WriteFn; env?: Record<string, string | undefined>; isTTY?: boolean } = {},
): Reporter | null {
	if (!shouldReport(options.env ?? process.env, options.isTTY ?? Boolean(process.stdout.isTTY))) return null;
	const write = options.write ?? (text => process.stdout.write(text));
	const reporter = createReporter(write);
	pi.on("agent_start", () => reporter.working());
	// A run may retry, compact, or continue, so only the settled event is final.
	pi.on("agent_settled", () => reporter.idle());
	pi.on("ui_prompt_start", event => {
		reporter.blocked(event?.title?.trim() || "Waiting for input");
	});
	pi.on("ui_prompt_end", () => reporter.working());
	// A record outlives the process, so remove it on a clean quit.
	pi.on("session_shutdown", () => reporter.clear());
	return reporter;
}

export default function programStatus(pi: ExtensionAPI) {
	defineProgramStatus(pi);
}
