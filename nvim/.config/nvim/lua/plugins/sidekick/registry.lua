-- nvim/.config/nvim/lua/plugins/sidekick/registry.lua
local internal = require("plugins.sidekick.internal")

local M = {}

--- Parse a tmux session name into its sidekick components.
--- Default sidekick sessions look like `claude <hash>`; named ones like
--- `claude-tutorial <hash>`. Only named sessions return a non-nil result —
--- defaults are already registered in Config.cli.tools.
---
--- The tool prefix list is derived from internal.tool_commands so adding
--- a new tool there is the only change needed.
---@param name string
---@return { tool: string, slug: string, label: string }|nil
function M.parse_session_name(name)
  if type(name) ~= "string" then
    return nil
  end
  for tool, _ in pairs(internal.tool_commands) do
    -- Match `<tool>-<slug> <hash>` (named only; default `<tool> <hash>` returns nil).
    local pattern = "^" .. tool:gsub("%-", "%%-") .. "%-([%w_-]+)%s+%x+$"
    local slug = name:match(pattern)
    if slug and slug ~= "" then
      return { tool = tool, slug = slug, label = tool .. "-" .. slug }
    end
  end
  return nil
end

return M
