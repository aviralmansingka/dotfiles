# quicknote

Capture one fleeting note with no filing decision. Each thought becomes its own note
in `~/vault/0_inbox/fleeting/`, named after the thought and tagged `#fleeting`;
processing stays a later pass.

Two audiences, one binary:

- **Agents and pipes.** `quicknote "text"`, `echo text | quicknote`, `--json`,
  `--tag`, `--at`, `--dry-run`. Never draws, so it is safe in a script.
- **The human.** `quicknote ui` opens a small Charm box; `Enter` saves, `Esc`
  cancels. `quicknote` with no arguments and a terminal opens the same box.

## Processing the queue

Captures are not knowledge yet. `quicknote review` walks the ones that are due and
turns them into atomic notes:

```sh
quicknote review            # the processing pass, newest thought last
```

- `j`/`k` move, `p` promote, `s` snooze 3 days, `S` snooze 14, `d` delete, `o` open
  the capture, `q` quit.
- **Promote** asks for the insight in your own words, writes
  `2_knowledge/<insight>.md` (`tags: [atomic]`, empty `up:`, the capture kept in a
  `> [!CAPTURE]` callout), opens it in `$EDITOR`, then retires the capture.
- **Snooze** writes `review_due:` into the capture's frontmatter; the queue hides
  it until that day.
- **Delete** retires a capture you have already acted on.

The queue is ordered by capture time, oldest first, so nothing rots at the bottom.
`captured:` in the frontmatter is that clock — a snooze rewrite cannot make an old
thought look new.

Rex binds `Cmd+Shift+P` to the same pass in a floating layer cut to 78x16 cells;
the list fills that box, with the footer on its last row.

## What a capture writes

One note per thought, in `~/vault/0_inbox/fleeting/`. The filename is the thought,
kebab-cased and capped at eight words, because the name is identity, not an ID or a
date. The body keeps the words exactly as captured:

```md
---
id: writers-block-is-caused-by-readers-block
aliases: []
tags: [fleeting]
captured: 2026-11-14T20:50:40+05:30
---

> [!FLEETING] Writer's block is caused by reader's block
```

`#fleeting` is the only tag. There is no topic tag to choose and no daily file: one
type tag, no folders. Capturing the same thought twice reports the existing note and
writes nothing; a different thought that lands on the same filename gets a `-2`
sibling.

## The capture box

```sh
quicknote ui                 # the box: type, Enter saves, Esc cancels
quicknote ui --dry-run       # same box, prints the note instead of writing
quicknote ui --render                                 # one frame at the popup's size
quicknote ui --render --width 62 --height 10          # a narrower frame
quicknote ui --render --blurred                       # the unfocused palette
```

A rounded card with the title and count, the `▌` title input, the `#fleeting` chip,
the destination path — previewed live from what you type — and the key hints.

`Tab` adds a second input under the title, and puts the keys in it: that is where
detail goes. `Tab` again swaps back to the title, and so on. The first line of a
piped note is the title and the rest is detail; `--body TEXT` does the same from the
CLI. Capturing a title that already exists appends any new detail to that note
instead of dropping it.

The chip has square ends: `#484c37`, the warm green blended a quarter off the
background, with `#a9b665` as its text. That green also colors the border, the
title, the `▌` bar, and the `→`. The pane paints no background of its own, so
nothing sits at a different value than the pane around it.

## Layout

| File | Role |
|---|---|
| `cmd/quicknote/note.go` | slug, note body, write, duplicate check, JSON result |
| `cmd/quicknote/main.go` | argument parsing, capture path, UI dispatch |
| `cmd/quicknote/ui.go` | bubbletea model, card, tag chips, focus lift |

Build and install with `./scripts/install-quicknote`.

## Rex shortcut

`rex/notes.lua` binds `Cmd+Shift+N` to `capture_note`, which opens `quicknote ui`
in a floating layer with focus. Layer bounds are fractions of the window, so the
action measures the window in cells first and cuts the layer to the card's own
footprint, 64 columns by 11 rows: the popup ends where the card does instead of
leaving a field of empty space around it. The block closes when the box exits,
and the layer goes with it, so the action needs no cleanup.

Try it before the branch lands:

```sh
rex do "$PWD/rex/.config/rex/notes.lua" --action capture_note
```

After the dotfiles change is live, `rex config reload` installs the chord.

## Next step

Spaced repetition: a `review_due` cadence that brings snoozed captures and atomic
notes back on schedule, instead of one fixed 3-day snooze.
