-- Reader mode: centers a prose buffer in a fixed-width column.
--
-- Two filler windows sit on each side of the editing window. The editing
-- window stays a normal split window, so editing, LSP, and :w keep working.
-- A single float was measured and rejected: the window below stays visible in
-- the margins, so the markdown text shows twice (head on the left, tail on
-- the right).
--
-- wrap and linebreak are on for prose while the reader is open. Both values
-- come back on exit, so the markdown FileType keeps its own wrap=false.

local M = {}

local COLUMN = 100 -- fallback when the buffer wraps at no set width
local MIN_COLUMN = 40 -- a column below this width gains nothing
local MARGIN = 8 -- cells kept free for the two filler windows

local session -- { win, buf, left, right, wrap, linebreak }

local function notify(message)
  vim.notify("Reader: " .. message, vim.log.levels.INFO)
end

--- The width the buffer wraps prose at: 'textwidth', else the fallback column.
--- The formatter and `gq` use the same number, so the column matches the text.
function M.text_width(buf)
  buf = (buf == nil or buf == 0) and vim.api.nvim_get_current_buf() or buf
  local tw = vim.bo[buf].textwidth
  if tw ~= nil and tw > 0 then
    return tw
  end
  return COLUMN
end

--- Wanted text width for a window that offers `width` cells.
function M.column_width(width, preferred)
  return math.min(preferred or COLUMN, width - MARGIN)
end

--- Auto-enable rule. The column is the default for reading markdown. Auto-enable
--- it wherever it fits: the window must hold MIN_COLUMN cells or more.
function M.should_auto(width, preferred)
  return M.column_width(width, preferred) >= MIN_COLUMN
end

--- A prose buffer can use the reader column.
function M.eligible(buf)
  buf = (buf == nil or buf == 0) and vim.api.nvim_get_current_buf() or buf
  if not vim.api.nvim_buf_is_valid(buf) then
    return false
  end
  -- Herdr scrollback captures: :write replays the capture, not prose.
  if vim.b[buf].herdr_scrollback then
    return false
  end
  -- Octo buffers hold review threads and diffs, not prose.
  if vim.bo[buf].filetype == "octo" or vim.api.nvim_buf_get_name(buf):match("^octo://") then
    return false
  end
  if vim.bo[buf].buftype ~= "" then
    return false
  end
  return vim.bo[buf].filetype == "markdown"
end

function M.is_open()
  return session ~= nil and vim.api.nvim_win_is_valid(session.win)
end

local function text_offset(win)
  local info = vim.fn.getwininfo(win)[1]
  return info and info.textoff or 0
end

