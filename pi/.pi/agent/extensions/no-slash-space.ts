/**
 * Slash command completion without the trailing space.
 *
 * Pi's built-in provider completes a slash command as `/help ` (space
 * included) in `applyCompletion`. That space comes from the TUI provider,
 * not from a setting, and the behavior is pinned by a pi test
 * (`/help ` in packages/tui/test/editor.test.ts). So this extension wraps
 * the built-in provider instead of forking pi.
 *
 * Rule:
 * - a bare `/name` completion drops the trailing space
 * - a completion that already sits before other text keeps its text
 * - argument completions (`/model gpt`) keep their own spacing
 *
 * Type the space yourself when a command needs an argument.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A completed command name alone on the line, followed by one space. */
const BARE_COMMAND_WITH_SPACE = /^\/\S+ $/;

export default function (pi: ExtensionAPI) {
	pi.ui.addAutocompleteProvider((current) => ({
		getSuggestions(lines, line, col, options) {
			return current.getSuggestions(lines, line, col, options);
		},
		shouldTriggerFileCompletion(lines, line, col) {
			return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
		},
		applyCompletion(lines, line, col, item, prefix) {
			const result = current.applyCompletion(lines, line, col, item, prefix);

			// An argument completion starts from a command name plus a space, so
			// the prefix tells the two cases apart.
			if (prefix.includes(" ")) return result;

			const text = result.lines[result.cursorLine] ?? "";
			if (!BARE_COMMAND_WITH_SPACE.test(text) || result.cursorCol !== text.length) return result;

			const trimmed = text.slice(0, -1);
			const next = [...result.lines];
			next[result.cursorLine] = trimmed;
			return { lines: next, cursorLine: result.cursorLine, cursorCol: result.cursorCol - 1 };
		},
	}));
}
