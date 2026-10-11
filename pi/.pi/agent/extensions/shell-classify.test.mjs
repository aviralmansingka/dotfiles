// Core suite for shell-classify.mjs — the shared shell-syntax primitives
// that python.ts, tool-call-renderer-public.ts, and run-command/render.ts
// all delegate to. Table-driven over the shapes that historically drifted
// between the three consumers (issue #242, `786c2d3`): heredoc tag variants
// unified behind one matcher, quote state clean after a heredoc close, and
// operators inside quotes never split. Plain `node`, no jiti.
import assert from "node:assert/strict";
import {
	containsUnquoted,
	createQuoteTracker,
	isHeredocTerminator,
	matchHeredocOpener,
	scanCommandContext,
	scanQuoteClose,
	wrapsInlinePython,
	PYTHON_INVOCATION,
} from "./shell-classify.mjs";

// ────────────────────────────────────────────────────────────────────────────
// Heredoc opener — one matcher, every tag variant the consumers saw
// ────────────────────────────────────────────────────────────────────────────
const openerTable = [
	// [source, offset, expected {tag, quote, length} or undefined, label]
	["cat <<EOF", 4, { tag: "EOF", quote: "", length: 5 }, "unquoted"],
	["cat <<'EOF'", 4, { tag: "EOF", quote: "'", length: 7 }, "single-quoted"],
	['cat <<"EOF"', 4, { tag: "EOF", quote: '"', length: 7 }, "double-quoted"],
	["cat <<-EOF", 4, { tag: "EOF", quote: "", length: 6 }, "dash-prefixed"],
	["cat <<-'EOF'", 4, { tag: "EOF", quote: "'", length: 8 }, "dash-prefixed quoted"],
	["cat << EOF", 4, { tag: "EOF", quote: "", length: 6 }, "space before the tag"],
	["cat <<- 'EOT'", 4, { tag: "EOT", quote: "'", length: 9 }, "dash and space before the tag"],
	["cat <<MY-TAG", 4, { tag: "MY-TAG", quote: "", length: 8 }, "dashed tag"],
	["cat <<_x9", 4, { tag: "_x9", quote: "", length: 5 }, "underscore-leading tag"],
	// The drift classes: never open for these.
	["cat <<< word | wc", 4, undefined, "herestring never opens (renderer drift)"],
	["cat <<3D", 4, undefined, "digit-leading tag never opens (run-command drift)"],
	["cat <<'EOF\"", 4, undefined, "mismatched delimiters never open"],
	["cat <file", 4, undefined, "a single redirect never opens"],
	["cat <<", 4, undefined, "no tag never opens"],
];
for (const [source, offset, expected, label] of openerTable) {
	const match = matchHeredocOpener(source, offset);
	if (expected === undefined) {
		assert.equal(match, undefined, `${label}: no heredoc opens`);
	} else {
		assert.deepEqual(match, expected, `${label}: opener matches`);
	}
}
// The offset slices into the line; matching is anchored at it, not at ^text.
assert.deepEqual(matchHeredocOpener("xx <<EOF", 3), { tag: "EOF", quote: "", length: 5 }, "offset anchors the match");

// ────────────────────────────────────────────────────────────────────────────
// Heredoc terminator — trim-equal, `<<-` tab bodies included
// ────────────────────────────────────────────────────────────────────────────
const terminatorTable = [
	["EOF", true, "exact"],
	["  EOF ", true, "space-padded"],
	["\tEOF", true, "tab-indented (dash-heredoc body)"],
	["EOF2", false, "a different tag"],
	["xEOF", false, "a prefixed line"],
	["E O F", false, "inner spaces"],
];
for (const [line, expected, label] of terminatorTable) {
	assert.equal(isHeredocTerminator("EOF", line), expected, `${label}: terminator check`);
}

// ────────────────────────────────────────────────────────────────────────────
// Quote tracker — the one machine every consumer runs
// ────────────────────────────────────────────────────────────────────────────
{
	const tracker = createQuoteTracker();
	const events = [..."a'b\\'c'd"].map((ch) => tracker.step(ch));
	// a plain, ' open, b literal, \ literal (backslash inside single quotes), ' CLOSES
	// (the backslash cannot escape it), c plain, ' opens again, d literal
	assert.deepEqual(events, ["plain", "open", "literal", "literal", "close", "plain", "open", "literal"], "single-quote walk");
	assert.equal(tracker.state, "'", "the string ends inside the re-opened quote");
}
{
	const tracker = createQuoteTracker();
	const events = [...'a"b\\"c"d'].map((ch) => tracker.step(ch));
	// a plain, " open, b literal, \ escape, " escaped (consumed), c literal, " close, d plain
	assert.deepEqual(events, ["plain", "open", "literal", "escape", "escaped", "literal", "close", "plain"], "double-quote walk with an escaped quote");
	assert.equal(tracker.state, "", "state is clean after the close");
}

