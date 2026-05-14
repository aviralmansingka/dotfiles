-- Per-tool visual identity for sidekick floats.
-- Colors, highlight groups, border + title builders. Pure module — no side
-- effects on require. Call M.ensure_highlights() once at plugin setup and on
-- every ColorScheme autocmd.
local internal = require("plugins.sidekick.internal")

local M = {}

M.colors = {
  claude = "#E07856", -- terracotta
  codex = "#10A37F", -- openai green
  cursor = "#B19CD9", -- soft violet
  opencode = "#E0AF68", -- amber
}

M.fallback_color = "#7C7C7C"

-- Starship's default `git_branch` style is `bold purple`; in this user's
-- ghostty palette, color 5 (purple) resolves to #d3869b. Match that exactly.
M.branch_color = "#d3869b"
M.branch_glyph = ""

local ROUNDED = { "╭", "─", "╮", "│", "╯", "─", "╰", "│" }

local function capitalize(name)
  if not name or name == "" then
    return ""
  end
  return name:sub(1, 1):upper() .. name:sub(2)
end

--- Map a tool label (e.g., "claude" or "claude-tutorial") to its base tool key.
--- Walks known tools in `internal.tool_commands` and returns the matching key.
---@param label string
---@return string|nil
function M.tool_of(label)
  if type(label) ~= "string" or label == "" then
    return nil
  end
  if internal.tool_commands[label] then
    return label
  end
  for tool, _ in pairs(internal.tool_commands) do
    if label == tool or label:sub(1, #tool + 1) == tool .. "-" then
      return tool
    end
  end
  return nil
end

---@param label string
---@return string hex color
function M.color_of(label)
  local tool = M.tool_of(label)
  return (tool and M.colors[tool]) or M.fallback_color
end

---@param tool string|nil
---@return { border: string, title: string }
function M.hl_groups(tool)
  local suffix = tool and capitalize(tool) or "Fallback"
  return {
    border = "SidekickBorder" .. suffix,
    title = "SidekickTitle" .. suffix,
  }
end

--- Idempotent. Defines SidekickBorder<Tool> + SidekickTitle<Tool> for each
--- known tool plus the fallback. Safe to call repeatedly and on ColorScheme.
function M.ensure_highlights()
  local groups = {}
  for tool, _ in pairs(M.colors) do
    groups[tool] = true
  end
  groups.fallback = true
  for tool, _ in pairs(groups) do
    local color = M.colors[tool] or M.fallback_color
    local hl = M.hl_groups(tool == "fallback" and nil or tool)
    vim.api.nvim_set_hl(0, hl.border, { fg = color, default = false })
    vim.api.nvim_set_hl(0, hl.title, { fg = color, bold = true, default = false })
  end
  vim.api.nvim_set_hl(0, "SidekickBranch", { fg = M.branch_color, bold = true, default = false })
end

--- 8-element border spec colored with the tool's hl group.
---@param tool string|nil
---@return table
function M.border_spec(tool)
  local hl = M.hl_groups(tool)
  local out = {}
  for i, ch in ipairs(ROUNDED) do
    out[i] = { ch, hl.border }
  end
  return out
end

--- Title text + hl, formatted as { { " <session> · <branch> ", hl } }.
--- Branch is optional; omitted segment renders just the session name.
---@param tool string|nil
---@param session_name string
---@param branch string|nil
---@return table
function M.title_spec(tool, session_name, branch)
  local hl = M.hl_groups(tool)
  if branch and branch ~= "" then
    return {
      { string.format(" %s ", session_name), hl.title },
      { string.format(" %s %s ", M.branch_glyph, branch), "SidekickBranch" },
    }
  end
  return { { string.format(" %s ", session_name), hl.title } }
end

--- Mutate a sidekick.cli.Terminal's float opts so the next open uses the
--- per-tool border + title. Called from Config.cli.win.config.
---@param terminal table sidekick.cli.Terminal
function M.apply(terminal)
  if not terminal or not terminal.opts or not terminal.opts.float then
    return
  end
  local tool_name = terminal.tool and terminal.tool.name or nil
  local tool = M.tool_of(tool_name)
  local session_name = tool_name or "sidekick"
  local branch = nil
  local sid = terminal.tmux_session_id or (terminal.session and terminal.session.tmux_session_id)
  if not sid and tool_name then
    local ok, internal = pcall(require, "plugins.sidekick.internal")
    if ok and internal.find_tmux_session_id then
      sid = internal.find_tmux_session_id(tool_name)
    end
  end
  if sid then
    local ok, branch_mod = pcall(require, "plugins.sidekick.branch")
    if ok then
      branch = branch_mod.read_session(sid)
    end
  end
  terminal.opts.float.border = M.border_spec(tool)
  terminal.opts.float.title = M.title_spec(tool, session_name, branch)
  terminal.opts.float.title_pos = "center"
end

return M
