-- Markdown motions that step over concealed syntax.
--
-- With `conceallevel` at 2 or more both conceal layers draw zero-width cells:
-- the treesitter highlighter applies the `#set! conceal ""` captures, and a
-- renderer (render-markdown) adds `conceal = ""` extmarks for what the grammar
-- does not cover (wiki-link brackets, a hidden wiki destination, an icon that
-- replaces a bullet). A native `h`/`l`/`w`/`b`/`e` that lands on one of those
-- bytes leaves the cursor on an invisible cell. These motions run the native
-- motion and then keep stepping in the same direction while the landing byte
-- is concealed, so the cursor always stops on a character the reader can see.
-- The visible link title keeps its own words.
--
-- Both sources are inspection, not a second Markdown parser: the `highlights`
-- query is the declaration the highlighter draws, and the extmarks are the
-- drawn state. With conceal off (`conceallevel` below 2, no `n` in
-- `concealcursor`, no active highlighter, no conceal extmarks) every motion is
-- the native one, which keeps raw editing and `:set conceallevel=0` untouched.
--
-- Normal mode only: operator-pending and visual motions stay native, and a
-- motion mapping never enters the redo buffer, so `.` keeps repeating the last
-- change.

local M = {}

--- `#set!` may sit on the pattern or on the capture, and the engine hands
-- back either the bare value or a `{ conceal = ... }` table.
local function zero_width(conceal)
  if conceal == nil then
    return false
  end
  local value = type(conceal) == "table" and conceal.conceal or conceal
  -- An empty replacement character is the only zero-width form: a conceal
  -- with an icon still occupies one cell.
  return value == ""
end

--- Byte columns the conceal layers hide on `row`, keyed by buffer tick.
local cache = { buf = -1, tick = -1, rows = {} }

--- Add the query captures that conceal `row` in `lang`.
local function add_capture_conceal(hidden, buf, row, tree, lang)
  local query = vim.treesitter.query.get(lang, "highlights")
  if not query then
    return
  end
  for id, node, metadata in query:iter_captures(tree:root(), buf, row, row + 1) do
    local capture_meta = metadata and metadata[id]
    local conceal = (metadata and metadata.conceal) or (capture_meta and capture_meta.conceal)
    if zero_width(conceal) then
      local range = vim.treesitter.get_range(node, buf, capture_meta)
      -- Four values (`start_row, start_col, end_row, end_col`), or six with
      -- the byte offsets spliced in on newer nvim.
      local start_row, end_row, start_col, end_col
      if #range == 6 then
        start_row, start_col, end_row, end_col = range[1], range[2], range[4], range[5]
      else
        start_row, start_col, end_row, end_col = range[1], range[2], range[3], range[4]
      end
      -- The concealed pieces of Markdown syntax never span lines; a
      -- multi-line capture is left to the native motion.
      if start_row == row and end_row == row then
        for col = start_col, end_col - 1 do
          hidden[col] = true
        end
      end
    end
  end
end

--- Add the zero-width conceal extmarks a renderer drew on `row`.
local function add_extmark_conceal(hidden, buf, row)
  for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, -1, { row, 0 }, { row, -1 }, { details = true })) do
    local details = mark[4] or {}
    local end_col = details.end_col or (mark[3] + 1)
    if details.conceal ~= nil and zero_width(details.conceal) then
      for col = mark[3], end_col - 1 do
        hidden[col] = true
      end
    end
  end
end

--- Concealed byte columns of `row` as a `{ [col] = true }` set (0-based).
function M.hidden(buf, row)
  buf = buf == 0 and vim.api.nvim_get_current_buf() or buf
  -- The highlighter is what turns the query conceal into drawn cells, so the
  -- query only speaks for the screen while it is running.
  local active = vim.treesitter.highlighter.active[buf] ~= nil
  local tick = vim.api.nvim_buf_get_changedtick(buf)
  if cache.buf ~= buf or cache.tick ~= tick or cache.active ~= active then
    cache = { buf = buf, tick = tick, active = active, rows = {} }
  end
  local hidden = cache.rows[row]
  if hidden then
    return hidden
  end
  hidden = {}
  cache.rows[row] = hidden

  add_extmark_conceal(hidden, buf, row)

  if not active then
    return hidden
  end
  local ok, parser = pcall(vim.treesitter.get_parser, buf)
  if not ok or not parser then
    return hidden
  end
  parser:parse()
  -- Injected trees (markdown_inline holds the link syntax) appear on a full
  -- parse; later parses stay incremental.
  if not next(parser:children() or {}) then
    parser:parse(true)
  end
  parser:for_each_tree(function(tree, lang_tree)
    add_capture_conceal(hidden, buf, row, tree, lang_tree:lang())
  end)
  return hidden
end

--- Concealed text is drawn in this window and normal mode.
local function drawn(win)
  return vim.wo[win].conceallevel >= 2 and vim.wo[win].concealcursor:find("n", 1, true) ~= nil
end

--- Run `motion` `count` times, stepping past concealed landings.
function M.move(motion, count)
  local win = vim.api.nvim_get_current_win()
  local buf = vim.api.nvim_get_current_buf()
  local function step()
    vim.cmd.normal({ args = { motion }, bang = true })
  end

  -- Conceal off: one native step per count, exactly what the key would do.
  local skip = drawn(win)
  for _ = 1, count do
    step()
    if skip then
      local cursor = vim.api.nvim_win_get_cursor(win)
      while M.hidden(buf, cursor[1] - 1)[cursor[2]] do
        local previous = cursor
        step()
        cursor = vim.api.nvim_win_get_cursor(win)
        -- The motion stopped (end of line, first column): the concealed cell
        -- is the nearest one, so the cursor stays there.
        if cursor[1] == previous[1] and cursor[2] == previous[2] then
          break
        end
      end
    end
  end
end

--- Bind the five motions for one buffer (normal mode only).
function M.setup()
  local buf = vim.api.nvim_get_current_buf()
  for _, motion in ipairs({ "h", "l", "w", "b", "e" }) do
    vim.keymap.set("n", motion, function()
      M.move(motion, vim.v.count1)
    end, { buffer = buf, silent = true, desc = "Markdown " .. motion .. " (skips concealed syntax)" })
  end
end

return M
