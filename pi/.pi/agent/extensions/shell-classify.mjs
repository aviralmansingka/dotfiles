/**
 * Pure shell-syntax classifier shared by the three modules that parse the
 * same bash command text:
 *   - python.ts (tool_call guard: is this bash call only inline Python?)
 *   - tool-call-renderer-public.ts (commandRows: heredoc/quote/continuation
 *     aware row splitting)
 *   - run-command/render.ts (splitCommand: display splitting)
 *
 * These three grew up parsing independently and drifted apart — the proven
 * regression class behind issue #242 and `786c2d3` (a one-char regex change
 * in one consumer shipped broken while the other suites stayed green).
 * This module is the single source of truth for the shared primitives:
 * heredoc open/close tag matching, the quoted-string state machine,
 * top-level operator positions, backslash line continuations, and the
 * bash-wrapped-Python decision table. Per-domain post-processing (rendered
 * rows, guard reasons, fold rules) stays with the consumers.
 *
 * Kept free of pi imports so it loads with plain `node` and is unit-tested
 * by shell-classify.test.mjs (auto-discovered by the CI glob).
 */

// ────────────────────────────────────────────────────────────────────────────
// Heredoc tags
// ────────────────────────────────────────────────────────────────────────────

/**
 * Match a heredoc opener at `offset` in `text`: `<<`, optional `-`
 * (`<<-`), optional whitespace, and a tag that is either unquoted or
 * wrapped in matching single/double quotes (`<<'EOF'`, `<<"EOF"`).
 *
 * The tag charset is strict — a tag must start with a letter or
 * underscore (`[A-Za-z_][A-Za-z0-9_-]*`). The run-command splitter
 * historically used the looser `[\w-]+`, which also opened heredocs for
 * digit-leading tags like `<<3D`; the strict charset is the unified rule.
 *
 * Returns `{ tag, quote, length }` (quote is the delimiter character, ""
 * for unquoted) or undefined when nothing opens at the offset. A `<<<`
 * herestring never matches: the third `<` cannot start a tag, and the
 * renderer historically opened a spurious heredoc off the second `<` of
 * `<<<` — the unified rule is that it never opens one.
 */
const HEREDOC_OPENER = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1/;

export function matchHeredocOpener(text, offset = 0) {
	const match = HEREDOC_OPENER.exec(text.slice(offset));
	if (!match) return undefined;
	return { tag: match[2], quote: match[1], length: match[0].length };
}

/**
 * A body line closes the heredoc when its trimmed text equals the tag
 * (leading tabs count as indentation, so `<<-` bodies close on `\tEOF`).
 */
export function isHeredocTerminator(tag, line) {
	return line.trim() === tag;
}

// ────────────────────────────────────────────────────────────────────────────
// Quoted-string state machine
// ────────────────────────────────────────────────────────────────────────────

/**
 * One shared quote-state machine, escape-aware, used by every consumer:
 * inside single quotes a backslash is literal; inside double quotes and in
 * command context a backslash consumes the next character. The python
 * guard historically ran an escape-blind copy that desynced on
 * `python -c "print(\"a;b\")"` — the shared machine is the unified rule.
 *
 * `step(char)` classifies one character:
 *   - "escape": an escaping backslash; the caller must skip the next char
 *   - "escaped": a character consumed by a preceding backslash
 *   - "open"/"close": a quote delimiter toggling the state
 *   - "plain": an ordinary character in command context
 *   - "literal": an ordinary character inside quotes
 */
export function createQuoteTracker(initialQuote = "") {
	let quote = initialQuote;
	let escaped = false;
	return {
		/** Current open quote: "", "'", or '"'. */
		get state() {
			return quote;
		},
		step(char) {
			if (escaped) {
				escaped = false;
				return "escaped";
			}
			if (char === "\\") {
				if (quote === "'") return "literal";
				escaped = true;
				return "escape";
			}
			if (quote) {
				if (char === quote) {
					quote = "";
					return "close";
				}
				return "literal";
			}
			if (char === "'" || char === '"') {
				quote = char;
				return "open";
			}
			return "plain";
		},
	};
}

/**
 * True when `text` contains any of `chars` (default the shell chain chars
 * `;`, `|`, `&`) outside quotes and not escaped. A `;` inside the quoted
 * Python code of `-c '…;…'` is Python syntax, not a shell chain.
 */
