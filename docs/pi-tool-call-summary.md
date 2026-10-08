# Pi tool-call summary titles (bash + python)

Status: implemented for bash and python. Branch `feat/bash-summary`,
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
proposed  ◇ bash — find renderCall hooks in core tool sources · $ grep -rn "renderCall" dist/core/tools | head -5
proposed  ◇ python — parse session log for nested bash calls · $ rows = [json.loads(l) for l in open(...)]
```

## Scope: bash and python

Powershell stays out: session history shows zero powershell calls across
all sessions (32 distinct tools used, ~29,900 bash calls), and
`commandBodies` gates the lift on `tool === "bash"`.

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

Fallback: comment-less calls render exactly as today (no title). If model
compliance proves poor, revisit a cheap `ctx.modelRegistry.streamSimple()`
summarizer on the `tool_call` event — rejected for now because it needs
async state keyed by toolCallId, races fast commands, and re-summarizes on
reload.

## Rendering changes (`tool-call-renderer-public.ts`)

- `commandBodies(theme, toolCallId, tool, command)`: lift a leading `#`
  comment from the *first shell segment only* — the scanner already parses
  quoted/heredoc boundaries, so a `#` inside a heredoc body stays body, not
  title. First non-comment line becomes the `$` leaf, as today.
- `pythonBodies(theme, toolCallId, code)`: lift leading `#` comment lines the
  same way; first code line stays the leaf.
- Both caches carry the lifted title beside the existing rows.
- Row header: ` ${glyph} ${name} ${dim —} ${dim title}` in the
  `bash/powershell/python` branch, before the inline `$ leaf` and `elapsed`.
  Title truncates to remaining width; the full comment still shows in the
  expanded spine.
- Multi-command rows: the title rides the name line; leaf/spine rows are
  unchanged.
- `statusBanner`, `expandedOutput`, and the exit summary are untouched.

## Prompt rule (`APPEND_SYSTEM.md`)

One new section, Simplified Technical English at the panel's 100% standard:
format spec (`# verb-first intent, 10–15 words, first line, before code`),
scope (bash and python only), and the no-trailing-period rule. It sits
after the turn-title rules so one mental model covers both.

## Tests

- `tool-call-renderer-public.test.mjs`: title lift for bash and python; leaf
  skips the comment; heredoc `#` stays body; comment-only call renders the
  title as the whole row; overlong titles truncate with `…`; comment-less
  fallback renders today's row. All green.
- `python.test.mjs` unchanged and green: tool behavior is untouched.

## Out of scope

- Powershell title parity (`commandBodies` lifts for bash only).
- Titles on non-output tools (read, edit, write).
- The summarizer-model fallback.

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
