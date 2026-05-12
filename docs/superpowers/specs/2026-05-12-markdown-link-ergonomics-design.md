# Markdown Link Ergonomics — Design

## Problem

Long inline markdown links (`[text](https://very-long-url...)`) cause two pains in Neovim:

1. **Phantom wrap whitespace.** With `wrap=true` and a long URL, the line wraps to multiple visual lines. The concealed URL bytes still consume wrap width, so the second/third/Nth visual lines render as blank space. Example: pasting two `[Fix in Cursor](…) [Fix in Web](…)` links produces six visual lines for two visible labels.
2. **Awkward URL editing.** Editing the URL requires manually finding the parens, selecting between them, and typing the replacement.
3. **Manual link wrapping.** Pasting a URL onto selected text requires three steps (`c[`, paste, `]()` etc.) instead of one.

## Goals

Three filetype-scoped features for `markdown`:

1. **Collapse** — inline links never visually expand the line. URL stays in the buffer (so `gx`, `yi(`, treesitter motions still work) but takes zero visual width regardless of cursor position.
2. **URL text object** — `iu` selects the URL contents, `au` includes the surrounding parens.
3. **Smart paste-as-link** — in visual mode, pasting a URL wraps the selection as `[selection](url)`.

Non-goals:

- Changing on-disk file format (no auto-conversion to reference-style links).
- Custom URL-opener (existing `gx` is fine).
- Behavior in non-markdown buffers.

## Architecture

Single new helper module:

```
nvim/.config/nvim/lua/helpers/markdown_links.lua
```

