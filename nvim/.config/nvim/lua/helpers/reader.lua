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
--
-- Table rows and mermaid lines spill: the column grows to hold the widest of
-- them. Prose keeps wrapping in the column.

local M = {}

local COLUMN = 100 -- wanted text columns
local MIN_COLUMN = 40 -- a column below this width gains nothing
local MARGIN = 8 -- cells kept free for the two filler windows
local SPILL_MARGIN = 4 -- cells kept free when a spill line widens the column
local RELAYOUT_MS = 120 -- debounce for a re-cut after a text change

local session -- { win, buf, left, right, wrap, linebreak }
local spill_cache = {} -- bufnr -> { tick, lines, width }
local relayout_timer

local function notify(message)
  vim.notify("Reader: " .. message, vim.log.levels.INFO)
end

--- Wanted text width for a window that offers `width` cells.
function M.column_width(width)
  return math.min(COLUMN, width - MARGIN)
end

--- Text width for a window that offers `avail` cells. The prose column grows
--- to the widest spill line, but never past the spill cap.
function M.read_width(avail, widest)
  local column = M.column_width(avail)
  if widest and widest > column then
    return math.min(widest, avail - SPILL_MARGIN)
  end
  return column
end

--- Auto-enable rule. The column is the default for reading markdown. Auto-enable
--- it wherever it fits: the window must hold MIN_COLUMN cells or more.
function M.should_auto(width)
  return M.column_width(width) >= MIN_COLUMN
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

local function trim(line)
  return (line:match("^%s*(.-)%s*$"))
end

