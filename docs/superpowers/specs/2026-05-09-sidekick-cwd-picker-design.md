# Sidekick `<c-.>` Cwd-Scoped Peek Picker

## Problem

Today `<c-.>` is bound to `sidekick.cli.toggle()` (see `nvim/.config/nvim/lua/plugins/sidekick.lua:73-79`), which opens sidekick.nvim's built-in tool/session picker. That picker only shows session names — there is no way to peek into a session's chat before deciding whether to open it. When the user has several named claude/cursor/codex sessions running, they often want to glance at the last few exchanges to decide whether the session needs attention before switching to it.

The existing `<leader>al` picker (`nvim/.config/nvim/lua/plugins/sidekick/picker.lua`) does include a tmux-pane preview, but it lists every named session across every cwd in a horizontal split layout that's optimized for full-list browsing, not a quick "peek into the session I'm probably about to focus" flow.

## Goal

Replace `<c-.>`'s behavior with a new floating picker that:

- Lists only named sessions whose cwd is the current working directory or a descendant of it.
- Shows a large chat-preview pane on top so the user can read the most recent scrollback before opening.
- Uses an fzf-style fuzzy-match input below the preview.
- Opens the selected session as a regular sidekick session on `<CR>`.

Existing `<leader>al` keeps its current behavior unchanged.

## Non-goals

