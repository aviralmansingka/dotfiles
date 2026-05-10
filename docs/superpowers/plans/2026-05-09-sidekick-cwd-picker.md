# Sidekick `<c-.>` Cwd-Scoped Peek Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `<c-.>`'s current behavior with a Snacks-based floating picker that lists named sidekick sessions whose cwd is the current working directory or a descendant, shows a chat-preview pane on top, fuzzy-matches via a 3-row list, and opens the selected session on `<CR>`.

**Architecture:** New module `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua` reuses `registry.discover()` for source data, applies a cwd-subtree filter, and calls `Snacks.picker.pick` with a custom vertical layout (preview → list → input). The `<c-.>` keymap in `nvim/.config/nvim/lua/plugins/sidekick.lua` is rewired to invoke this new module. `<leader>al` (the existing global picker) stays untouched.

**Tech Stack:** Neovim Lua, Snacks.nvim (already a dependency via `<leader>al`), tmux (`capture-pane`, `kill-session`), sidekick.nvim.

**Spec:** `docs/superpowers/specs/2026-05-09-sidekick-cwd-picker-design.md`

---

## File Structure

- **Create:** `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua` — single-purpose module exposing `M.open()`. Owns the cwd filter, item builder, kill helper, layout config, and Snacks call.
- **Modify:** `nvim/.config/nvim/lua/plugins/sidekick.lua` — change the `<c-.>` keymap body to invoke `cwd_picker.open()`. No other lines touched.

No test infrastructure exists in this repo for nvim plugins (verified: `find nvim -name '*_spec.lua' -o -name 'test_*.lua' 2>/dev/null` returns nothing). The repo's existing sidekick modules (`picker.lua`, `registry.lua`, `resume.lua`) are also untested by harness — they're verified manually via the steps documented in `docs/superpowers/specs/2026-05-01-sidekick-named-sessions-design.md` and follow-on specs. We follow the same convention here: each task ends with a manual `:source` + interactive verification recipe rather than an automated test runner. This is consistent with how prior sidekick plans (e.g. `2026-05-01-sidekick-named-sessions.md`) were executed.

---

## Task 1: Create the module skeleton with cwd filter helper

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`

- [ ] **Step 1: Create the file with the module skeleton, requires, and a pure cwd-subtree predicate**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
-- Cwd-scoped peek picker for sidekick named sessions.
-- Bound to <c-.> in plugins/sidekick.lua.
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

local M = {}

---@param p string
---@return string
local function normalize(p)
  if not p or p == "" then
    return ""
  end
  return vim.fs.normalize(vim.fn.fnamemodify(p, ":p")):gsub("/$", "")
end

---@param entry_cwd string|nil
---@param root string  already normalized
---@return boolean
local function in_cwd_subtree(entry_cwd, root)
  if not entry_cwd or entry_cwd == "" or root == "" then
    return false
  end
  local n = normalize(entry_cwd)
  if n == root then
    return true
  end
  return n:sub(1, #root + 1) == root .. "/"
end

return M
```

- [ ] **Step 2: Verify the module loads without syntax errors**

Run from inside an active nvim instance (or `nvim --headless`):

```bash
nvim --headless -c 'lua require("plugins.sidekick.cwd_picker")' -c 'qa' 2>&1
```

Expected: no output (module loads silently). Any error string means a syntax bug.

- [ ] **Step 3: Smoke-test the predicate**

```bash
nvim --headless -c 'lua local m = loadfile(vim.fn.expand("~/dotfiles/nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua"))() print("loaded ok")' -c 'qa' 2>&1
```

Note: the predicate is local, so we'll exercise it indirectly when `M.list_items` is added in Task 2.

Expected: prints `loaded ok`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
git commit -m "Add sidekick cwd_picker skeleton with subtree predicate"
```

---

## Task 2: Add the cwd-filtered item builder

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`

- [ ] **Step 1: Add `M.list_items()` that calls `registry.discover()` and filters by cwd subtree**

Insert *after* the `in_cwd_subtree` function and *before* the `return M` line:

