# nvim workspaces and scrollback suite

## Purpose

This suite pins the workspace tab cluster of the Neovim config. It covers
`plugins/herdr/workspaces.lua`, the `herdr-workspaces` wiring, and
`helpers/herdr_scrollback.lua`. This code closes tabs and writes capture
files. A regression here destroys user state. The suite runs offline. It
stubs `herdr.call`, `herdr.git_context`, and the `helpers.markdown_ansi`
require, and drives real tabpages and buffers in a headless instance.

## Overview (merged PRs)

- #133, tab snapshot: `snapshot` orders workspaces by tab number, then by
  list position. `reconcile` refreshes labels and the flag state.
- #135, cross-worktree cleanup: `close_tabs` closes only tabs of the owning
  worktree; a sibling worktree of the same repository keeps its tab.
  `agent_closed` closes a workspace only when it is empty and listed.
- #127, pane-list shapes: `snapshot` reads the workspace cwd from the first
  pane. An invalid list shape fails the snapshot and reports the command.

## What the suite covers

- snapshot: ordering, shape checks, first-pane cwd, failure reports.
- reconcile: label refresh, flag transitions, one warning per failure.
- bind_tab and unbind: create, reuse, rebind, no-cwd warning, no dangling
  tab vars.
- close_tabs: cross-worktree safety, non-git match, nil-cwd fallback.
- agent_closed: live-agent early return, foreground precedence, quiet
  missing close, empty-workspace close.
- pickers: create, rename, and close argv and state; items, markers,
  `focus`, wiring, keymap, TabEnter hook.
- scrollback document: ansi fences, tree rows, fence growth, SGR removal.
- scrollback paths: captures directory, identity hash stability, rejects.
- scrollback save and load: round trip, refusals, bang overwrite, window
  layout, setup hooks, render guard.

## How to run

Run `scripts/test-nvim-workspaces.sh` from the repository root. The script
runs `nvim/tests/ci/workspaces_spec.lua` with `nvim --headless -u NONE`.
It finds nvim on `PATH`, else in `~/.local/share/bob`. Each check prints
`PASS`. The script exits non-zero when a check fails or a `PASS` mark is
missing. Set `STRICT=1` to turn a missing nvim binary into a failure. The
shared suite `scripts/test-nvim-headless.sh` also runs this spec.

## Runtime and SLA

The entry finishes in about 70 ms on this host. The SLA is 60 s for the
entry and 30 s for the case. Every check stays deterministic: canned herdr
responses, fixed fixtures, no `vim.wait`, no sleep above 10 ms. Run the
entry twice before you merge; both runs must show the same result.

## Coverage result

Lua has no c8, so this table is the inventory. "Part" means the suite runs
the export through a stub boundary or an indirect call.

| Module | Covered | Not covered |
|---|---|---|
| herdr/workspaces | `focus`, `agent_closed`, `open` (part), `setup` | live picker pixels, TabEnter firing |
| herdr-workspaces wiring | spec table, `init`, keymap | — |
| herdr_scrollback | `document`, `directory`, `path`, `save`, `load`, `setup`, `render` (guard) | live `render` capture |

The suite also runs every local function of `herdr/workspaces.lua` through
the harness upvalue path: `snapshot`, `reconcile`, `focus_tab`, `bind_tab`,
`unbind`, `unbind_tabs`, `close_tabs`, `cwd_matches_target`,
`resolve_cwd_target`, `disposable_unbound_tab`, and the three picker
actions with `picker_items` and `format_item`.

## Known gaps

- `render` needs a live Herdr environment and a live pane read. Only its
  environment guard runs.
- The Snacks picker pixels and layout stay untested. The suite pins the
  argv and state seam only.
- `helpers.markdown_ansi` is require-stubbed. Its own spec owns that code.
- `tab_get` in `herdr/workspaces.lua` reads a `false` tab var as unset. The
  module treats both states as falsy for its flags, so the behavior stays
  consistent. No fix was made.
