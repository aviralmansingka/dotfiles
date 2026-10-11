-- nvim/.config/nvim/lua/plugins/sidekick/search.lua
local registry = require("plugins.sidekick.registry")
local herdr = require("plugins.sidekick.herdr")

local M = {}

---@return string
local function tmpdir()
  local pid = vim.fn.getpid()
  return string.format("/tmp/sidekick-search-%d", pid)
end

--- Capture every named-session agent to <tmpdir>/<label>.txt.
--- Wipes the directory first so each invocation starts clean.
---@return string dir, integer captured count
function M.snapshot()
  local dir = tmpdir()
  vim.fn.delete(dir, "rf")
  vim.fn.mkdir(dir, "p")
  local count = 0
  for label, entry in pairs(registry.discover()) do
    local text = herdr.read(entry.agent_name, "recent", 1000)
    if text then
      local path = string.format("%s/%s.txt", dir, label)
      vim.fn.writefile(vim.split(text, "\n", { plain = true }), path)
      count = count + 1
    end
  end
  return dir, count
end

function M.cleanup()
  vim.fn.delete(tmpdir(), "rf")
end

return M
