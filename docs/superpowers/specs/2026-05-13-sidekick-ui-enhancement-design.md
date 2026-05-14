# Sidekick UI Enhancement — Design

**Date:** 2026-05-13
**Status:** Approved for implementation
**Scope:** Personal nvim configuration in `~/dotfiles`. Not an upstream `sidekick.nvim` patch.

## Problem

Today every sidekick CLI float looks identical: rounded border, neutral color, the literal title `" Sidekick "`. There is no in-float signal of *which* agent or *which* session you are in. The only session-identifying surface is tmux's `pane-border-status top`, which is rendered inside the tmux pane and lives in `tmux/.tmux.conf:137-142`.

Three concrete gaps:

1. **No per-tool visual identity.** Claude, Codex, Cursor, and Opencode floats are visually indistinguishable. Eye has to read the prompt to know which agent is running.
2. **Session context isn't shown inside nvim.** The session name lives only in the tmux pane border (which is awkward — it competes with the agent's own UI for the top row) and the picker label. The git branch the session was cut from isn't tracked at all.
3. **Selecting a session can land you on the wrong branch.** `<leader>al` / `<leader>as` reopen a session whose tmux cwd is preserved, but the working tree might have moved on since. The user has to manually `git checkout <branch>` and remember which one.

## Decisions

| Axis | Choice | Rationale |
|---|---|---|
| Per-tool colors | Brand-inspired palette: claude=#E07856, codex=#10A37F, cursor=#B19CD9, opencode=#E0AF68 | Each color evokes the agent's own brand; high enough contrast against gruvbox `bg` |
| Integration point | `Config.cli.win.config` hook (Approach A) | Already used for border style; sidekick calls it on every terminal init; no patching of `sidekick.cli.terminal` |
| Border rendering | List-of-pairs form (`{{char, hl}, ...}`) with per-tool highlight groups `SidekickBorder<Tool>` and `SidekickTitle<Tool>` | nvim native; survives `:colorscheme` swap if highlights are reapplied on `ColorScheme` autocmd |
| Title format | ` <session> · <branch> ` centered, colored | `·` is unambiguous; matches the picker preview the user approved |
| Branch storage | Tmux session env var `SIDEKICK_BRANCH`, set at spawn time | Survives nvim restart; scoped to the pane; readable via `tmux show-environment -t <session>`; matches the existing `SIDEKICK_NAMED_SESSION` pattern |
| Branch tracking scope | All sessions (named + default per-tool toggles) | Uniform; selecting any session does the same right thing |
| Abort conditions | Dirty working tree, mid-rebase/merge, recorded branch doesn't exist | Confirmed by user; preserves in-progress work and never silently lands on the wrong branch |
| Non-git cwd handling | If `SIDEKICK_BRANCH` is unset for that session, skip checkout silently | Lets `<leader>ag` in `/tmp` still work; only sessions that captured a branch attempt restore |
| Tmux pane-border-status | Remove `tmux/.tmux.conf:137-142` entirely | Replaced by the nvim float title; no need to render the same info twice |
| Resume picker (`<leader>ar`) | Out of scope — no recorded branch in claude jsonl | Could be added later if we instrument session creation to write branch into the jsonl |

## Architecture

Two new modules under `nvim/.config/nvim/lua/plugins/sidekick/`, three existing files edited, plus the tmux cleanup. Existing module responsibilities are preserved.

```
nvim/.config/nvim/lua/plugins/sidekick.lua          (edit: wire win.config hook, route keymaps through branch wrapper)
nvim/.config/nvim/lua/plugins/sidekick/branding.lua (new: colors, hl groups, border + title builder)
nvim/.config/nvim/lua/plugins/sidekick/branch.lua   (new: capture, restore, validate, abort)
nvim/.config/nvim/lua/plugins/sidekick/internal.lua (edit: inject SIDEKICK_BRANCH into spawn env)
nvim/.config/nvim/lua/plugins/sidekick/picker.lua   (edit: show branch in picker line; route confirm through branch wrapper)
nvim/.config/nvim/lua/plugins/sidekick/float_toggle.lua (edit: rebuild colored border when split→float)
tmux/.tmux.conf                                     (edit: remove pane-border-status block)
```

