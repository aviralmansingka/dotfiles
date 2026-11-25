-- Herdr adapter for the agent send path.
--
-- Pane discovery contract (herdr 0.8.0):
--   * current pane: `$HERDR_PANE_ID`, falling back to `herdr pane current`
--   * candidates:   `herdr pane list` -> result.panes, filtered to the same tab_id
--   * delivery:     `herdr pane send-text <pane_id> <text>` + `herdr pane send-keys <pane_id> Enter`
--
-- Only panes in the SAME tab with a positive agent lifecycle status are ever
-- targeted, so this never crosses tabs and never types into a bare shell.
local herdr = require("plugins.sidekick.herdr")

local M = {}

-- `herdr pane report-agent` states that mean "an agent owns this pane".
-- "unknown" (bare shell / firstmate primary before it reports) is excluded.
-- "blocked" is included: a blocked agent (e.g. Pi waiting on its own UI prompt)
-- still owns its pane, so it stays a valid same-tab send target.
M.agent_statuses = {
  working = true,
  busy = true,
  idle = true,
  done = true,
  waiting = true,
  blocked = true,
}

---@return string|nil
function M.current_pane_id()
  local env = os.getenv("HERDR_PANE_ID")
  if env and env ~= "" then
    return env
  end
  local result = herdr.call({ "pane", "current" }, true)
  local pane = result and result.pane
  return pane and pane.pane_id or nil
end

---@param pane table
---@return boolean
function M.is_agent_pane(pane)
  return type(pane) == "table" and M.agent_statuses[pane.agent_status] == true
end

---Pick the agent pane that shares a tab with `current_pane_id`.
---@param panes table[]
---@param current_pane_id string
---@return table|nil pane
function M.find_agent_pane(panes, current_pane_id)
  local tab_id
  for _, pane in ipairs(panes or {}) do
    if pane.pane_id == current_pane_id then
      tab_id = pane.tab_id
      break
    end
  end
  if not tab_id then
    return nil
  end
  local fallback
  for _, pane in ipairs(panes) do
    if pane.pane_id ~= current_pane_id and pane.tab_id == tab_id and M.is_agent_pane(pane) then
      -- Prefer a pane that also advertises an agent kind (codex/pi/...).
      if pane.agent then
        return pane
      end
      fallback = fallback or pane
    end
  end
  return fallback
end

---@return table|nil target { id, label, tab, mux }
---@return string|nil error
function M.resolve()
  local current = M.current_pane_id()
  if not current then
    return nil, "Not running inside a Herdr pane"
  end
  local panes = herdr.list_panes()
  if not panes or #panes == 0 then
    return nil, "No agent pane found in this tab"
  end
  local pane = M.find_agent_pane(panes, current)
  if not pane then
    return nil, "No agent pane found in this tab"
  end
  return {
    id = pane.pane_id,
    label = pane.agent or "agent",
    tab = pane.tab_id,
    mux = "herdr",
  }, nil
end

---@param target table
---@param text string
---@return boolean sent
function M.deliver(target, text)
  -- Both shapes reach here: this adapter's { id } target, and the raw pane
  -- tables callers and specs hand over directly.
  local id = type(target) == "table" and (target.id or target.pane_id) or nil
  if type(id) ~= "string" then
    return false
  end
  if herdr.call({ "pane", "send-text", id, text }) == nil then
    return false
  end
  return herdr.send_key(id, "Enter")
end

return M
