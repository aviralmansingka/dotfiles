-- Send the current buffer (or visual selection) to the agent pane that lives in
-- the same Herdr tab as this Neovim pane.
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
M.agent_statuses = {
  working = true,
  busy = true,
  idle = true,
  done = true,
  waiting = true,
}

-- Guard against pasting a giant buffer into an agent prompt.
M.max_bytes = 64 * 1024

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.WARN)
end

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

---@return table|nil pane
---@return string|nil error
function M.resolve_target()
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
  return pane, nil
end

---@param bufnr integer
---@return integer start_line 1-indexed inclusive
---@return integer end_line 1-indexed inclusive
function M.visual_range(bufnr)
  local mode = vim.fn.mode()
  local first, last
  if mode == "v" or mode == "V" or mode == "\22" then
    first = vim.fn.getpos("v")[2]
    last = vim.fn.getpos(".")[2]
  else
    first = vim.fn.getpos("'<")[2]
    last = vim.fn.getpos("'>")[2]
  end
  if first == 0 or last == 0 then
    return 1, vim.api.nvim_buf_line_count(bufnr)
  end
  if first > last then
    first, last = last, first
  end
  return first, last
end

---@param bufnr integer
---@param visual boolean
---@return string text
---@return string label
function M.build_payload(bufnr, visual)
  local name = vim.api.nvim_buf_get_name(bufnr)
  local label = name ~= "" and vim.fn.fnamemodify(name, ":~:.") or "[No Name]"
  local first, last
  if visual then
    first, last = M.visual_range(bufnr)
  else
    first, last = 1, vim.api.nvim_buf_line_count(bufnr)
  end
  local lines = vim.api.nvim_buf_get_lines(bufnr, first - 1, last, false)
  local body = table.concat(lines, "\n")
  local truncated = false
  if #body > M.max_bytes then
    body = body:sub(1, M.max_bytes)
    truncated = true
  end
  local header = visual and string.format("From neovim buffer %s (lines %d-%d):", label, first, last)
    or string.format("From neovim buffer %s:", label)
  local text = header .. "\n" .. body
  if truncated then
    text = text .. string.format("\n[truncated: only the first %d bytes were sent]", M.max_bytes)
  end
  return text, label
end

---@param opts? { visual?: boolean, bufnr?: integer, fallback?: fun():boolean }
---@return boolean sent
function M.send(opts)
  opts = opts or {}
  local bufnr = opts.bufnr or vim.api.nvim_get_current_buf()
  local pane, err = M.resolve_target()
  if not pane then
    -- When no agent pane shares this tab, hand off to the caller's fallback
    -- (e.g. the original sidekick "Send This" stack) instead of warning.
    if opts.fallback then
      return opts.fallback() == true
    end
    notify(err or "No agent pane found in this tab")
    return false
  end
  local text, label = M.build_payload(bufnr, opts.visual == true)
  if herdr.call({ "pane", "send-text", pane.pane_id, text }) == nil then
    return false
  end
  if not herdr.send_key(pane.pane_id, "Enter") then
    return false
  end
  notify(
    string.format("Sent %s to %s (%s)", label, pane.agent or "agent", pane.pane_id),
    vim.log.levels.INFO
  )
  return true
end

return M
