-- lua/helpers/reader.lua, exercised headless with a real window layout.
-- Guards the centered reader column:
--   * the eligibility rules (herdr scrollback, octo, non-prose buftypes);
--   * the column arithmetic (100 cells, window - 8, auto wherever it fits);
--   * enable/close leaves a symmetric two-filler layout, restores wrap and
--     linebreak, and maps q/<Esc> only while the column is open;
--   * the auto rule (a window too narrow for a 40-cell column stays alone,
--     every other window gets the column);
--   * a resize re-cuts the fillers, a window close and a buffer switch drop
--     them, and :write keeps the column open;
--   * a wide table row or mermaid line spills: the column grows to hold it, the
--     4-cell spill cap holds, prose keeps the 72-cell default, and a deleted
--     table shrinks the column back.
--
-- Headless nvim sizes 'columns'/'lines' itself, so every case pins them first.
-- Nothing here touches $HOME or the network.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local reader = require("helpers.reader")

local function win_count()
  return #vim.api.nvim_list_wins()
end

local function prose_buf(lines, ft)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = ""
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines or { "# Title", "", "Some prose in a column." })
  vim.bo[buf].filetype = ft or "markdown"
  return buf
end

local function target_info(win)
  return vim.fn.getwininfo(win)[1]
end

local function mapped(buf, lhs)
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(buf, "n")) do
    if m.lhs == lhs then
      return true
    end
  end
  return false
end

