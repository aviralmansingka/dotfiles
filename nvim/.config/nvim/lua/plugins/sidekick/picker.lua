-- nvim/.config/nvim/lua/plugins/sidekick/picker.lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")
local branch_mod = require("plugins.sidekick.branch")
local branding = require("plugins.sidekick.branding")

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
    local branch = branch_mod.read_session(entry.session_id)
    local label_col = branch and string.format("%s · %s %s", label, branding.branch_glyph, branch) or label
    items[#items + 1] = {
      text = string.format("%s  %s %s", label_col, branding.dir_glyph, cwd_display),
      label = label,
      tool = entry.tool,
      slug = entry.slug,
      pane_id = entry.pane_id,
      session_id = entry.session_id,
      cwd = entry.cwd,
      branch = branch,
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

---@param item table
---@return string[]
local function preview_lines(item)
  if not item or not item.pane_id then
    return { "(no pane)" }
  end
  local out = vim.fn.systemlist({
    "tmux",
    "capture-pane",
    "-p",
    "-S",
    "-200",
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

---@param session_id string
local function kill_session(session_id)
  if not session_id or session_id == "" then
    return false
  end
  local out = vim.fn.systemlist({ "tmux", "kill-session", "-t", session_id })
  -- Treat "session not found" as success — the session already went away.
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
    layout = { layout = { backdrop = false } },
    preview = function(ctx)
      local lines = preview_lines(ctx.item)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, lines)
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if item and item.label then
        require("plugins.sidekick.last_session").record(item.label)
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
        if not item or not item.session_id then
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
