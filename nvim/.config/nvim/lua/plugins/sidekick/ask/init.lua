-- nvim/.config/nvim/lua/plugins/sidekick/ask/init.lua
local state = require('plugins.sidekick.ask.state')
local signs = require('plugins.sidekick.ask.signs')
local context = require('plugins.sidekick.ask.context')
local cli = require('plugins.sidekick.ask.cli')
local ui = require('plugins.sidekick.ask.ui')

local M = {}

local setup_done = false

local ESC = vim.api.nvim_replace_termcodes('<Esc>', true, false, true)

---@return 'normal'|'visual', integer, { start_line: integer, end_line: integer }?
local function get_invocation_target()
  local mode = vim.fn.mode()
  if mode == 'v' or mode == 'V' or mode == '\22' then
    local s = vim.fn.getpos('v')
    local e = vim.fn.getpos('.')
    local s_line = math.min(s[2], e[2]) - 1
    local e_line = math.max(s[2], e[2]) - 1
    vim.api.nvim_feedkeys(ESC, 'nx', false)
    if s_line == e_line then
      return 'normal', s_line, nil
    end
    return 'visual', s_line, { start_line = s_line, end_line = e_line }
  end
  local cursor = vim.api.nvim_win_get_cursor(0)
  return 'normal', cursor[1] - 1, nil
end

---@param entry_mode 'ask'|'edit'
local function start_flow(entry_mode)
  M.setup()
  local bufnr = vim.api.nvim_get_current_buf()
  local mode, line0, range = get_invocation_target()

  local existing_id, existing_entry = state.find_at(bufnr, line0, signs.ns)
  if existing_entry and existing_entry.status == 'pending' then
    vim.notify('ask: still working on this line', vim.log.levels.WARN)
    return
  end
  if existing_entry then
    signs.clear(bufnr, existing_entry)
    state.remove(bufnr, existing_id)
  end

  ui.open_prompt({
    on_cancel = function() end,
    on_submit = function(question)
      local ctx = context.build({ mode = mode, bufnr = bufnr, range = range })
      local prompt = (entry_mode == 'edit')
        and context.render_edit_prompt(question, ctx)
        or context.render_prompt(question, ctx)

      local anchor_extmark = signs.create_anchor(bufnr, line0)
      local range_extmarks = {}
      if range then
        range_extmarks = signs.create_range_bar(bufnr, range.start_line, range.end_line)
      end

      local entry = {
        kind = range and 'range' or 'line',
        mode = entry_mode,
        extmark_id = anchor_extmark,
        range_extmarks = range_extmarks,
        question = question,
        status = 'pending',
        started_at = vim.uv.hrtime(),
        spinner_frame = 1,
        original_code = (entry_mode == 'edit') and ctx.code or nil,
      }
      local anchor_id = state.add(bufnr, entry)

      entry.sysobj = cli.spawn(prompt, function(result)
        entry.sysobj = nil
        if not vim.api.nvim_buf_is_valid(bufnr) then return end
        local cur = state.entries(bufnr)[anchor_id]
        if not cur then return end
        if not result.ok then
          signs.clear(bufnr, cur)
          state.remove(bufnr, anchor_id)
          vim.notify('ask: ' .. result.err, vim.log.levels.ERROR)
          signs.ensure_spinner_running()
          return
        end
        cur.answer = result.result
        cur.duration_ms = result.duration_ms
        cur.tokens = result.tokens
        cur.status = 'done'
        if cur.mode == 'edit' then
          cur.modified_code = result.result
        end
        signs.mark_done(bufnr, cur)
      end)

      signs.start_spinner()
    end,
  })
end

function M.ask()
  start_flow('ask')
end

function M.edit()
  start_flow('edit')
end

function M.clear_line()
  local bufnr = vim.api.nvim_get_current_buf()
  local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
  local id, entry = state.find_at(bufnr, line0, signs.ns)
  if not entry then return end
  if entry.status == 'pending' then return end
  signs.clear(bufnr, entry)
  state.remove(bufnr, id)
  ui.close_hover()