```lua
---@return snacks.picker.finder.Item[]
function M.list_items()
  local root = normalize(vim.fn.getcwd())
  local home = normalize(vim.fn.expand("~"))
  local items = {}
  for label, entry in pairs(registry.discover()) do
    if in_cwd_subtree(entry.cwd, root) then
      local cwd_display = entry.cwd or ""
      if home ~= "" and cwd_display:sub(1, #home) == home then
        cwd_display = "~" .. cwd_display:sub(#home + 1)
      end
      items[#items + 1] = {
        text = string.format("[%s] %s  %s", entry.tool, label, cwd_display),
        label = label,
        tool = entry.tool,
        slug = entry.slug,
        pane_id = entry.pane_id,
        session_id = entry.session_id,
        cwd = entry.cwd,
      }
    end
  end
  table.sort(items, function(a, b)
    if a.tool ~= b.tool then
      return a.tool < b.tool
    end
    return a.label < b.label
  end)
  return items
end
```

- [ ] **Step 2: Verify the function is callable**

```bash
nvim --headless -c 'lua print(vim.inspect(require("plugins.sidekick.cwd_picker").list_items()))' -c 'qa' 2>&1
```

Expected: prints `{}` (empty table) when no named sessions exist in the cwd, OR a non-empty array of items if any are running.

- [ ] **Step 3: Manual verification with a live session**

In an interactive nvim from `~/dotfiles`:
1. `<leader>an` → claude → "peektest" — starts a named session.
2. `:lua print(vim.inspect(require("plugins.sidekick.cwd_picker").list_items()))`
3. Expected: an array containing one item with `label = "claude-peektest"` and `tool = "claude"`.
4. From `~/some-other-dir`: `:lua print(vim.inspect(require("plugins.sidekick.cwd_picker").list_items()))`
5. Expected: empty array `{}` — the session's cwd is `~/dotfiles`, which is not a subtree of the unrelated directory.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
git commit -m "Add cwd-filtered list_items to sidekick cwd_picker"
```

---

## Task 3: Add the preview helper and kill-session helper

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`

- [ ] **Step 1: Add the preview helper above `M.list_items`**

Place these two helpers between `in_cwd_subtree` and `M.list_items`:

```lua
---@param item table|nil
---@return string[]
local function preview_lines(item)
  if not item or item._empty or not item.pane_id then
    return { "(no session)" }
  end
  local out = vim.fn.systemlist({
    "tmux",
    "capture-pane",
    "-p",
    "-S",
    "-",
    "-E",
    "-",
    "-t",
    item.pane_id,
  })
  if vim.v.shell_error ~= 0 then
    return { "(capture-pane failed)" }
  end
  return out
end

---@param session_id string|nil
---@return boolean
local function kill_session(session_id)
  if not session_id or session_id == "" then
    return false
  end
  local out = vim.fn.systemlist({ "tmux", "kill-session", "-t", session_id })
  if vim.v.shell_error == 0 then
    return true
  end
  for _, line in ipairs(out) do
    if line:match("can't find session") or line:match("no such session") then
      return true
    end
  end
  vim.notify("Sidekick: tmux kill-session failed: " .. table.concat(out, " "), vim.log.levels.WARN)
  return false
end
```

These mirror `picker.lua:37-75` but with two intentional differences:
- `preview_lines` honors a new `item._empty` flag (used for the empty-state placeholder in Task 5).
- The capture window is full scrollback (`-S -`) instead of `-S -200`, because the user wants to mouse-scroll up to read history.

- [ ] **Step 2: Verify the file still loads**

```bash
nvim --headless -c 'lua require("plugins.sidekick.cwd_picker")' -c 'qa' 2>&1
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
git commit -m "Add preview and kill helpers to sidekick cwd_picker"
```

---

