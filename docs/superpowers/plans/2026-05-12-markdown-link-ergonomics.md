# Markdown Link Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three filetype-scoped features for `markdown`: collapse inline link URLs to zero visual width, add `iu`/`au` URL text objects, and override visual-mode `p`/`P` to wrap selections as `[selection](url)` when the register holds a URL.

**Architecture:** New helper module `nvim/.config/nvim/lua/helpers/markdown_links.lua` with a single `setup()` entry point wired into the existing markdown `FileType` autocmd in `plugins/markdown.lua`. Collapse uses `conceallevel=3` first; if that breaks render-markdown icons or fails to remove wrap phantom lines, fall back to a custom extmark renderer in phase 2. Text object and paste use treesitter (`markdown_inline` parser, no plugin dependency) and buffer-local keymaps.

**Tech Stack:** Lua, Neovim 0.10+ APIs (`vim.api.nvim_buf_set_extmark`, `vim.treesitter`), existing plugins `render-markdown.nvim` and `nvim-treesitter` with the `markdown_inline` parser.

**Spec:** `docs/superpowers/specs/2026-05-12-markdown-link-ergonomics-design.md`

---

## File Structure

- **Create:** `nvim/.config/nvim/lua/helpers/markdown_links.lua` — module with `setup`, `select_url`, `paste_as_link`.
- **Modify:** `nvim/.config/nvim/lua/plugins/markdown.lua` — add `conceallevel=3` + `require("helpers.markdown_links").setup()` to the markdown FileType autocmd. Phase 2 only: also set `link.enabled = false` in render-markdown opts.
- **Create (test fixture):** `/tmp/md-link-test.md` — reproducer file with long URLs and short URLs, used for manual verification.

---

## Task 1: Scaffold the helper module

**Files:**
- Create: `nvim/.config/nvim/lua/helpers/markdown_links.lua`

- [ ] **Step 1: Write the module skeleton**

```lua
-- nvim/.config/nvim/lua/helpers/markdown_links.lua
local M = {}

local function is_markdown(buf)
  return vim.bo[buf].filetype == "markdown"
end

function M.setup()
  local buf = vim.api.nvim_get_current_buf()
  if not is_markdown(buf) then return end

  vim.opt_local.conceallevel = 3

  -- Mappings installed in later tasks.
end

return M
```

- [ ] **Step 2: Wire into the markdown FileType autocmd**

Edit `nvim/.config/nvim/lua/plugins/markdown.lua` line 15-24. Locate the existing `FileType` autocmd for `markdown`. Add the `markdown_links` setup call after the existing `vim.opt_local` lines:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  callback = function()
    vim.cmd("PencilSoft")
    vim.opt_local.textwidth = 120
    vim.opt_local.wrap = true
    vim.opt_local.linebreak = true
    vim.opt_local.formatexpr = "v:lua.require'helpers.markdown_wrap'.formatexpr()"
    require("helpers.markdown_links").setup()
  end,
})
```

- [ ] **Step 3: Reload and verify module loads cleanly**

In a running Neovim:

```
:lua require("helpers.markdown_links")
:e! /tmp/md-link-test.md
:set conceallevel?
```

Expected: no errors, `conceallevel=3` reported (after opening a markdown buffer).

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/helpers/markdown_links.lua nvim/.config/nvim/lua/plugins/markdown.lua
git commit -m "Add markdown_links helper module scaffold"
```

---

## Task 2: Create reproducer fixture and verify phase-1 collapse

**Files:**
- Create: `/tmp/md-link-test.md`

- [ ] **Step 1: Write the fixture**

```markdown
# Markdown link test

## Long URLs (the original pain point)

[Fix in Cursor](https://cursor.com/open?link=eyJ2ZXJzaW9uIjoxLCJ0eXBlIjoiQlVHQk9UX0ZJWF9JTl9DVVJTT1IiLCJkYXRhIjp7InJlZGlzS2V5IjoiYnVnYm90Ojk1NWU5NzM0LTI3OWUtNDI3MC04MDZmLTI1ZDI5ZmNlNzc2NiJ9fQ) [Fix in Web](https://cursor.com/agents?link=eyJ2ZXJzaW9uIjoxLCJ0eXBlIjoiQlVHQk9UX0ZJWF9JTl9XRUIiLCJkYXRhIjp7InJlZGlzS2V5IjoiYnVnYm90Ojk1NWU5NzM0LTI3OWUtNDI3MC04MDZmLTI1ZDI5ZmNlNzc2NiJ9fQ)

## Short URLs

Visit [github](https://github.com/x/y) or [youtube](https://youtube.com/watch?v=abc).

## Mixed prose

Some text before [the link with long URL](https://example.com/a/very/long/path/that/should/wrap/normally/if/visible/right/here) and text after.
```

