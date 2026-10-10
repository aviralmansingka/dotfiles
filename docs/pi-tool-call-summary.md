# Pi tool-call summary titles (bash + python + mcpScript)

Status: implemented for bash, python, and mcpScript. Branch `feat/bash-summary`
(mcpScript lift: `feat/mcpscript-rendering`),
rebased on `main` `1846f04`. Rendering lives in
`pi/.pi/agent/extensions/tool-call-renderer-public.ts`; the prompt rule
lives in `pi/.pi/agent/APPEND_SYSTEM.md`. Powershell is out of scope:
session history shows zero powershell calls, so it keeps today's rows.

## Goal

Every `bash` and `python` call row carries a 10–15 word intent title next to
the tool name. The title is always visible, collapsed or expanded, and never
displaces the raw command leaf.

```text
today     ◇ bash $ grep -rn "renderCall" dist/core/tools | head -5
proposed  ◇ bash — find renderCall hooks in core tool sources
          └─ $ grep -rn "renderCall" dist/core/tools | head -5
proposed  ◇ python — parse session log for nested bash calls
          └─ $ rows = [json.loads(l) for l in open(...)]
proposed  ◇ mcpScript — fan out workspace searches and filter failures
          └─ $ const settled = await Promise.allSettled(calls)
```

## Scope: bash, python, and mcpScript

Powershell stays out: session history shows zero powershell calls across
all sessions (32 distinct tools used, ~29,900 bash calls), and
`commandBodies` gates the lift on `tool === "bash"`. mcpScript joins via
`jsBodies`: its `code` arg is JavaScript source, so the same comment-lift
model applies with `//` instead of `#`.

## Title source — decision

Chosen: **model-authored leading comment**. `APPEND_SYSTEM.md` gains a rule:
every `bash` command and `python` script starts with one `# <intent>`
comment line — verb-first, 10–15 words, no trailing period, before any code.

Why it wins:

- Zero latency and zero per-call cost; no async state in the renderer.
- Survives reloads and branch switches: the title lives in the stored
  `command`/`code` args, and `renderCall` redraws from args.
- Best intent quality: the session model knows *why* it runs the command,
  which no post-hoc summarizer can recover from the string alone.

Fallback (implemented): the comment title from the original tool message
stays primary; the harness backfills only when a LIVE row renders without
one — for bash, python, and mcpScript rows alike (`requestTitle` is
tool-agnostic; the mcpScript branch just passes `args.code`). The render
path (argsComplete, not restored) fires exactly one
`ctx.modelRegistry.complete()` request at the session model — system prompt
demands ONLY a verb-first 10–15 word title — deduped per toolCallId with a
pending set. The answer lands in `generatedTitles`, invalidates the row,
and the redraw shows `— <title>`. `tool_result` persists it into the stored
details as `intentTitle`, and `renderResult` seeds the map from stored
details, so reloaded sessions restore titles with no new requests; rows
that predate the feature keep their dim one-line preview. The old
objections are answered: async state is a plain map, racing a fast command
only means the title lands after the result, and reload re-summarizes
never.

## Rendering changes (`tool-call-renderer-public.ts`)

- `commandBodies(theme, toolCallId, tool, command)`: lift a leading `#`
  comment from the *first shell segment only* — the scanner already parses
  quoted/heredoc boundaries, so a `#` inside a heredoc body stays body, not
  title. First non-comment line becomes the `$` leaf, as today.
- `pythonBodies(theme, toolCallId, code)`: lift leading `#` comment lines the
  same way; first code line stays the leaf.
- `jsBodies(theme, toolCallId, code)`: mcpScript mirror of `pythonBodies` —
  `liftLeadingJsComment` lifts the first `//` comment before any code and
  skips `// @options:` directive lines (both title-first and
  @options-first orders work); first code line is the `$` leaf, the rest
  ride the `│` spine, highlighted with the `javascript` grammar (the same
  grammar pi's codemode renderer uses).
- Both caches carry the lifted title beside the existing rows.
- Row header: ` ${glyph} ${name} ${dim —} ${dim title}` in the
  `bash/powershell/python` branch. A titled call never inlines the
  command into the title row: single and multi commands alike render a
  bare header, then railed `$` leaf rows. The inline `name $ command` form
  survives only for title-less single commands.
  Title truncates to remaining width; the full comment still shows in the
  expanded spine.
- Multi-command rows: the title rides the name line; leaf/spine rows are
  unchanged.
- `statusBanner`, `expandedOutput`, and the exit summary are untouched.

## Ctrl+Q command-visibility toggle

`registerShortcut("ctrl+q")` in the same extension toggles
`commandsHidden` (process state, starts `true` every launch). Hidden rows
keep the `— title` header; a title-less call keeps a dim one-line `$ `
preview so the row stays identifiable. The toggles are orthogonal:
`Ctrl+O` expands output only and never reveals a hidden command body;
`Ctrl+Q` hides the command body in collapsed and expanded views alike.
The handler invalidates every mounted row, so the transcript flips in
place, and `ctx.ui.notify()` confirms the state.
No editor clash: `ctrl+e` keeps move-to-line-end. The user runs
AeroSpace, so alt-based shortcuts are out, and ctrl+q is the one
unbound ctrl letter.

## Prompt rule (`APPEND_SYSTEM.md`)

One section, Simplified Technical English at the panel's 100% standard:
format spec (`# verb-first intent, 10–15 words, first line, before code`),
scope (bash, python, and mcpScript; `//` for mcpScript with `@options`
after the title), and the no-trailing-period rule. It sits after the
turn-title rules so one mental model covers both.

## Tests

- `tool-call-renderer-public.test.mjs`: title lift for bash, python, and
  mcpScript (`//` lift, `@options` skip in both orders, late `//` stays
  body, comment-only script renders the title as the whole row); leaf
  skips the comment; heredoc `#` stays body; overlong titles truncate with
  `…`; comment-less fallback renders today's row. All green.
- mcpScript keeps downstream delegation for expanded result bodies: only
  the call row is ours.
- `python.test.mjs` unchanged and green: tool behavior is untouched.

## Out of scope

- Powershell title parity (`commandBodies` lifts for bash only).
- Titles on non-output tools (read, edit, write).
- mcpScript result-body framing: the collapsed summary and expanded body
  stay generic; only the call row and its title changed.

## Risks

- The model may omit the comment: the no-title fallback keeps rows readable.
  Track misses before considering the summarizer.
- 10–15 words can exceed narrow pane widths: truncate to width, keep the
  full text in the expanded view.
- A leading `#` changes the executed bash text: harmless as a comment, but
  `!!` dim commands and short pipelines gain one line. Comment-only python
  scripts pass the `code.trim()` guard and run as no-ops; the renderer shows
  their title as the whole row.
- The live `~/.pi/agent/APPEND_SYSTEM.md` symlink points at the `main`
  checkout, so live sessions see the prompt rule only after this branch
  merges.