## Task 4: Add `M.open()` for the populated case

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`

- [ ] **Step 1: Add `M.open()` between `M.list_items` and `return M`**

```lua
function M.open()
  registry.rehydrate()
  local items = M.list_items()
  local empty = #items == 0
  if empty then
    items = { {
      text = "(no named sessions in cwd)",
      _empty = true,
    } }
  end

  Snacks.picker.pick({
    source = "sidekick_cwd_peek",
    title = "Sidekick Sessions in Cwd",
    items = items,
    format = "text",
    layout = {
      preset = "default",
      layout = {
        box = "vertical",
        width = 0.8,
        height = 0.8,
        border = "none",
        { win = "preview", border = "rounded" },
        { win = "list", height = 5, border = "rounded" },
        { win = "input", height = 3, border = "rounded" },
      },
    },
    preview = function(ctx)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, preview_lines(ctx.item))
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if not item or item._empty then
        return
      end
      if item.label then
        internal.toggle_tool_session(item.label, true)
      end
    end,
    win = {
      input = {
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n", "i" } },
        },
      },
      list = {
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n" } },
        },
      },
    },
    actions = {
      sidekick_kill_session = function(picker, item)
        if not item or item._empty or not item.session_id then
          return
        end
        if kill_session(item.session_id) then
          picker:close()
          vim.schedule(function()
            M.open()
          end)
        end
      end,
    },
  })
end
```

Notes for the engineer:
- The `box = "vertical"` layout stacks children top-to-bottom. Children appear in array order, so order is: preview, list, input — matching the spec.
- `list.height = 5` = 3 inner rows + 2 rounded-border rows. `input.height = 3` = 1 inner + 2 border. The `preview` box has no fixed height, so Snacks fills it with the remaining space.
- `width = 0.8` and `height = 0.8` give the 80% × 80% float per spec.
- `<c-n>/<c-p>` cycle and `<Esc>` dismiss are Snacks defaults — we don't bind them explicitly.

- [ ] **Step 2: Verify the file loads**

```bash
nvim --headless -c 'lua require("plugins.sidekick.cwd_picker")' -c 'qa' 2>&1
```

Expected: silent.

- [ ] **Step 3: Manual verification — populated case**

In an interactive nvim from `~/dotfiles`, with no named sessions running:
1. `<leader>an` → claude → "peektest" — starts a named session in `~/dotfiles`.
2. `:lua require("plugins.sidekick.cwd_picker").open()`
3. Expected: an 80%×80% centered float with three stacked rounded boxes:
   - Top: large preview area showing the captured tmux scrollback of the `claude-peektest` pane.
   - Middle: 3-row list with `[claude] claude-peektest  ~/dotfiles`.
   - Bottom: 1-row input with cursor.
4. Type `peek` → list narrows (still one match).
5. `<CR>` → picker closes; the `claude-peektest` sidekick float opens.
6. `<c-.>` would still call the OLD binding (we wire it in Task 6), so test re-opening via `:lua require("plugins.sidekick.cwd_picker").open()` again.
7. Press `<c-x>` on the visible match → tmux kills the session, picker reopens with the empty placeholder.

- [ ] **Step 4: Manual verification — empty case**

From a directory with no sessions (e.g. `cd /tmp && nvim`):
1. `:lua require("plugins.sidekick.cwd_picker").open()`
2. Expected: same float layout. List shows `(no named sessions in cwd)`. Preview shows `(no session)`. `<CR>` closes silently. `<Esc>` dismisses.

- [ ] **Step 5: Manual verification — mouse scroll on preview**

With a session whose history exceeds the preview height:
1. Open the picker.
2. Mouse-wheel up over the preview pane.
3. Expected: scrollback scrolls. Mouse wheel does NOT enter copy-mode (we are not using a tmux embed; this is a normal scratch buffer).

If wheel scroll doesn't work, verify `:set mouse?` shows `mouse=a` (LazyVim default).

- [ ] **Step 6: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
git commit -m "Add M.open with stacked layout, kill action, empty state"
```

---

## Task 5: Rewire the `<c-.>` keybind

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua` (lines 72-79 only)

- [ ] **Step 1: Read the current binding**

Confirm lines 72-79 look like this before editing:

```lua
    {
      "<c-.>",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle",
      mode = { "n", "t", "i", "x" },
    },
```

- [ ] **Step 2: Replace the body**

Use the Edit tool with this exact replacement:

old_string:
```lua
    {
      "<c-.>",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle",
      mode = { "n", "t", "i", "x" },
    },
