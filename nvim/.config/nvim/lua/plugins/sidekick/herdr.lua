local M = {}

local function notify(message)
  vim.notify("Sidekick: " .. message, vim.log.levels.ERROR)
end

local function decode(cmd, result, quiet)
  if result.code ~= 0 then
    local err = (result.stderr or ""):gsub("%s+$", "")
    if not quiet then
      notify(err ~= "" and err or ("command failed: " .. table.concat(cmd, " ")))
    end
    return nil, err
  end
  if not result.stdout or result.stdout:match("^%s*$") then
    return {}
  end
  local ok, decoded = pcall(vim.json.decode, result.stdout or "")
  if not ok or type(decoded) ~= "table" or type(decoded.result) ~= "table" then
    local err = "invalid Herdr JSON response"
    if not quiet then
      notify(err)
    end
    return nil, err
  end
  return decoded.result
end

---@param path string|nil
---@return string
function M.normalize_cwd(path)
  if not path or path == "" then
    return ""
  end
  local normalized = vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
  return normalized == "/" and normalized or normalized:gsub("/$", "")
end

---@class SidekickGitContext
---@field repository string
---@field repository_label string
---@field worktree string
---@field worktree_label string

---@param cwd string
---@return SidekickGitContext|nil
function M.git_context(cwd)
  local normalized = M.normalize_cwd(cwd)
  if normalized == "" then
    return nil
  end
  local result = vim
    .system({
      "git",
      "-C",
      normalized,
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-common-dir",
      "--abbrev-ref",
      "HEAD",
    }, { text = true })
    :wait()
  if result.code ~= 0 then
    return nil
  end
  local lines = vim.split((result.stdout or ""):gsub("%s+$", ""), "\n", { plain = true })
  local worktree = M.normalize_cwd(lines[1])
  local common_dir = M.normalize_cwd(lines[2])
  if worktree == "" or common_dir == "" then
    return nil
  end
  local repository = M.normalize_cwd(vim.fn.fnamemodify(common_dir, ":h"))
  local branch = vim.trim(lines[3] or "")
  return {
    repository = repository,
    repository_label = vim.fn.fnamemodify(repository, ":t"),
    worktree = worktree,
    worktree_label = branch ~= "" and branch ~= "HEAD" and branch or vim.fn.fnamemodify(worktree, ":t"),
  }
end

---@param cwd string
---@param baseline? string
---@return { added: integer, removed: integer }|nil
function M.git_diff_stats(cwd, baseline)
  local context = M.git_context(cwd)
  if not context then
    return nil
  end
  local result = vim
    .system({ "git", "-C", context.worktree, "diff", "--numstat", baseline or "main", "--" }, { text = true })
    :wait()
  if result.code ~= 0 then
    return nil
  end
  local added, removed = 0, 0
  for line in (result.stdout or ""):gmatch("[^\n]+") do
    local line_added, line_removed = line:match("^(%d+)%s+(%d+)%s+")
    added = added + (tonumber(line_added) or 0)
    removed = removed + (tonumber(line_removed) or 0)
  end
  return { added = added, removed = removed }
end

---@param args string[]
---@param quiet? boolean
---@return table|nil result
---@return string|nil error
function M.call(args, quiet)
  local cmd = { "herdr" }
  vim.list_extend(cmd, args)
  return decode(cmd, vim.system(cmd, { text = true }):wait(), quiet)
end

---@return table[]
function M.list_agents()
  local result = M.call({ "agent", "list" })
  return result and result.agents or {}
end

---@return table[]
function M.list_panes()
  local result = M.call({ "pane", "list" })
  return result and result.panes or {}
end

---@param agent table|nil
---@return boolean
function M.is_durable_agent(agent)
  local kind = agent and agent.agent
  local name = agent and agent.name
  if (kind ~= "codex" and kind ~= "pi") or type(name) ~= "string" then
    return false
  end
  return name:match("^sk%-" .. kind .. "%-") ~= nil or name:match("^" .. kind .. "%-") ~= nil
end

---@param target string
---@return table|nil
function M.get_agent(target)
  local result = M.call({ "agent", "get", target }, true)
  return result and result.agent or nil
end

---@param tool string
---@param cwd string
---@return string
function M.agent_name(tool, cwd)
  if tool:find("-", 1, true) then
    return tool
  end
  return string.format("sk-%s-%s", tool:gsub("_", "-"):sub(1, 16), vim.fn.sha256(M.normalize_cwd(cwd)):sub(1, 8))
end

