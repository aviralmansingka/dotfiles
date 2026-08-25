# Tool-call rendering: amp-style command rows in the work-step tree

Goal: stop showing `Running 1 command` + a separate command block; show the
command itself, rendered amp-style, in the tree row. In this revision every
prototype uses Amp's row body — bold green `$`, bold command name, normal
args, truncated to width — plus a starship-style host tag (`⟠ <host>` —
starship's default hostname symbol; `starship.toml` only overrides `[python]`)
and **stacked rows**: consecutive single-command steps merge under one shared
title instead of repeating it. Amp baselines come from a live TUI capture.

Palette is gruvbox-material (pi theme); the amp baseline keeps Amp's own SGR
colors (green `38;5;2`, dim `2m`, italic `3m`) as captured. `ansi` blocks pass
through unhighlighted in pi, so these render as-authored.

---

## Baselines

### Amp — Neo TUI, live capture (`tmux capture-pane`, amp 0.0.1787601851)

Observed: a completed search tool renders as one collapsed line — green `✓`,
a verb phrase, a dim count, and a `▸` expand chevron. A bash call renders as
bold green `$` + the command (name bold, args normal) + `▸`, and it **stays
that way after completion**; the output lands as ordinary assistant text
below. The composer border carries the state (`∼ Thinking` / `∼ Streaming`)
and the cwd/branch.

```ansi
[38;5;2m┃[0m [3m[38;5;2mRun the exact bash command: echo hello-world[0m

[38;5;2m✓[0m Explored [2m1 search[0m ▸[0m

[1m[38;5;2m$ [0m[1m[38;5;2mecho[0m hello-world ▸[0m
```

What Amp gets right: **one line per tool call**, the command itself as the
line body, a recognizable leading glyph, and a chevron that means "details
behind here." What it doesn't do: host/sandbox tagging and stacking — each
call is its own row, forever.

### Codex — item-based transcript (typed, statused items)

Codex (`codex-cli`, Rust/ratatui) renders the conversation as typed transcript
items (`McpToolCallItem`, `FileChangeItem`, `LocalShellAction`…), each with a
status (`in_progress`, `completed`, `failed`, `running`) and a human label
(tool + primary arg). No thinking hierarchy — the transcript is the tree.

```ansi
[38;2;102;92;84m  ~/dotfiles[0m
[38;2;235;219;178m[1mRead dir:[0m[38;2;235;219;178m scripts[0m              [38;2;184;187;38m✓ done[0m
[38;2;235;219;178m[1mBash:[0m[38;2;235;219;178m grep -rn FIXME scripts/[0m  [38;2;184;187;38m✓ 3 files[0m
[38;2;235;219;178m[1mBash:[0m[38;2;235;219;178m go test ./...[0m            [38;2;250;189;47m◌ in progress[0m
[38;2;235;219;178m[1mEdit:[0m[38;2;235;219;178m nvim/plugin.lua[0m          [38;2;242;89;75m✗ failed[0m
```

### Current pi tree (reference) — what we're extending

From `tool-call-renderer.ts`: `▸` title rows (thinking), `◇/◆` diamond summary
rows from `summaryParts()`; `fallbackTitle()` yields `Running 1 command` when
the model writes no text. `renderedGroups()` already merges consecutive
single-step groups into one "singles" block — the stacking seam exists.

```ansi
 [38;2;60;56;54m├─[0m [38;2;146;131;116m▸[0m [38;2;235;219;178m[1mRunning 1 command[0m
 [38;2;60;56;54m│  └─[0m [38;2;184;187;38m◆[0m [38;2;235;219;178m[1m1 command[0m[38;2;146;131;116m · [0m[38;2;184;187;38m[1mcompleted[0m

 [38;2;60;56;54m├─[0m [38;2;146;131;116m▸[0m [38;2;235;219;178m[1mRunning 1 command[0m
 [38;2;60;56;54m│  └─[0m [38;2;184;187;38m◆[0m [38;2;235;219;178m[1m1 command[0m[38;2;146;131;116m · [0m[38;2;184;187;38m[1mcompleted[0m
```

---

## Prototypes

All three: amp-style `$ command` row bodies, starship host symbol `⟠` (same
glyph everywhere; value varies — `⟠ homelab`, `⟠ orb`, `⟠ devbox`), and
consecutive single-bash steps stacking under one title as new calls stream in.

### P1 — Amp-style `$ command` rows under a merged title

The direct port of Amp's proven line: each single-bash step is one row —
diamond glyph, bold green `$`, the command itself (name bold, truncated to
width), then the status part. Consecutive singles stack under a shared title
carrying the count and the host tag. Only `summaryParts`' bash branch changes:
instead of `1 command` it emits the command line; the merged title rides the
existing `singles` merge in `renderedGroups()`.

```ansi
 [38;2;60;56;54m├─[0m [38;2;146;131;116m▸[0m [38;2;235;219;178m[1m3 commands[0m[38;2;146;131;116m · [0m[38;2;128;170;158m⟠ homelab[0m
 [38;2;60;56;54m│  ├─[0m [38;2;184;187;38m◆[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgrep[0m[38;2;235;219;178m -rn FIXME scripts/[0m[38;2;146;131;116m · [0m[38;2;184;187;38m[1mcompleted[0m
 [38;2;60;56;54m│  ├─[0m [38;2;184;187;38m◆[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgit[0m[38;2;235;219;178m status --short[0m[38;2;146;131;116m · [0m[38;2;184;187;38m[1mcompleted[0m
 [38;2;60;56;54m│  └─[0m [38;2;250;189;47m◇[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgo[0m[38;2;235;219;178m test ./...[0m[38;2;146;131;116m · [0m[38;2;250;189;47m[1mrunning[0m
```

### P2 — Command as the title (no announcement at all)

When the title is auto-derived (not `titleLocked`) and the step is a single
bash call, the command line itself becomes the step title and the diamond row
demotes to status-only. `Running 1 command` disappears entirely. Touches
`fallbackTitle()` call sites; must respect `titleLocked` and session restore.

```ansi
 [38;2;60;56;54m├─[0m [38;2;146;131;116m▸[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgrep[0m[38;2;235;219;178m -rn FIXME scripts/[0m[38;2;146;131;116m · [0m[38;2;128;170;158m⟠ homelab[0m
 [38;2;60;56;54m│  └─[0m [38;2;184;187;38m◆[0m [38;2;184;187;38m[1mcompleted[0m

 [38;2;60;56;54m├─[0m [38;2;146;131;116m▸[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgo[0m[38;2;235;219;178m test ./...[0m[38;2;146;131;116m · [0m[38;2;128;170;158m⟠ homelab[0m
 [38;2;60;56;54m│  └─[0m [38;2;250;189;47m◇[0m [38;2;250;189;47m[1mrunning[0m
```

### P3 — Amp-style rows + lifecycle status

P1's command rows with Amp's explicit lifecycle on the status part — a timed
`running 0.8s` while pending (the `ClockInvalidationScheduler` already ticks
running components), `completed` / `failed` when settled. No title or row-body
change beyond P1; purely additive to the status segment.

```ansi
 [38;2;60;56;54m├─[0m [38;2;146;131;116m▸[0m [38;2;235;219;178m[1m2 commands[0m[38;2;146;131;116m · [0m[38;2;128;170;158m⟠ homelab[0m
 [38;2;60;56;54m│  ├─[0m [38;2;184;187;38m◆[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgrep[0m[38;2;235;219;178m -rn FIXME scripts/[0m[38;2;146;131;116m · [0m[38;2;184;187;38m[1mcompleted[0m
 [38;2;60;56;54m│  └─[0m [38;2;250;189;47m◇[0m [38;2;184;187;38m[1m$ [0m[38;2;235;219;178m[1mgo[0m[38;2;235;219;178m test ./...[0m[38;2;146;131;116m · [0m[38;2;250;189;47m[1mrunning 0.8s[0m
```

---

## Ranking (by cohesion with the existing tree)

1. **P1 — Amp-style `$ command` rows.** Only the bash branch of
   `summaryParts()` changes; glyphs, rails, title, and status parts stay;
   stacking rides the existing `singles` merge. Ship first.
2. **P3 — Lifecycle status.** Additive on top of P1, but re-enters the timing
   path (`scheduler`, elapsed formatting) that currently only runs for
   connected subagents — more surface. Use once P1 lands.
3. **P2 — Command as title.** Cleanest end state, but the title is the tree's
   identity and `titleLocked` + restored-session logic make it the riskiest
   change. Do last.

Recommended path: **P1 → P3 → P2**. The earlier verb-phrase summarizer
(`_summarize_command` port) is dropped — showing the command amp-style is
simpler and more honest. Host tagging is orthogonal: add `⟠ <host>` wherever
the title is composed once `tool-call-renderer.ts` knows the execution
context (local vs orb vs devbox); the symbol never changes, only the value.
Amp's `▸` expander maps to pi's existing `ctrl+e` expansion, so no chevron is
needed on the rows.