- [ ] **Step 2: Open in Neovim and visually inspect**

```
:e /tmp/md-link-test.md
```

Check:
1. Move cursor away from the long-URL line. Confirm there are **no blank visual lines** below it (count visual rows from `# Markdown link test` down).
2. Move cursor onto the long-URL line. Confirm icons still render (the `󰌹` or domain-specific icon should appear before each label).
3. If both checks pass → phase 1 worked, skip Task 3. If wrap phantom lines remain OR icons disappeared → proceed to Task 3.

- [ ] **Step 3: Record outcome in a comment in the helper module**

If phase 1 worked, add a one-line comment in `markdown_links.lua`:

```lua
-- Collapse: conceallevel=3 + render-markdown's existing conceal is sufficient.
```

If phase 1 failed, note which mode and continue to Task 3.

---

## Task 3 (conditional): Phase-2 extmark renderer

**Run this task only if Task 2 step 2 showed phantom wrap lines or missing icons.**

**Files:**
- Modify: `nvim/.config/nvim/lua/helpers/markdown_links.lua`
- Modify: `nvim/.config/nvim/lua/plugins/markdown.lua` (render-markdown opts)

- [ ] **Step 1: Disable render-markdown's link rendering**

Edit `nvim/.config/nvim/lua/plugins/markdown.lua` around line 515-546 (the `link = { … }` block in render-markdown opts). Change `enabled = true` to `enabled = false`:

```lua
link = {
  enabled = false,  -- handled by helpers.markdown_links
  -- (rest unchanged)
},
```

- [ ] **Step 2: Add the renderer to the helper module**

In `helpers/markdown_links.lua`, append:

