-- nvim/.config/nvim/lua/plugins/sidekick/registry.lua
local internal = require("plugins.sidekick.internal")

local M = {}

--- Parse a tmux session name into its sidekick components.
--- Default sidekick sessions look like `claude <hash>`; named ones like
--- `claude-tutorial <hash>`. Only named sessions return a non-nil result —
--- defaults are already registered in Config.cli.tools.
---
--- The tool prefix list is derived from internal.tool_commands so adding
--- a new tool there is the only change needed.
---@param name string
---@return { tool: string, slug: string, label: string }|nil
function M.parse_session_name(name)
  if type(name) ~= "string" then
    return nil
  end
  for tool, _ in pairs(internal.tool_commands) do
    -- Match `<tool>-<slug> <hash>`. sidekick currently computes the hash
    -- width from the tool-name length, so 16-char names like
    -- `pi-wedding-tasks` end up with an empty suffix and a trailing space.
    local pattern = "^" .. tool:gsub("%-", "%%-") .. "%-([%w_-]+)%s*%x*$"
    local slug = name:match(pattern)
    if slug and slug ~= "" then
      return { tool = tool, slug = slug, label = tool .. "-" .. slug }
    end
  end
  return nil
end

-- Format string passed to tmux list-panes; mirrors sidekick.nvim's PANE_FORMAT
-- but adds a literal separator we control. Layout:
-- <session_id>|<session_name>|<pane_id>|<cwd>
local PANE_FORMAT =
  "#{session_id}|#{session_name}|#{pane_id}|#{?pane_current_path,#{pane_current_path},#{pane_start_path}}"

---@return string[] lines, string? err
local function tmux_list_panes()
  if vim.fn.executable("tmux") ~= 1 then
    return {}
  end
  local out = vim.fn.systemlist({ "tmux", "list-panes", "-a", "-F", PANE_FORMAT })
  if vim.v.shell_error ~= 0 then
    return {}, table.concat(out, "\n")
  end
  return out
end

--- Walk all tmux panes; return a label-indexed map of named sidekick sessions.
--- One entry per label — if multiple panes share a session_name (multi-pane
--- session), the first wins. Sidekick spawns one pane per session so this is
--- the typical case.
---@return table<string, { tool: string, slug: string, label: string, cwd: string, pane_id: string, session_id: string }>
function M.discover()
  local out = {}
  for _, line in ipairs(tmux_list_panes()) do
    local session_id, session_name, pane_id, cwd = line:match("^([^|]+)|([^|]+)|([^|]+)|(.*)$")
    if session_id and session_name and pane_id then
      local parsed = M.parse_session_name(session_name)
      if parsed and not out[parsed.label] then
        out[parsed.label] = {
          tool = parsed.tool,
          slug = parsed.slug,
          label = parsed.label,
          cwd = cwd or "",
          pane_id = pane_id,
          session_id = session_id,
        }
      end
    end
  end
  return out
end

--- For every discovered label not already in Config.cli.tools, register a
--- tool entry. Idempotent: existing tools are never overwritten (so explicit
--- registrations from <leader>an/<leader>aN at runtime stay authoritative).
function M.rehydrate()
  local ok, config = pcall(require, "sidekick.config")
  if not ok then
    return
  end
  config.cli.tools = config.cli.tools or {}
  for label, entry in pairs(M.discover()) do
    if config.cli.tools[label] == nil then
      local cmd = internal.tool_commands[entry.tool] or { entry.tool }
      config.cli.tools[label] = internal.merged_tool_config(
        entry.tool,
        internal.make_tool(cmd, internal.normalize_cwd(entry.cwd), internal.tool_urls[entry.tool])
      )
    end
  end
end

return M