```

new_string:
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

The mode list is preserved verbatim so terminal/insert/visual access still triggers the new picker.

- [ ] **Step 3: Reload the running nvim sessions and the keybind**

In each open nvim:
1. `:Lazy reload sidekick.nvim`
2. `<c-.>` should now open the new picker instead of `sidekick.cli.toggle()`.

If reload doesn't pick up the new keymap (LazyVim caches keys), restart the nvim session.

- [ ] **Step 4: End-to-end verification**

From `~/dotfiles`:
1. Start a named session via `<leader>an` → claude → "e2e".
2. Press `<c-.>` from normal mode.
3. Expected: the new floating picker opens, lists `claude-e2e`, shows its scrollback in the preview.
4. From insert mode of any buffer, press `<c-.>` — same picker opens (mode list includes `i`).
5. From a `:terminal` buffer, press `<c-.>` — same picker opens (mode `t`).

- [ ] **Step 5: Confirm the existing pickers are untouched**

1. `<leader>al` → still opens the original full-list horizontal picker.
2. `<leader>aa` → still toggles the default sidekick CLI.
3. No other binding regressions.

- [ ] **Step 6: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "Rewire <c-.> to sidekick cwd_picker"
```

---

## Task 6: Final integration check

**Files:** None (verification-only task)

- [ ] **Step 1: Run the full verification recipe from the spec**

From `~/dotfiles`:

1. `<leader>an` → claude → "foo"
2. `<leader>an` → cursor → "bar"
3. `cd nvim/`, `<leader>an` → claude → "sub"
4. Return to `~/dotfiles`. Press `<c-.>`.
5. Expected: 3 entries — `claude-foo`, `cursor-bar`, `claude-sub`. Sub is included because its cwd `~/dotfiles/nvim` is a descendant of `~/dotfiles`.
6. From `~/some-other-repo` (any unrelated dir), press `<c-.>`.
7. Expected: empty-state UI.
8. From `~/dotfiles`, press `<c-.>`, type `f`.
9. Expected: list narrows to `claude-foo`; preview updates.
10. `<c-n>` / `<c-p>` cycles selection.
11. `<CR>` opens the highlighted session.
12. Reopen `<c-.>`, press `<c-x>` on a match — that tmux session is killed; picker reopens with one fewer entry.
13. `<Esc>` from input — picker dismisses.
14. Mouse-wheel up over preview — scrollback scrolls.

If any step fails, fix and recommit before merging.

- [ ] **Step 2: Clean up test sessions (optional)**

```bash
tmux kill-session -t claude-foo 2>/dev/null
tmux kill-session -t cursor-bar 2>/dev/null
tmux kill-session -t claude-sub 2>/dev/null
tmux kill-session -t claude-e2e 2>/dev/null
tmux kill-session -t claude-peektest 2>/dev/null
```

- [ ] **Step 3: No new commit needed** — verification-only task.

---

## Self-Review (completed by author)

**Spec coverage:**
- 80% × 80% float, centered, three stacked rounded boxes (preview / list / input) — Task 4 Step 1.
- Cwd + descendants filter — Task 1 (predicate) + Task 2 (filter).
- Snapshot preview, no auto-refresh — Task 3 (`preview_lines`) + Task 4 (`preview = function(ctx)` fires only on selection change).
- `<c-n>/<c-p>` cycle — Snacks default, called out in Task 4 Step 1 notes.
- `<CR>` confirm — Task 4 (`confirm` callback).
- `<c-x>` kill — Task 4 (`sidekick_kill_session` action).
- `<Esc>` dismiss — Snacks default.
- Mouse-wheel scroll on preview — verified in Task 4 Step 5 and Task 6 Step 1.14.
- Empty-state placeholder — Task 4 (`empty` branch).
- `<leader>al` left untouched — Task 5 Step 5 verifies.
- Keybind rewire on `<c-.>` keeping the mode list — Task 5.

**Placeholder scan:** No "TBD"/"TODO"/"similar to". Every code step shows full code; every command has expected output.

**Type consistency:** `M.list_items` returns items with the same shape used by `preview_lines`, `confirm`, and `sidekick_kill_session`. The `_empty` flag is consistently checked in all three places.

**Scope check:** Two-file change, six tasks, single PR. Appropriately scoped.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-09-sidekick-cwd-picker.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
