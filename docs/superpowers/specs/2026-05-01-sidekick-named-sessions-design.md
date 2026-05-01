# Sidekick Named Sessions — Design

**Date:** 2026-05-01
**Status:** Approved for implementation planning
**Scope:** Personal nvim configuration in `~/dotfiles`. Not an upstream `sidekick.nvim` patch.

## Problem

`nvim/.config/nvim/lua/plugins/sidekick.lua` already lets the user spawn named CLI-tool sessions (`claude-tutorial`, `claude-sidekick`, etc.) via `<leader>an`. Each named session is a distinct tool registered in `Config.cli.tools` at runtime, and each runs in its own tmux session.

Three pain points:

1. **Labels don't persist across nvim restarts.** The tmux session lives on, but the `Config.cli.tools["claude-foo"]` registration is lost. After restart, `<leader>as` no longer shows the session by its label — it shows up as a generic `claude` session at some cwd.
2. **No fast list/jump UX.** Beyond the generic `<leader>as` selector (which mixes registered tools with running sessions), there is no dedicated way to see "all my named sessions" or to jump to one by label.
3. **No cross-session search.** No way to grep across the scrollback of every named session at once — common need when remembering "which session was I working on X in?"

## Decisions

| Axis | Choice | Rationale |
|---|---|---|
| Identity model | Label = first-class identity, one tmux session per label | Matches existing `start_named_session` behavior; user does not run multiple agents under one label |
| Persistence | Derive labels from tmux at nvim startup; no separate state file | Tmux is already the source of truth for "which sessions exist"; zero state to maintain; matches dotfiles minimalism |
| Picker | Dedicated picker on `<leader>al` with scrollback preview | `<leader>as` gets cluttered as labels accumulate; preview pane is the killer feature for "which one was that?" |
| Search | Live grep over snapshot of all labeled-pane scrollbacks; results-only (no jump-to-line in v1) | Simplest valuable shape; jump-to-line has edge cases worth deferring |

## Architecture

Three loosely coupled units plus one shared helper module, all inside `nvim/.config/nvim/lua/plugins/sidekick/` (extracted from the current single `sidekick.lua`). The existing `sidekick.lua` becomes the LazyVim spec entry point and the keymaps; the modules below are sibling Lua modules. `internal.lua` is a pure relocation of existing helpers — it isn't one of the three feature units, but it factors out shared code.

```
nvim/.config/nvim/lua/plugins/sidekick.lua          -- LazyVim spec, keymaps (existing, slimmed)
nvim/.config/nvim/lua/plugins/sidekick/internal.lua -- shared helpers: tool_commands, make_tool, normalize_label, start_named_session
nvim/.config/nvim/lua/plugins/sidekick/registry.lua -- discovery + rehydration from tmux
nvim/.config/nvim/lua/plugins/sidekick/picker.lua   -- <leader>al picker with preview
nvim/.config/nvim/lua/plugins/sidekick/search.lua   -- <leader>a/ cross-session grep
```

The current `sidekick.lua` helpers (`tool_commands`, `tool_urls`, `make_tool`, `normalize_label`, `normalize_cwd`, `start_named_session`, `prompt_named_session`, `is_claude_tool`, `ensure_claude_bridge`, `toggle_tool_session`) move into `internal.lua` so both `registry.lua` and the keymap block can call them without duplication. `sidekick.lua` shrinks to a LazyVim plugin spec plus keymaps.

The registry, picker, and search modules are independent: each works without the others. The registry just makes labels usable from sidekick's existing entry points (`<leader>as`, `<leader>ac`, …) for free.

## Components

### `internal.lua`
Pure relocation of existing helpers; no behavior change. Exposes the helpers needed by `registry.lua` and the keymap block.