```lua
local ns = vim.api.nvim_create_namespace("markdown_links")

local ICONS = {
  { pattern = "github%.com",       icon = "󰊤 " },
  { pattern = "gitlab%.com",       icon = "󰮠 " },
  { pattern = "discord%.com",      icon = "󰙯 " },
  { pattern = "google%.com",       icon = "󰊭 " },
  { pattern = "neovim%.io",        icon = " " },
  { pattern = "reddit%.com",       icon = "󰑍 " },
  { pattern = "stackoverflow%.com", icon = "󰓌 " },
  { pattern = "wikipedia%.org",    icon = "󰖬 " },
  { pattern = "youtube%.com",      icon = "󰗃 " },
  { pattern = "^http",             icon = "󰖟 " },
}
local DEFAULT_ICON = "󰌹 "

local function pick_icon(url)
  for _, entry in ipairs(ICONS) do
    if url:match(entry.pattern) then return entry.icon end
  end
  return DEFAULT_ICON
end

local QUERY = vim.treesitter.query.parse("markdown_inline", [[
  (inline_link
    (link_text) @text
    (link_destination) @dest) @link
]])

local function render(buf)
  if not vim.api.nvim_buf_is_valid(buf) or not is_markdown(buf) then return end
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)

  local ok, parser = pcall(vim.treesitter.get_parser, buf, "markdown_inline")
  if not ok or not parser then return end
  local tree = parser:parse()[1]
  if not tree then return end
  local root = tree:root()

  for id, node in QUERY:iter_captures(root, buf) do
    local name = QUERY.captures[id]
    if name == "link" then
      local link_node = node
      local dest_node
      for child in link_node:iter_children() do
        if child:type() == "link_destination" then dest_node = child end
      end
      if dest_node then
        local lsr, lsc, ler, lec = link_node:range()
        local _, _, dsr, dsc = link_node:range()  -- placeholder
        local text_node
        for child in link_node:iter_children() do
          if child:type() == "link_text" then text_node = child end
        end
        if text_node then
          local tsr, tsc, ter, tec = text_node:range()
          local url = vim.treesitter.get_node_text(dest_node, buf)
          local icon = pick_icon(url)

          -- 1. Conceal `](url)` — from end of link_text to end of link.
          vim.api.nvim_buf_set_extmark(buf, ns, ter, tec, {
            end_row = ler,
            end_col = lec,
            conceal = "",
          })

          -- 2. Conceal the opening `[`.
          vim.api.nvim_buf_set_extmark(buf, ns, lsr, lsc, {
            end_row = tsr,
            end_col = tsc,
            conceal = "",
          })

          -- 3. Insert icon as inline virt_text before the link.
          vim.api.nvim_buf_set_extmark(buf, ns, lsr, lsc, {
            virt_text = { { icon, "RenderMarkdownLink" } },
            virt_text_pos = "inline",
          })
        end
      end
    end
  end
end

function M._render_current_buf()
  render(vim.api.nvim_get_current_buf())
end
```

- [ ] **Step 3: Install the render autocmds in `setup()`**

Modify the `setup()` function to add:

```lua
function M.setup()
  local buf = vim.api.nvim_get_current_buf()
  if not is_markdown(buf) then return end

  vim.opt_local.conceallevel = 3

  local group = vim.api.nvim_create_augroup("markdown_links_" .. buf, { clear = true })
  vim.api.nvim_create_autocmd({ "BufEnter", "TextChanged", "TextChangedI", "InsertLeave" }, {
    group = group,
    buffer = buf,
    callback = function()
      vim.schedule(function() render(buf) end)
    end,
  })
  render(buf)
end
```

- [ ] **Step 4: Reload and re-verify**

In Neovim:

```
:Lazy reload render-markdown.nvim
:luafile nvim/.config/nvim/lua/helpers/markdown_links.lua
:e! /tmp/md-link-test.md
```

Confirm icons + labels render and no blank wrap continuation lines appear.

- [ ] **Step 5: Commit**

```bash
git add nvim/.config/nvim/lua/helpers/markdown_links.lua nvim/.config/nvim/lua/plugins/markdown.lua
git commit -m "Add phase-2 custom extmark renderer for markdown links"
```

---

## Task 4: URL text object (`iu` / `au`)

**Files:**
- Modify: `nvim/.config/nvim/lua/helpers/markdown_links.lua`

- [ ] **Step 1: Add `select_url` function**

Append to `helpers/markdown_links.lua`:

```lua
local function find_inline_link(node)
  while node do
    if node:type() == "inline_link" then return node end
    node = node:parent()
  end
  return nil
end

function M.select_url(around)
  local node = vim.treesitter.get_node()
  local link = find_inline_link(node)
  if not link then
    vim.notify("No inline link under cursor", vim.log.levels.WARN)
    return
  end

  local dest
  for child in link:iter_children() do
    if child:type() == "link_destination" then dest = child end
  end
  if not dest then return end

  local sr, sc, er, ec = dest:range()
  if around then
    -- Expand to include surrounding `(` and `)`.
    sc = sc - 1
    ec = ec + 1
  end

  vim.api.nvim_win_set_cursor(0, { sr + 1, sc })
  vim.cmd("normal! v")
  vim.api.nvim_win_set_cursor(0, { er + 1, ec - 1 })
end
```

- [ ] **Step 2: Install mappings in `setup()`**

Add to `setup()`:

```lua
vim.keymap.set({ "o", "x" }, "iu", function() M.select_url(false) end, { buffer = buf, desc = "Inside URL" })
vim.keymap.set({ "o", "x" }, "au", function() M.select_url(true)  end, { buffer = buf, desc = "Around URL" })
```

- [ ] **Step 3: Manual test**

Open `/tmp/md-link-test.md`. Move cursor onto a link line. Test:

1. Press `viu` — confirm just the URL is highlighted (no parens).
2. Press `<Esc>`, then `vau` — confirm URL + surrounding `()` highlighted.
3. Press `<Esc>`, then `ciu`, type `https://changed.example.com`, `<Esc>` — confirm URL replaced.
4. Press `yiu` on a different link — confirm URL is in `"` register (`:reg "`).

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/helpers/markdown_links.lua
git commit -m "Add iu/au text objects for markdown link URLs"
```

---

## Task 5: Smart paste-as-link

**Files:**
- Modify: `nvim/.config/nvim/lua/helpers/markdown_links.lua`

- [ ] **Step 1: Add `paste_as_link` function**

Append:

```lua
local function looks_like_url(s)
  s = s:gsub("^%s+", ""):gsub("%s+$", "")
  return s:match("^https?://%S+$") ~= nil, s
end

local function get_visual_selection()
  local s = vim.fn.getpos("'<")
  local e = vim.fn.getpos("'>")
  local sr, sc = s[2] - 1, s[3] - 1
  local er, ec = e[2] - 1, e[3]
  local lines = vim.api.nvim_buf_get_text(0, sr, sc, er, ec, {})
  return table.concat(lines, "\n"), sr, sc, er, ec
end

function M.paste_as_link(mode)
  -- mode is "p" or "P". Read register, decide URL vs fallback.
  local raw = vim.fn.getreg('"')
  if raw == "" or raw == nil then raw = vim.fn.getreg("+") end
  local is_url, url = looks_like_url(raw or "")

  -- Leave visual mode so '<, '> are populated.
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x", false)

  local selection, sr, sc, er, ec = get_visual_selection()

  if not is_url or selection == "" or selection:find("\n") then
    -- Fallback: re-enter visual and do a normal paste.
    vim.schedule(function()
      vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("gv" .. mode, true, false, true), "n", false)
    end)
    return
  end

  local replacement = "[" .. selection .. "](" .. url .. ")"
  vim.api.nvim_buf_set_text(0, sr, sc, er, ec, { replacement })
  vim.api.nvim_win_set_cursor(0, { sr + 1, sc + #replacement })
end
```

- [ ] **Step 2: Install mappings in `setup()`**

Add:

```lua
vim.keymap.set("x", "p", function() M.paste_as_link("p") end, { buffer = buf, desc = "Paste (URL-aware)" })
vim.keymap.set("x", "P", function() M.paste_as_link("P") end, { buffer = buf, desc = "Paste before (URL-aware)" })
```

- [ ] **Step 3: Manual test — URL paste**

In `/tmp/md-link-test.md`:

1. Yank a URL: `:let @"="https://example.com/test"`.
2. Visually select the word `prose` in the `## Mixed prose` heading.
3. Press `p`. Expected: heading becomes `## Mixed [prose](https://example.com/test)`.

- [ ] **Step 4: Manual test — fallback paste**

1. Yank non-URL text: `:let @"="not-a-url"`.
2. Visually select any word.
3. Press `p`. Expected: normal paste replaces the selection with `not-a-url`.

- [ ] **Step 5: Manual test — multi-line fallback**

1. Yank a URL.
2. Visually select two lines.
3. Press `p`. Expected: normal paste (URL is not wrapped, because multi-line selection falls back).

- [ ] **Step 6: Commit**

```bash
git add nvim/.config/nvim/lua/helpers/markdown_links.lua
git commit -m "Add visual-mode paste-as-link for URLs in markdown"
```

---

## Task 6: Final verification pass

**Files:** none modified.

- [ ] **Step 1: Re-run the full manual checklist on `/tmp/md-link-test.md`**

1. Open file. No phantom wrap lines under long-URL line.
2. Move cursor onto long-URL line. No phantom wrap lines (always-collapsed).
3. `gx` over a link still opens the URL in browser.
4. `yi(` over `(url)` still yanks the URL (raw vim behavior preserved).
5. `viu` selects URL contents only.
6. `vau` selects URL with parens.
7. `ciu` then type → edits URL.
8. Visual-select word + `p` with URL in register → wraps as link.
9. Visual-select word + `p` with non-URL in register → normal paste.
10. Visual-select word + `P` with URL in register → wraps as link.
11. Switch to a non-markdown buffer (`:e ~/.bashrc` or similar). Confirm `iu`/`au` and `p`/`P` are **not** remapped.

- [ ] **Step 2: Check insert-mode editing still works**

On a link line, press `i` and confirm raw text becomes visible (default `concealcursor` behavior). Make a small edit, `<Esc>`, confirm rendering returns.

- [ ] **Step 3: No commit** (verification only)

---

## Self-Review Notes

- **Spec coverage:** Three goals from the spec — collapse, text object, smart paste — each have a dedicated task (2/3, 4, 5). Phase 2 fallback explicitly conditional on Task 2's outcome.
- **Buffer-local scope:** All mappings use `{ buffer = buf }`. `conceallevel` is set via `vim.opt_local`. No global side effects.
- **No placeholders:** Each task has complete code; no "TBD" / "similar to" / "implement later".
- **Type consistency:** Function names (`M.setup`, `M.select_url`, `M.paste_as_link`) match across tasks. Treesitter node types (`inline_link`, `link_text`, `link_destination`) used consistently.
- **Known risk:** `paste_as_link`'s fallback uses `feedkeys` to re-enter visual mode and call the original `p`. If a future Neovim version changes feedkeys semantics for visual mode this would need adjustment. Documented in the spec.
