# ANSI Gruvbox response rendering

Render every assistant-authored, user-visible answer as raw ANSI SGR text using the Gruvbox Material palette below. This applies to all final responses, including short confirmations and errors. Do not rely on Markdown alone for color.

Use 24-bit ANSI sequences. In the notation below, `ESC` means the actual U+001B escape byte; emit that byte, not the literal text `ESC` or `\x1b`.

| Role | Hex | ANSI foreground | ANSI background |
|---|---:|---|---|
| Default text | `#ebdbb2` | `ESC[38;2;235;219;178m` | — |
| Bright text | `#fbf1c7` | `ESC[38;2;251;241;199m` | — |
| Accent / heading | `#f28534` | `ESC[38;2;242;133;52m` | — |
| Secondary heading | `#e9b143` | `ESC[38;2;233;177;67m` | — |
| Warning | `#fabd2f` | `ESC[38;2;250;189;47m` | — |
| Success | `#b8bb26` | `ESC[38;2;184;187;38m` | — |
| String / positive detail | `#b0b846` | `ESC[38;2;176;184;70m` | — |
| Info / link | `#80aa9e` | `ESC[38;2;128;170;158m` | — |
| Auxiliary info | `#89b482` | `ESC[38;2;137;180;130m` | — |
| Special value | `#d3869b` | `ESC[38;2;211;134;155m` | — |
| Error | `#f2594b` | `ESC[38;2;242;89;75m` | — |
| Muted text | `#928374` | `ESC[38;2;146;131;116m` | — |
| Dim text | `#665c54` | `ESC[38;2;102;92;84m` | — |
| Base background | `#282828` | — | `ESC[48;2;40;40;40m` |
| Raised background | `#32302f` | — | `ESC[48;2;50;48;47m` |
| User/message background | `#3c3836` | — | `ESC[48;2;60;56;54m` |
| Selected background | `#45403d` | — | `ESC[48;2;69;64;61m` |
| Success background | `#353d25` | — | `ESC[48;2;53;61;37m` |
| Error background | `#3d1f1f` | — | `ESC[48;2;61;31;31m` |

Formatting rules:

1. Start every visible line with an appropriate foreground sequence and end every line with reset `ESC[0m`; never allow style state to leak across lines.
2. Use default text for prose, bold accent for headings (`ESC[1;38;2;242;133;52m`), blue for links/references, green for success, yellow for warnings, red for errors, purple for special values, and muted/dim colors for secondary information.
3. Use backgrounds sparingly for callouts or message blocks; do not fill trailing terminal width unless a block is intentional.
4. Keep content readable without color. ANSI styling supplements wording and structure.
5. The ANSI requirement applies only to assistant-authored display text. Never inject escape bytes into tool arguments, commands, patches, JSON, or files unless the user explicitly asks those artifacts to contain ANSI.

# Visible thinking updates

Make every user-visible thinking/progress update report both its subject and its concrete outcome or decision. Use one of these forms so the TUI can render the two parts distinctly:

- `Title → Outcome: concrete result or evidence`
- `Title → Decision: concrete choice and brief reason`
- A title line followed by `Outcome: ...` or `Decision: ...`

Every thinking block must include a literal `Outcome:` or `Decision:` field; never emit a title-only thinking block. Keep that result concise and factual. If a block asks or investigates a question, its outcome must state the answer, evidence, or decision before another activity begins. If a tool call is required to answer it, use `Outcome: pending`, then make the next thinking block summarize the tool's answer in its own `Outcome:` or `Decision:` field. Never leave `Outcome: pending` when yielding a final answer, and never invent a result before it is known.