### `registry.lua`
```lua
M.parse_session_name(name) -- string -> { tool=, slug=, hash= } | nil
M.discover()               -- table<label, { tool=, slug=, cwd=, pane_id=, session_id= }>
M.rehydrate()              -- side effect: register discovered labels into Config.cli.tools (idempotent)
```
- Parses tmux session names against `^(<tool>)-(.+) [0-9a-f]+$` where `<tool>` is built dynamically from the keys of `internal.tool_commands` (so adding a new tool to that table is the only change needed). The format matches what sidekick's `Session.sid` produces.
- `rehydrate()` skips labels already present in `Config.cli.tools` — never overwrites.
- Side-effect surface: `Config.cli.tools` only.
- Failure modes:
  - tmux not installed → return early, no notify
  - tmux exec non-zero → debug log, return empty
  - malformed session name → skipped silently

### `picker.lua`
```lua
M.list_sessions() -- array<{ label, tool, slug, cwd, pane_id, session_id, last_activity? }>
M.preview(entry) -- string (last 200 lines of scrollback)
M.open()         -- entry point bound to <leader>al
```
- Calls `registry.rehydrate()` on each open (cheap, idempotent) so labels created in another nvim instance show up.
- Entry list comes from `registry.discover()` — single source of tmux discovery used by both picker and search. Truth lives in tmux on every open; no caching.
- UI: snacks picker, format `[tool] label  cwd~`, preview from `tmux capture-pane -p -S -200 -E - -t <pane_id>`.
- Inline keymaps:
  - `<CR>` — `toggle_tool_session(label, true)`
  - `<C-x>` — `tmux kill-session -t <session_id>`, then refresh picker
- Failure modes:
  - empty list → friendly notify "No named sessions"
  - pane disappears between list and confirm → toggle starts a fresh tmux session at the same cwd (acceptable)

### `search.lua`
```lua
M.snapshot() -- captures every labeled pane to /tmp/sidekick-search-<nvim-pid>/<label>.txt; returns dir path
M.grep()     -- entry point bound to <leader>a/
M.cleanup()  -- VimLeavePre handler; rm -rf tmpdir
```
- On every invocation: wipe tmpdir, snapshot every pane via `tmux capture-pane -p -S - -E - -t <pane_id>` into `<label>.txt`.
- Hands the tmpdir to `snacks.picker.grep({ dirs = { tmpdir } })`. Filename → label mapping is trivial (`label = basename without .txt`).
- On confirm: `toggle_tool_session(label, true)`. No tmux scroll-to-line in v1.
- Failure modes:
  - rg missing → error notify with install hint (rg is already in Brewfile)
  - capture-pane fails for one pane → skip, log debug, continue
  - VimLeavePre missed (crash) → stale tmpdir is harmless; recreated next run
  - two nvim instances → per-pid tmpdir avoids collision

## Data Flows

### Startup rehydration

```
VimEnter (or first sidekick keymap fire)
  registry.rehydrate()
    exec: tmux list-panes -a -F "<PANE_FORMAT>"
    for each pane:
      parse session_name → { tool, slug, hash } | skip
      skip if Config.cli.tools["<tool>-<slug>"] already exists
      cwd = pane_current_path  (already in PANE_FORMAT)
      Config.cli.tools["<tool>-<slug>"] = make_tool(tool_commands[tool], cwd, tool_urls[tool])
    no UI, no notify on success
```
Cost: one `tmux list-panes` + a regex per line; sub-50ms with 50 panes.

### Picker open (`<leader>al`)

```
keymap fires
  registry.rehydrate()             -- covers labels created since startup
  entries = picker.list_sessions()
    delegates to registry.discover()  -- single tmux read path
  snacks.pick(entries, {
    format: "[tool] label  cwd~",
    preview: tmux capture-pane -p -S -200 -E - -t <pane_id>,
    on_confirm:    toggle_tool_session(label, true),
    on_C-x:        tmux kill-session -t <session_id> ; refresh,
  })
```

### Search (`<leader>a/`)

