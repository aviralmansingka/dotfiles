-- nvim/.config/nvim/lua/plugins/sidekick/search.lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

local M = {}

---@return string
local function tmpdir()
  local pid = vim.fn.getpid()
  return string.format("/tmp/sidekick-search-%d", pid)
end

--- Capture every named-session pane to <tmpdir>/<label>.txt.
--- Wipes the directory first so each invocation starts clean.
---@return string dir, integer captured count
function M.snapshot()
  local dir = tmpdir()
  vim.fn.delete(dir, "rf")
  vim.fn.mkdir(dir, "p")
  local count = 0
  for label, entry in pairs(registry.discover()) do
    local out = vim.fn.systemlist({
      "tmux",
      "capture-pane",
      "-p",
      "-S",
      "-",
      "-E",
      "-",
      "-t",
      entry.pane_id,
    })
    if vim.v.shell_error == 0 then
      local path = string.format("%s/%s.txt", dir, label)
      vim.fn.writefile(out, path)
      count = count + 1
    end
  end
  return dir, count
end

function M.grep()
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
