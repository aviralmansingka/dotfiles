// Pure helpers for journal-review.ts — open (or focus) the herdr-annotate
// reviewer on the session's lesson journal, with annotations DELIVERED back
// to the requesting agent pane (--deliver-to). Mirrors hunk-open-core.mjs so
// both share the focus-or-launch pane pattern.

import { createHash } from "node:crypto";
import { dirname } from "node:path";

export function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function reviewerPaneTitle(journalPath, deliverToPaneId) {
	const identity = createHash("sha256")
		.update(`${journalPath}\0${deliverToPaneId}`)
		.digest("hex")
		.slice(0, 12);
	return `annotate:${identity}`;
}

export function reviewerPluginPaneArgs(journalPath, deliverToPaneId) {
	return [
		"plugin",
		"pane",
		"open",
		"--plugin",
		"annotate-review",
		"--entrypoint",
		"doc",
		"--placement",
		"split",
		"--target-pane",
		deliverToPaneId,
		"--direction",
		"right",
		"--cwd",
		dirname(journalPath),
		"--env",
		`PLANNOTATOR_TUI_FILE=${journalPath}`,
		"--env",
		`PLANNOTATOR_TUI_DELIVER_TO=${deliverToPaneId}`,
		"--focus",
	];
}

export function manualReviewerCommand(binaryPath, journalPath, deliverToPaneId) {
	const parts = [binaryPath, "herdr", "open", journalPath];
	if (deliverToPaneId) parts.push("--deliver-to", deliverToPaneId);
	return parts.map(shellQuote).join(" ");
}

export function isReviewerProcess(process) {
	const argv = process.argv ?? [];
	const executable = argv[0]?.split(/[\\/]/).at(-1);
	return (
		(process.name === "plannotator-tui" || executable === "plannotator-tui") &&
		argv[1] === "herdr" &&
		argv[2] === "pane"
	);
}

export function isReviewerPane(pane, processes, journalPath, deliverToPaneId) {
	const expectedTitle = reviewerPaneTitle(journalPath, deliverToPaneId);
	return (
		[pane.label, pane.title, pane.terminal_title_stripped].includes(expectedTitle) &&
		processes.some(isReviewerProcess)
	);
}

export async function openReviewerWithHost(host, binaryPath, journalPath, deliverToPaneId) {
	const pane = host.currentPane();
	if (pane) {
		const existing = host.findReviewerPane(pane.tab_id, journalPath, deliverToPaneId);
		if (
			existing.status === "found" &&
			host.focusPane(existing.paneId, pane.pane_id)
		) {
			return {
				message: `Focused existing Annotate reviewer pane (${existing.paneId}). Deliver new annotations there with its send action.`,
				launched: false,
			};
		}
		if (existing.status !== "error") {
			const paneId = host.launchPane(binaryPath, journalPath, deliverToPaneId);
			if (paneId) {
				return {
					message: `Opened the Annotate reviewer on ${journalPath} in pane ${paneId}. Comment on lessons there; annotations are delivered back to this pane.`,
					launched: true,
				};
			}
		}
	}

	return {
		message: host.manualCommand(binaryPath, journalPath, deliverToPaneId),
		launched: false,
	};
}