---@param cwd string
---@return string|nil workspace_id
---@return boolean listed
function M.workspace_for_cwd(cwd)
  local wanted = M.normalize_cwd(cwd)
  local result = M.call({ "pane", "list" }, true)
  if not result or type(result.panes) ~= "table" then
    return nil, false
  end
  for _, pane in ipairs(result.panes) do
    local pane_cwd = M.normalize_cwd(pane.foreground_cwd or pane.cwd)
    if pane_cwd == wanted then
      return pane.workspace_id, true
    end
  end
  return nil, true
end

---@param repository string
---@return string|nil workspace_id
---@return boolean listed
function M.workspace_for_repository(repository)
  local wanted = M.normalize_cwd(repository)
  local result = M.call({ "pane", "list" }, true)
  if not result or type(result.panes) ~= "table" then
    return nil, false
  end
  for _, pane in ipairs(result.panes) do
    local pane_cwd = pane.foreground_cwd or pane.cwd
    local context = M.git_context(pane_cwd)
    if (context and context.repository == wanted) or (not context and M.normalize_cwd(pane_cwd) == wanted) then
      return pane.workspace_id, true
    end
  end
  return nil, true
end

---@param cwd string
---@return table|nil agent
---@return boolean listed
function M.agent_for_worktree(cwd)
  local wanted = M.git_context(cwd)
  local wanted_cwd = wanted and wanted.worktree or M.normalize_cwd(cwd)
  local result = M.call({ "agent", "list" }, true)
  if not result or type(result.agents) ~= "table" then
    return nil, false
  end
  for _, agent in ipairs(result.agents) do
    if M.is_durable_agent(agent) then
      local agent_cwd = agent.foreground_cwd or agent.cwd
      local context = M.git_context(agent_cwd)
      if (context and context.worktree == wanted_cwd) or (not context and M.normalize_cwd(agent_cwd) == wanted_cwd) then
        return agent, true
      end
    end
  end
  return nil, true
end

