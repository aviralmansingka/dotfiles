-- nvim/.config/nvim/lua/plugins/sidekick/picker.lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")
local branch_mod = require("plugins.sidekick.branch")
local branding = require("plugins.sidekick.branding")
local herdr = require("plugins.sidekick.herdr")

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
    local branch = branch_mod.current(entry.cwd)
    local label_col = branch and string.format("%s · %s %s", label, branding.branch_glyph, branch) or label
    items[#items + 1] = {
      text = string.format("%s  [%s]  %s %s", label_col, entry.status, branding.dir_glyph, cwd_display),
      label = label,
      tool = entry.tool,
      slug = entry.slug,
      pane_id = entry.pane_id,
      workspace_id = entry.workspace_id,
      terminal_id = entry.terminal_id,
      agent_name = entry.agent_name,
      status = entry.status,
      cwd = entry.cwd,
      branch = branch,
    }
  end
  table.sort(items, function(a, b)
    if a.tool ~= b.tool then
      return internal.compare_agents(a.tool, b.tool)
    end
    return a.label < b.label
  end)
  return items
end

---@param item table
---@return string[]
local function preview_lines(item)
  if not item or not item.agent_name then
    return { "(no agent)" }
  end
  local text = herdr.read(item.agent_name, "recent", 200)
  return text and vim.split(text, "\n", { plain = true }) or { "(agent read failed)" }
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
        if not item or not item.pane_id then
          return
        end
        if herdr.close(item.pane_id) then
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
