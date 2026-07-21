-- nvim/.config/nvim/lua/plugins/sidekick/registry.lua
local internal = require("plugins.sidekick.internal")
local herdr = require("plugins.sidekick.herdr")

local M = {}

--- Parse a Herdr agent name into its named Sidekick components. Base Sidekick
--- sessions use `sk-<tool>-<hash>` and are intentionally ignored here.
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
    -- The optional suffix keeps parsing compatible with old tmux names while
    -- the Herdr representation is simply `<tool>-<slug>`.
    local pattern = "^" .. tool:gsub("%-", "%%-") .. "%-([%w_-]+)%s*%x*$"
    local slug = name:match(pattern)
    if slug and slug ~= "" then
      return { tool = tool, slug = slug, label = tool .. "-" .. slug }
    end
  end
  return nil
end

--- Return a label-indexed map of named Sidekick agents from Herdr.
---@return table<string, { tool: string, slug: string, label: string, cwd: string, pane_id: string, workspace_id: string, terminal_id: string, agent_name: string, status: string }>
function M.discover()
  local out = {}
  for _, agent in ipairs(herdr.list_agents()) do
    local parsed = M.parse_session_name(agent.name)
    if parsed and not out[parsed.label] then
      out[parsed.label] = {
        tool = parsed.tool,
        slug = parsed.slug,
        label = parsed.label,
        cwd = agent.foreground_cwd or agent.cwd or "",
        pane_id = agent.pane_id,
        workspace_id = agent.workspace_id,
        terminal_id = agent.terminal_id,
        agent_name = agent.name,
        status = agent.agent_status or "unknown",
      }
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
      local cmd = internal.tool_command_for_named_session(entry.tool, entry.slug)
      config.cli.tools[label] = internal.merged_tool_config(
        entry.tool,
        internal.make_tool(cmd, internal.normalize_cwd(entry.cwd), internal.tool_urls[entry.tool], {
          env = { [internal.named_env_var] = entry.slug },
          is_proc = internal.is_proc_named(entry.slug),
        })
      )
    end
  end
end

return M