- No live-streaming preview. The preview re-captures only on selection change.
- No support for sessions outside the current cwd subtree (that's what `<leader>al` is for).
- No new session-creation flows. `<leader>an` still owns that.
- No replacement of `<leader>al` or any other sidekick keybind.

## User experience

Layout occupies an 80%-wide × 80%-tall float, centered, no outer border. Top-to-bottom inside the float:

```
╭───────────────────────────────────╮
│  CHAT PREVIEW                     │   ≈ float_height − 8 rows
│  (tmux capture-pane scrollback,   │   rounded border
│   mouse-wheel scrollable)         │
╰───────────────────────────────────╯
╭───────────────────────────────────╮
│ > claude-foo  ~/dotfiles          │   3 inner rows, rounded border
│   claude-bar  ~/dotfiles/sub      │
│   cursor-baz  ~/dotfiles          │
╰───────────────────────────────────╯
╭───────────────────────────────────╮
│ > query_                          │   1 inner row, rounded border
╰───────────────────────────────────╯
```

Each section has its own rounded border. Match list shows exactly 3 visible items at a time; additional matches are reachable by `<c-n>` / `<c-p>` which scroll the visible window.

### Keymaps

| Key | Action |
|-----|--------|
| typing in input | fuzzy-filters the list (Snacks default matcher) |
| `<c-n>` / `<c-p>` | cycle selection up/down (Snacks default) |
| `<CR>` | confirm: `internal.toggle_tool_session(item.label, true)`, then close picker |
| `<c-x>` | `tmux kill-session -t <session_id>`, then reopen picker — mirrors `picker.lua:103-124` |
| `<Esc>` | dismiss (Snacks default) |
| mouse wheel on preview | scroll the preview buffer (it is a normal scratch buffer) |

### Empty state

If the cwd-filtered list is empty, the picker still opens. The list shows a single non-selectable placeholder row `(no named sessions in cwd)`; the preview shows `(no session)`. `<CR>` is a no-op; `<Esc>` dismisses.

## Architecture

New module **`nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`**.

- Public surface: `M.open()`.
- Reuses `plugins.sidekick.registry.discover()` for the source data and `plugins.sidekick.internal.toggle_tool_session` for the confirm action.
- The cwd filter is applied in `cwd_picker.lua` after `registry.rehydrate()`.

### Source list

```lua
local function in_cwd_subtree(entry_cwd, root)
  if not entry_cwd or entry_cwd == "" then return false end
  return entry_cwd == root or entry_cwd:sub(1, #root + 1) == root .. "/"
end
```

`root` is `vim.fn.getcwd()` normalized via `vim.fs.normalize(vim.fn.fnamemodify(..., ":p"))` to match how `internal.normalize_cwd` produces stored cwds. Both `root` and `entry_cwd` are normalized before comparison so trailing slashes and symlinks don't trip the prefix match.

Item shape mirrors `picker.lua:16-24`:

```lua
{
  text = string.format("[%s] %s  %s", entry.tool, label, cwd_display),
  label = label,
  tool = entry.tool,
  slug = entry.slug,
  pane_id = entry.pane_id,
  session_id = entry.session_id,
  cwd = entry.cwd,
}
```

Sort by `tool` then `label` (same comparator as `picker.lua:26-31`).

### Layout

Snacks picker `layout` configured per-call:

```lua
layout = {
  preset = "default",
  layout = {
    box = "vertical",
    width = 0.8,
    height = 0.8,
    border = "none",
    { win = "preview", border = "rounded" },           -- fills remaining height
    { win = "list",    height = 5, border = "rounded" }, -- 3 inner + 2 border
    { win = "input",   height = 3, border = "rounded" }, -- 1 inner + 2 border
  },
}
```

The `preview` box has no fixed height so it absorbs whatever's left after `list` (5) and `input` (3) are subtracted from the float's 80% height. On a typical 50-row terminal, 80% = 40 rows → preview ≈ 32 rows.

### Preview rendering

Identical to `picker.lua:37-56` — `tmux capture-pane -p -S - -E - -t <pane_id>` for full scrollback (vs. `-S -200` in the existing picker; here we want full history so the user can mouse-scroll up). On `tmux capture-pane` failure, write `{ "(capture-pane failed)" }` into the preview buffer.

The preview buffer is a regular scratch buffer (Snacks default). Mouse-wheel scroll works because LazyVim's defaults set `vim.opt.mouse = "a"`; the wheel events translate into normal-mode `<ScrollWheelUp>/<ScrollWheelDown>` mappings that scroll the buffer.

### Confirm and kill actions

```lua
confirm = function(picker, item)
  picker:close()
  if item and item.label then
    internal.toggle_tool_session(item.label, true)
  end
end,
```

Kill action is copied verbatim from `picker.lua:103-124` — same `<c-x>` binding on both `input` and `list` windows, same `kill_session` helper that treats "no such session" as success.

### Empty state implementation

Detected before the Snacks call. Instead of `vim.notify("Sidekick: no named sessions in cwd")` (which is what `picker.lua:80-83` does for the global empty case), `cwd_picker.lua` opens the picker with `items = { { text = "(no named sessions in cwd)", _empty = true } }`. The `confirm` callback ignores items with `_empty = true`. The `preview` callback writes `{ "(no session)" }` into the buffer for empty items. The `<c-x>` action also early-returns when `item._empty` or `item.session_id` is missing, so kill-on-placeholder is a no-op.

### Keybinding wiring

In `nvim/.config/nvim/lua/plugins/sidekick.lua`, replace the `<c-.>` entry (currently at lines 72-79):

```lua
{
  "<c-.>",
  function()
    require("plugins.sidekick.cwd_picker").open()
  end,
  desc = "Sidekick Peek Sessions in Cwd",
  mode = { "n", "t", "i", "x" },
},
```

The mode list (`n`, `t`, `i`, `x`) is preserved from the existing binding so terminal/insert/visual access still works.

## Edge cases

- **No tmux on `$PATH`** — `registry.discover()` already returns `{}` in that case, so the empty-state UI will open. No new handling needed.
- **`tmux capture-pane` fails for one session** — preview shows `(capture-pane failed)`; the picker stays usable. Same as today's `picker.lua`.
- **Selected session was killed externally between open and `<CR>`** — `internal.toggle_tool_session` will respawn it via the registered tool config. Acceptable; matches today's behavior for `<leader>al`.
- **`<c-x>` kills the only visible session** — after the kill, `M.open()` is re-invoked, re-runs the cwd filter, and the empty-state UI shows.
- **Cwd contains a symlink** — both sides of the prefix comparison are run through `vim.fs.normalize ∘ fnamemodify(..., ":p")` so symlinked roots and physical roots compare equal.
- **Session's cwd is a parent of the editor cwd** — does *not* match (we want descendants only). Intentional: the user said "cwd and children".

## Testing

Manual verification recipe:

1. From `~/dotfiles`, start two named sessions: `<leader>an` claude / "foo", `<leader>an` cursor / "bar".
2. `cd nvim/`, start `<leader>an` claude / "sub".
3. Return to `~/dotfiles`. Press `<c-.>`.
   - Expect 3 entries (foo, bar, sub) — sub is in a child cwd so it is included.
4. From `~/some-other-repo`, press `<c-.>`.
   - Expect the empty-state UI: `(no named sessions in cwd)` in list, `(no session)` in preview.
5. From `~/dotfiles`, press `<c-.>`, type `f`.
   - Expect list narrows to "foo"; preview updates to that session's tmux scrollback.
6. Press `<c-n>` / `<c-p>` — selection cycles, preview updates.
7. Press `<CR>` on a match — picker closes, the session opens as a normal sidekick float.
8. Reopen `<c-.>`, press `<c-x>` on a match — that tmux session is killed, the picker reopens with one fewer entry.
9. `<Esc>` from input — picker dismisses without acting.
10. Mouse-wheel up over the preview pane — scrollback scrolls. (Requires a session with > visible-rows of history.)

Failures in any step are bugs to fix before merging.

## File-level diff summary

- **New**: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua` (~80 LOC).
- **Edit**: `nvim/.config/nvim/lua/plugins/sidekick.lua` — replace the `<c-.>` keymap body (lines 72-79).
- No other files touched. `picker.lua`, `registry.lua`, `internal.lua` are reused as-is.

## Out of scope / explicit YAGNI

- Auto-refresh timer for the preview.
- Embedding the live tmux pane via `tmux attach -r`.
- Including base sessions (claude, cursor, codex, opencode without slugs) — only named sessions are listed, matching the user's stated source filter.
- Cross-cwd session listing — that's `<leader>al`.
- A new "create session" affordance from inside the picker — `<leader>an` is unchanged.
