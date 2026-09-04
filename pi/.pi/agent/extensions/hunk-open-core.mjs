export function parseHunkArgs(input) {
	const args = [];
	let current = "";
	let quote = null;
	let escaped = false;

	for (const character of input) {
		if (escaped) {
			current += character;
			escaped = false;
		} else if (character === "\\" && quote !== "'") {
			escaped = true;
		} else if (quote) {
			if (character === quote) quote = null;
			else current += character;
		} else if (character === "'" || character === '"') {
			quote = character;
		} else if (/\s/.test(character)) {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += character;
		}
	}
	if (escaped) current += "\\";
	if (current) args.push(current);
	return args;
}

export async function openHunkWithHost(cwd, requestedArgs, host) {
	const args = requestedArgs.length > 0 ? requestedArgs : ["diff", "--watch"];
	const pane = host.currentPane();
	if (pane) {
		const existing = host.findHunkPane(pane.tab_id, cwd);
		if (existing.status === "found") {
			const focused = host.focusPane(existing.paneId, pane.pane_id);
			return {
				message: focused
					? `Focused existing Hunk pane (${existing.paneId}).`
					: `Could not focus existing Hunk pane (${existing.paneId}) automatically.`,
				launched: false,
			};
		}
		if (existing.status === "absent") {
			const paneId = host.launchPane(cwd, args);
			if (paneId) {
				return { message: `Opened Hunk in pane ${paneId}.`, launched: true };
			}
		}
	}

	if (host.tmuxOpen(cwd, args)) {
		return { message: "Opened Hunk in a tmux split.", launched: true };
	}
	return { message: host.manualCommand(cwd, args), launched: false };
}