// ────────────────────────────────────────────────────────────────────────────
// Command-context scan — operator positions, never inside quotes
// ────────────────────────────────────────────────────────────────────────────
const scanTable = [
	// [text, expected ops, label]
	["a && b || c | d", [["&&", 2], ["||", 7], ["|", 12]], "the three split operators with their positions"],
	[`echo 'a && b' "c || d" | cat`, [["|", 23]], "operators inside quotes never split"],
	[String.raw`echo a\|b \&\& "c\"||d" && done`, [["&&", 24]], "escaped operators never split"],
	["(a && (b || c)) | echo $(x | y) && z", [["|", 16], ["&&", 32]], "parens gate splitting top-level only"],
	["a & b", [], "a single & is backgrounding, never a split"],
	["a ; b", [], "; is domain policy, never a split operator"],
	["cat <<< word | wc", [["|", 13]], "a herestring leaves the pipe splittable"],
];
for (const [text, expected, label] of scanTable) {
	const ops = scanCommandContext(text).events.filter((e) => e.type === "operator").map((e) => [e.op, e.index]);
	assert.deepEqual(ops, expected, `${label}: operator events`);
}
// Quote state carried in: an open quote from a previous line suppresses splits.
{
	const scan = scanCommandContext("x | y", { quote: '"' });
	assert.deepEqual(scan.events, [], "a carried-open quote suppresses splits");
	assert.equal(scan.quote, '"', "the quote stays open");
}
// Paren depth carried in and restored by the closer.
{
	assert.deepEqual(scanCommandContext("a | b", { parenDepth: 1 }).events, [], "carried depth suppresses splits");
	const scan = scanCommandContext(") | b", { parenDepth: 1 });
	assert.deepEqual(scan.events.filter((e) => e.type === "operator"), [{ type: "operator", index: 2, op: "|" }], "the closer restores top-level splitting");
	assert.equal(scan.parenDepth, 0, "depth floors back to zero");
	assert.equal(scanCommandContext("))", { parenDepth: 1 }).parenDepth, 0, "extra closers floor at zero");
}
// Backslash continuations: only a line-final backslash in command context.
{
	assert.equal(scanCommandContext("echo x \\").trailingEscape, true, "a trailing backslash continues the segment");
	assert.equal(scanCommandContext('echo "x \\').trailingEscape, false, "a backslash inside double quotes is not a continuation");
	assert.equal(scanCommandContext("echo 'x \\").trailingEscape, false, "a backslash inside single quotes is literal");
	assert.equal(scanCommandContext("echo x \\\\").trailingEscape, false, "an escaped backslash is not a continuation");
}

// ────────────────────────────────────────────────────────────────────────────
// Heredoc events in the scan
// ────────────────────────────────────────────────────────────────────────────
{
	const scan = scanCommandContext("cat <<EOF && echo x");
	assert.deepEqual(scan.events, [
		{ type: "heredoc", index: 4, tag: "EOF", length: 5 },
		{ type: "operator", index: 10, op: "&&" },
	], "the heredoc opens before the same-line operator splits");
	assert.equal(scan.quote, "", "quote state is clean after an unquoted opener");
}
{
	// The `786c2d3` class: a tag's quotes belong to the opener, never to
	// the string machine — a leaked open quote dimmed every later row.
	for (const opener of ["<<'EOF'", '<<"EOF"', "<<-EOF", "<< EOF"]) {
		const scan = scanCommandContext(`python3 - ${opener}`);
		assert.equal(scan.events.filter((e) => e.type === "heredoc").length, 1, `${opener}: one heredoc event`);
		assert.equal(scan.quote, "", `${opener}: the tag quotes never leak into the quote state`);
	}
}
{
	const scan = scanCommandContext(`echo "a << b"`);
	assert.deepEqual(scan.events, [], "a heredoc opener inside quotes never opens");
}
{
	// Unified rule: openers are not paren-gated (run-command's semantics).
	const scan = scanCommandContext("$(cat <<EOF");
	assert.equal(scan.events.filter((e) => e.type === "heredoc").length, 1, "a heredoc inside a substitution still opens");
}

