-- nvim/.config/nvim/lua/plugins/sidekick/search.lua
local internal = require("plugins.sidekick.internal")
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

function M.grep()
  if vim.fn.executable("rg") ~= 1 then
    vim.notify("Sidekick: ripgrep (rg) is required for search. Install with: brew install ripgrep", vim.log.levels.ERROR)
    return
  end
  registry.rehydrate()
  local dir, count = M.snapshot()
  if count == 0 then
    vim.notify("Sidekick: no named sessions to search", vim.log.levels.INFO)
    return
  end
  Snacks.picker.grep({
    title = "Sidekick Search",
    dirs = { dir },
    confirm = function(picker, item)
      picker:close()
      if not item or not item.file then
        return
      end
      local fname = vim.fn.fnamemodify(item.file, ":t:r") -- strip dir + .txt
      if fname and fname ~= "" then
        internal.toggle_tool_session(fname, true)
      end
    end,
  })
end

function M.cleanup()
  vim.fn.delete(tmpdir(), "rf")
end

return M