export function containsUnquoted(text, chars = ";|&") {
	const tracker = createQuoteTracker();
	for (const char of text) {
		if (tracker.step(char) === "plain" && chars.includes(char)) return true;
	}
	return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Command-context scanning
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk `text` from `start` in command context and report where the
 * top-level structure changes, so consumers keep only their rendering
 * policy. Quotes, escapes, and parens are consumed here and never leak
 * into the reported positions.
 *
 * `state` (`{ quote, parenDepth }`) carries cross-line structure in and
 * the end state comes back in the result; a pending backslash escape
 * never survives the scan (bash `\<newline>` continues the segment without
 * escaping the next line's first character).
 *
 * Events, in text order:
 *   - `{ type: "operator", index, op }` — a top-level `&&`, `||`, or `|`
 *     (parens gate splitting; `;` and a single `&` are never operators —
 *     their handling is per-domain policy)
 *   - `{ type: "heredoc", index, tag, length }` — a heredoc opener; the
 *     tag's quotes are part of the opener and never enter the string
 *     machine. Not paren-gated: `$(cat <<EOF …)` opens like any other.
 *
 * `trailingEscape` is true when the scanned text ends in a backslash in
 * command context (a line continuation), which consumers use to carry the
 * segment across the newline.
 */
export function scanCommandContext(text, state = {}, start = 0) {
	const tracker = createQuoteTracker(state.quote);
	let parenDepth = state.parenDepth ?? 0;
	const events = [];
	let trailingEscape = false;
	for (let k = start; k < text.length; k++) {
		const char = text[k];
		const event = tracker.step(char);
		if (event === "escape") {
			// A backslash at the end of the scanned text is a line
			// continuation, not an escape of the next line's first char —
			// and inside quotes it never continues anything.
			if (k === text.length - 1 && !tracker.state) trailingEscape = true;
			k++; // consume the escaped character
			continue;
		}
		if (event !== "plain") continue; // quoted, delimiter, or consumed
		if (char === "(") {
			parenDepth++;
			continue;
		}
		if (char === ")") {
			parenDepth = Math.max(0, parenDepth - 1);
			continue;
		}
		if (char === "<" && text[k - 1] !== "<") {
			const opener = matchHeredocOpener(text, k);
			if (opener) {
				events.push({ type: "heredoc", index: k, tag: opener.tag, length: opener.length });
				k += opener.length - 1; // skip the tag; its quotes are not string delimiters
			}
			continue;
		}
		if (parenDepth > 0) continue; // operators inside $(…) or (…) never split
		if (char === "&" && text[k + 1] === "&") {
			events.push({ type: "operator", index: k, op: "&&" });
			k++;
			continue;
		}
		if (char === "|") {
			if (text[k + 1] === "|") {
				events.push({ type: "operator", index: k, op: "||" });
				k++;
			} else {
				events.push({ type: "operator", index: k, op: "|" });
			}
		}
	}
	return { events, quote: tracker.state, parenDepth, trailingEscape };
}

/**
 * Walk `text` from `from` while the quote `quote` is open, and report
 * where it closes. `closeIndex` is just past the closing delimiter, or
 * `text.length` when the quote stays open past the end (the caller keeps
 * scanning the next line). An escaped delimiter (`\"`) is skipped, not a
 * close; inside single quotes a backslash is literal.
 */
export function scanQuoteClose(text, quote, from = 0) {
	const tracker = createQuoteTracker(quote);
	let i = from;
	while (i < text.length) {
		const event = tracker.step(text[i]);
		if (event === "escape") {
			i += 2;
			continue;
		}
		if (event === "close") {
			i++;
			return { closed: true, closeIndex: i, quote: tracker.state };
		}
		i++;
	}
	return { closed: false, closeIndex: text.length, quote: tracker.state };
}

// ────────────────────────────────────────────────────────────────────────────
// Bash-wrapped inline Python decision table
// ────────────────────────────────────────────────────────────────────────────

/**
 * Invocation line prefix allowed before the interpreter: env assignments
 * (`PYTHONWARNINGS=ignore …`) and `uv run`, then `python`/`python3`/
 * `python3.11` as a whole word.
 */
export const PYTHON_INVOCATION =
	/^(?:[A-Za-z_]\w*=(?:"[^"\n]*"|'[^'\n]*'|[^\s]+)\s+)*(?:uv\s+run\s+)?python3?(?:\.\d+)?(?=\s|$)/;

/**
 * Bash-wrapped inline Python is a python-tool call in disguise: an
 * invocation line that only runs `python[3] [-] <<HEREDOC` or
 * `python[3] -c …` (env assignments and `uv run` allowed). Chained or
 * piped invocation lines are not ours to block, and running an existing
 * script file (`python3 script.py`) stays a bash call. The leading
 * intent-title comment is dropped before judging the line.
 */
export function wrapsInlinePython(command) {
	const source = command.replace(/^(?:\s*#[^\n]*\n)+/, "");
	const invocation = (source.split("\n", 1)[0] ?? "").trim();
	const beforeHeredoc = invocation.split("<<", 1)[0];
	if (containsUnquoted(beforeHeredoc)) return false;
	const invocationMatch = PYTHON_INVOCATION.exec(invocation);
	if (!invocationMatch) return false;
	const args = beforeHeredoc.slice(invocationMatch[0].length).trim().split(/\s+/).filter(Boolean);
	return args.includes("-") || args.includes("-c") || invocation.includes("<<");
}