// ────────────────────────────────────────────────────────────────────────────
// Quote-close scan — the continuation prefix helper
// ────────────────────────────────────────────────────────────────────────────
assert.deepEqual(scanQuoteClose("a'b | c", "'"), { closed: true, closeIndex: 2, quote: "" }, "closes just past the delimiter");
assert.deepEqual(scanQuoteClose('a\\"b" c', '"'), { closed: true, closeIndex: 5, quote: "" }, "an escaped delimiter is skipped, not a close");
assert.deepEqual(scanQuoteClose("abc", "'"), { closed: false, closeIndex: 3, quote: "'" }, "an unclosed quote spans past the line");
assert.deepEqual(scanQuoteClose("a\\", '"'), { closed: false, closeIndex: 2, quote: '"' }, "a trailing escape inside quotes never closes");
assert.deepEqual(scanQuoteClose("a\\b'c", "'"), { closed: true, closeIndex: 4, quote: "" }, "a backslash is literal inside single quotes and never escapes the closer");

// ────────────────────────────────────────────────────────────────────────────
// Unquoted chain chars — the python guard's question
// ────────────────────────────────────────────────────────────────────────────
const chainTable = [
	["echo start; python3 run.py", true, "an unquoted semicolon chains"],
	["echo a | b", true, "an unquoted pipe chains"],
	["echo a & b", true, "an unquoted single ampersand chains"],
	["'a;b'", false, "single quotes hide the chain char"],
	[`"a|b"`, false, "double quotes hide the chain char"],
	[`python3 -c 'import json; print(1)'`, false, "the -c pin: python syntax is not a shell chain"],
	[`python -c "print('a && b')"`, false, "the one-liner pin: quotes hold the chain chars"],
	[`python3 -c "print(\\"a;b\\")"`, false, "unified: an escaped quote no longer desyncs the machine"],
	[String.raw`'a\;b'`, false, "a backslash is literal inside single quotes, the ; stays quoted"],
	[String.raw`a \| b`, false, "an escaped pipe is not a chain"],
	["a.b", true, "custom char sets work", "."],
];
for (const [text, expected, label, chars] of chainTable) {
	assert.equal(containsUnquoted(text, chars), expected, `${label}: unquoted detection`);
}

// ────────────────────────────────────────────────────────────────────────────
// The bash-wrapped-python decision table
// ────────────────────────────────────────────────────────────────────────────
const mustWrap = [
	["quoted heredoc", "python3 - <<'EOF'\nimport os\nprint(os.getcwd())\nEOF"],
	["unquoted heredoc", "python3 - <<EOF\nprint(1)\nEOF"],
	["dash heredoc", "python3 - <<-'EOF'\nprint(1)\nEOF"],
	["uv run heredoc", "uv run python - <<EOF\nprint(1)\nEOF"],
	["env-prefixed heredoc", "PYTHONWARNINGS=ignore python3 - <<EOF\nprint(1)\nEOF"],
	["titled heredoc", "# parse the session log for nested bash calls\npython3 - <<EOF\nprint(1)\nEOF"],
	["versioned heredoc", "python3.11 - <<EOF\nprint(1)\nEOF"],
	["flagged stdin", "python3 -B -u - <<EOF\nprint(1)\nEOF"],
	["one-liner", "python3 -c 'import json; print(json.dumps({}))'"],
	["double-quoted one-liner", `python -c "print('a && b')"`],
	["unified escaped-quote one-liner", `python3 -c "print(\\"a;b\\")"`],
];
for (const [label, command] of mustWrap) {
	assert.equal(wrapsInlinePython(command), true, `${label}: bash-wrapped inline python`);
}
const mustNotWrap = [
	["script file", "python3 scripts/analyze.py --flag"],
	["module run", "python3 -m http.server"],
	["uv-run script file", "uv run python scripts/analyze.py --flag"],
	["uv-run module", "uv run python -m pytest"],
	["chained after cd", "cd /tmp && python3 - <<EOF\nprint(1)\nEOF"],
	["piped stdin", `echo '{"a":1}' | python3 -c 'import json,sys; print(json.load(sys.stdin))'`],
	["plain shell", "grep -rn renderCall dist/core | head -5"],
	["nested in bash -c", "bash -c 'echo start; python3 run.py'"],
	["a heredoc marker inside quotes", "echo 'a << b'; python3 run.py"],
	["non-python heredoc", "cat <<EOF\nnot python\nEOF"],
];
for (const [label, command] of mustNotWrap) {
	assert.equal(wrapsInlinePython(command), false, `${label}: not bash-wrapped inline python`);
}
assert.ok(PYTHON_INVOCATION.test("python3 "), "the invocation pattern matches a whole-word interpreter");
assert.ok(!PYTHON_INVOCATION.test("pythonista x"), "the invocation pattern stays a whole word");

console.log("shell-classify core suite passed");
