-- nvim/.config/nvim/lua/plugins/sidekick/last_session.lua
-- Tracks the most recently picker-selected session label so <C-.> can jump
-- straight back to it. Recorded by picker confirms; tool-toggle keymaps
-- (<leader>ag/ao/au/<C-;>) intentionally do NOT update this.
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
--- the named-sessions picker so the keymap is never a dead end.
function M.open()
  if not M.label or M.label == "" then
    require("plugins.sidekick.picker").open()
    return
  end
  require("plugins.sidekick.internal").toggle_tool_session(M.label, true)
end

return M
