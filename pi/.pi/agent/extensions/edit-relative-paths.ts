import { isAbsolute, relative, sep } from "node:path";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────────
// edit-relative-paths — rewrite edit paths to session-relative form.
//
// Read calls arrive with paths relative to the session cwd; edit calls
// arrive with absolute worktree paths, which are long and host-specific.
// The edit tool resolves relative paths against that same session cwd
// (`resolveToCwd`), so rewriting an absolute path under the cwd to its
// relative form edits the identical file, while everything downstream of
// the call — result text, nested-call records, subagent activity trees —
// sees the short form. The stored assistant message keeps the model's
// original argument; execution never sees it.
// Paths outside the session cwd and already-relative paths pass through
// untouched, matching how the read tool is used.
// ────────────────────────────────────────────────────────────────────────────

export default function editRelativePaths(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "edit") return;
		const input = event.input as { path?: unknown } | null | undefined;
		if (!input || typeof input !== "object") return;
		if (typeof input.path !== "string") return;
		const path = input.path;
		if (!isAbsolute(path)) return;
		const cwd = ctx?.cwd ?? process.cwd();
		if (typeof cwd !== "string" || !isAbsolute(cwd)) return;
		// Only strictly-under paths rewrite: a path outside the cwd has no
		// valid relative form here, and the cwd itself names a directory.
		if (!path.startsWith(`${cwd}${sep}`)) return;
		input.path = relative(cwd, path);
	});
}
