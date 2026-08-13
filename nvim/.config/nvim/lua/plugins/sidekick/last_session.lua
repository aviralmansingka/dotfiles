-- nvim/.config/nvim/lua/plugins/sidekick/last_session.lua
-- Tracks the most recently created or picker-selected named session per tab so
-- <C-.> follows the tab's workspace instead of one process-global target.
-- Direct session toggles intentionally do not update this.
local M = {}

local label_var = "sidekick_last_session_label"
local terminal_var = "sidekick_last_session_terminal_id"

local function get(tab, name)
  local ok, value = pcall(vim.api.nvim_tabpage_get_var, tab, name)
  return ok and value or nil
end

---@param label string|nil
---@param terminal_id? string
function M.record(label, terminal_id)
  if type(label) == "string" and label ~= "" then
    local tab = vim.api.nvim_get_current_tabpage()
    vim.api.nvim_tabpage_set_var(tab, label_var, label)
    if terminal_id then
      vim.api.nvim_tabpage_set_var(tab, terminal_var, terminal_id)
    else
      pcall(vim.api.nvim_tabpage_del_var, tab, terminal_var)
    end
  end
end

--- Open the last active named session. With no record yet, fall back to
--- the cwd-scoped named-session picker so the keymap stays local by default.
function M.open()
  local tab = vim.api.nvim_get_current_tabpage()
  local label = get(tab, label_var)
  if type(label) ~= "string" or label == "" then
    require("plugins.sidekick.cwd_picker").open()
    return
  end
  require("plugins.sidekick.internal").toggle_tool_session(label, true, get(tab, terminal_var))
end

return M
