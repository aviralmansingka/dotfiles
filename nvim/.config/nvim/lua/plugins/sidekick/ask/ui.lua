-- nvim/.config/nvim/lua/plugins/sidekick/ask/ui.lua
local M = {}

local active_hover = nil

local function fmt_elapsed(ms)
  return string.format('%.1fs', ms / 1000)
end

---@param opts { on_submit: fun(text: string), on_cancel: fun() }
function M.open_prompt(opts)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].swapfile = false

  local screen_row = vim.fn.winline()
  local row = (screen_row <= 2) and 1 or -2

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'cursor',
    row = row,
    col = 0,
    width = 60,
    height = 1,
    style = 'minimal',
    border = 'rounded',
    title = ' ask cursor-agent ',
    title_pos = 'center',
  })

  local finished = false
  local function finish(text)
    if finished then return end
    finished = true
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    if text and text ~= '' then opts.on_submit(text) else opts.on_cancel() end
  end

  vim.keymap.set({ 'n', 'i' }, '<CR>', function()
    local lines = vim.api.nvim_buf_get_lines(buf, 0, 1, false)
    finish(((lines[1] or '')):gsub('^%s+', ''):gsub('%s+$', ''))
  end, { buffer = buf, nowait = true })

  vim.keymap.set({ 'n', 'i' }, '<Esc>', function()
    finish(nil)
  end, { buffer = buf, nowait = true })

  vim.api.nvim_create_autocmd('BufLeave', {
    buffer = buf,
    once = true,
    callback = function() finish(nil) end,
  })

  vim.cmd('startinsert')
end

---@param entry AskEntry
---@return string[]
local function hover_lines(entry)
  local lines = {
    '> **Q:** ' .. entry.question,
    '',
  }
  if entry.status == 'pending' then
    lines[#lines + 1] = '*working...*'
  else
    for _, l in ipairs(vim.split(entry.answer or '', '\n', { plain = true })) do
      lines[#lines + 1] = l
    end
  end
  lines[#lines + 1] = ''
  lines[#lines + 1] = '---'
  if entry.status == 'pending' then
    local elapsed = (vim.uv.hrtime() - entry.started_at) / 1e6
    lines[#lines + 1] = string.format('*working %s...*', fmt_elapsed(elapsed))
  else
    local tok = entry.tokens or { input = 0, output = 0 }
    lines[#lines + 1] = string.format('*%s · in:%d out:%d*', fmt_elapsed(entry.duration_ms or 0), tok.input, tok.output)
  end
  return lines
end

function M.close_hover()
  if not active_hover then return end
  if vim.api.nvim_win_is_valid(active_hover.winid) then
    vim.api.nvim_win_close(active_hover.winid, true)
  end
  active_hover = nil
end

---@param opts { entry: AskEntry, anchor_line: integer, end_line: integer, win: integer }
function M.open_hover(opts)
  M.close_hover()
  local entry = opts.entry
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].bufhidden = 'wipe'
  local lines = hover_lines(entry)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = 'markdown'
  vim.bo[buf].modifiable = false

  local view = vim.fn.winsaveview()
  local height_win = vim.api.nvim_win_get_height(opts.win)
  local screen_row_top = opts.anchor_line - view.topline
  local top_half = screen_row_top < math.floor(height_win / 2)

  local width = math.min(80, vim.o.columns - 4)
  local height = math.max(1, math.min(20, #lines))

  local row, anchor
  if top_half then
    row = opts.end_line + 1 - view.topline
    anchor = 'NW'
  else
    row = opts.anchor_line - view.topline
    anchor = 'SW'
  end

  local winid = vim.api.nvim_open_win(buf, false, {
    relative = 'win',
    win = opts.win,
    row = row,
    col = 0,
    width = width,
    height = height,
    style = 'minimal',
    border = 'rounded',
    focusable = false,
    anchor = anchor,
    noautocmd = true,
  })
  vim.wo[winid].wrap = true
  active_hover = { winid = winid, bufnr = buf }
end

return M
