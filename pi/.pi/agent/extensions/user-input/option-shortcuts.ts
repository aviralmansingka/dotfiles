export const NUMBER_SHORTCUT_LIMIT = 9;

export function numberShortcutIndex(data: string, optionCount: number): number | undefined {
	if (!/^[1-9]$/.test(data)) return undefined;
	const index = Number(data) - 1;
	if (index >= Math.min(optionCount, NUMBER_SHORTCUT_LIMIT)) return undefined;
	return index;
}

export function numberShortcutHint(optionCount: number, action: string): string | undefined {
	const last = Math.min(optionCount, NUMBER_SHORTCUT_LIMIT);
	if (last <= 0) return undefined;
	const keys = last === 1 ? "1" : `1-${last}`;
	return optionCount > NUMBER_SHORTCUT_LIMIT ? `${keys} ${action} first nine` : `${keys} ${action}`;
}

export function joinHints(...hints: Array<string | undefined>): string {
	return hints.filter(Boolean).join(" • ");
}
