import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
	isReviewerProcess,
	manualReviewerCommand,
	openReviewerWithHost,
	reviewerPaneCommand,
} from "./journal-review-core.mjs";
import { resolveJournalPath } from "./md-log";

// ────────────────────────────────────────────────────────────────────────────
// journal-review — the round-trip between lessons and herdr-annotate.
//
// md-log keeps a per-session lesson journal (<session>.md). This extension
// opens the local Annotate reviewer (ops/herdr-annotate-review, installed at
// ~/.local/share/herdr/annotate-review/) on that journal in a sibling Herdr
// pane with --deliver-to <this pane>: the user comments / marks looks_good on
// lessons and quiz results, and the reviewer DELIVERS those annotations back
// into the agent pane as input, closing the feedback loop — the professor
// reads them and adapts the teaching.
//
// Ctrl-click on a file:// link to the journal (see lesson's result text) uses
// the reviewer's markdown-file link handler instead; this tool is the
// deliberate, deliver-to-enabled path.
// ────────────────────────────────────────────────────────────────────────────

const COMMAND_TIMEOUT_MS = 5000;

interface PaneInfo {
	pane_id: string;
	tab_id: string;
	cwd: string;
	foreground_cwd?: string;
}

interface ProcessEntry {
	name?: string;
	argv?: string[];
}

interface ProcessInfo {
	foreground_processes?: ProcessEntry[];
}

type DetectionResult =
	| { status: "found"; paneId: string }
	| { status: "absent" }
	| { status: "error" };

function commandJson(command: string, args: string[]): unknown | null {
	try {
		return JSON.parse(
			execFileSync(command, args, {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: COMMAND_TIMEOUT_MS,
			}),
		);
	} catch {
		return null;
	}
}

function commandOk(command: string, args: string[]): boolean {
	try {
		execFileSync(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: COMMAND_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

function currentPane(): PaneInfo | null {
	const response = commandJson("herdr", ["pane", "current"]) as
		| { result?: { pane?: PaneInfo } }
		| null;
	return response?.result?.pane ?? null;
}

function findReviewerPane(
	tabId: string,
	journalPath: string,
	deliverToPaneId: string,
): DetectionResult {
	const response = commandJson("herdr", ["pane", "list"]) as
		| { result?: { panes?: PaneInfo[] } }
		| null;
	const panes = response?.result?.panes;
	if (!panes) return { status: "error" };

	let hadError = false;
	for (const pane of panes.filter((candidate) => candidate.tab_id === tabId)) {
		const processResponse = commandJson("herdr", [
			"pane",
			"process-info",
			"--pane",
			pane.pane_id,
		]) as { result?: { process_info?: ProcessInfo } } | null;
		const processes = processResponse?.result?.process_info?.foreground_processes;
		if (!processes) {
			hadError = true;
			continue;
		}
		if (processes.some((process) => isReviewerProcess(process, journalPath, deliverToPaneId))) {
			return { status: "found", paneId: pane.pane_id };
		}
	}
	return hadError ? { status: "error" } : { status: "absent" };
}

function focusPane(targetPaneId: string, currentPaneId: string): boolean {
	for (const direction of ["right", "down", "left", "up"] as const) {
		const response = commandJson("herdr", [
			"pane",
			"neighbor",
			"--pane",
			currentPaneId,
			"--direction",
			direction,
		]) as { result?: { neighbor?: { pane_id?: string } } } | null;
		if (response?.result?.neighbor?.pane_id === targetPaneId) {
			return commandOk("herdr", [
				"pane",
				"focus",
				"--current",
				"--direction",
				direction,
			]);
		}
	}
	return false;
}

function reviewerBinary(): string {
	const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
	return join(dataHome, "herdr", "annotate-review", "plannotator-tui");
}

function launchPane(
	binaryPath: string,
	journalPath: string,
	deliverToPaneId: string,
): string | null {
	const split = commandJson("herdr", [
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--focus",
	]) as { result?: { pane?: { pane_id?: string } } } | null;
	const paneId = split?.result?.pane?.pane_id;
	if (
		paneId &&
		commandOk("herdr", [
			"pane",
			"run",
			paneId,
			reviewerPaneCommand(paneId, binaryPath, journalPath, deliverToPaneId),
		])
	) {
		commandOk("herdr", ["pane", "rename", paneId, "annotate"]);
		return paneId;
	}
	if (paneId) commandOk("herdr", ["pane", "close", paneId]);
	return null;
}

export async function openJournalReviewer(
	ctx: any,
): Promise<{ message: string; launched: boolean }> {
	const journal = resolveJournalPath(ctx);
	if (!journal) {
		return {
			message: "No lesson journal for this session — show a lesson first (the journal is created when the first lesson or quiz lands).",
			launched: false,
		};
	}
	if (!existsSync(journal)) {
		return { message: `Journal not written yet (${journal}).`, launched: false };
	}
	const binary = reviewerBinary();
	if (!existsSync(binary)) {
		return {
			message: `Annotate reviewer not installed (${binary}). Run ./scripts/install-herdr-annotate from a dotfiles checkout.`,
			launched: false,
		};
	}
	const pane = currentPane();
	if (!pane) {
		return {
			message: `Not inside Herdr. Run: ${manualReviewerCommand(binary, journal)}`,
			launched: false,
		};
	}

	return openReviewerWithHost(
		{
			currentPane: () => pane,
			findReviewerPane,
			focusPane,
			launchPane,
			manualCommand: (bin: string, jp: string, deliverTo: string) =>
				`Could not open the reviewer automatically. Run: ${manualReviewerCommand(bin, jp, deliverTo)}`,
		},
		binary,
		journal,
		pane.pane_id,
	);
}

const journalReviewTool = {
	name: "journal_review",
	label: "Open lesson journal reviewer",
	description:
		"Open the herdr-annotate reviewer on this session's lesson journal in a sibling Herdr pane, with annotation delivery back to this pane. The user comments on lessons and quiz results; delivered annotations arrive here as input. Use when the user wants to review, comment on, or mark up the lesson journal.",
	promptSnippet:
		"Open the Annotate reviewer on the session lesson journal with annotations delivered back to this pane.",
	promptGuidelines: [
		"Use journal_review (or the /journal command) when the user wants to review or comment on the lesson journal.",
		"Annotations the user delivers back are feedback on the teaching — read them and adapt the next lesson.",
	],
	parameters: Type.Object({}),
	async execute(_toolCallId: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: any) {
		const result = await openJournalReviewer(ctx);
		return { content: [{ type: "text" as const, text: result.message }], details: result };
	},
};

export default function journalReview(pi: ExtensionAPI) {
	pi.registerTool(journalReviewTool);
	pi.registerCommand("journal", {
		description: "Open the Annotate reviewer on this session's lesson journal",
		handler: async (_args: string, ctx: any) => {
			const result = await openJournalReviewer(ctx);
			ctx.ui.notify(
				result.message,
				result.launched ? "info" : "warning",
			);
		},
	});
}
