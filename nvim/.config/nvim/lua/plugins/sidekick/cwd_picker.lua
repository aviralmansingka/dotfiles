-- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
-- Cwd-scoped peek picker for sidekick named sessions.
-- Bound to <c-.> in plugins/sidekick.lua.
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

local M = {}

---@param p string
---@return string
local function normalize(p)
  if not p or p == "" then
    return ""
  end
  return vim.fs.normalize(vim.fn.fnamemodify(p, ":p")):gsub("/$", "")
end

---@param entry_cwd string|nil
---@param root string  already normalized
---@return boolean
local function in_cwd_subtree(entry_cwd, root)
  if not entry_cwd or entry_cwd == "" or root == "" then
    return false
  end
  local n = normalize(entry_cwd)
  if n == root then
    return true
  end
  return n:sub(1, #root + 1) == root .. "/"
end

---@return snacks.picker.finder.Item[]
function M.list_items()
  local root = normalize(vim.fn.getcwd())
  local home = normalize(vim.fn.expand("~"))
  local items = {}
  for label, entry in pairs(registry.discover()) do
    if in_cwd_subtree(entry.cwd, root) then
      local cwd_display = entry.cwd or ""
      if home ~= "" and cwd_display:sub(1, #home) == home then
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
  end
  table.sort(items, function(a, b)
    if a.tool ~= b.tool then
      return a.tool < b.tool
    end
    return a.label < b.label
  end)
  return items
end

return M
