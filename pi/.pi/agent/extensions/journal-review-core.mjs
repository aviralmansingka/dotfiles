// Pure helpers for journal-review.ts — open (or focus) the herdr-annotate
// reviewer on the session's lesson journal, with annotations DELIVERED back
// to the requesting agent pane (--deliver-to). Mirrors hunk-open-core.mjs so
// both share the focus-or-launch pane pattern.

export function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function reviewerPaneCommand(paneId, binaryPath, journalPath, deliverToPaneId) {
	// Herdr runs one shell command in the new pane; quote each value, and
	// close that exact pane when the reviewer exits.
	const parts = [
		binaryPath,
		"herdr",
		"open",
		journalPath,
		"--placement",
		"split",
		"--deliver-to",
		deliverToPaneId,
	].map(shellQuote);
	return `${parts.join(" ")}; herdr pane close ${shellQuote(paneId)}`;
}

export function isReviewerProcess(process) {
	const argv = process.argv ?? [];
	const executable = argv[0]?.split(/[\\/]/).at(-1);
	return (
		(process.name === "plannotator-tui" || executable === "plannotator-tui") &&
		argv[1] === "herdr" &&
		argv[2] === "open"
	);
}

export async function openReviewerWithHost(host, binaryPath, journalPath, deliverToPaneId) {
	const pane = host.currentPane();
	if (pane) {
		const existing = host.findReviewerPane(pane.tab_id);
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
