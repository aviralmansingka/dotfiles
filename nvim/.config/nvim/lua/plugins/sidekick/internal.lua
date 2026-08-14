-- nvim/.config/nvim/lua/plugins/sidekick/internal.lua
local M = {}

M.tool_urls = {
  codex = "https://github.com/openai/codex",
  pi = "https://github.com/earendil-works/pi",
}

M.tool_commands = {
  codex = { "codex", "--dangerously-bypass-approvals-and-sandbox" },
  pi = { "pi" },
}

M.primary_agent_order = { "pi", "codex" }
M.agent_order = { "pi", "codex" }
M.agent_rank = {}
for rank, tool in ipairs(M.agent_order) do
  M.agent_rank[tool] = rank
end

--- Env var passed to named Herdr agents so native tool integrations can keep
--- distinguishing named tools when Sidekick inspects their processes.
M.named_env_var = "SIDEKICK_NAMED_SESSION"

M.tool_is_proc_patterns = {
  codex = "\\<codex\\>",
  pi = "\\<pi\\>",
}

local function agent_sort_rank(tool)
  return M.agent_rank[tool] or 1000
end

function M.compare_agents(a, b)
  local ar = agent_sort_rank(a)
  local br = agent_sort_rank(b)
  if ar ~= br then
    return ar < br
  end
  return tostring(a or "") < tostring(b or "")
end