end

function M.yank_line()
  local bufnr = vim.api.nvim_get_current_buf()
  local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
  local _, entry = state.find_at(bufnr, line0, signs.ns)
  if not entry or entry.status ~= 'done' or not entry.answer then
    vim.notify('ask: no answer on this line', vim.log.levels.WARN)
    return
  end
  vim.fn.setreg('+', entry.answer)
  vim.notify('ask: answer yanked')
end

local function blockquote(text)
  local out = {}
  for _, line in ipairs(vim.split(text, '\n', { plain = true })) do
    if line == '' then out[#out + 1] = '>'
    else out[#out + 1] = '> ' .. line end
  end
  return table.concat(out, '\n')
end

function M.send_to_session()
  local bufnr = vim.api.nvim_get_current_buf()
  local mode = vim.fn.mode()
  local payload

  if mode == 'v' or mode == 'V' or mode == '\22' then
    local s = vim.fn.getpos('v')
    local e = vim.fn.getpos('.')
    local s_line = math.min(s[2], e[2]) - 1
    local e_line = math.max(s[2], e[2]) - 1
    vim.api.nvim_feedkeys(ESC, 'nx', false)
    local lines = vim.api.nvim_buf_get_lines(bufnr, s_line, e_line + 1, false)
    payload = table.concat(lines, '\n')
  else
    local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
    local _, entry = state.find_at(bufnr, line0, signs.ns)
    if not entry or entry.status ~= 'done' or not entry.answer then
      vim.notify('ask: no answer to send', vim.log.levels.WARN)
      return
    end
    payload = entry.answer
  end

  local ok, registry = pcall(require, 'plugins.sidekick.registry')
  if not ok then
    vim.notify('ask: sidekick registry not available', vim.log.levels.ERROR)
    return
  end
  local sessions = registry.discover()
  local labels = vim.tbl_keys(sessions)
  if #labels == 0 then
    vim.notify('ask: no named sidekick sessions', vim.log.levels.WARN)
    return
  end
  table.sort(labels)

  vim.ui.select(labels, { prompt = 'Send to which session?' }, function(label)
    if not label then return end
    local quoted = blockquote(payload)
    require('sidekick.cli').send({ name = label, msg = quoted })
  end)
end

function M.setup()
  if setup_done then return end
  setup_done = true
  signs.setup_highlights()

  local group = vim.api.nvim_create_augroup('sidekick.ask', { clear = true })

  vim.api.nvim_create_autocmd('CursorHold', {
    group = group,
    callback = function(args)
      local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
      local _, entry = state.find_at(args.buf, line0, signs.ns)
      if not entry or entry.status ~= 'done' then return end
      local pos_start = vim.api.nvim_buf_get_extmark_by_id(args.buf, signs.ns, entry.extmark_id, {})
      if not pos_start or not pos_start[1] then return end
      local end_line = pos_start[1]
      if entry.kind == 'range' and entry.range_extmarks and #entry.range_extmarks > 0 then
        local last = entry.range_extmarks[#entry.range_extmarks]
        local lpos = vim.api.nvim_buf_get_extmark_by_id(args.buf, signs.ns, last, {})
        if lpos and lpos[1] then end_line = lpos[1] end
      end
      if entry.mode == 'edit' and entry.original_code and entry.modified_code then
        ui.open_diff_overlay(args.buf, signs.ns, end_line, entry.original_code, entry.modified_code)
      else
        ui.open_hover({
          entry = entry,
          anchor_line = pos_start[1],
          end_line = end_line,
          win = vim.api.nvim_get_current_win(),
        })
      end
    end,
  })

  vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI', 'BufLeave', 'WinLeave', 'InsertEnter' }, {
    group = group,
    callback = function()
      ui.close_hover()
      ui.close_diff_overlay()
    end,
  })

  vim.api.nvim_create_autocmd({ 'BufDelete', 'BufWipeout' }, {
    group = group,
    callback = function(args) state.cleanup_buffer(args.buf) end,
  })

  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function() state.cleanup_all() end,
  })
end

return M
