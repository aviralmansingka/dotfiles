const WATCHED_DIFF_ARGS = ["diff", "--watch"];

export function hunkPaneCommand(paneId, args) {
	return ["sh", "-c", 'hunk "$@"; herdr pane close "$0"', paneId, ...args];
}

export function isWatchedHunkProcess(process) {
	const argv = process.argv ?? [];
	const executable = argv[0]?.split(/[\\/]/).at(-1);
	return (
		(process.name === "hunk" || executable === "hunk") &&
		argv[1] === "diff" &&
		argv.slice(2).includes("--watch")
	);
}

export async function openHunkWithHost(cwd, host) {
	const pane = host.currentPane();
	if (pane) {
		const existing = host.findHunkPane(pane.tab_id, cwd);
		if (
			existing.status === "found" &&
			host.focusPane(existing.paneId, pane.pane_id)
		) {
			return {
				message: `Focused existing Hunk pane (${existing.paneId}).`,
				launched: false,
			};
		}
		if (existing.status !== "error") {
			const paneId = host.launchPane(cwd, WATCHED_DIFF_ARGS);
			if (paneId) {
				return { message: `Opened Hunk in pane ${paneId}.`, launched: true };
			}
		}
	}

	if (host.tmuxOpen(cwd, WATCHED_DIFF_ARGS)) {
		return { message: "Opened Hunk in a tmux split.", launched: true };
	}
	return {
		message: host.manualCommand(cwd, WATCHED_DIFF_ARGS),
		launched: false,
	};
}