## Components

### `branding.lua` (new)

Pure module. No side effects on require.

```lua
M.colors = {
  claude   = "#E07856", -- terracotta
  codex    = "#10A37F", -- openai green
  cursor   = "#B19CD9", -- soft violet
  opencode = "#E0AF68", -- amber
}

M.fallback_color = "#7C7C7C" -- neutral grey for unknown tools

M.tool_of(label)        -- "claude-tutorial" -> "claude"; "claude" -> "claude"
M.color_of(label)       -- label -> hex string
M.hl_groups(tool)       -- returns { border = "SidekickBorderClaude", title = "SidekickTitleClaude" }
M.ensure_highlights()   -- idempotent; defines all hl groups; safe to call repeatedly
M.border_spec(tool)     -- {{char, hl}, ...} 8-element list using rounded glyphs + tool border hl
M.title_spec(tool, session_name, branch)
                        -- {{ " <session> · <branch> ", "SidekickTitleClaude" }}; branch optional
M.apply(term)           -- mutates term.opts.float.border, .title, .title_pos for this terminal
```

Tool inference (`tool_of`): walk `internal.tool_commands` keys, find the longest prefix of `label` that matches `<tool>` or `<tool>-`. Falls back to `nil` → fallback grey.

Highlight setup runs at plugin `config` time and re-runs on `ColorScheme` autocmd. Each tool gets:
- `SidekickBorder<Tool>` — `fg = color`, transparent bg (so it inherits float bg)
- `SidekickTitle<Tool>` — `fg = color`, `bold = true`

### `branch.lua` (new)

Pure functions for git ops + tmux env reads. Notifications happen at the caller (the wrapper in `internal.lua`).

```lua
M.current(cwd)          -- string|nil; nil if cwd is not a git repo
M.read_session(session_id)
                        -- string|nil; reads SIDEKICK_BRANCH from `tmux show-environment -t <sid>`; nil if unset
M.write_session(session_id, branch)
                        -- `tmux set-environment -t <sid> SIDEKICK_BRANCH <branch>`; no-op if branch is nil

-- Returns { ok = true } | { ok = false, reason = "<code>", detail = "..." }
-- reason codes: "dirty", "rebase", "merge", "missing_branch", "not_a_repo"
M.can_switch(cwd, branch)

-- Performs the checkout if can_switch passes. Same return shape.
M.switch(cwd, branch)
```

`can_switch` checks (cheap, no checkout):
1. `cwd` exists and contains `.git` (or `git rev-parse --git-dir` succeeds) → else `not_a_repo`
2. `.git/MERGE_HEAD` exists → `merge`
3. `.git/rebase-apply/` or `.git/rebase-merge/` exists → `rebase`
4. `git rev-parse --verify <branch>` fails → `missing_branch`
5. `git diff --quiet` AND `git diff --cached --quiet` — if either has output → `dirty` (record file count via `git status --porcelain | wc -l`)
6. Else `ok = true`

`switch` runs `can_switch`, then `git -C <cwd> checkout <branch>` on success.

### `internal.lua` (edit)

Two changes:

1. **Spawn-time branch capture.** `start_named_session` and a new `toggle_tool_session_with_capture(name)` helper compute the branch from the spawn cwd, then schedule a `vim.defer_fn` poll that calls `tmux set-environment -t <session_id> SIDEKICK_BRANCH <branch>` once the tmux session exists. The poll runs every 100ms, retries up to 20 times (~2s cap), and exits as soon as `tmux has-session -t <name>` succeeds. On final failure: DEBUG notify, no abort — branch is best-effort metadata, the agent still opens.

   Why `set-environment` (session-level) rather than passing `env` into the spawn (pane-level): `tmux show-environment -t <sid>` reads back the session env namespace, not pane env. Centralizing on session env means one read API (`show-environment`) is used everywhere.

