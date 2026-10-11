# Sidekick picker actions — CI test suite

## Purpose

This suite guards the picker action lifecycle and the session-resolution
rules. It tests the real `cwd_picker.lua`, `herdr.lua`, and `last_session.lua`
code, and every external process is a recorder. No network, no plugin
bootstrap, and no live herdr starts.

## Overview (merged PRs)

The suite pins the defects that these merged PRs fixed:

- #129: a kill action hit the wrong target. `active_item` now reads the
  workspace-window cursor row when that window owns the focus.
- #130: a rename action sent a terminal id, not an agent name, so herdr
  answered `agent_not_found`. The rename argv now always carries
  `item.agent_name`.
- #135, #138, #141: the session grouping rules. One workspace serves one
  repository. A non-main worktree owns one durable session. The main
  checkout reuses a session only on an exact name match. `ensure_workspace`
  fails closed on an unverifiable inventory.

## What the suite covers

- `activate`: the picker records `last_session`, then toggles the session.
  A done-status item first focuses the agent. A cross-workspace confirm
  focuses the target workspace. A failed focus stops the activate.
- `rename_item`: the argv carries the agent name and never the terminal id.
  A cancelled input and an unchanged slug cause no call. A failed rename
  sends a notification and keeps the picker open.
- `kill_item`: a confirmed kill closes the pane and reports `agent_closed`.
  A declined confirmation and a failed close change nothing.
- `active_item`: the workspace cursor row drives the action when that
  window owns the focus. The picker current item drives it otherwise.
  Heading rows and empty rows cause no action.
- `workspace_groups`: worktrees of one repository share one group. A second
  repository forms its own group. A non-git agent groups by workspace. A
  transient agent joins no group. The current repository sorts first.
- herdr resolution values: `is_durable_agent`, `workspace_for_repository`,
  `agent_for_worktree`, `ensure_workspace`. The suite checks return values,
  not CLI argv. An unverifiable inventory fails closed.
- `M.start` reuse rule: the main checkout reuses an exact-name match. A
  non-main worktree rejects a second durable name. A second name on main
  passes the ownership gate.
- `last_session`: `record` stores a label and a terminal id. `open` toggles
  the recorded pair. An empty record changes nothing. No record makes
  `open` start the cwd picker.

## How to run

Run `scripts/test-nvim-picker.sh` from the repository root. It runs
`nvim/.config/nvim/tests/ci/picker_actions_spec.lua` under
`nvim --headless -u NONE` through the shared harness. Each check prints a
`PASS` mark. A failure prints a traceback and exits non-zero. Set
`STRICT=1` to fail when nvim is missing. The default mode prints `SKIP`.

## Runtime and SLA

The entry runs one nvim process. The whole entry stays under 60 s. The
measured runtime is about 25 ms. A single case has a 30 s timeout.

## Coverage result

Every reachable action closure in `M.open` runs through the real code:
`activate`, `rename_item`, `kill_item`, `active_item`, `rename_active_item`,
`kill_active_item`, `workspace_enter`, and the `confirm` hook. The suite
drives `on_show` and `render_workspace` with the real wiring, and the herdr
resolution functions and `last_session` run at full value coverage.

## Known gaps

These areas stay untested:

- Selector motion and input keys: `toggle_selector`, `move_next`,
  `move_previous`, `clear_input`, `focus_input` need real window focus.
- Preview lifecycle: stale-guard generations, buffer staging, scroll, and
  the spinner timer. The suite reaches only the argv and state seam.
- `on_close` cleanup and reopen scheduling need the real picker teardown.
- `M.get_agent` and adapter argv shapes belong to the adapter spec.
