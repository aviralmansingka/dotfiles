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

return M
