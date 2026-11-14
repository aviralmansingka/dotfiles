-- helpers/markdown_markers.lua: glyphs for the marker shapes the grammar has no
-- node for yet.
--
-- While you type, a dash-only line is normal and unparsed: the grammar calls it a
-- setext h2 underline, so render-markdown would show the raw dash until the next
-- keystroke. The handler draws the bullet the plugin would draw, and never
-- touches a row the grammar already covers. Empty checkboxes are handled by the
-- plugin's own custom tokens (`[ ]`, `[x]`, `[X]`), so the handler stays out of
-- those rows entirely.
--
-- No plugin bootstrap: the plugin's resolved config is stubbed through
-- `package.loaded["render-markdown.state"]`, and the tree is the bundled markdown
-- parser. A raising config must never break the handler, since it runs inside the
-- plugin's own markdown parse.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local markers = require("helpers.markdown_markers")

local config = {
  bullet = { enabled = true, icons = { "B1", "B2", "B3" }, highlight = "RenderMarkdownBullet" },
  checkbox = {
    enabled = true,
    unchecked = { icon = "U", highlight = "RenderMarkdownUnchecked" },
    checked = { icon = "C", highlight = "RenderMarkdownChecked" },
    custom = {},
  },
}

local function stub_config(value)
  package.loaded["render-markdown.state"] = {
    get = function()
      if value ~= nil then
        return value
      end
      return config
    end,
  }
end

--- Parse `lines` in a markdown buffer and return the handler's marks.
local function marks_for(lines, shiftwidth)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = "markdown"
  vim.bo[buf].shiftwidth = shiftwidth or 2
  local parser = vim.treesitter.get_parser(buf, "markdown")
  local root = parser:parse()[1]:root()
  return markers.parse({ buf = buf, root = root })
end

--- The glyph marks only: they carry a virt_text and the conceal of the raw bytes.
local function glyphs(marks)
  return vim.tbl_filter(function(mark)
    return mark.opts.virt_text ~= nil and mark.opts.conceal == ""
  end, marks)
end

--- The conceal-only marks: the plugin draws the glyph on that row already.
local function conceals(marks)
  return vim.tbl_filter(function(mark)
    return mark.opts.virt_text == nil and mark.opts.conceal == ""
  end, marks)
end

H.run("markdown_markers_spec", function()
  stub_config()

  -- ── an indented empty bullet is a setext underline to the grammar ───────
  local found = glyphs(marks_for({ "- parent item", "  - " }))
  H.eq(#found, 1, "one glyph covers the unparsed indented marker")
  H.eq(found[1].start_row, 1, "the glyph anchors on the empty nested bullet")
  H.eq(found[1].start_col, 2, "the glyph starts at the marker column")
  H.eq(found[1].opts.end_col, 4, "the marker and its space are concealed")
  H.eq(found[1].opts.virt_text[1][1], "B2", "a second-level bullet icon is used")
  H.eq(found[1].opts.virt_text[1][2], "RenderMarkdownBullet", "the icon uses the plugin highlight")
  H.eq(found[1].conceal, false, "the glyph is never hidden under the cursor")

  -- the level follows the indent, not the nesting the grammar lost
  found = glyphs(marks_for({ "- a", "    - " }))
  H.eq(found[1].opts.virt_text[1][1], "B3", "a deeper indent picks the next icon")

  -- a dash-only line under prose is the same shape
  found = glyphs(marks_for({ "some prose", "- " }))
  H.eq(#found, 1, "an empty bullet under prose gets a glyph")
  H.eq(found[1].start_col, 0, "the top-level marker starts in column zero")

  -- ── a parsed item keeps the plugin's own marker ────────────────────────
  found = glyphs(marks_for({ "- a", "- " }))
  H.eq(#found, 0, "a parsed empty bullet gets no second glyph")
  local hidden = conceals(marks_for({ "- a", "- " }))
  H.eq(#hidden, 1, "the spaces after a parsed marker are concealed")
  H.eq(hidden[1].start_col, 1, "only the space is concealed, not the marker")

  -- ── empty checkboxes go through the plugin's custom tokens ─────────────
  -- `[ ]`, `[x]`, and `[X]` are custom checkbox tokens in the plugin opts, so
  -- the plugin's own checkbox renderer draws an empty box. The handler must not
  -- draw a second marker on those rows.
  H.eq(#glyphs(marks_for({ "- a", "- [ ] " })), 0, "an empty box is left to the plugin")
  H.eq(#glyphs(marks_for({ "- a", "- [x] " })), 0, "an empty checked box is left to the plugin")
  H.eq(#glyphs(marks_for({ "- a", "- [-] " })), 0, "a custom token is left to the plugin")
  H.eq(#glyphs(marks_for({ "- [ ] has text" })), 0, "a filled checkbox is left to the plugin")

  -- ── dashed lines that are content ──────────────────────────────────────
  H.eq(#glyphs(marks_for({ "```", "- not a bullet", "```" })), 0, "a fence keeps its dashes")
  H.eq(#glyphs(marks_for({ "- a", "  - b" })), 0, "a filled nested item is parsed")

  -- ── guards ─────────────────────────────────────────────────────────────
  stub_config()
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "- a", "  - " })
  vim.bo[buf].filetype = "markdown"
  local root = vim.treesitter.get_parser(buf, "markdown"):parse()[1]:root()
  vim.bo[buf].filetype = "lua"
  H.eq(markers.parse({ buf = buf, root = root }), {}, "a non-markdown buffer gets no glyphs")

  vim.bo[buf].filetype = "markdown"
  local ok, result = pcall(markers.parse, { buf = buf, root = root })
  H.eq(ok, true, "a raising handler chain never propagates")
  H.eq(#glyphs(result), 1, "the glyphs survive when the ansi parser is clean")

  package.loaded["render-markdown.state"] = {
    get = function()
      error("no config")
    end,
  }
  ok, result = pcall(markers.parse, { buf = buf, root = root })
  H.eq(ok, true, "a config failure stays inside the handler")
  H.eq(#glyphs(result), 0, "no glyphs are drawn without a resolved config")
end)