local function blank_vert(value)
  local parts = {}
  for part in tostring(value):gmatch("[^,]+") do
    if not part:match("^vert:") then
      parts[#parts + 1] = part
    end
  end
  parts[#parts + 1] = "vert: " -- no separator line beside the column
  return table.concat(parts, ",")
end

local function filler(win, side, width)
  local buf = vim.api.nvim_create_buf(false, true)
  local pad = vim.api.nvim_open_win(buf, false, { split = side, win = win, width = width })
  local wo = vim.wo[pad]
  wo.number, wo.relativenumber = false, false
  wo.signcolumn, wo.foldcolumn, wo.statuscolumn = "no", "0", ""
  wo.winbar, wo.colorcolumn = "", ""
  wo.wrap, wo.linebreak, wo.list, wo.spell = false, false, false, false
  wo.cursorline, wo.cursorcolumn = false, false
  wo.fillchars = "eob: ,vert: " -- empty column, no ~ marks
  wo.winhl = "Normal:Normal"
  return pad
end

local function set_pad_width(pad, width)
  vim.wo[pad].winfixwidth = false
  vim.api.nvim_win_set_width(pad, width)
  vim.wo[pad].winfixwidth = true
end

-- Cut the column out of `avail` cells. The text area is centered, not the
-- window: 'statuscolumn' and the sign column stay in the left margin.
local function metrics(win, avail)
  local off = text_offset(win)
  local column = M.column_width(avail, M.text_width(vim.api.nvim_win_get_buf(win)))
  if column < MIN_COLUMN then
    return nil
  end
  local left = math.floor((avail - column) / 2) - 1 - off
  local target = column + off
  if left < 1 or left + target + 2 > avail then
    return nil
  end
  return { column = column, target = target, left = left }
end

-- Size the two fillers and the editing window. The right filler takes what is
-- left over, so only the left filler and the editing window need a width.
local function layout()
  local win = session.win
  local left = session.left
  local right = session.right
  local avail = vim.api.nvim_win_get_width(left) + 1 + vim.api.nvim_win_get_width(win) + 1
    + vim.api.nvim_win_get_width(right)
  local cut = metrics(win, avail)
  if not cut then
    return false
  end
  set_pad_width(left, cut.left)
  local fix = vim.wo[win].winfixwidth
  vim.wo[win].winfixwidth = false
  vim.api.nvim_win_set_width(win, cut.target)
  vim.wo[win].winfixwidth = fix
  return true
end

-- The reader window options. A later FileType callback (the markdown wrap
-- reset) or a global option write can undo them, so every sync calls this.
local function dress(win)
  vim.wo[win].wrap = true
  vim.wo[win].linebreak = true
  vim.wo[win].fillchars = blank_vert(session.fillchars)
end

-- Keep the column in step with the buffer that lands in the editing window.
local function sync(win, buf)
  if not M.is_open() then
    M.maybe_auto(win)
    return
  end
  if win ~= session.win then
    return
  end
  if not M.eligible(buf) then
    M.close() -- review threads, scrollback, quickfix: no column
    return
  end
  dress(win)
end

--- Open the reader column on `win`. Returns false when the window cannot hold it.
function M.enable(win)
  win = win or vim.api.nvim_get_current_win()
  if M.is_open() then
    return true
  end
  if not vim.api.nvim_win_is_valid(win) or vim.api.nvim_win_get_config(win).relative ~= "" then
    return false
  end
  local buf = vim.api.nvim_win_get_buf(win)
  local cut = vim.api.nvim_win_is_valid(win) and metrics(win, vim.api.nvim_win_get_width(win)) or nil
  if not M.eligible(buf) or not cut then
    return false
  end
  session = {
    win = win,
    buf = buf,
    wrap = vim.wo[win].wrap,
    linebreak = vim.wo[win].linebreak,
    fillchars = vim.wo[win].fillchars,
  }
  -- Prose reads in the column; the saved values come back on close.
  dress(win)
  local pad = vim.api.nvim_win_get_width(win) - cut.left - cut.target - 2
  session.left = filler(win, "left", cut.left)
  session.right = filler(win, "right", pad)
  if not layout() then
    M.close()
    return false
  end
  local function stop()
    M.close()
  end
  vim.keymap.set("n", "q", stop, { buffer = buf, desc = "Close reader column" })
  vim.keymap.set("n", "<Esc>", stop, { buffer = buf, desc = "Close reader column" })
  return true
end

local function unmap(buf)
  for _, lhs in ipairs({ "q", "<Esc>" }) do
    pcall(vim.keymap.del, "n", lhs, { buffer = buf })
  end
end

--- Close the reader column and restore the window options.
function M.close()
  if not session then
    return
  end
  local closed = session
  session = nil
  for _, pad in ipairs({ closed.left, closed.right }) do
    if pad and vim.api.nvim_win_is_valid(pad) then
      pcall(vim.api.nvim_win_close, pad, true)
    end
  end
  if vim.api.nvim_buf_is_valid(closed.buf) then
    unmap(closed.buf)
  end
  if vim.api.nvim_win_is_valid(closed.win) then
    vim.wo[closed.win].wrap = closed.wrap
    vim.wo[closed.win].linebreak = closed.linebreak
    vim.wo[closed.win].fillchars = closed.fillchars
  end
end

function M.toggle()
  if M.is_open() then
    M.close()
    return
  end
  local win = vim.api.nvim_get_current_win()
  if not M.eligible(vim.api.nvim_win_get_buf(win)) then
    notify("this buffer has no reader column")
    return
  end
  if not M.enable(win) then
    notify(string.format("the window needs at least %d columns", MIN_COLUMN + MARGIN))
  end
end

--- Enable the reader when `win` shows prose in a window that fits the column.
function M.maybe_auto(win)
  win = win or vim.api.nvim_get_current_win()
  if M.is_open() or not vim.api.nvim_win_is_valid(win) then
    return
  end
  if vim.api.nvim_win_get_config(win).relative ~= "" then
    return -- floats (picker preview, notifications) stay as they are
  end
  if not M.eligible(vim.api.nvim_win_get_buf(win)) then
    return
  end
  if M.should_auto(vim.api.nvim_win_get_width(win), M.text_width(vim.api.nvim_win_get_buf(win))) then
    M.enable(win)
  end
end

function M.setup()
  local group = vim.api.nvim_create_augroup("nvim_reader", { clear = true })

  -- A markdown file opened in a window that fits gets the column on its own.
  -- The same event re-applies the column options to the open reader.
  vim.api.nvim_create_autocmd("FileType", {
    group = group,
    pattern = "markdown",
    callback = function(event)
      vim.schedule(function()
        if not vim.api.nvim_buf_is_valid(event.buf) then
          return
        end
        local win = vim.api.nvim_get_current_win()
        if vim.api.nvim_win_get_buf(win) == event.buf then
          sync(win, event.buf)
        end
      end)
    end,
  })

  -- A filetype already set on the buffer skips FileType, so watch the window.
  vim.api.nvim_create_autocmd("BufWinEnter", {
    group = group,
    callback = function(event)
      vim.schedule(function()
        if not vim.api.nvim_buf_is_valid(event.buf) then
          return
        end
        local win = vim.api.nvim_get_current_win()
        if vim.api.nvim_win_get_buf(win) == event.buf then
          sync(win, event.buf)
        end
      end)
    end,
  })

  -- A resized terminal re-cuts the two fillers.
  vim.api.nvim_create_autocmd("VimResized", {
    group = group,
    callback = function()
      if not M.is_open() then
        return
      end
      vim.schedule(function()
        if not M.is_open() or not layout() then
          M.close()
        end
      end)
    end,
  })

  -- The editing window closed (:q, :wq, :bd): drop the fillers with it.
  vim.api.nvim_create_autocmd("WinClosed", {
    group = group,
    callback = function(event)
      if not M.is_open() then
        return
      end
      local id = tonumber(event.match)
      if id == session.win or id == session.left or id == session.right then
        vim.schedule(function()
          M.close()
        end)
      end
    end,
  })
end

return M