-- Split a table row into cells. A leading or trailing pipe is optional.
local function cells(line)
  local body = trim(line):gsub("^|", ""):gsub("|$", "")
  local out = {}
  for cell in (body .. "|"):gmatch("([^|]*)|") do
    out[#out + 1] = trim(cell)
  end
  return out
end

-- A GFM delimiter row: dash cells with optional colons, and one pipe or more.
local function delimiter(line)
  if not line:find("|", 1, true) then
    return nil
  end
  local count = 0
  for _, cell in ipairs(cells(line)) do
    if not cell:match("^:?%-+:?$") then
      return nil
    end
    count = count + 1
  end
  if count == 0 then
    return nil
  end
  return count
end

local function is_blank(line)
  return line:match("^%s*$") ~= nil
end

-- An opening code fence. Returns its marks and its lowercased info string.
local function fence_open(line)
  local marks, info = line:match("^%s*(```+)%s*(.-)%s*$")
  if not marks then
    marks, info = line:match("^%s*(~~~+)%s*(.-)%s*$")
  end
  if not marks then
    return nil
  end
  return marks, (info or ""):lower()
end

local function fence_close(line, marks)
  local pattern = marks:sub(1, 1) == "`" and "^%s*```+%s*$" or "^%s*~~~+%s*$"
  return line:match(pattern) ~= nil
end

-- The spill-eligible lines: the rows of a table block (header, delimiter, and
-- the pipe rows below it) and the lines of a mermaid fence. A lone pipe in
-- prose counts only when a delimiter row and a header row support it.
local function spill_lines(lines)
  local marked = {}
  local i = 1
  while i <= #lines do
    local marks, info = fence_open(lines[i])
    if marks then
      local first, last = i, i
      i = i + 1
      while i <= #lines do
        local closed = fence_close(lines[i], marks)
        last = i
        i = i + 1
        if closed then
          break
        end
      end
      if info == "mermaid" or info:match("^mermaid%s") then
        for n = first, last do
          marked[n] = true
        end
      end
    elseif delimiter(lines[i]) and i > 1 and not is_blank(lines[i - 1]) and lines[i - 1]:find("|", 1, true) then
      local first = i - 1
      local last = i
      local j = i + 1
      while j <= #lines and not is_blank(lines[j]) and lines[j]:find("|", 1, true) do
        last = j
        j = j + 1
      end
      for n = first, last do
        marked[n] = true
      end
      i = j
    else
      i = i + 1
    end
  end
  return marked
end

-- Display cells in `line`. strdisplaywidth() reads the wrap state of the
-- current window and over-reports a long line there, so take the pure string
-- width when nvim offers it.
local function line_width(line)
  if vim.api.nvim_strwidth then
    return vim.api.nvim_strwidth(line)
  end
  return vim.fn.strdisplaywidth(line)
end

--- Widest spill-eligible line in `buf`, in display cells. The cache key is
--- the change tick, so a text change pays for one scan of the eligible lines.
function M.spill_width(buf)
  buf = (buf == nil or buf == 0) and vim.api.nvim_get_current_buf() or buf
  if not vim.api.nvim_buf_is_valid(buf) or not vim.api.nvim_buf_is_loaded(buf) then
    return 0
  end
  local tick = vim.api.nvim_buf_get_changedtick(buf)
  local count = vim.api.nvim_buf_line_count(buf)
  local hit = spill_cache[buf]
  if hit and hit.tick == tick and hit.lines == count then
    return hit.width
  end
  local content = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local widest = 0
  for index in pairs(spill_lines(content)) do
    local width = line_width(content[index])
    if width > widest then
      widest = width
    end
  end
  spill_cache[buf] = { tick = tick, lines = count, width = widest }
  return widest
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

-- Cut the column out of `avail` cells. The text area is centered, not the
-- window: 'statuscolumn' and the sign column stay in the left margin.
local function metrics(win, avail, buf)
  local off = text_offset(win)
  -- The text offset moves the text right, so it spends the left margin twice.
  -- Cap by what it leaves, else the guard below drops a grown column.
  local column = math.min(M.read_width(avail, M.spill_width(buf)), avail - SPILL_MARGIN - 2 * off)
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

-- Size the two fillers and the editing window. Every width is set, so the
-- total stays the same. A fixed filler would keep its cells and leave the
-- editing window no room to grow, so all three widths are free while they
-- change and fixed again after.
local function layout()
  local win = session.win
  local left = session.left
  local right = session.right
  local avail = vim.api.nvim_win_get_width(left) + 1 + vim.api.nvim_win_get_width(win) + 1
    + vim.api.nvim_win_get_width(right)
  local cut = metrics(win, avail, session.buf)
  if not cut then
    return false
  end
  local fixed = { vim.wo[left].winfixwidth, vim.wo[win].winfixwidth, vim.wo[right].winfixwidth }
  vim.wo[left].winfixwidth, vim.wo[win].winfixwidth, vim.wo[right].winfixwidth = false, false, false
  vim.api.nvim_win_set_width(left, cut.left)
  vim.api.nvim_win_set_width(win, cut.target)
  vim.api.nvim_win_set_width(right, avail - cut.left - 1 - cut.target - 1)
  vim.wo[left].winfixwidth = fixed[1]
  vim.wo[win].winfixwidth = fixed[2]
  vim.wo[right].winfixwidth = fixed[3]
  return true
end

-- Content changed in the column: the widest spill line may have moved. Cut
-- again after a short pause, so one keystroke never cuts twice.
local function debounce_relayout()
  if not relayout_timer then
    relayout_timer = (vim.uv or vim.loop).new_timer()
  end
  relayout_timer:stop()
  relayout_timer:start(RELAYOUT_MS, 0, function()
    vim.schedule(function()
      if M.is_open() then
        layout()
      end
    end)
  end)
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
  session.buf = buf -- the new buffer may spill by a different amount
  dress(win)
  layout()
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
  local cut = vim.api.nvim_win_is_valid(win) and metrics(win, vim.api.nvim_win_get_width(win), buf) or nil
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
  if relayout_timer then
    relayout_timer:stop()
  end
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
  if M.should_auto(vim.api.nvim_win_get_width(win)) then
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

  -- A wider table or mermaid line grows the column and a deleted one shrinks
  -- it back. Debounced, and only while the column is open.
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
    group = group,
    callback = function(event)
      if not M.is_open() or event.buf ~= session.buf then
        return
      end
      debounce_relayout()
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
