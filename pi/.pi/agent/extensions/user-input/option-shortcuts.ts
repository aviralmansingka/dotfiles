export const NAVIGATION_HINT = "↑↓/jk navigate";
const NUMBER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const NUMBER_SHORTCUT_LIMIT = NUMBER_KEYS.length;

export function numberShortcutIndex(data: string, optionCount: number): number | undefined {
	const encoded = data.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?(?:;(\d+))?(?::\d+)?u$/);
	const codePoint = Number(encoded?.[1]);
	const modifier = Number(encoded?.[2] ?? 1);
	const key = modifier === 1 && codePoint >= 49 && codePoint <= 57 ? String.fromCodePoint(codePoint) : data;
	const index = NUMBER_KEYS.indexOf(key as (typeof NUMBER_KEYS)[number]);
	return index >= 0 && index < optionCount ? index : undefined;
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