function M.ordered_agents()
  local tools = {}
  for tool, _ in pairs(M.tool_commands) do
    tools[#tools + 1] = tool
  end
  table.sort(tools, M.compare_agents)
  return tools
end

function M.primary_agents()
  local tools = {}
  for _, tool in ipairs(M.primary_agent_order) do
    if M.tool_commands[tool] then
      tools[#tools + 1] = tool
    end
  end
  return tools
end

function M.command_to_shell(cmd)
  if type(cmd) ~= "table" then
    return tostring(cmd)
  end
  local escaped = {}
  for _, part in ipairs(cmd) do
    escaped[#escaped + 1] = vim.fn.shellescape(part)
  end
  return table.concat(escaped, " ")
end

--- Toggle a Sidekick tool session through the configured backend.
---@param name string
---@param focus boolean|nil
---@param terminal_id? string
function M.toggle_tool_session(name, focus, terminal_id)
  M.hide_tool_sessions(name)
  local filter = terminal_id and { session = "herdr:" .. terminal_id } or nil
  require("sidekick.cli").toggle({ name = name, focus = focus ~= false, filter = filter })
end

--- Hide visible Sidekick terminals except an optional tool.
---@param except? string
---@return string|nil first hidden tool name
function M.hide_tool_sessions(except)
  local hidden
  for _, terminal in ipairs(require("sidekick.cli.terminal").sessions()) do
    if terminal.tool.name ~= except and terminal:is_open() then
      hidden = hidden or terminal.tool.name
      terminal:hide()
    end
  end
  return hidden
end

---@param cmd string|string[]
---@param cwd? string
---@param url? string
---@param extra? table extra config to merge in (e.g., env, is_proc)
function M.make_tool(cmd, cwd, url, extra)
  local out
  if cwd and cwd ~= "" then
    out = {
      cmd = { "sh", "-c", string.format("cd %s && exec %s", vim.fn.shellescape(cwd), M.command_to_shell(cmd)) },
      url = url,
    }
  elseif type(cmd) == "table" then
    out = { cmd = vim.deepcopy(cmd), url = url }
  else
    out = { cmd = { cmd }, url = url }
  end
  -- Unwrapped argv (executable + args) for backends like Herdr that launch the
  -- kind's canonical executable themselves and set cwd on the pane.
  out.raw_cmd = type(cmd) == "table" and vim.deepcopy(cmd) or { cmd }
  if extra then
    out = vim.tbl_deep_extend("force", out, extra)
  end
  return out
end

--- is_proc for a base tool: match the tool's cmd pattern, but reject any
--- proc carrying SIDEKICK_NAMED_SESSION (those belong to a named tool).
---@param pattern string vim regex matching the base tool's cmdline
---@return fun(self, proc): boolean
function M.is_proc_base(pattern)
  local re = vim.regex(pattern)
  return function(_, proc)
    if (proc.env or {})[M.named_env_var] then
      return false
    end
    return re:match_str(proc.cmd) ~= nil
  end
end

--- is_proc for a named tool: match procs whose env var equals slug.
---@param slug string
---@return fun(self, proc): boolean
function M.is_proc_named(slug)
  return function(_, proc)
    return (proc.env or {})[M.named_env_var] == slug
  end
end

--- Build the user-facing tool config for sidekick.config.cli.tools[<tool>].
--- Wires the base-pattern is_proc so default tool sessions don't collide
--- with named sessions in the cli picker.
---@param tool string
function M.base_tool_config(tool)
  return M.make_tool(M.tool_commands[tool], nil, M.tool_urls[tool], {
    is_proc = M.is_proc_base(M.tool_is_proc_patterns[tool]),
  })
end

--- Merge sk/cli/<base>.lua defaults (is_proc, mux_focus, etc.) into a dynamic tool entry.
--- Keys from `made` win so cmd/url from make_tool stay authoritative.
---@param base_tool_name string
---@param made table
function M.merged_tool_config(base_tool_name, made)
  local Tool = require("sidekick.cli.tool")
  local base = Tool.get(base_tool_name)
  return vim.tbl_deep_extend("force", vim.deepcopy(base.config), made)
end

function M.normalize_label(label)
  return (label or "")
    :gsub("^%s+", "")
    :gsub("%s+$", "")
    :lower()
    :gsub("[^%w_-]+", "-")
    :gsub("-+", "-")
    :gsub("^-+", "")
    :gsub("-+$", "")
end

function M.normalize_cwd(cwd)
  if not cwd or cwd == "" then
    return nil
  end
  local expanded = vim.fs.normalize(vim.fn.fnamemodify(cwd, ":p"))
  local current = vim.fs.normalize(vim.fn.fnamemodify(vim.fn.getcwd(), ":p"))
  if expanded == current then
    return nil
  end
  return expanded
end

--- Build the spawn command for a named session.
---@param tool string
---@param slug string
---@return string[]
function M.tool_command_for_named_session(tool, slug)
  local cmd = vim.deepcopy(M.tool_commands[tool] or { tool })
  if tool == "pi" and slug and slug ~= "" then
    table.insert(cmd, "--name")
    table.insert(cmd, slug)
  end
  return cmd
end

---@param tool string
---@param label string
---@param cwd? string
function M.start_named_session(tool, label, cwd)
  local slug = M.normalize_label(label)
  local name = tool .. "-" .. slug
  local requested_cwd = M.normalize_cwd(cwd) or vim.fn.getcwd()
  local herdr = require("plugins.sidekick.herdr")
  local context = herdr.git_context(requested_cwd)
  local existing, listed = herdr.agent_for_worktree(requested_cwd, context and context.branch == "main" and name or nil)
  if listed == false then
    vim.notify("Sidekick: could not verify whether this worktree already owns a durable session", vim.log.levels.ERROR)
    return
  end
  if existing then
    local target = existing.agent
    if not (existing.name or ""):match("^sk%-") then
      local registry = require("plugins.sidekick.registry")
      registry.rehydrate()
      local parsed = registry.parse_session_name(existing.name)
      target = parsed and parsed.label or target
    end
    if target then
      M.toggle_tool_session(target, true, existing.terminal_id)
      require("plugins.sidekick.last_session").record(target)
      vim.notify(string.format("Sidekick: reusing %s for this worktree", existing.name or target), vim.log.levels.INFO)
      return
    end
    vim.notify("Sidekick: this worktree already owns a session", vim.log.levels.WARN)
    return
  end
  if slug == "" then
    vim.notify("Sidekick: session label cannot be empty", vim.log.levels.WARN)
    return
  end
  local config = require("sidekick.config")
  local command = M.tool_command_for_named_session(tool, slug)
  local workspace_ok, workspace_id = pcall(
    vim.api.nvim_tabpage_get_var,
    vim.api.nvim_get_current_tabpage(),
    "herdr_workspace_id"
  )
  local extra = {
    env = { [M.named_env_var] = slug },
    herdr_workspace_id = workspace_ok and type(workspace_id) == "string" and workspace_id or nil,
    is_proc = M.is_proc_named(slug),
  }
  config.cli.tools[name] =
    M.merged_tool_config(tool, M.make_tool(command, M.normalize_cwd(cwd), M.tool_urls[tool], extra))
  M.toggle_tool_session(name, true)
  require("plugins.sidekick.last_session").record(name)
end

function M.prompt_named_session(tool)
  vim.ui.input({ prompt = string.format("%s session label: ", tool) }, function(session_label)
    if not session_label then
      return
    end
    vim.ui.input({
      prompt = "Working directory (leave empty for current): ",
      default = vim.fn.getcwd(),
      completion = "dir",
    }, function(cwd)
      M.start_named_session(tool, session_label, cwd)
    end)
  end)
end

return M