```
keymap fires
  entries = registry.discover()
  tmpdir = /tmp/sidekick-search-<nvim-pid>/  (mkdir -p, wipe contents)
  for entry in entries:
    exec: tmux capture-pane -p -S - -E - -t <pane_id>  →  <tmpdir>/<label>.txt
  snacks.picker.grep({ dirs = { tmpdir } })
    on_confirm(result):
      label = basename without .txt
      toggle_tool_session(label, true)
VimLeavePre → search.cleanup() → rm -rf tmpdir
```

## Keymaps (additions)

| Keymap | Action |
|---|---|
| `<leader>al` | Open named-session picker |
| `<leader>a/` | Search across named-session scrollbacks |

Existing keymaps (`<leader>aa`, `<leader>as`, `<leader>ac`, `<leader>ag`, `<leader>ao`, `<leader>an`, `<leader>ad`, `<leader>at`, `<leader>af`, `<leader>av`, `<leader>ap`) are unchanged.

## Error Handling

| Failure | Strategy |
|---|---|
| tmux not installed / not running | early return; no notify |
| Malformed tmux session name | skip silently |
| tmux command non-zero | debug log, treat as empty |
| capture-pane fails for one pane | skip, continue |
| tmux kill-session fails (already gone) | treat as success; refresh picker |
| rg missing | error notify with install hint |
| Snacks picker not loaded | error notify |
| Two nvim instances grepping concurrently | per-pid tmpdir |
| Pane disappears between list and confirm | toggle starts fresh session at same cwd |
| Duplicate label re-create via `<leader>an` | overwrite (current behavior; preserved) |

No persistent state file → no corruption surface. Worst case: stale label in `Config.cli.tools` for one nvim session; fixed by restart.

## Testing

### Tier 1 — manual smoke (must pass before merge)
- After creating two tmux sessions matching `claude-foo` / `opencode-bar` manually, calling `registry.rehydrate()` registers both. `<leader>as` now lists them.
- `<leader>al` opens picker, both rows visible, preview renders, `<CR>` toggles, `<C-x>` kills.
- `<leader>a/` indexes both, typing a known string yields a match, confirming jumps to the correct session.

### Tier 2 — adversarial manual (run once after implementation)
- No labeled sessions at all → picker shows "No named sessions"; search shows same.
- All tmux killed → open nvim → rehydrate is no-op, no errors.
- Mid-session creation: nvim open, `<leader>an` creates `claude-x`, then `<leader>al` lists it.
- Two nvim instances grepping → each uses its own tmpdir, no interference.

### Tier 3 — automated
None. Personal dotfiles; integration testing happens by use. The only candidate worth a unit test is `parse_session_name`; will inline ad-hoc assertions if iterating on the regex.

## Out of Scope (v1 parking lot)

- Jump-to-line in tmux scrollback after search match (via `tmux copy-mode` + `send-keys`).
- `<C-r>` rename inside picker.
- Persistent registry file (would let labels survive tmux death / reboot; option C from brainstorm).
- Last-activity sort and "alive/dead" badges in picker.
- Cross-machine label persistence.
- Indexed/cached search corpus (today's design re-snapshots on every grep open; sufficient for current corpus sizes).

## File-by-file change summary

| File | Change |
|---|---|
| `nvim/.config/nvim/lua/plugins/sidekick.lua` | Slim to LazyVim spec + keymaps; require helpers from `sidekick/internal.lua` |
| `nvim/.config/nvim/lua/plugins/sidekick/internal.lua` | New; relocated helpers (no behavior change) |
| `nvim/.config/nvim/lua/plugins/sidekick/registry.lua` | New; tmux discovery + rehydration |
| `nvim/.config/nvim/lua/plugins/sidekick/picker.lua` | New; `<leader>al` picker with preview |
| `nvim/.config/nvim/lua/plugins/sidekick/search.lua` | New; `<leader>a/` cross-session grep |
