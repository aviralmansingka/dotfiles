export function normalizeContextFiles(files: unknown): string[] {
	if (!Array.isArray(files)) return [];
	return files.map((file) => String(file).trim()).filter(Boolean);
}

export function contextFileHint(files: string[]): string | undefined {
	if (files.length === 0) return undefined;
	return `o open ${files.length === 1 ? "context file" : "context files"}`;
}

// The `h` handout shortcut always works (the handout is generated from the
// quiz's own content, not from contextFiles), so this hint is unconditional.
export function handoutHint(): string {
	return "h handout";
}
