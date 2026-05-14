-- nvim/.config/nvim/lua/plugins/sidekick/ask/ui.lua
local branding = require('plugins.sidekick.branding')

local M = {}

local active_hover = nil

-- Separate namespace from signs.ns so we can clear the inline diff preview
-- without disturbing the anchor sign in the gutter.
local diff_ns = vim.api.nvim_create_namespace('sidekick.ask.diff_preview')
local diff_active_buf = nil

local function fmt_elapsed(ms)
  return string.format('%.1fs', ms / 1000)
end

---@param opts { on_submit: fun(text: string), on_cancel: fun(), title: string?, mode: ('ask'|'edit')? }
function M.open_prompt(opts)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].swapfile = false
  vim.b[buf].completion = false

  local screen_row = vim.fn.winline()
  local row = (screen_row <= 2) and 1 or -2

  local mode = opts.mode or 'ask'
  local title = opts.title or mode

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'cursor',
    row = row,
    col = 0,
    width = 60,
    height = 1,
    style = 'minimal',
    border = branding.border_spec(mode),
    title = branding.title_spec(mode, title),
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

  vim.keymap.set({ 'n', 'i' }, '<C-c>', function()
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
  local wrapped_rows = 0
  for _, line in ipairs(lines) do
    local w = vim.fn.strdisplaywidth(line)
    wrapped_rows = wrapped_rows + math.max(1, math.ceil(w / width))
  end
  local height = math.max(1, math.min(20, wrapped_rows))

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
  -- If a long answer still exceeds the 20-row cap, replace the default
  -- `@@@` lastline indicator with a space so it doesn't stomp on the text.
  vim.wo[winid].fillchars = "lastline: "
  active_hover = { winid = winid, bufnr = buf }
end

---Parse the full post-apply file with treesitter using `ft`'s language and
---return a per-line per-byte highlight map covering ONLY the lines that
---belong to the added block. Parsing the full file (not just the snippet)
---is what gives the added lines their correct, context-sensitive captures.
---@param ft string
---@param lines string[]
---@param first0 integer
---@param count integer
---@return table<integer, table<integer, string>>?  per_byte  keyed by 1-based line
local function highlight_added_lines(ft, lines, first0, count)
  if not ft or ft == '' then return nil end
  if count <= 0 then return nil end
  local lang = vim.treesitter.language.get_lang(ft) or ft
  local source = table.concat(lines, '\n')
  local ok_parser, parser = pcall(vim.treesitter.get_string_parser, source, lang)
  if not ok_parser or not parser then return nil end
  local ok_trees, trees = pcall(function() return parser:parse() end)
  if not ok_trees or not trees or not trees[1] then return nil end
  local ok_query, query = pcall(vim.treesitter.query.get, lang, 'highlights')
  if not ok_query or not query then return nil end

  local per_byte = {}
  for l = first0, first0 + count - 1 do
    per_byte[l + 1] = {}
  end

  local root = trees[1]:root()
  for id, node in query:iter_captures(root, source, first0, first0 + count) do
    local cap = query.captures[id]
    if cap and cap:sub(1, 1) ~= '_' then
      local hl = '@' .. cap
      local srow, scol, erow, ecol = node:range()
      local lo = math.max(srow, first0)
      local hi = math.min(erow, first0 + count - 1)
      for row = lo, hi do
        if per_byte[row + 1] then
          local line = lines[row + 1] or ''
          local cs = (row == srow) and scol or 0
          local ce = (row == erow) and ecol or #line
          for c = cs + 1, math.min(ce, #line) do
            per_byte[row + 1][c] = hl
          end
        end
      end
    end
  end

  return per_byte
end

---Collapse a per-byte hl table into a list of `{text, hl}` virt_line
---segments. Leading chunks place a `│` range bar at column 0 (so it lines
---up vertically with the gutter `±` / `│` marks on the buffer lines
---above) followed by a pad of `textoff - 1` spaces, so the actual code
---content lands at the same text column as the buffer line. Used together
---with `virt_lines_leftcol = true` on the extmark.
---Each content segment combines `SidekickDiffAdd` (bg-only tint) with the
---syntax capture (fg). A trailing space-pad chunk extends the bg to the
---right edge — `virt_lines` has no `hl_eol` equivalent, so we pad to
---`vim.o.columns`; nvim clips at the window edge.
---@param line string
---@param per_byte table<integer, string>?
---@param textoff integer  width of the window's sign+number+fold columns
---@return table[]
local function line_to_segs(line, per_byte, textoff)
  local segs = {
    { '│', 'SidekickEditRange' },
    { string.rep(' ', math.max(0, (textoff or 0) - 1)), 'Normal' },
  }
  if #line > 0 then
    if not per_byte then
      segs[#segs + 1] = { line, 'SidekickDiffAdd' }
    else
      local c = 1
      while c <= #line do
        local hl = per_byte[c]
        local j = c
        while j <= #line and per_byte[j] == hl do j = j + 1 end
        local chunk = line:sub(c, j - 1)
        if hl then
          segs[#segs + 1] = { chunk, { 'SidekickDiffAdd', hl } }
        else
          segs[#segs + 1] = { chunk, 'SidekickDiffAdd' }
        end
        c = j
      end
    end
  end
  segs[#segs + 1] = { string.rep(' ', vim.o.columns), 'SidekickDiffAdd' }
  return segs
end

---Render a live-replace preview of a single block replacement. Lines in
---`[start_line0..end_line0]` get a `DiffDelete` line highlight in place;
---`added` renders as `virt_lines` below the block, with treesitter
---highlights derived from the FULL post-apply file so the snippet's
---captures match the context the replacement would create.
---Only one preview is active at a time; rendering a new one clears any
---previous one (possibly in another buffer).
---@param bufnr integer
---@param start_line0 integer  0-based first line of the block being replaced
---@param end_line0 integer    0-based last line of the block being replaced (inclusive)
---@param added string[]       replacement lines (empty == NOOP, nothing to preview)
function M.render_diff_inline(bufnr, start_line0, end_line0, added)
  M.clear_diff_inline()
  if not added then return end
  local last_line = vim.api.nvim_buf_line_count(bufnr) - 1
  start_line0 = math.max(0, start_line0)
  end_line0 = math.min(last_line, end_line0)
  if start_line0 > end_line0 then return end

  for ln = start_line0, end_line0 do
    vim.api.nvim_buf_set_extmark(bufnr, diff_ns, ln, 0, {
      line_hl_group = 'SidekickDiffDelete',
      hl_eol = true,
    })
  end

  if #added == 0 then
    diff_active_buf = bufnr
    return
  end

  local orig_lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local post_lines = {}
  for i = 1, start_line0 do post_lines[i] = orig_lines[i] end
  for _, l in ipairs(added) do post_lines[#post_lines + 1] = l end
  for i = end_line0 + 2, #orig_lines do post_lines[#post_lines + 1] = orig_lines[i] end

  local per_byte_map = highlight_added_lines(vim.bo[bufnr].filetype, post_lines, start_line0, #added)

  local textoff = 0
  local win = vim.fn.bufwinid(bufnr)
  if win and win ~= -1 then
    local info = vim.fn.getwininfo(win)
    if info and info[1] and info[1].textoff then textoff = info[1].textoff end
  end

  local virt_lines = {}
  for i, line in ipairs(added) do
    local lnum1 = start_line0 + i
    local pb = per_byte_map and per_byte_map[lnum1]
    virt_lines[#virt_lines + 1] = line_to_segs(line, pb, textoff)
  end
  vim.api.nvim_buf_set_extmark(bufnr, diff_ns, end_line0, 0, {
    virt_lines = virt_lines,
    virt_lines_leftcol = true,
  })

  diff_active_buf = bufnr
end

function M.clear_diff_inline()
  if diff_active_buf and vim.api.nvim_buf_is_valid(diff_active_buf) then
    vim.api.nvim_buf_clear_namespace(diff_active_buf, diff_ns, 0, -1)
  end
  diff_active_buf = nil
end

return M
