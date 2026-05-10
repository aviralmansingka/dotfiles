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

---@param item table|nil
---@return string[]
local function preview_lines(item)
  if not item or item._empty or not item.pane_id then
    return { "(no session)" }
  end
  local out = vim.fn.systemlist({
    "tmux",
    "capture-pane",
    "-p",
    "-S",
    "-",
    "-E",
    "-",
    "-t",
    item.pane_id,
  })
  if vim.v.shell_error ~= 0 then
    return { "(capture-pane failed)" }
  end
  return out
end

---@param session_id string|nil
---@return boolean
local function kill_session(session_id)
  if not session_id or session_id == "" then
    return false
  end
  local out = vim.fn.systemlist({ "tmux", "kill-session", "-t", session_id })
  if vim.v.shell_error == 0 then
    return true
  end
  for _, line in ipairs(out) do
    if line:match("can't find session") or line:match("no such session") then
      return true
    end
  end
  vim.notify("Sidekick: tmux kill-session failed: " .. table.concat(out, " "), vim.log.levels.WARN)
  return false
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

function M.open()
  registry.rehydrate()
  local items = M.list_items()
  local empty = #items == 0
  if empty then
    items = { {
      text = "(no named sessions in cwd)",
      _empty = true,
    } }
  end

  Snacks.picker.pick({
    source = "sidekick_cwd_peek",
    title = "Sidekick Sessions in Cwd",
    items = items,
    format = "text",
    layout = {
      preset = "default",
      layout = {
        box = "vertical",
        width = 0.8,
        height = 0.8,
        border = "none",
        { win = "preview", border = "rounded" },
        { win = "list", height = 5, border = "rounded" },
        { win = "input", height = 3, border = "rounded" },
      },
    },
    preview = function(ctx)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, preview_lines(ctx.item))
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if not item or item._empty then
        return
      end
      if item.label then
        internal.toggle_tool_session(item.label, true)
      end
    end,
    win = {
      input = {
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n", "i" } },
        },
      },
      list = {
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n" } },
        },
      },
    },
    actions = {
      sidekick_kill_session = function(picker, item)
        if not item or item._empty or not item.session_id then
          return
        end
        if kill_session(item.session_id) then
          picker:close()
          vim.schedule(function()
            M.open()
          end)
        end
      end,
    },
  })
end

return M
