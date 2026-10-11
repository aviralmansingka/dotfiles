# nvim headless test suite

## Purpose

This suite runs the Neovim config code with no editor UI. It catches
regressions that parse checks miss. Each case loads the WORKTREE copy of
the config, never a stowed `~/.config/nvim` copy. It starts no plugin
manager, opens no network socket, and runs no live tmux or herdr process.

## What the suite covers

- cwd_picker rows: the suite asserts highlight groups, not only text.
  Non-main rows carry the branch marker in `SidekickBranch`; main rows
  carry no marker and no diff totals.
- cwd_picker helpers: session filter, name precedence, metrics, scrub.
- agent_send: allow-list with `blocked`, same-tab filter, kind choice.
- agent_send: `HERDR_PANE_ID` fallback, visual range, 64 KiB truncation.
- herdr adapter: `agent prompt` verb, raw stdout reads, bounded retry.
- herdr_backend: `native_scroll`, idempotent identity, mark-seen, verbs.
- ask/cli: the `pi` argv contract and the result shape.
- markdown_ansi: SGR parser, atomic rejects, decode/encode round trip.
- obsidian: DST date math on a frozen clock; first-Log heading rule.
- workspace: tab binding, buffer membership, snapshot/restore round trip.
- mermaid_render: the real fence walk and the real width formula.
- config/indent: stance table, untouched filetypes, reload idempotency.
- octo keys: no `group=` entries, all `<leader>O*` present, deletions.
- project patterns: `.git` in, `BUILD.bazel` out.
- python and mason pins: basedpyright in, pyright out.
- go spec: `GOPACKAGESDRIVER` env respect, idempotent post-merge hook.

## How to run

Run `scripts/test-nvim-headless.sh` from the repository root. The script
finds nvim on `PATH`, else in `~/.local/share/bob`. It runs each case
with `nvim --headless -u NONE`. It globs `nvim/tests/ci/*_spec.lua`, so a
new case file runs with no list change. `obsidian_spec` runs twice: once
for `America/New_York` and once for `UTC`, because `os.date` cannot
switch time zones inside one process. Each case must print `PASS` and
exit zero. nvim exits zero even when a lua chunk fails, so the script
also requires the `PASS` mark.

## Runtime and SLA

The whole suite finishes in under 1 s on this host. The SLA is 60 s for
the whole entry and 30 s per case. Every case stays deterministic:
frozen clocks, pinned `TZ`, no `vim.wait`, no sleep above 10 ms. Run the
entry twice before you merge. Both runs must show the same result.

## Coverage result

Lua has no c8, so this table is the inventory. "Part" means the suite
runs the export through a stub boundary or an indirect call.

| Module | Covered | Not covered |
|---|---|---|
| cwd_picker | `list_items`, `open`, scrub, helpers | rename, kill, activate |
| agent_send | all exports (`resolve_target` part) | — |
| herdr adapter | verbs, `read`, `start`, names | `call`, `list_*` (stub) |
| herdr_backend | 8 exports, `init`..`mark_seen` | `apply`, `start` |
| ask/cli | `spawn` | — |
| markdown_ansi | `parse`, `decode`, `encode`, `setup` | — |
| obsidian | all exports | — |
| workspace | all exports | multi-buffer `cycle` |
| mermaid_render | `render_float`, `foldexpr` | `foldtext`, `setup_inline` |
| indent | whole file behavior | — |
| plugin specs | tables under test | `go` opts `root_dir` |

## Known gaps

These surfaces stay out of the fast lane:

- `term_paste_tilde_spec.lua` needs a real PTY. It stays Tier 2.
- `herdr_agent_mapping_spec.lua` needs the installed sidekick.nvim plugin.
- `herdr_term_send_spec.lua` and `lazygit_cwd_spec.lua` run offline, but
  this entry does not own them. Wire them in a later PR.
- The live `verify-nvim` routes need a real desktop session.
- The cwd picker group rows and the preview swap need a live picker UI.
- `mermaid_render.setup_inline` reads `stdpath("config")`, which points
  at the stowed copy under `-u NONE`. A case would test the wrong tree,
  so it stays out.
