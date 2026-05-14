-- Per-tool visual identity for sidekick floats.
-- Colors, highlight groups, border + title builders. Pure module — no side
-- effects on require. Call M.ensure_highlights() once at plugin setup and on
-- every ColorScheme autocmd.
local internal = require("plugins.sidekick.internal")

local M = {}

M.colors = {
  claude = "#e48285", -- terracotta
  codex = "#89b482", -- gruvbox aqua, matches Codex image-token text
  cursor = "#B19CD9", -- soft violet
  opencode = "#928374", -- gruvbox gray
  -- Ask + edit borders match their gutter-sign colors (defined in
  -- plugins/sidekick/ask/signs.lua). Blue for ask, deep dark purple for
  -- edit. Kept in sync manually with signs.lua.
  ask = "#83a598", -- gruvbox blue
  edit = "#8f3f71", -- gruvbox faded purple
}

M.fallback_color = "#7C7C7C"

-- Starship's default `git_branch` style is `bold purple`; in this user's
-- ghostty palette, color 5 (purple) resolves to #d3869b. Match that exactly.
M.branch_color = "#d3869b"
M.branch_glyph = ""
M.dir_glyph = ""

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
      { "· ", "Comment" },
      { string.format("%s %s ", M.branch_glyph, branch), "SidekickBranch" },
    }
  end
  return { { string.format(" %s ", session_name), hl.title } }
end

--- Statusline-syntax winbar string, mirroring the float's title_spec.
---@param tool string|nil
---@param session_name string
---@param branch string|nil
---@return string
function M.winbar_spec(tool, session_name, branch)
  local hl = M.hl_groups(tool)
  local s = string.format(" %%#%s#%s ", hl.title, session_name)
  if branch and branch ~= "" then
    s = s
      .. string.format("%%#Comment#· %%#SidekickBranch#%s %s", M.branch_glyph, branch)
  end
  return s
end

--- Infer tool/session/branch from a sidekick.cli.Terminal.
---@param terminal table
---@return string|nil tool, string session_name, string|nil branch
local function infer_terminal_branding(terminal)
  local tool_name = terminal.tool and terminal.tool.name or nil
  local tool = M.tool_of(tool_name)
  local session_name = tool_name or "sidekick"
  local branch = nil
  local sid = terminal.tmux_session_id or (terminal.session and terminal.session.tmux_session_id)
  if not sid and tool_name then
    local ok, internal_mod = pcall(require, "plugins.sidekick.internal")
    if ok and internal_mod.find_tmux_session_id then
      sid = internal_mod.find_tmux_session_id(tool_name)
    end
  end
  if sid then
    local ok, branch_mod = pcall(require, "plugins.sidekick.branch")
    if ok then
      branch = branch_mod.read_session(sid)
    end
  end
  return tool, session_name, branch
end

--- Set winbar + colored WinSeparator on a split window hosting a sidekick CLI.
---@param win integer
---@param tool string|nil
---@param session_name string
---@param branch string|nil
function M.apply_to_split(win, tool, session_name, branch)
  if not vim.api.nvim_win_is_valid(win) then
    return
  end
  local hl = M.hl_groups(tool)
  vim.wo[win].winbar = M.winbar_spec(tool, session_name, branch)
  vim.wo[win].winhighlight = "WinSeparator:" .. hl.border
end

--- Apply split styling for a terminal to a specific window. Use when the
--- caller already knows the winid (e.g., float_toggle after float → split).
---@param terminal table sidekick.cli.Terminal
---@param win integer
function M.apply_split_for(terminal, win)
  if not terminal then
    return
  end
  local tool, session_name, branch = infer_terminal_branding(terminal)
  M.apply_to_split(win, tool, session_name, branch)
end

--- Strip the split-only styling from a window (used when converting split → float).
---@param win integer
function M.clear_split_styling(win)
  if not vim.api.nvim_win_is_valid(win) then
    return
  end
  vim.wo[win].winbar = ""
  vim.wo[win].winhighlight = ""
end

--- Mutate a sidekick.cli.Terminal's opts so the next open uses the
--- per-tool branding. For float layouts that means border + title; for
--- split layouts the window doesn't exist yet, so we defer winbar +
--- winhighlight setup to the next event-loop tick.
---@param terminal table sidekick.cli.Terminal
function M.apply(terminal)
  if not terminal or not terminal.opts then
    return
  end
  local tool, session_name, branch = infer_terminal_branding(terminal)
  if terminal.opts.layout == "float" and terminal.opts.float then
    terminal.opts.float.border = M.border_spec(tool)
    terminal.opts.float.title = M.title_spec(tool, session_name, branch)
    terminal.opts.float.title_pos = "center"
    return
  end
  -- Split layout: terminal.win is not assigned yet at config-callback time.
  vim.schedule(function()
    if terminal.win and vim.api.nvim_win_is_valid(terminal.win) then
      M.apply_to_split(terminal.win, tool, session_name, branch)
    end
  end)
end

return M