2. **Branch-aware toggle wrapper.** New `open_session_with_branch(name, opts)`:
   - Looks up the session_id for `name` via the existing registry discovery
   - If the session already exists: reads `SIDEKICK_BRANCH`, validates with `branch.can_switch`, runs `branch.switch` on success or notifies + aborts on failure
   - If the session does not exist: captures branch at spawn, no checkout needed
   - On success, calls `toggle_tool_session(name, focus)` as before

### `picker.lua` (edit)

- `list_items()` reads `SIDEKICK_BRANCH` for each discovered entry, stores it on the item, and formats the text as `[tool] label · <branch>  <cwd>` (branch column dropped if unset).
- `confirm` routes through `internal.open_session_with_branch(item.label, { focus = true })` instead of `toggle_tool_session` directly.

### `float_toggle.lua` (edit)

When converting split→float (the `is_split` branch in `M.toggle`):

- Look up the terminal via `vim.w[win].sidekick_session_id`
- Call `branding.apply(term)` to refresh border + title (in case theme changed mid-session)
- Pass the colored `border` and `title` table directly into `nvim_win_set_config`

This keeps the float-toggle path consistent with the win.config hook used at initial open.

### `sidekick.lua` (edit)

```lua
opts = {
  cli = {
    win = {
      config = function(terminal)
        require("plugins.sidekick.branding").apply(terminal)
      end,
      ...
    },
    ...
  },
},
config = function(_, opts)
  require("plugins.sidekick.branding").ensure_highlights()
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = vim.api.nvim_create_augroup("plugins.sidekick.branding", { clear = true }),
    callback = function()
      require("plugins.sidekick.branding").ensure_highlights()
    end,
  })
  ... -- rest unchanged
end,
```

Keymaps `<leader>ac`, `<leader>au`, `<leader>ag`, `<leader>ao`, `<c-;>` all route through the new branch-aware wrapper (the wrapper handles "session doesn't exist yet" too, so no extra branching at the call site).

`<leader>as` (sidekick's built-in select) — the existing `cb` callback already calls `attach`; before calling `attach`, look up the session's branch and run the same validate/switch/abort flow. If abort, return without attaching.

### `tmux/.tmux.conf` (edit)

Delete lines 136–142 (the sidekick-specific `set-titles`/`pane-border-status` block and the catch-up `run-shell`). The float's nvim title replaces this surface entirely.

## Failure modes & notifications

All notifications use `vim.notify` with appropriate levels.

| Trigger | Level | Message |
|---|---|---|
| Dirty working tree | WARN | `Sidekick: <name>: working tree dirty (<N> files), aborting checkout to <branch>` |
| Mid-rebase | WARN | `Sidekick: <name>: rebase in progress, aborting checkout to <branch>` |
| Mid-merge | WARN | `Sidekick: <name>: merge in progress, aborting checkout to <branch>` |
| Missing branch | WARN | `Sidekick: <name>: branch '<branch>' no longer exists, aborting open` |
| Tmux not available for env read | DEBUG (silent unless `:messages`) | `Sidekick: tmux show-environment failed: <stderr>` |
| Branch capture failed at spawn | DEBUG | `Sidekick: failed to record branch for <name>: <err>` (does not abort spawn — branch is best-effort) |

Abort = early `return` before `toggle_tool_session`, so the agent window is never opened on the wrong branch.

## Open questions

None. Resume picker branch support is explicitly deferred.

## Testing strategy

Each implementation task is validated against a running nvim session via the `neovim-debugger` agent:

1. Reload the affected module(s) (`:Lazy reload sidekick.nvim` or `:lua package.loaded["plugins.sidekick.branding"]=nil`).
2. Exercise the change (e.g., toggle a claude session, open the picker).
3. Capture evidence: `:messages` tail, the float's actual border highlight (`:lua =vim.api.nvim_win_get_config(<win>)`), or the picker item text.
4. Verdict: clean / warnings / failed.

No automated test suite — this is interactive UI configuration.
