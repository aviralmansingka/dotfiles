-- nvim/.config/nvim/lua/plugins/sidekick/ask/ui.lua
local branding = require('plugins.sidekick.branding')

local M = {}

local active_hover = nil
local active_diff = nil -- { bufnr, extmark_id, ns }

local function fmt_elapsed(ms)
  return string.format('%.1fs', ms / 1000)
end

---@param opts { on_submit: fun(text: string), on_cancel: fun(), mode: 'ask'|'edit'|nil }
function M.open_prompt(opts)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].swapfile = false

  local screen_row = vim.fn.winline()
  local row = (screen_row <= 2) and 1 or -2

  local border, title
  if opts.mode == 'edit' then
    border = branding.edit_border_spec()
    title = branding.edit_title_spec('edit')
  else
    border = branding.border_spec('cursor')
    title = branding.title_spec('cursor', 'ask')
  end

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'cursor',
    row = row,
    col = 0,
    width = 60,
    height = 1,
    style = 'minimal',
    border = border,
    title = title,
    title_pos = 'center',
  })

  local finished = false
  local function finish(text)
    if finished then return end
    finished = true
    vim.cmd('stopinsert')
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
  pcall(vim.treesitter.start, buf, 'markdown')
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
    border = branding.border_spec('cursor'),
    focusable = false,
    anchor = anchor,
    noautocmd = true,
  })
  vim.wo[winid].wrap = true
  active_hover = { winid = winid, bufnr = buf }
end

---Build virt_lines representing a unified diff between original and modified code.
---@param original string
---@param modified string
---@return table[][] virt_lines
local function build_diff_virt_lines(original, modified)
  local ok, hunks = pcall(vim.diff, original, modified, { result_type = 'indices', ctxlen = 0 })
  if not ok or not hunks then return {} end
  local orig_lines = vim.split(original, '\n', { plain = true })
  local mod_lines = vim.split(modified, '\n', { plain = true })
  local out = {}
  out[#out + 1] = { { '── proposed diff ──', 'Comment' } }
  for _, hunk in ipairs(hunks) do
    local a_start, a_count, b_start, b_count = hunk[1], hunk[2], hunk[3], hunk[4]
    for i = a_start, a_start + a_count - 1 do
      out[#out + 1] = { { '- ' .. (orig_lines[i] or ''), 'DiffDelete' } }
    end
    for i = b_start, b_start + b_count - 1 do
      out[#out + 1] = { { '+ ' .. (mod_lines[i] or ''), 'DiffAdd' } }
    end
  end
  return out
end

---@param bufnr integer
---@param ns integer
---@param line integer
---@param original string
---@param modified string
function M.open_diff_overlay(bufnr, ns, line, original, modified)
  M.close_diff_overlay()
  local virt_lines = build_diff_virt_lines(original, modified)
  if #virt_lines == 0 then return end
  local id = vim.api.nvim_buf_set_extmark(bufnr, ns, line, 0, {
    virt_lines = virt_lines,
    virt_lines_above = false,
  })
  active_diff = { bufnr = bufnr, extmark_id = id, ns = ns }
end

function M.close_diff_overlay()
  if not active_diff then return end
  if vim.api.nvim_buf_is_valid(active_diff.bufnr) then
    pcall(vim.api.nvim_buf_del_extmark, active_diff.bufnr, active_diff.ns, active_diff.extmark_id)
  end
  active_diff = nil
end

return M
