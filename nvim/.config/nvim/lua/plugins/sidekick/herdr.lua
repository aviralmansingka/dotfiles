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
function M.workspace_for_cwd(cwd)
  local wanted = M.normalize_cwd(cwd)
  for _, pane in ipairs(M.list_panes()) do
    local pane_cwd = M.normalize_cwd(pane.foreground_cwd or pane.cwd)
    if pane_cwd == wanted then
      return pane.workspace_id
    end
  end
end

---@param label string
---@return string|nil workspace_id
---@return boolean listed
function M.workspace_for_label(label)
  local result = M.call({ "workspace", "list" })
  if not result then
    return nil, false
  end
  local wanted = vim.trim(label):lower()
  for _, workspace in ipairs(result.workspaces or {}) do
    if vim.trim(workspace.label or ""):lower() == wanted then
      return workspace.workspace_id, true
    end
  end
  return nil, true
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
  if type(scope) == "table" and scope.workspace_id then
    return scope.workspace_id, nil, false
  end
  local workspace_cwd = type(scope) == "table" and scope.cwd or cwd
  local workspace_label = type(scope) == "table" and scope.label or (type(scope) == "string" and scope or nil)
  local workspace_id
  if type(scope) == "string" then
    local listed
    workspace_id, listed = M.workspace_for_label(workspace_label)
    if not listed then
      return nil, nil, false
    end
  else
    workspace_id = M.workspace_for_cwd(workspace_cwd)
    if not workspace_id and workspace_label then
      local listed
      workspace_id, listed = M.workspace_for_label(workspace_label)
      if not listed then
        return nil, nil, false
      end
    end
  end
  if workspace_id then
    return workspace_id, nil, false
  end
  local normalized = M.normalize_cwd(workspace_cwd)
  workspace_label = workspace_label or vim.fn.fnamemodify(normalized, ":t")
  local create_args = { "workspace", "create", "--cwd", normalized, "--label", workspace_label, "--no-focus" }
  vim.list_extend(create_args, env_args(env))
  local result = M.call(create_args)
  if not result or not result.workspace then
    return nil, nil, false
  end
  return
    result.workspace.workspace_id,
    result.root_pane and result.root_pane.pane_id or nil,
    true,
    result.root_pane and result.root_pane.tab_id or nil
end

local function worktree_for_branch(worktrees, branch)
  for _, worktree in ipairs(worktrees or {}) do
    if worktree.branch == branch then
      return worktree
    end
  end
end

---@param repository string
---@param workspace_label string
---@param feature_branch string
---@return table|nil scope
function M.ensure_feature_scope(repository, workspace_label, feature_branch)
  local normalized = M.normalize_cwd(repository)
  local listed = M.call({ "worktree", "list", "--cwd", normalized })
  if not listed then
    return nil
  end

  local feature = worktree_for_branch(listed.worktrees, feature_branch)
  local workspace_id = feature and feature.open_workspace_id or nil
  if not workspace_id then
    local action = feature and "open" or "create"
    local result = M.call({
      "worktree",
      action,
      "--cwd",
      normalized,
      "--branch",
      feature_branch,
      "--label",
      workspace_label,
      "--no-focus",
    })
    feature = result and result.worktree or nil
    workspace_id = result and result.workspace and result.workspace.workspace_id or nil
  end
  if not feature or not workspace_id then
    return nil
  end
  if not M.call({ "workspace", "rename", workspace_id, workspace_label }) then
    return nil
  end

  return feature.path and { workspace_id = workspace_id, cwd = feature.path } or nil
end

---@param repository string
---@param workspace_label string
---@param feature_branch string
---@param task_branch string
---@return table|nil scope
function M.ensure_task_scope(repository, workspace_label, feature_branch, task_branch)
  local normalized = M.normalize_cwd(repository)
  local listed = M.call({ "worktree", "list", "--cwd", normalized })
  if not listed then
    return nil
  end

  local feature = worktree_for_branch(listed.worktrees, feature_branch)
  if not feature then
    local result = M.call({
      "worktree",
      "create",
      "--cwd",
      normalized,
      "--branch",
      feature_branch,
      "--label",
      workspace_label,
      "--no-focus",
    })
    feature = result and result.worktree or nil
    local temporary_workspace_id = result and result.workspace and result.workspace.workspace_id or nil
    if not feature or not temporary_workspace_id or not M.call({ "workspace", "close", temporary_workspace_id }) then
      return nil
    end
  end

  local task = worktree_for_branch(listed.worktrees, task_branch)
  local workspace_id = task and task.open_workspace_id or nil
  if not workspace_id then
    local action = task and "open" or "create"
    local result = M.call({
      "worktree",
      action,
      "--cwd",
      normalized,
      "--branch",
      task_branch,
      "--label",
      workspace_label,
      "--no-focus",
    })
    task = result and result.worktree or nil
    workspace_id = result and result.workspace and result.workspace.workspace_id or nil
  end
  if not task or not workspace_id or not M.call({ "workspace", "rename", workspace_id, workspace_label }) then
    return nil
  end

  return task.path and { workspace_id = workspace_id, cwd = task.path } or nil
end

---@param agent? table
---@return boolean
local function terminal_agent(agent)
  return not not (agent
    and agent.name
    and agent.pane_id
    and agent.tab_id
    and agent.workspace_id
    and agent.terminal_id)
end

---@param agent? table
---@return boolean
local function full_agent(agent)
  local session = agent and agent.agent_session
  return not not (terminal_agent(agent)
    and session
    and session.source
    and session.kind
    and session.value)
end

local function same_session(left, right)
  return left
    and right
    and left.source == right.source
    and left.kind == right.kind
    and left.value == right.value
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
---@param scope table
---@param tab_label string
---@return table|nil agent
function M.place_agent(agent, scope, tab_label)
  if not full_agent(agent) then
    notify("worker must be a full Herdr Codex session")
    return nil
  end
  local cwd = M.normalize_cwd(agent.foreground_cwd or agent.cwd)
  if cwd ~= M.normalize_cwd(scope.cwd) then
    notify("existing agent cwd does not match its feature worktree")
    return nil
  end
  return own_tab(agent, scope, tab_label)
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
  local resolved_id, bootstrap_pane_id, workspace_created, bootstrap_tab_id =
    M.ensure_workspace(cwd, scope, env)
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
  while
    not result
    and err
    and err:find("agent_pane_busy", 1, true)
    and vim.uv.hrtime() < readiness_deadline
  do
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
  vim.system(cmd, { text = true }, vim.schedule_wrap(function(result)
    if result.code ~= 0 then
      decode(cmd, result)
      callback(nil)
      return
    end
    callback(result.stdout or "")
  end))
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
