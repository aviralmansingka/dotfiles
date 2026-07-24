-- nvim/.config/nvim/lua/plugins/sidekick/picker.lua
local cwd_picker = require("plugins.sidekick.cwd_picker")

local M = {}

---@return snacks.picker.finder.Item[]
function M.list_items()
  return cwd_picker.list_items({ global = true })
end

function M.open()
  return cwd_picker.open({ global = true })
end

return M