---@param cwd string
---@return table|nil worktree
---@return string|nil path
local function containing_linked_worktree(cwd)
  local normalized = M.normalize_cwd(cwd)
  if normalized == "" then
    return nil
  end
  local listed = M.call({ "worktree", "list", "--cwd", normalized }, true)
  if not listed then
    return nil
  end
  local match, match_path
  for _, worktree in ipairs(listed.worktrees or {}) do
    local path = worktree.path and M.normalize_cwd(worktree.path) or ""
    if
      worktree.is_linked_worktree
      and path ~= ""
      and (normalized == path or vim.startswith(normalized, path .. "/"))
      and (not match_path or #path > #match_path)
    then
      match, match_path = worktree, path
    end
  end
  return match, match_path
end

---@param cwd string
---@return table|nil scope { workspace_id: string, cwd: string }
function M.worktree_scope(cwd)
  local worktree, path = containing_linked_worktree(cwd)
  if not worktree or not path then
    return nil
  end
  local workspace_id = worktree.open_workspace_id
  if not workspace_id then
    local result = M.call({ "worktree", "open", "--path", path, "--no-focus" })
    workspace_id = result and result.workspace and result.workspace.workspace_id or nil
  end
  if not workspace_id then
    return nil
  end
  return { workspace_id = workspace_id, cwd = path }
end

local function env_args(env)
  local out = {}
  for key, value in pairs(env or {}) do
    if value ~= false then
      vim.list_extend(out, { "--env", string.format("%s=%s", key, tostring(value)) })
    end
  end
  return out
end

---@param cwd string
---@param scope? string|{ workspace_id?: string, cwd?: string, label?: string }
---@param env? table<string, string|boolean>
---@return string|nil workspace_id
---@return string|nil root_pane_id
---@return boolean created
---@return string|nil root_tab_id
function M.ensure_workspace(cwd, scope, env)
  local scoped_workspace_id = type(scope) == "table" and scope.workspace_id or nil
  local workspace_cwd = type(scope) == "table" and scope.cwd or cwd
  local workspace_label = type(scope) == "table" and scope.label or (type(scope) == "string" and scope or nil)
  local git = M.git_context(workspace_cwd)
  if git then
    workspace_cwd = git.repository
    workspace_label = git.repository_label
  end
  local workspace_id
  local listed = true
  if git then
    workspace_id, listed = M.workspace_for_repository(workspace_cwd)
  else
    workspace_id, listed = M.workspace_for_cwd(workspace_cwd)
  end
  if listed == false then
    return nil, nil, false
  end
  if workspace_id then
    return workspace_id, nil, false
  end
  if scoped_workspace_id then
    return scoped_workspace_id, nil, false
  end
  local normalized = M.normalize_cwd(workspace_cwd)
  workspace_label = workspace_label or vim.fn.fnamemodify(normalized, ":t")
  local create_args = { "workspace", "create", "--cwd", normalized, "--label", workspace_label, "--no-focus" }
  vim.list_extend(create_args, env_args(env))
  local result = M.call(create_args)
  if not result or not result.workspace then
    return nil, nil, false
  end
  return result.workspace.workspace_id,
    result.root_pane and result.root_pane.pane_id or nil,
    true,
    result.root_pane and result.root_pane.tab_id or nil
end

---@param agent? table
---@return boolean
local function terminal_agent(agent)
  return not not (agent and agent.name and agent.pane_id and agent.tab_id and agent.workspace_id and agent.terminal_id)
end

---@param agent? table
---@return boolean
local function full_agent(agent)
  local session = agent and agent.agent_session
  return not not (terminal_agent(agent) and session and session.source and session.kind and session.value)
end

local function same_session(left, right)
  return left and right and left.source == right.source and left.kind == right.kind and left.value == right.value
end

local function tab_info(tab_id)
  local result = M.call({ "tab", "list" }, true)
  for _, tab in ipairs(result and result.tabs or {}) do
    if tab.tab_id == tab_id then
      return tab
    end
  end
end

local function own_tab(agent, scope, tab_label)
  local tab = tab_info(agent.tab_id)
  if tab and tab.workspace_id == scope.workspace_id and tab.pane_count == 1 then
    return M.call({ "tab", "rename", agent.tab_id, tab_label }) and agent or nil
  end

  local moved = M.call({
    "pane",
    "move",
    agent.pane_id,
    "--new-tab",
    "--workspace",
    scope.workspace_id,
    "--label",
    tab_label,
    "--no-focus",
  })
  if not moved then
    return nil
  end
  local placed = M.get_agent(agent.name)
  local placed_tab = placed and tab_info(placed.tab_id)
  local require_session = full_agent(agent)
  if
    not terminal_agent(placed)
    or placed.name ~= agent.name
    or placed.terminal_id ~= agent.terminal_id
    or (require_session and (not full_agent(placed) or not same_session(agent.agent_session, placed.agent_session)))
    or M.normalize_cwd(placed.foreground_cwd or placed.cwd) ~= M.normalize_cwd(scope.cwd)
    or placed.workspace_id ~= scope.workspace_id
    or not placed_tab
    or placed_tab.pane_count ~= 1
  then
    return nil
  end
  return placed
end

---@param agent table
---@return table|nil agent
function M.anchor_agent_worktree(agent)
  if not terminal_agent(agent) then
    return nil
  end
  local scope = M.worktree_scope(agent.foreground_cwd or agent.cwd)
  if not scope or scope.workspace_id == agent.workspace_id then
    return agent
  end
  local moved = M.call({
    "pane",
    "move",
    agent.pane_id,
    "--new-tab",
    "--workspace",
    scope.workspace_id,
    "--label",
    agent.name,
    "--no-focus",
  })
  if not moved then
    return nil
  end
  local placed = M.get_agent(agent.name)
  local require_session = full_agent(agent)
  if
    not terminal_agent(placed)
    or placed.name ~= agent.name
    or placed.terminal_id ~= agent.terminal_id
    or placed.workspace_id ~= scope.workspace_id
    or (require_session and (not full_agent(placed) or not same_session(agent.agent_session, placed.agent_session)))
  then
    return nil
  end
  return placed
end

---@param name string
---@param cwd string
---@param command string[] raw argv; command[1] is the herdr agent kind
---@param env? table<string, string|boolean>
---@param scope? string|{ workspace_id?: string }
---@param tab_label? string
---@return table|nil agent
function M.start(name, cwd, command, env, scope, tab_label)
  local normalized = M.normalize_cwd(cwd)
  local existing, listed = M.agent_for_worktree(normalized)
  if listed == false then
    notify("could not verify whether this worktree already owns a durable session")
    return nil
  end
  if existing then
    if existing.name == name then
      return existing
    end
    local context = M.git_context(normalized)
    notify(
      string.format(
        "worktree %s already owns session %s; use a separate worktree for another durable session",
        context and context.worktree_label or normalized,
        existing.name or existing.pane_id or "unknown"
      )
    )
    return nil
  end
  local resolved_id, bootstrap_pane_id, workspace_created, bootstrap_tab_id = M.ensure_workspace(cwd, scope, env)
  if not resolved_id then
    return nil
  end

  -- herdr 0.7.5 launches the agent inside an existing pane at a shell prompt.
  -- For a freshly created workspace the root pane is that pane (env was set on
  -- it via `workspace create --env`). For an existing workspace, split a new
  -- pane with the right cwd + env.
  local pane_id = bootstrap_pane_id
  if not pane_id then
    local panes = M.call({ "pane", "list", "--workspace", resolved_id }, true)
    local source = panes and panes.panes and panes.panes[1]
    if not source then
      if workspace_created then
        M.call({ "workspace", "close", resolved_id }, true)
      end
      return nil
    end
    local split_args = {
      "pane",
      "split",
      source.pane_id,
      "--direction",
      "right",
      "--cwd",
      normalized,
      "--no-focus",
    }
    vim.list_extend(split_args, env_args(env))
    local split = M.call(split_args)
    pane_id = split and split.pane and split.pane.pane_id
    if not pane_id then
      if workspace_created then
        M.call({ "workspace", "close", resolved_id }, true)
      end
      return nil
    end
  end

  -- `agent start --kind` launches the kind's canonical executable, so pass
  -- only the args after the executable name as agent args.
  local kind = command[1]
  local agent_args = {}
  for i = 2, #command do
    agent_args[#agent_args + 1] = command[i]
  end
  local start_args = { "agent", "start", name, "--kind", kind, "--pane", pane_id }
  if #agent_args > 0 then
    start_args[#start_args + 1] = "--"
    vim.list_extend(start_args, agent_args)
  end
  -- Herdr 0.8 may return `agent_pane_busy` for a freshly created or split
  -- pane whose shell has not yet reached its interactive prompt; `agent start
  -- --timeout` does not cover this case. Poll the start until the pane is
  -- ready or a bounded readiness window elapses.
  local result, err = M.call(start_args, true)
  local readiness_deadline = vim.uv.hrtime() + 10e9
  while not result and err and err:find("agent_pane_busy", 1, true) and vim.uv.hrtime() < readiness_deadline do
    vim.uv.sleep(200)
    result, err = M.call(start_args, true)
  end
  local agent = result and result.agent or nil
  if not result and err and err ~= "" then
    notify(err)
  end
  if not terminal_agent(agent) or agent.name ~= name then
    if agent and agent.pane_id then
      M.call({ "pane", "close", agent.pane_id }, true)
    else
      M.call({ "pane", "close", pane_id }, true)
    end
    if workspace_created then
      M.call({ "workspace", "close", resolved_id }, true)
    end
    return nil
  end
  agent = own_tab(agent, { workspace_id = resolved_id, cwd = normalized }, tab_label or name)
  if not agent then
    M.call({ "pane", "close", result.agent.pane_id }, true)
    if workspace_created then
      M.call({ "workspace", "close", resolved_id }, true)
    end
    return nil
  end
  if
    workspace_created
    and bootstrap_pane_id
    and bootstrap_tab_id
    and bootstrap_tab_id ~= agent.tab_id
    and not M.call({ "tab", "close", bootstrap_tab_id }, true)
  then
    M.call({ "workspace", "close", resolved_id }, true)
    return nil
  end
  return agent
end

---@param target string
---@param text string
---@return boolean
function M.send(target, text)
  return M.call({ "agent", "prompt", target, text }) ~= nil
end

---@param pane_id string
---@param key string
---@return boolean
function M.send_key(pane_id, key)
  return M.call({ "pane", "send-keys", pane_id, key }) ~= nil
end

---@param pane_id string
---@param text string
---@return boolean
function M.run(pane_id, text)
  return M.call({ "pane", "run", pane_id, text }) ~= nil
end

---@param target string
---@param source? "visible"|"recent"|"recent-unwrapped"
---@param lines? integer
---@param ansi? boolean
---@return string|nil
function M.read(target, source, lines, ansi)
  local args = { "agent", "read", target, "--source", source or "recent" }
  if lines then
    vim.list_extend(args, { "--lines", tostring(lines) })
  end
  if ansi then
    args[#args + 1] = "--ansi"
  end
  local cmd = { "herdr" }
  vim.list_extend(cmd, args)
  local result = vim.system(cmd, { text = true }):wait()
  if result.code ~= 0 then
    decode(cmd, result)
    return nil
  end
  return result.stdout or ""
end

---@param target string
---@param source "visible"|"recent"|"recent-unwrapped"
---@param lines integer?
---@param ansi boolean?
---@param callback fun(output: string?)
function M.read_async(target, source, lines, ansi, callback)
  local args = { "agent", "read", target, "--source", source }
  if lines then
    vim.list_extend(args, { "--lines", tostring(lines) })
  end
  if ansi then
    args[#args + 1] = "--ansi"
  end
  local cmd = { "herdr" }
  vim.list_extend(cmd, args)
  vim.system(
    cmd,
    { text = true },
    vim.schedule_wrap(function(result)
      if result.code ~= 0 then
        decode(cmd, result)
        callback(nil)
        return
      end
      callback(result.stdout or "")
    end)
  )
end

---@param target string
---@return boolean
function M.focus(target)
  return M.call({ "agent", "focus", target }, true) ~= nil
end

---@param pane_id string
---@return boolean
function M.close(pane_id)
  return M.call({ "pane", "close", pane_id }, true) ~= nil
end

return M
