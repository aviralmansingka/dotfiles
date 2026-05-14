-- nvim/.config/nvim/lua/plugins/sidekick/ask/signs.lua
-- Owns the extmark namespace + spinner timer.
local state = require('plugins.sidekick.ask.state')

local M = {}

M.ns = vim.api.nvim_create_namespace('sidekick.ask')

local SPINNER_FRAMES = { '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' }
local DONE_ICON = '?'
local EDIT_DONE_ICON = '±'
local RANGE_BAR = '│'

local timer = nil

function M.setup_highlights()
  require('plugins.sidekick.branding').ensure_highlights()
  -- Ask = gruvbox blue. Edit = deep dark purple. Kept in sync with
  -- plugins/sidekick/branding.lua's M.colors.ask / M.colors.edit so the
  -- prompt-float border matches the gutter sign.
  vim.api.nvim_set_hl(0, 'SidekickAskSign', { fg = '#83a598', default = true })
  vim.api.nvim_set_hl(0, 'SidekickAskRange', { fg = '#83a598', default = true })
  vim.api.nvim_set_hl(0, 'SidekickEditSign', { fg = '#8f3f71', default = true })
  vim.api.nvim_set_hl(0, 'SidekickEditRange', { fg = '#8f3f71', default = true })
  -- Live-replace preview uses the colorscheme's classic diff colors so the
  -- overlay reads as a real diff (green = add, red = remove). Linked via
  -- `default = true` so a user-defined override still wins.
  vim.api.nvim_set_hl(0, 'SidekickDiffAdd', { link = 'DiffAdd', default = true })
  vim.api.nvim_set_hl(0, 'SidekickDiffDelete', { link = 'DiffDelete', default = true })
end

---@param mode 'ask'|'edit'
---@return string sign_hl, string range_hl
local function hl_for(mode)
  if mode == 'edit' then return 'SidekickEditSign', 'SidekickEditRange' end
  return 'SidekickAskSign', 'SidekickAskRange'
end

---@param bufnr integer
---@param line integer
---@param mode 'ask'|'edit'
---@return integer
function M.create_anchor(bufnr, line, mode)
  local sign_hl = hl_for(mode)
  return vim.api.nvim_buf_set_extmark(bufnr, M.ns, line, 0, {
    sign_text = SPINNER_FRAMES[1],
    sign_hl_group = sign_hl,
    invalidate = true,
  })
end

---@param bufnr integer
---@param start_line integer
---@param end_line integer
---@param mode 'ask'|'edit'
---@return integer[]
function M.create_range_bar(bufnr, start_line, end_line, mode)
  local _, range_hl = hl_for(mode)
  local ids = {}
  for line = start_line, end_line do
    ids[#ids + 1] = vim.api.nvim_buf_set_extmark(bufnr, M.ns, line, 0, {
      sign_text = RANGE_BAR,
      sign_hl_group = range_hl,
      invalidate = true,
    })
  end
  return ids
end

---@param bufnr integer
---@param extmark_id integer
---@param sign_text string
---@param sign_hl_group string
local function set_anchor_sign(bufnr, extmark_id, sign_text, sign_hl_group)
  local pos = vim.api.nvim_buf_get_extmark_by_id(bufnr, M.ns, extmark_id, {})
  if not pos or not pos[1] then return end
  vim.api.nvim_buf_set_extmark(bufnr, M.ns, pos[1], 0, {
    id = extmark_id,
    sign_text = sign_text,
    sign_hl_group = sign_hl_group,
    invalidate = true,
  })
end

---@param bufnr integer
---@param entry AskEntry
function M.mark_done(bufnr, entry)
  local icon = entry.mode == 'edit' and EDIT_DONE_ICON or DONE_ICON
  local sign_hl = hl_for(entry.mode)
  set_anchor_sign(bufnr, entry.extmark_id, icon, sign_hl)
end

---@param bufnr integer
---@param entry AskEntry
function M.clear(bufnr, entry)
  pcall(vim.api.nvim_buf_del_extmark, bufnr, M.ns, entry.extmark_id)
  for _, id in ipairs(entry.range_extmarks or {}) do
    pcall(vim.api.nvim_buf_del_extmark, bufnr, M.ns, id)
  end
end

local function has_pending()
  for _, buf in pairs(state.state) do
    for _, entry in pairs(buf) do
      if entry.status == 'pending' then return true end
    end
  end
  return false
end

local function tick()
  local any = false
  for bufnr, buf in pairs(state.state) do
    if vim.api.nvim_buf_is_valid(bufnr) then
      for _, entry in pairs(buf) do
        if entry.status == 'pending' then
          any = true
          entry.spinner_frame = (entry.spinner_frame % #SPINNER_FRAMES) + 1
          local sign_hl = hl_for(entry.mode)
          set_anchor_sign(bufnr, entry.extmark_id, SPINNER_FRAMES[entry.spinner_frame], sign_hl)
        end
      end
    end
  end
  if not any then
    M.stop_spinner()
  end
end

function M.start_spinner()
  if timer then return end
  timer = vim.uv.new_timer()
  timer:start(0, 100, vim.schedule_wrap(tick))
end

function M.stop_spinner()
  if not timer then return end
  timer:stop()
  timer:close()
  timer = nil
end

function M.ensure_spinner_running()
  if has_pending() then M.start_spinner() end
end

return M
