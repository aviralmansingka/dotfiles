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

---@param cwd string
---@param scope? string|{ workspace_id?: string }
---@return string|nil workspace_id
---@return string|nil root_pane_id
---@return boolean created
---@return string|nil root_tab_id
function M.ensure_workspace(cwd, scope)
  if type(scope) == "table" and scope.workspace_id then
    return scope.workspace_id, nil, false
  end
  local workspace_label = type(scope) == "string" and scope or nil
  local workspace_id
  if workspace_label then
    local listed
    workspace_id, listed = M.workspace_for_label(workspace_label)
    if not listed then
      return nil, nil, false
    end
  else
    workspace_id = M.workspace_for_cwd(cwd)
  end
  if workspace_id then
    return workspace_id, nil, false
  end
  local normalized = M.normalize_cwd(cwd)
  workspace_label = workspace_label or vim.fn.fnamemodify(normalized, ":t")
  local result = M.call({ "workspace", "create", "--cwd", normalized, "--label", workspace_label, "--no-focus" })
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
---@param task_branch string
---@return table|nil scope
function M.ensure_task_scope(repository, workspace_label, feature_branch, task_branch)
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

  local task = worktree_for_branch(listed.worktrees, task_branch)
  if not task then
    local result = M.call({
      "worktree",
      "create",
      "--cwd",
      normalized,
      "--branch",
      task_branch,
      "--label",
      workspace_label,
      "--no-focus",
    })
    task = result and result.worktree or nil
    local temporary_workspace_id = result and result.workspace and result.workspace.workspace_id or nil
    if not task or not temporary_workspace_id then
      return nil
    end
    if not M.call({ "workspace", "close", temporary_workspace_id }) then
      M.call({ "worktree", "remove", "--workspace", temporary_workspace_id }, true)
      return nil
    end
  end

  return task.path and { workspace_id = workspace_id, cwd = task.path } or nil
end

---@param agent table
---@param scope table
---@param tab_label string
---@return table|nil agent
function M.place_agent(agent, scope, tab_label)
  local cwd = M.normalize_cwd(agent.foreground_cwd or agent.cwd)
  if cwd ~= M.normalize_cwd(scope.cwd) then
    notify("existing agent cwd does not match its task worktree")
    return nil
  end
  if agent.workspace_id == scope.workspace_id then
    return M.call({ "tab", "rename", agent.tab_id, tab_label }) and agent or nil
  end

  local created = M.call({
    "tab",
    "create",
    "--workspace",
    scope.workspace_id,
    "--cwd",
    scope.cwd,
    "--label",
    tab_label,
    "--no-focus",
  })
  local tab = created and created.tab or nil
  local root = created and created.root_pane or nil
  if not tab or not root then
    return nil
  end
  local moved = M.call({
    "pane",
    "move",
    agent.pane_id,
    "--tab",
    tab.tab_id,
    "--split",
    "right",
    "--target-pane",
    root.pane_id,
    "--ratio",
    "0.5",
    "--no-focus",
  })
  if not moved then
    M.call({ "tab", "close", tab.tab_id }, true)
    return nil
  end
  M.call({ "pane", "close", root.pane_id }, true)
  return M.get_agent(agent.name or agent.pane_id) or vim.tbl_extend("force", agent, {
    cwd = scope.cwd,
    foreground_cwd = scope.cwd,
    tab_id = tab.tab_id,
    workspace_id = scope.workspace_id,
  })
end

---@param name string
---@param cwd string
---@param command string[]
---@param env? table<string, string|boolean>
---@param scope? string|{ workspace_id?: string }
---@param tab_label? string
---@return table|nil agent
function M.start(name, cwd, command, env, scope, tab_label)
  local normalized = M.normalize_cwd(cwd)
  local resolved_id, root_pane_id, workspace_created, tab_id = M.ensure_workspace(cwd, scope)
  if not resolved_id then
    return nil
  end
  if workspace_created then
    if not tab_id or not M.call({ "tab", "rename", tab_id, tab_label or name }) then
      M.call({ "workspace", "close", resolved_id }, true)
      return nil
    end
  else
    local tab_result = M.call({
      "tab",
      "create",
      "--workspace",
      resolved_id,
      "--cwd",
      normalized,
      "--label",
      tab_label or name,
      "--no-focus",
    })
    if not tab_result or not tab_result.tab then
      return nil
    end
    tab_id = tab_result.tab.tab_id
    root_pane_id = tab_result.root_pane and tab_result.root_pane.pane_id or nil
  end
  local args = {
    "agent",
    "start",
    name,
    "--cwd",
    normalized,
    "--workspace",
    resolved_id,
    "--tab",
    tab_id,
    "--no-focus",
  }
  for key, value in pairs(env or {}) do
    if value ~= false then
      vim.list_extend(args, { "--env", string.format("%s=%s", key, tostring(value)) })
    end
  end
  args[#args + 1] = "--"
  vim.list_extend(args, command)
  local result = M.call(args)
  local agent = result and result.agent or nil
  if not agent then
    if workspace_created then
      M.call({ "workspace", "close", resolved_id }, true)
    elseif tab_id then
      M.call({ "tab", "close", tab_id }, true)
    end
    return nil
  end
  if root_pane_id and root_pane_id ~= agent.pane_id then
    M.call({ "pane", "close", root_pane_id }, true)
  end
  return agent
end

---@param target string
---@param text string
---@return boolean
function M.send(target, text)
  return M.call({ "agent", "send", target, text }) ~= nil
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
  local result = M.call(args)
  return result and result.read and result.read.text or nil
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
    local decoded = decode(cmd, result)
    callback(decoded and decoded.read and decoded.read.text or nil)
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
