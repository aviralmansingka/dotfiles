export function normalizeContextFiles(files: unknown): string[] {
	if (!Array.isArray(files)) return [];
	return files.map((file) => String(file).trim()).filter(Boolean);
}

export function contextFileHint(files: string[]): string | undefined {
	if (files.length === 0) return undefined;
	return `o open ${files.length === 1 ? "context file" : "context files"}`;
}

// The `h` / `H` lesson shortcuts always work (the node view falls back to
// the session journal, not something derived from contextFiles), so this
// hint is unconditional.
export function lessonFileHint(): string {
	return "h node · H journal";
}
