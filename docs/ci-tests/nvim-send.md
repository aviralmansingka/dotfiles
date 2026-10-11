# nvim send orchestration tests

## Purpose

This suite checks the send paths that move text from Neovim to an agent:
target resolution, send order, fallback, and the pending queue. It runs
offline and headless. It starts no herdr or tmux process. Each case loads
the WORKTREE copy of the config, never a stowed `~/.config/nvim` copy.

## Overview (merged PRs)

- PR #220 makes blocked panes valid send targets. A blocked agent still owns
  its pane, so `agent_send` keeps it in the same-tab allow-list. The suite
  sends to a blocked pane and checks the exact pane verbs.
- PR #219 adds the view-focus handoff. `view_focus` releases the local client
  on focus loss and restores it on focus gain. The suite checks the state
  moves and the queue replay.

## What the suite covers

- `agent_send` send order: the resolved pane gets `pane send-text <id>
  <text>`, then `pane send-keys <id> Enter`. An argv recorder checks both
  commands through the real herdr adapter.
- `agent_send` abort paths: a failed `send-text` sends no Enter. A failed
  Enter reports failure. Both errors surface through `vim.notify`.
- `agent_send` fallback: with no same-tab target, the send delegates to the
  caller fallback and returns its boolean, true or false. No pane verb runs.
  The suite never targets a pane in another tab.
- `term_send` chan path: the payload bytes reach the pty job through
  `nvim_chan_send`, with one trailing newline. A stubbed channel checks the
  bytes. A fake Snacks singleton checks the float cwd, the created flag, the
  show and focus calls, and the missing-pty error. Payloads stay raw, with
  no header and a byte cap.
- `view_focus` patches: the Terminal send, submit, and on_ready patches apply
  once. A second setup changes nothing.
- `view_focus` send-on-closed: a closed view routes input to a live sibling
  view, queues it when a saved view exists, or reports the drop. The input
  never vanishes in silence.
- `view_focus` release and resume: the release snapshot keeps the tab, the
  layout, the mode, and a queue copy. The resume drops views for closed tabs,
  keeps views for other tabs, blocks a second attach, and reports a failed
  attach. The pending queue replays exactly once on restore.
- `herdr-agent.lua` mapping table: all four mappings exist, each handler
  wires to the right module, and `<leader>tt` stays visual-only.

## How to run

Run `scripts/test-nvim-send.sh` from the repository root. The script finds
nvim on `PATH`, else in `~/.local/share/bob`. It runs each case with
`nvim --headless -u NONE`. Each case must print `PASS` and exit zero, because
nvim exits zero even when a Lua chunk fails. The three cases also run inside
`scripts/test-nvim-headless.sh` through the `nvim/tests/ci/*_spec.lua` glob.
When nvim is missing, the entry prints `SKIP` and exits zero. Set `STRICT=1`
to make the missing binary a failure.

## Runtime and SLA

The entry finishes in under 150 ms on this host. The SLA is 60 s for the
whole entry and 30 s per case. Every case stays deterministic: stubbed
processes, fake timers, no `vim.wait`, no sleep above 10 ms. Run the entry
twice before you merge. Both runs must show the same result.

## Coverage result

Lua has no c8, so this table is the inventory.

| Module | Covered | Not covered |
|---|---|---|
| herdr/agent_send | `current_pane_id`, `resolve_target`, `send` order, abort, fallback | prompt flow, payload build (owned by `herdr_agent_send_spec`) |
| herdr/term_send | `build_payload`, `resolve_target`, `send`, cwd choice | a real pty write |
| sidekick/view_focus | patches, routing, release, resume, queue replay, wiring | real focus events, TermClose fire, toggle conversion |
| herdr-agent.lua | all mappings, handler wiring | live sidekick fallback body |

## Known gaps

- Real focus-loss events and PTY behavior need a live session. The Tier 2
  script `scripts/test-sidekick-view-focus.lua` owns them. The `TermClose`
  restore guard and the float/split toggle conversion stay there too.
- `prompt_selection` and the payload header belong to
  `nvim/tests/herdr_agent_send_spec.lua`, which another spec owns.
