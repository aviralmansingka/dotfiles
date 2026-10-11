# nvim ask pipeline test suite

## Purpose

This suite tests the sidekick ask and edit inline pipeline. Each case
loads the WORKTREE config, starts no plugin manager, opens no float,
and spawns no `pi` process.

## Overview

The feat-hunk session found three races in the completion callback of
this flow:

- A late FAILED reply removed an entry that already had an answer. The
  user lost the answer. The suite pins this: only a pending entry may
  change state.
- A reply with no data (EOF) made a done entry with no answer, and the
  edit path broke on a nil string join. The suite pins the fail-closed
  rule: no data means an error, and no entry stays pending forever.
- A duplicate reply overwrote a stored answer. The status guard stops
  every late or duplicate callback. Each guard in the `ask/init.lua` fix
  carries a `[fix: feat-hunk completion races]` flag.

## What the suite covers

- `diff.parse`: fenced replies, bare `NOOP`, single-hunk apply,
  multi-hunk reject, malformed `@@` headers, junk lines.
- `state`: anchor table lifecycle, `find_at` line and range boundary
  math with a stubbed extmark reader, anchor drift removal, buffer
  cleanup that kills the `sysobj` process.
- `signs`: anchor and range-bar extmark set and clear pairs, done icons,
  spinner idempotence with a fake timer, `tick` frame advance.
- `init`: ask and edit lifecycle, the three race contracts, `edit_span`
  recompute from live extmarks, `apply_line` writing the drifted span
  exactly once, `reject_line` killing the process, the wipe autocmd.
- `context`: the render functions as pure text; `build` for a visual
  selection, the whole-buffer fallback, and symbols through a faked LSP hover.
- `ui`: `hover_lines` text shapes, the inline preview extmark pair, and
  the no-op safety of the closers.

## How to run

Run `scripts/test-nvim-ask.sh` from the repository root. The script
finds nvim on `PATH`, then at `~/.local/bin/nvim`, then in `bob`. It
runs each case with `nvim --headless -u NONE`. When nvim is missing,
the entry prints SKIP and exits zero. Set `STRICT=1` to make the
missing binary a failure. `scripts/test-nvim-headless.sh` also runs
these cases through its `nvim/tests/ci` glob.

## Runtime and SLA

The entry finishes in under 1 s on this host. The SLA is 60 s for the
entry and 30 s per case. Every case stays deterministic: no network, no
live `pi` spawn, no real spinner timer. The cases stub `cli.spawn`,
`ui.open_prompt`, `vim.uv.new_timer`, and the extmark reader. No case
sleeps.

## Coverage result

Lua has no c8, so this table is the inventory. "Upvalue" means the
suite drives the real private closure.

| Module | Covered | Not covered |
|---|---|---|
| ask/diff | `parse`, all verdicts | — |
| ask/state | all exports, drift, cleanup | — |
| ask/signs | all exports, `tick` + `has_pending` (upvalue) | — |
| ask/init | all 7 exports, `edit_span` (upvalue) | hover timer order |
| ask/context | `build` (3 paths), 3 render fns, `line_numbered` (upvalue) | scope match, live LSP |
| ask/ui | `hover_lines` (upvalue), preview pair, closers | `open_prompt`, `open_hover` |

## Known gaps

- `ui.open_prompt` needs a live float window and insert mode.
- `ui.open_hover` and the `WinLeave` close order need live windows.
- The treesitter scope match needs the `textobjects` query, which does
  not load under `-u NONE`.
- A live LSP client must block for the real hover timeouts.
- `yank_line` content needs a clipboard provider. Headless nvim has
  none, so the case checks the notify only.