Exports `M.setup(opts?)`. Called once from the existing markdown FileType autocmd in `nvim/.config/nvim/lua/plugins/markdown.lua`:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  callback = function()
    -- existing pencil setup …
    require("helpers.markdown_links").setup()
  end,
})
```

The module installs:

- A buffer-local `conceallevel` override (collapse phase 1).
- Buffer-local mappings for `iu`/`au` (operator-pending + visual).
- Buffer-local mappings for `p`/`P` (visual mode only).
- Optionally (phase 2): an autocmd group + extmark namespace for custom link rendering.

All side effects are buffer-local so non-markdown buffers are untouched.

## Feature 1 — Collapse

### Phase 1 (try first, settings only)

In the markdown FileType autocmd:

```lua
vim.opt_local.conceallevel = 3
```

`conceallevel=3` makes concealed regions take zero visual width — replacement chars are also hidden. Verification step during implementation: open a buffer containing the user's reproducer (two long-URL links on one line) and confirm:

- No blank wrap continuation lines below the link line.
- render-markdown icons (`󰌹`, github/youtube custom icons) still appear.

If both hold, collapse is done. If icons disappear or wrap persists, fall through to phase 2.

### Phase 2 (custom extmark renderer, only if phase 1 fails)

In render-markdown opts, set `link.enabled = false` to stop double-rendering.

In `helpers/markdown_links.lua`:

- Namespace: `vim.api.nvim_create_namespace("markdown_links")`.
- Autocmds (buffer-local): `BufEnter`, `TextChanged`, `TextChangedI`, `InsertLeave` → `vim.schedule(render)`.
- `render(buf)`:
  1. `parser = vim.treesitter.get_parser(buf, "markdown_inline")`; `tree = parser:parse()[1]`.
  2. Treesitter query: `((inline_link (link_text) @text (link_destination) @url) @link)`.
  3. Clear all extmarks in the namespace for the buffer.
  4. For each match:
     - Extmark covering bytes from the closing `]` through the closing `)` with `conceal = ""` (zero-width concealment).
     - Extmark at the start byte of `[` with `virt_text = { { icon, "RenderMarkdownLink" } }, virt_text_pos = "inline"`. Icon chosen from a domain table matching the existing `link.custom` patterns in `plugins/markdown.lua` (github/youtube/discord/etc.), default `󰌹 `.

Icon table is duplicated here from render-markdown's config — small, stable list, and we want this module self-contained.

## Feature 2 — URL text object (`iu` / `au`)

Pure treesitter, no plugin dependency.

`M.select_url(around)` is a Lua function that:

1. Gets cursor node via `vim.treesitter.get_node()`.
2. Walks up until it finds an `inline_link` node. If none, beep and return.
3. Locates the `link_destination` child node.
4. For `iu` (around=false): selects the `link_destination` range (just URL chars).
   For `au` (around=true): expands one byte on each side to include `(` and `)`.
5. Enters charwise visual mode with the computed range via `vim.api.nvim_buf_set_mark` + `normal! gv` or `vim.fn.setpos` + `normal! v`.

Mappings (buffer-local, markdown only):

```lua
vim.keymap.set({ "o", "x" }, "iu", function() M.select_url(false) end, { buffer = true })
vim.keymap.set({ "o", "x" }, "au", function() M.select_url(true)  end, { buffer = true })
```

Usage: `ciu` deletes URL contents and enters insert mode; `viu` selects URL; `yau` yanks `(url)` including parens.

## Feature 3 — Smart paste-as-link

`M.paste_as_link(mode)` where `mode` is `"p"` or `"P"`:

1. Read the unnamed register: `reg = vim.fn.getreg('"')`. If the user copied from the system clipboard, this still works because `clipboard=unnamedplus` is typical in this config; if not, fall back to `'+'`.
2. Trim whitespace. If the trimmed content matches `^https?://%S+$` → URL mode. Otherwise → fall back to normal `p`/`P`.
3. URL mode:
   - Read the visual selection text via `vim.api.nvim_buf_get_text` using marks `'<` and `'>`.
   - Build replacement: `"[" .. selection .. "](" .. url .. ")"`.
   - Replace the selection with `vim.api.nvim_buf_set_text`.
   - Position cursor after the closing `)`.
   - Leave visual mode.
4. Fallback mode: `vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("gv" .. mode, true, false, true), "n", false)` — re-select then paste.

Mappings (buffer-local, markdown only):

```lua
vim.keymap.set("x", "p", function() M.paste_as_link("p") end, { buffer = true })
vim.keymap.set("x", "P", function() M.paste_as_link("P") end, { buffer = true })
```

Edge cases:

- **Empty selection** — shouldn't happen in visual mode, but guard with `if selection == "" then fallback end`.
- **Multi-line selection** — fall back to normal paste (URL-wrapping a multi-line selection is ambiguous).
- **Selection contains `]` or `)`** — accept; user can fix afterward. Don't auto-escape.
- **URL contains spaces** — regex requires `\S+$`, so quoted/spaced clipboard contents fall through to normal paste.
- **`P` semantics** — for paste-as-link, `p` and `P` do the same thing (wrap selection); only fallback differs.

## File Layout & Wire-Up

**New file:** `nvim/.config/nvim/lua/helpers/markdown_links.lua` (~150 lines).

Public surface:

```lua
local M = {}
function M.setup(opts) end          -- install everything for current buffer
function M.select_url(around) end   -- text object impl
function M.paste_as_link(mode) end  -- paste impl
return M
```

**Modified file:** `nvim/.config/nvim/lua/plugins/markdown.lua`:

- In the existing `FileType=markdown` autocmd: add `vim.opt_local.conceallevel = 3` and `require("helpers.markdown_links").setup()`.
- (Phase 2 only, if needed) set `link.enabled = false` in render-markdown opts.

## Testing / Verification

Reproducer file `/tmp/md-link-test.md`:

```markdown
# Test

[Fix in Cursor](https://cursor.com/open?link=eyJ2ZXJzaW9uIjoxLCJ0eXBlIjoiQlVHQk9UX0ZJWF9JTl9DVVJTT1IiLCJkYXRhIjp7InJlZGlzS2V5IjoiYnVnYm90Ojk1NWU5NzM0LTI3OWUtNDI3MC04MDZmLTI1ZDI5ZmNlNzc2NiJ9fQ) [Fix in Web](https://cursor.com/agents?link=eyJ2ZXJzaW9uIjoxfQ)

short [github](https://github.com/x/y) and [youtube](https://youtube.com/watch?v=abc) links.
```

Manual checks:

1. Open the file. Confirm no blank wrap lines below the long-link line. Cursor on/off the line.
2. Position cursor on a URL; press `viu`. Confirm just the URL is highlighted.
3. Press `vau` on `(https://...)`. Confirm parens included.
4. Select the text `github` in visual mode. Yank some URL into the register (`:let @"="https://example.com"`). Press `p`. Confirm replacement becomes `[github](https://example.com)`.
5. Same as 4 but with non-URL register content. Confirm normal paste.

No automated tests — pure config code, plugins-style.

## Open Questions / Risks

- **render-markdown interaction.** If phase 1 works, render-markdown still owns the rendering and we just bumped conceallevel. If it doesn't, phase 2 disables render-markdown's link block, which may interact with `anti_conceal.link` mode tables. Verify during implementation.
- **`autolist.nvim` and `pencil.vim` mappings.** They may install their own `p`/`P` mappings or formatting hooks. Buffer-local mappings should win, but verify nothing strips our handler.
- **Conceal in insert mode.** Default behavior with `conceallevel=3` is that the cursor line shows raw text in insert mode (via `concealcursor`). Confirm this still works so users can edit a link line.

## Rollout

One-shot edit + manual test. No flags, no migration. If the user dislikes the smart-paste override they can comment out two lines.
