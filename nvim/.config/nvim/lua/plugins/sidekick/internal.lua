-- nvim/.config/nvim/lua/plugins/sidekick/internal.lua
local M = {}

M.tool_urls = {
  codex = "https://github.com/openai/codex",
  cursor = "https://cursor.com",
  opencode = "https://github.com/sst/opencode",
  pi = "https://github.com/earendil-works/pi",
  claude = "https://github.com/anthropics/claude-code",
}

M.claude_bin = vim.fn.executable(vim.fn.expand("~/.local/bin/claude")) == 1 and vim.fn.expand("~/.local/bin/claude")
  or "claude"

M.cursor_agent_bin = vim.fn.executable(vim.fn.expand("~/.local/bin/cursor-agent")) == 1
    and vim.fn.expand("~/.local/bin/cursor-agent")
  or "cursor-agent"

M.tool_commands = {
  codex = { "codex", "--dangerously-bypass-approvals-and-sandbox" },
  cursor = { M.cursor_agent_bin, "--force" },
  opencode = { "opencode" },
  pi = { "pi" },
  claude = { M.claude_bin, "--dangerously-skip-permissions" },
}

-- Highest-to-lowest preference for agent pickers. Pi + Codex are the primary
-- Neovim agent backends; Cursor/OpenCode/Claude are kept as optional legacy
-- backends and sorted after the primary pair.
M.primary_agent_order = { "pi", "codex" }
M.agent_order = { "pi", "codex", "cursor", "opencode", "claude" }
M.agent_rank = {}
for rank, tool in ipairs(M.agent_order) do
  M.agent_rank[tool] = rank
end

--- Env var passed to named Herdr agents so native tool integrations can keep
--- distinguishing named tools when Sidekick inspects their processes.
M.named_env_var = "SIDEKICK_NAMED_SESSION"

M.tool_is_proc_patterns = {
  codex = "\\<codex\\>",
  cursor = "\\<cursor-agent\\>",
  opencode = "\\<opencode\\>",
  pi = "\\<pi\\>",
  claude = "\\<claude\\>",
}

local function agent_sort_rank(tool)
  if tool == "claude" then
    return math.huge
  end
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

function M.is_claude_tool(name)
  return type(name) == "string" and name:match("^claude") ~= nil
end

function M.ensure_claude_bridge()
  local ok, claudecode = pcall(require, "claudecode")
  if not ok then
    local lazy_ok, lazy = pcall(require, "lazy")
    if lazy_ok and type(lazy.load) == "function" then
      lazy.load({ plugins = { "claudecode.nvim" } })
      ok, claudecode = pcall(require, "claudecode")
    end
  end
  if not ok then
    vim.notify("Sidekick: failed to load claudecode.nvim", vim.log.levels.ERROR)
    return false
  end
  if claudecode.state and claudecode.state.server then
    return true
  end
  local started, err = claudecode.start(false)
  if started or err == "Already running" then
    return true
  end
  vim.notify("Sidekick: failed to start Claude IDE bridge: " .. tostring(err), vim.log.levels.ERROR)
  return false
end

--- Toggle a Sidekick tool session through the configured backend.
---@param name string
---@param focus boolean|nil
function M.toggle_tool_session(name, focus)
  if M.is_claude_tool(name) and not M.ensure_claude_bridge() then
    return
  end
  M.hide_tool_sessions(name)
  require("sidekick.cli").toggle({ name = name, focus = focus ~= false })
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

--- Build the spawn command for a named session, splicing per-tool name flags
--- where supported. Claude and pi take `--name <slug>` so the slug appears in
--- their native session pickers/titles; other tools have no equivalent and
--- fall through unchanged.
---@param tool string
---@param slug string
---@return string[]
function M.tool_command_for_named_session(tool, slug)
  local cmd = vim.deepcopy(M.tool_commands[tool] or { tool })
  if (tool == "claude" or tool == "pi") and slug and slug ~= "" then
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
  if slug == "" then
    vim.notify("Sidekick: session label cannot be empty", vim.log.levels.WARN)
    return
  end
  local name = tool .. "-" .. slug
  local config = require("sidekick.config")
  local command = M.tool_command_for_named_session(tool, slug)
  local extra = {
    env = { [M.named_env_var] = slug },
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
