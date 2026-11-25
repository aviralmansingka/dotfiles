-- Markers the parser cannot see yet.
--
-- render-markdown draws only nodes the grammar emits. A dash-only line has no
-- list node, because the grammar reads it as a setext h2 underline
-- (tree-sitter-grammars/tree-sitter-markdown#202). So a bullet you just added
-- shows its raw dash until the first character arrives. An empty checkbox has
-- the same gap in the grammar, and it is covered by the `[ ]`/`[x]` custom
-- tokens in the plugin opts, which reach the plugin's own checkbox renderer.
--
-- This handler draws the glyph the plugin would draw for the parsed bullet, and
-- also hides the spaces after a parsed empty marker, so the listchar `trail`
-- glyph never draws a dot beside the icon. It runs inside render-markdown's own
-- markdown handler, so the marks follow every edit and vanish on the next
-- keystroke, when the grammar produces the real node.
--
-- Marks carry `conceal = false` (never hidden under the cursor) and place the
-- glyph inline over the concealed raw marker, which is the shape the plugin
-- itself uses for a marker that is wider than its icon.

local M = {}

--- Cycle a config value by list level, the same way the plugin resolves it.
--- A function value resolves per node inside the plugin, so it is left alone.
local function cycle(value, index)
  if type(value) == "function" then
    return nil
  end
  if type(value) ~= "table" then
    return value
  end
  if #value == 0 then
    return nil
  end
  return value[(index - 1) % #value + 1]
end

--- Leading whitespace as display columns, plus its byte length.
local function leading(line, tabstop)
  local columns, bytes = 0, 0
  while bytes < #line do
    local char = line:sub(bytes + 1, bytes + 1)
    if char == " " then
      columns = columns + 1
    elseif char == "\t" then
      columns = columns + tabstop
    else
      break
    end
    bytes = bytes + 1
  end
  return columns, bytes
end

--- Rows where a dashed line is content rather than a marker.
local OPAQUE = {
  fenced_code_block = true,
  indented_code_block = true,
  html_block = true,
  minus_metadata = true,
  plus_metadata = true,
  pipe_table = true,
}

--- Classify the tree once: rows the grammar already renders, and rows where raw
--- dashes are content.
local function classify(root)
  local rendered, opaque = {}, {}
  local function visit(node)
    local node_type = node:type()
    local start_row, _, end_row = node:range()
    if node_type == "list_item" then
      for child in node:iter_children() do
        if child:type():match("^list_marker") then
          rendered[select(1, child:range())] = true
          break
        end
      end
    elseif OPAQUE[node_type] then
      for row = start_row, end_row do
        opaque[row] = true
      end
    end
    for child in node:iter_children() do
      visit(child)
    end
  end
  visit(root)
  return rendered, opaque
end

--- Hide raw bytes without drawing anything: the plugin already draws the glyph.
local function conceal_mark(row, start_col, end_col)
  return {
    conceal = false,
    start_row = row,
    start_col = start_col,
    opts = {
      end_col = end_col,
      conceal = "",
      priority = 1000,
    },
  }
end

--- A glyph over the raw marker: inline icon, raw bytes concealed.
local function glyph_mark(row, start_col, end_col, icon, highlight)
  return {
    conceal = false,
    start_row = row,
    start_col = start_col,
    opts = {
      end_col = end_col,
      conceal = "",
      virt_text = { { icon, highlight } },
      virt_text_pos = "inline",
      priority = 1000,
    },
  }
end

function M.parse(ctx)
  local marks = require("helpers.markdown_ansi").parse(ctx)
  -- An error here would abort the plugin's whole markdown render, so the extra
  -- glyphs stay best effort: the ansi marks and the built-in render survive.
  pcall(M.extend, ctx, marks)
  return marks
end

--- Append a glyph for every marker the grammar has no node for yet.
function M.extend(ctx, marks)
  if vim.bo[ctx.buf].filetype ~= "markdown" then
    return
  end
  local config = require("render-markdown.state").get(ctx.buf)
  local rendered, opaque = classify(ctx.root)

  local lines = vim.api.nvim_buf_get_lines(ctx.buf, 0, -1, false)
  local tabstop = vim.bo[ctx.buf].tabstop
  local shiftwidth = vim.bo[ctx.buf].shiftwidth
  if shiftwidth == 0 then
    shiftwidth = tabstop
  end

  for index, line in ipairs(lines) do
    local row = index - 1
    local lead, dash, gap, rest = line:match("^(%s*)([-*+])(%s*)(.*)$")
    if lead and not opaque[row] then
      local marker_end = #lead + #dash + #gap
      if rest == "" then
        if config.bullet.enabled then
          if rendered[row] then
            -- The plugin draws this marker already. Hide the spaces after it,
            -- or the listchar "trail" glyph draws a dot next to the bullet.
            local gap_start = #lead + #dash
            if gap_start < #line then
              marks[#marks + 1] = conceal_mark(row, gap_start, #line)
            end
          else
            local columns = leading(line, tabstop)
            local icon = cycle(config.bullet.icons, math.floor(columns / shiftwidth) + 1)
            if icon then
              marks[#marks + 1] = glyph_mark(row, #lead, marker_end, icon, config.bullet.highlight)
            end
          end
        end
      end
    end
  end
  return marks
end

return M