H.run("markdown_reader_spec", function()
  -- ── eligibility ─────────────────────────────────────────────────────────
  local md = prose_buf()
  H.eq(reader.eligible(md), true, "a markdown prose buffer uses the column")

  local text = prose_buf({ "plain" }, "text")
  H.eq(reader.eligible(text), false, "only markdown buffers use the column")

  local octo_ft = prose_buf({ "thread" }, "octo")
  H.eq(reader.eligible(octo_ft), false, "ft=octo never uses the column")

  local octo_name = prose_buf()
  vim.api.nvim_buf_set_name(octo_name, "octo://owner/repo/pull/1")
  H.eq(reader.eligible(octo_name), false, "an octo:// buffer never uses the column")

  local scrollback = prose_buf()
  vim.b[scrollback].herdr_scrollback = true
  H.eq(reader.eligible(scrollback), false, "herdr scrollback captures never use the column")

  local quickfix = prose_buf()
  vim.bo[quickfix].buftype = "quickfix"
  H.eq(reader.eligible(quickfix), false, "non-prose buftypes never use the column")

  -- ── column arithmetic ───────────────────────────────────────────────────
  H.eq(reader.column_width(159), 100, "a wide window pins the column to 100 cells")
  H.eq(reader.column_width(120), 100, "the column caps at 100 cells")
  H.eq(reader.column_width(80), 72, "a narrow window keeps 8 cells for the margins")
  H.eq(reader.should_auto(47), false, "47 columns leaves the column too narrow")
  H.eq(reader.should_auto(48), true, "48 columns holds the narrowest 40-cell column")
  H.eq(reader.should_auto(80), true, "an 80-cell window auto-enables")
  H.eq(reader.should_auto(110), true, "110 columns auto-enables")
  H.eq(reader.should_auto(159), true, "a wide window auto-enables")

  -- ── enable / close ──────────────────────────────────────────────────────
  vim.o.columns, vim.o.lines = 120, 40
  local buf = prose_buf()
  vim.api.nvim_set_current_buf(buf)
  vim.wo.wrap, vim.wo.linebreak = false, false
  vim.wo.fillchars = "eob:~,fold:-"
  H.eq(win_count(), 1, "one window before the reader")

  local win = vim.api.nvim_get_current_win()
  H.eq(reader.enable(win), true, "the reader opens on a wide markdown window")
  H.eq(reader.is_open(), true, "the reader reports itself open")
  H.eq(win_count(), 3, "two filler windows appear")

  local info = target_info(win)
  local text_width = info.width - info.textoff
  local left_blank = (info.wincol - 1) + info.textoff
  local right_blank = vim.o.columns - (left_blank + text_width)
  H.eq(text_width, 100, "the text sits in a 100-cell column")
  H.eq(math.abs(left_blank - right_blank) <= 1, true,
    string.format("the column is centered (left %d, right %d)", left_blank, right_blank))
  H.eq(vim.wo[win].wrap, true, "the column wraps prose")
  H.eq(vim.wo[win].linebreak, true, "the column breaks lines at words")
  local has_blank_vert = false
  local keeps_eob = false
  for part in tostring(vim.wo[win].fillchars):gmatch("[^,]+") do
    if part == "vert: " then
      has_blank_vert = true
    elseif part == "eob:~" then
      keeps_eob = true
    end
  end
  H.eq(has_blank_vert, true, "the separator beside the column is blank")
  H.eq(keeps_eob, true, "the other fillchars fields stay")
  H.eq(mapped(buf, "q"), true, "q closes the column")
  H.eq(mapped(buf, "<Esc>"), true, "<Esc> closes the column")

  -- :write keeps the column open
  local path = vim.fn.tempname() .. ".md"
  vim.api.nvim_buf_set_name(buf, path)
  vim.cmd("write")
  H.eq(vim.fn.filereadable(path), 1, ":write writes the buffer from the column")
  H.eq(win_count(), 3, ":write keeps the fillers")

  reader.close()
  H.eq(win_count(), 1, "closing the reader drops both fillers")
  H.eq(reader.is_open(), false, "the reader reports itself closed")
  H.eq(vim.wo[win].wrap, false, "the previous wrap value comes back")
  H.eq(vim.wo[win].linebreak, false, "the previous linebreak value comes back")
  H.eq(vim.wo[win].fillchars, "eob:~,fold:-", "the previous fillchars value comes back")
  H.eq(mapped(buf, "q"), false, "q is unbound after the close")
  H.eq(mapped(buf, "<Esc>"), false, "<Esc> is unbound after the close")
  vim.fn.delete(path)

  -- ── the auto rule ───────────────────────────────────────────────────────
  vim.o.columns = 47
  reader.maybe_auto(vim.api.nvim_get_current_win())
  H.eq(win_count(), 1, "a window too narrow for a 40-cell column stays alone")

  vim.o.columns = 80
  reader.maybe_auto(vim.api.nvim_get_current_win())
  H.eq(win_count(), 3, "an 80-cell window gets the column on its own")
  H.eq(vim.wo.wrap, true, "auto mode wraps prose too")
  local narrow = target_info(vim.api.nvim_get_current_win())
  H.eq(narrow.width - narrow.textoff, 72, "the 80-cell window fits a 72-cell column")
  reader.close()

  vim.o.columns = 110
  reader.maybe_auto(vim.api.nvim_get_current_win())
  H.eq(win_count(), 3, "a 110-cell window still gets the column on its own")
  reader.close()

  vim.o.columns = 140
  reader.maybe_auto(vim.api.nvim_get_current_win())
  H.eq(win_count(), 3, "a wide window gets the column on its own")
  H.eq(vim.wo.wrap, true, "auto mode wraps prose too")
  reader.close()

  -- a filetype that lands while the buffer is current reaches the autocmd
  reader.setup()
  vim.api.nvim_exec_autocmds("FileType", { pattern = "markdown" })
  vim.wait(1000, function()
    return win_count() == 3
  end, 10)
  H.eq(win_count(), 3, "the FileType autocmd auto-enables the column")

  -- a second markdown buffer keeps the column: the markdown FileType callback
  -- resets wrap, and the reader puts it back
  local second = prose_buf({ "# Other", "", "More prose." })
  vim.api.nvim_win_set_buf(vim.api.nvim_get_current_win(), second)
  vim.wo.wrap = false -- what the markdown FileType callback does
  vim.api.nvim_exec_autocmds("FileType", { pattern = "markdown" })
  vim.wait(1000, function()
    return vim.wo.wrap == true
  end, 10)
  H.eq(reader.is_open(), true, "a markdown buffer switch keeps the column")
  H.eq(vim.wo.wrap, true, "the column re-applies wrap after the switch")
  H.eq(win_count(), 3, "the fillers survive a markdown buffer switch")

  -- ── a buffer switch drops the column ────────────────────────────────────
  local octo = prose_buf({ "thread" }, "octo")
  vim.api.nvim_win_set_buf(vim.api.nvim_get_current_win(), octo)
  vim.wait(1000, function()
    return win_count() == 1
  end, 10)
  H.eq(win_count(), 1, "a switch to an octo buffer drops the column")
  H.eq(reader.is_open(), false, "the reader closes with the buffer switch")

  -- octo buffers never get the column, whatever the window width
  reader.maybe_auto(vim.api.nvim_get_current_win())
  H.eq(win_count(), 1, "an octo buffer never auto-enables")

  local scrollback_buf = prose_buf()
  vim.b[scrollback_buf].herdr_scrollback = true
  vim.api.nvim_win_set_buf(vim.api.nvim_get_current_win(), scrollback_buf)
  reader.maybe_auto(vim.api.nvim_get_current_win())
  H.eq(win_count(), 1, "a herdr scrollback buffer never auto-enables")

  -- ── a resize re-cuts the fillers ────────────────────────────────────────
  local prose = prose_buf()
  vim.api.nvim_win_set_buf(vim.api.nvim_get_current_win(), prose)
  vim.o.columns = 120
  reader.enable(vim.api.nvim_get_current_win())
  H.eq(win_count(), 3, "the reader is open before the resize")

  vim.o.columns = 200
  vim.api.nvim_exec_autocmds("VimResized", {})
  local function centered()
    local i = target_info(vim.api.nvim_get_current_win())
    local tw = i.width - i.textoff
    local lb = (i.wincol - 1) + i.textoff
    return math.abs(lb - (vim.o.columns - (lb + tw))) <= 1
  end
  vim.wait(1000, centered, 10)
  local resized = target_info(vim.api.nvim_get_current_win())
  local w = resized.width - resized.textoff
  local l = (resized.wincol - 1) + resized.textoff
  H.eq(w, 100, "the resize keeps the 100-cell column")
  H.eq(centered(), true,
    string.format("the resize keeps the column centered (left %d, right %d)", l, vim.o.columns - (l + w)))

  -- a resize below the minimum drops the column
  vim.o.columns = 40
  vim.api.nvim_exec_autocmds("VimResized", {})
  vim.wait(1000, function()
    return win_count() == 1
  end, 10)
  H.eq(win_count(), 1, "a too-narrow resize drops the column")

  -- ── closing the editing window drops the fillers ────────────────────────
  vim.o.columns = 140
  local closing = prose_buf()
  vim.api.nvim_set_current_buf(closing)
  reader.enable(vim.api.nvim_get_current_win())
  H.eq(win_count(), 3, "the reader is open before the window close")
  vim.api.nvim_win_close(vim.api.nvim_get_current_win(), true)
  vim.wait(1000, function()
    return win_count() == 1
  end, 10)
  H.eq(win_count(), 1, "closing the editing window drops the fillers")

  -- ── spill: a wide table or mermaid line widens the column ───────────────
  -- Prose keeps the 8-cell margin; a spill line may take the column up to
  -- 4 cells short of the window (one filler cell and one separator each side).
  H.eq(reader.read_width(120, 0), 100, "a prose-only buffer keeps the 100-cell column")
  H.eq(reader.read_width(80, 0), 72, "an 80-cell window keeps the 72-cell prose column")
  H.eq(reader.read_width(80, 76), 76, "a 76-cell spill line grows the column to 76")
  H.eq(reader.read_width(80, 200), 76, "a spill line past the cap stops at 80 - 4 cells")
  H.eq(reader.read_width(120, 110), 110, "a 110-cell spill line grows a 100-cell column")

  -- A lone pipe in prose is not a table, and a plain fence is not mermaid.
  local pipes = prose_buf({ "# Title", "a | b in prose", "", "more | pipes | here" })
  H.eq(reader.spill_width(pipes), 0, "a lone pipe in prose never counts as a table row")
  local lua_fence = prose_buf({ "```lua", string.rep("x", 120), "```" })
  H.eq(reader.spill_width(lua_fence), 0, "a non-mermaid fence never counts as spill")

  -- a two-cell GFM row that is exactly `width` cells wide
  local function table_row(width)
    return { "| a | b |", "| --- | --- |", "| " .. string.rep("x", width - 8) .. " | b |" }
  end

  vim.fn.delete(vim.fn.tempname())
  reader.close()
  vim.o.columns, vim.o.lines = 80, 40
  local spill_win = vim.api.nvim_get_current_win()
  -- prose only: the default column does not move
  vim.api.nvim_win_set_buf(spill_win, prose_buf({ "# Prose", "", "Some prose in a column." }))
  H.eq(reader.enable(spill_win), true, "the reader opens on a prose buffer in an 80-cell window")
  local prose_info = target_info(spill_win)
  H.eq(prose_info.width - prose_info.textoff, 72, "prose only keeps the 72-cell column")
  reader.close()

  -- a 76-cell table row in an 80-cell window: the column grows to hold it
  local lines = table_row(76)
  H.eq(#lines[3], 76, "the fixture row is 76 cells wide")
  local table_buf = prose_buf(lines)
  H.eq(reader.spill_width(table_buf), 76, "the table row measures 76 cells")
  vim.api.nvim_win_set_buf(spill_win, table_buf)
  H.eq(reader.enable(spill_win), true, "the reader opens on a wide table")
  local grown = target_info(spill_win)
  H.eq(grown.width - grown.textoff, 76, "the column grows to the 76-cell row")
  local grown_left = (grown.wincol - 1) + grown.textoff
  local grown_right = vim.o.columns - (grown_left + (grown.width - grown.textoff))
  H.eq(math.abs(grown_left - grown_right) <= 1, true,
    string.format("the grown column stays centered (left %d, right %d)", grown_left, grown_right))
  H.eq(vim.api.nvim_win_text_height(spill_win, { start_row = 2, end_row = 2 }).all, 1,
    "the grown column shows the table row on one screen line")
  H.eq(vim.wo[spill_win].wrap, true, "the grown column still wraps prose")
  reader.close()

  -- a wide mermaid line grows the column the same way
  local mermaid_line = "graph LR; " .. string.rep("A", 66)
  H.eq(#mermaid_line, 76, "the fixture mermaid line is 76 cells wide")
  local mermaid_buf = prose_buf({ "```mermaid", mermaid_line, "```" })
  H.eq(reader.spill_width(mermaid_buf), 76, "the mermaid line measures 76 cells")
  vim.api.nvim_win_set_buf(spill_win, mermaid_buf)
  H.eq(reader.enable(spill_win), true, "the reader opens on a wide mermaid block")
  local mer = target_info(spill_win)
  H.eq(mer.width - mer.textoff, 76, "a mermaid line grows the column to 76 cells")
  H.eq(vim.api.nvim_win_text_height(spill_win, { start_row = 1, end_row = 1 }).all, 1,
    "the grown column shows the mermaid line on one screen line")
  reader.close()

  -- a row wider than the 4-cell cap wraps: the documented fallback
  local over = table_row(77)
  H.eq(#over[3], 77, "the over-cap fixture row is 77 cells wide")
  local over_buf = prose_buf(over)
  vim.api.nvim_win_set_buf(spill_win, over_buf)
  H.eq(reader.enable(spill_win), true, "the reader opens on an over-cap table")
  local capped = target_info(spill_win)
  H.eq(capped.width - capped.textoff, 76, "an over-cap row stops the column at 76 cells")
  H.eq(vim.api.nvim_win_text_height(spill_win, { start_row = 2, end_row = 2 }).all, 2,
    "the over-cap row wraps onto two screen lines")

  -- deleting the wide table shrinks the column back to the prose default
  vim.wait(50, function()
    return false -- let any scheduled sync land before the edit
  end, 10)
  vim.api.nvim_buf_set_lines(over_buf, 0, -1, false, { "# Prose again", "", "short lines" })
  vim.api.nvim_exec_autocmds("TextChanged", { buffer = over_buf })
  local function shrunk()
    local info_now = target_info(spill_win)
    return info_now ~= nil and info_now.width - info_now.textoff == 72
  end
  vim.wait(1000, shrunk, 10)
  H.eq(shrunk(), true, "deleting the wide table shrinks the column back to 72 cells")

  -- an edit that widens the table widens the column again
  vim.api.nvim_buf_set_lines(over_buf, 0, -1, false, table_row(74))
  vim.api.nvim_exec_autocmds("TextChanged", { buffer = over_buf })
  local function regrown()
    local info_now = target_info(spill_win)
    return info_now ~= nil and info_now.width - info_now.textoff == 74
  end
  vim.wait(1000, regrown, 10)
  H.eq(regrown(), true, "a table edited wider grows the column again")
  reader.close()
end)
