-- Toggle Sidekick CLI between split layout and a centered 80% float.
local M = {}

--- Match snacks terminal / opencode / toggleterm float borders.
function M.float_border()
  return vim.g.neovide and vim.g.neovide_fancy_borders and vim.g.neovide_fancy_borders.current or "rounded"
end

local function find_sidekick_win()
  local cur = vim.api.nvim_get_current_win()
  if vim.w[cur].sidekick_session_id then
    return cur
  end
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if vim.w[w].sidekick_session_id and vim.api.nvim_win_is_valid(w) then
      return w
    end
  end
  return nil
end

---@param term sidekick.cli.Terminal
local function split_win_config(term)
  local layout = term.opts.layout
  local vertical = layout == "top" or layout == "bottom"
  local split = ({ top = "above", left = "left", bottom = "below", right = "right" })[layout] or "right"
  local s = vim.deepcopy(term.opts.split)
  local width = s.width
  local height = s.height
  width = width <= 1 and math.floor(vim.o.columns * width) or width
  height = height <= 1 and math.floor(vim.o.lines * height) or height
  width = width > 0 and width or nil
  height = height > 0 and height or nil
  return {
    relative = "",
    split = split,
    vertical = vertical,
    width = width,
    height = height,
  }
end

function M.toggle()
  local win = find_sidekick_win()
  if not win then
    vim.notify("Sidekick: no CLI window open", vim.log.levels.WARN)
    return
  end
  local cfg = vim.api.nvim_win_get_config(win)
  local is_split = cfg.relative == "" or cfg.relative == nil

  if is_split then
    -- 80% of full editor grid (columns × lines), centered.
    local w = math.floor(vim.o.columns * 0.8)
    local h = math.floor(vim.o.lines * 0.8)
    h = math.max(h, 1)
    vim.api.nvim_win_set_config(win, {
      relative = "editor",
      style = "minimal",
      border = M.float_border(),
      row = math.max(0, math.floor((vim.o.lines - h) / 2)),
      col = math.max(0, math.floor((vim.o.columns - w) / 2)),
      width = w,
      height = h,
    })
    vim.wo[win].winfixwidth = false
    vim.wo[win].winfixheight = false
    return
  end

  local sid = vim.w[win].sidekick_session_id
  local term = sid and require("sidekick.cli.terminal").get(sid)
  if not term then
    vim.notify("Sidekick: could not restore split (no session)", vim.log.levels.WARN)
    return
  end
  local new_cfg = split_win_config(term)
  vim.api.nvim_win_set_config(win, new_cfg)
  if new_cfg.vertical then
    vim.wo[win].winfixheight = true
    vim.wo[win].winfixwidth = false
  else
    vim.wo[win].winfixwidth = true
    vim.wo[win].winfixheight = false
  end
end

return M
