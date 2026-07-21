-- Display-only Git branch lookup for Herdr-backed Sidekick sessions.
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

return M
