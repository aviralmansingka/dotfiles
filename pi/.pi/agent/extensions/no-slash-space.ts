/**
 * Slash handling in the composer: no trailing space, no prose pickers.
 *
 * Pi's built-in provider appends a space when it completes a slash command
 * (`applyCompletion` builds `/name `), and it opens path suggestions when a
 * token contains a slash anywhere, so prose such as `and/or` or `TCP/IP`
 * starts a file picker. Both come from the TUI provider, so this extension
 * wraps that provider instead of forking pi.
 *
 * Rules:
 * - a bare `/name` completion drops the trailing space
 * - a slash inside a word does not open path suggestions
 * - real path tokens still complete: `/abs`, `./rel`, `../up`, `~/home`
 * - argument completions keep their own spacing
 *
 * The wrapper must be registered from a handler, because the UI context
 * exists only once a session runs. Registration is guarded so a session
 * restart does not stack the wrapper twice.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A completed command name alone on the line, followed by one space. */
const BARE_COMMAND_WITH_SPACE = /^\/\S+ $/;

/** A token the user means as a path, not as prose. */
const PATH_LIKE_TOKEN = /^(?:\/|\.{1,2}\/|~\/)/;

export default function (pi: ExtensionAPI) {
	let registered = false;

	pi.on("session_start", (_event, ctx) => {
		if (registered) return;
		registered = true;

		ctx.ui.addAutocompleteProvider((current) => ({
			async getSuggestions(lines, line, col, options) {
				if (!options.force && !wantsPathSuggestions(lines[line] ?? "", col)) return null;
				return current.getSuggestions(lines, line, col, options);
			},
			shouldTriggerFileCompletion(lines, line, col) {
				return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
			},
			applyCompletion(lines, line, col, item, prefix) {
				const result = current.applyCompletion(lines, line, col, item, prefix);

				// An argument completion starts from a command name plus a space,
				// so the prefix tells the two cases apart.
				if (prefix.includes(" ")) return result;

				const text = result.lines[result.cursorLine] ?? "";
				if (!BARE_COMMAND_WITH_SPACE.test(text) || result.cursorCol !== text.length) return result;

				const next = [...result.lines];
				next[result.cursorLine] = text.slice(0, -1);
				return { lines: next, cursorLine: result.cursorLine, cursorCol: result.cursorCol - 1 };
			},
		}));
	});
}

/**
 * True when the token under the cursor may open suggestions: a slash command
 * at the start of the message, or a token that starts like a path.
 */
export function wantsPathSuggestions(line: string, col: number): boolean {
	const before = line.slice(0, col);
	const token = before.split(/[\s"'`()[\]{}<>,;]/).pop() ?? "";
	if (token === "") return false;
	if (before.trimStart().startsWith("/") && before.trim() === token) return true;
	return PATH_LIKE_TOKEN.test(token);
}
