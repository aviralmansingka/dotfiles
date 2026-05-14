-- Git branch capture/restore for sidekick sessions.
-- Branch is stored as the SIDEKICK_BRANCH env var on the tmux session,
-- read/written via `tmux show-environment` / `tmux set-environment`.
-- All functions are best-effort: callers decide how to react to failure.
local M = {}

local function system(cmd, cwd)
  local opts = cwd and { cwd = cwd } or {}
  local result = vim.system(cmd, opts):wait()
  local lines = vim.split(result.stdout or "", "\n", { plain = true })
  while #lines > 0 and lines[#lines] == "" do
    table.remove(lines)
  end
  return lines, result.code
end

local function trim(s)
  return (s or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

--- Return current git branch for `cwd`, or nil if `cwd` is not a git repo.
---@param cwd string|nil
---@return string|nil
function M.current(cwd)
  if not cwd or cwd == "" then
    return nil
  end
  local out, rc = system({ "git", "rev-parse", "--abbrev-ref", "HEAD" }, cwd)
  if rc ~= 0 then
    return nil
  end
  local branch = trim(out[1])
  if branch == "" or branch == "HEAD" then
    return nil
  end
  return branch
end

--- Read SIDEKICK_BRANCH from a tmux session's env. Returns nil if unset or
--- tmux is unavailable.
---@param session_id string e.g. "$12"
---@return string|nil
function M.read_session(session_id)
  if not session_id or session_id == "" then
    return nil
  end
  if vim.fn.executable("tmux") ~= 1 then
    return nil
  end
  local out, rc = system({ "tmux", "show-environment", "-t", session_id, "SIDEKICK_BRANCH" })
  if rc ~= 0 then
    return nil
  end
  local line = trim(out[1])
  -- Output is either `SIDEKICK_BRANCH=<value>` or `-SIDEKICK_BRANCH` (unset).
  local value = line:match("^SIDEKICK_BRANCH=(.+)$")
  if value and value ~= "" then
    return value
  end
  return nil
end

--- Write SIDEKICK_BRANCH on a tmux session. No-op if branch is nil/empty.
--- Returns true on success.
---@param session_id string
---@param branch string|nil
---@return boolean
function M.write_session(session_id, branch)
  if not session_id or session_id == "" or not branch or branch == "" then
    return false
  end
  if vim.fn.executable("tmux") ~= 1 then
    return false
  end
  local _, rc = system({ "tmux", "set-environment", "-t", session_id, "SIDEKICK_BRANCH", branch })
  return rc == 0
end

local function git_dir(cwd)
  local out, rc = system({ "git", "rev-parse", "--git-dir" }, cwd)
  if rc ~= 0 then
    return nil
  end
  local dir = trim(out[1])
  if dir == "" then
    return nil
  end
  -- Resolve relative to cwd.
  if dir:sub(1, 1) ~= "/" then
    dir = cwd:gsub("/+$", "") .. "/" .. dir
  end
  return dir
end

local function path_exists(p)
  return p and vim.uv.fs_stat(p) ~= nil
end

local function dirty_file_count(cwd)
  local out, rc = system({ "git", "status", "--porcelain" }, cwd)
  if rc ~= 0 then
    return 0
  end
  local n = 0
  for _, line in ipairs(out) do
    if line ~= "" then
      n = n + 1
    end
  end
  return n
end

---@class sidekick.branch.Result
---@field ok boolean
---@field reason string|nil  one of "dirty", "rebase", "merge", "missing_branch", "not_a_repo", "checkout_failed"
---@field detail string|nil

--- Cheap pre-check. Does not modify the working tree.
---@param cwd string|nil
---@param branch string|nil
---@return sidekick.branch.Result
function M.can_switch(cwd, branch)
  if not cwd or cwd == "" then
    return { ok = false, reason = "not_a_repo", detail = "no cwd" }
  end
  if not branch or branch == "" then
    return { ok = true } -- nothing to switch to
  end
  local gd = git_dir(cwd)
  if not gd then
    return { ok = false, reason = "not_a_repo", detail = cwd }
  end
  if path_exists(gd .. "/MERGE_HEAD") then
    return { ok = false, reason = "merge", detail = "MERGE_HEAD present" }
  end
  if path_exists(gd .. "/rebase-apply") or path_exists(gd .. "/rebase-merge") then
    return { ok = false, reason = "rebase", detail = "rebase in progress" }
  end
  -- Verify branch exists (refs/heads/<branch>).
  local _, rc = system({ "git", "rev-parse", "--verify", "--quiet", "refs/heads/" .. branch }, cwd)
  if rc ~= 0 then
    return { ok = false, reason = "missing_branch", detail = branch }
  end
  -- Already on target?
  local cur = M.current(cwd)
  if cur == branch then
    return { ok = true }
  end
  -- Dirty?
  local _, dirty_rc = system({ "git", "diff", "--quiet" }, cwd)
  local _, staged_rc = system({ "git", "diff", "--cached", "--quiet" }, cwd)
  if dirty_rc ~= 0 or staged_rc ~= 0 then
    return { ok = false, reason = "dirty", detail = tostring(dirty_file_count(cwd)) .. " files" }
  end
  return { ok = true }
end

--- Run `git checkout <branch>` after can_switch passes. No-op if already on target.
---@param cwd string|nil
---@param branch string|nil
---@return sidekick.branch.Result
function M.switch(cwd, branch)
  local pre = M.can_switch(cwd, branch)
  if not pre.ok then
    return pre
  end
  if not branch or branch == "" then
    return { ok = true }
  end
  if M.current(cwd) == branch then
    return { ok = true }
  end
  local out, rc = system({ "git", "checkout", branch }, cwd)
  if rc ~= 0 then
    return { ok = false, reason = "checkout_failed", detail = table.concat(out, "; ") }
  end
  return { ok = true }
end

return M
