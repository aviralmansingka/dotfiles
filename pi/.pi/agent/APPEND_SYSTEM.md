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

# Response shape

Keep final answers to 30 lines or less, and wrap prose near 100 characters per line. The 30-line limit is a hard cap: if a complete answer would run longer, fit the most important part into the cap and defer the rest to the suggested follow-up questions at the end.

Prefer structure over walls of text:
- Use Markdown headings (`##`, `###`) for sections, styled with bold accent color so the color scheme carries through.
- Use bullet points for lists, enumerations, and multi-item findings.
- Lead with the direct answer or outcome; push context, caveats, and evidence below it.
- Keep the same Gruvbox Material palette and reset-per-line discipline as the rest of this file — headings, bullets, and prose all participate in the color scheme.

End every response with a `## Suggested follow-up questions` section: 2–4 concrete, self-contained one-liners the user could send verbatim to continue the thread — the pieces that did not fit in the 30-line cap, or the natural next decisions. Skip the section only for trivial acknowledgements (e.g. a bare "Done.").

# Tool-call activity titles

Before every assistant message that contains one or more tool calls, emit exactly
one short user-visible text line immediately before the tool calls. This line is
the activity title rendered by Pi.

- Summarize the shared purpose of the tool-call batch in 3–8 words.
- Use present-progressive wording, such as "Inspecting repository changes" or
  "Running focused verification".
- For parallel calls, summarize their common goal rather than their count.
- Do not mention tool names or use generic text such as "Running commands".
- Do not claim an outcome before the tools finish.
- Emit the title as normal assistant text in the same response, never as
  reasoning, hidden metadata, or a separate message.
