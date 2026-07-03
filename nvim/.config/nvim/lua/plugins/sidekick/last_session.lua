-- nvim/.config/nvim/lua/plugins/sidekick/last_session.lua
-- Tracks the most recently picker-selected session label so <C-.> can jump
-- straight back to it. Recorded by picker confirms; direct tool-toggle keymaps
-- (<leader>ag/<leader>ai) intentionally do NOT update this.
local M = {}

---@type string|nil
M.label = nil

---@param label string|nil
function M.record(label)
  if type(label) == "string" and label ~= "" then
    M.label = label
  end
end

--- Open the last picker-selected session. With no record yet, fall back to
--- the cwd-scoped named-session picker so the keymap stays local by default.
function M.open()
  if not M.label or M.label == "" then
    require("plugins.sidekick.cwd_picker").open()
    return
  end
  require("plugins.sidekick.internal").toggle_tool_session(M.label, true)
end

return M
