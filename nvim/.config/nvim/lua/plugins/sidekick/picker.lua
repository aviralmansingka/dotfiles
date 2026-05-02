-- nvim/.config/nvim/lua/plugins/sidekick/picker.lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

local M = {}

---@return snacks.picker.finder.Item[]
function M.list_items()
  local items = {}
  local home = vim.fn.fnamemodify(vim.fn.expand("~"), ":p"):gsub("/$", "")
  for label, entry in pairs(registry.discover()) do
    local cwd_display = entry.cwd or ""
    if cwd_display:sub(1, #home) == home then
      cwd_display = "~" .. cwd_display:sub(#home + 1)
    end
    items[#items + 1] = {
      text = string.format("[%s] %s  %s", entry.tool, label, cwd_display),
      label = label,
      tool = entry.tool,
      slug = entry.slug,
      pane_id = entry.pane_id,
      session_id = entry.session_id,
      cwd = entry.cwd,
    }
  end
  table.sort(items, function(a, b)
    if a.tool ~= b.tool then
      return a.tool < b.tool
    end
    return a.label < b.label
  end)
  return items
end

function M.open()
  registry.rehydrate()
  local items = M.list_items()
  if #items == 0 then
    vim.notify("Sidekick: no named sessions", vim.log.levels.INFO)
    return
  end
  Snacks.picker.pick({
    source = "sidekick_named_sessions",
    title = "Sidekick Named Sessions",
    items = items,
    format = "text",
    preview = "none",
    confirm = function(picker, item)
      picker:close()
      if item and item.label then
        internal.toggle_tool_session(item.label, true)
      end
    end,
  })
end

return M
