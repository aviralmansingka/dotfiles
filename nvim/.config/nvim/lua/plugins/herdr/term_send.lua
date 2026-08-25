-- Send the current buffer (or visual selection) to the non-agent terminal pane
-- that shares a Herdr tab with this Neovim pane. Mirrors ./agent_send.lua but
-- targets a bare terminal instead of an agent pane and sends raw text (no
-- "From neovim buffer" header) so the content is usable as shell input.
--
-- Pane discovery contract (herdr 0.8.0):
--   * current pane: `$HERDR_PANE_ID`, falling back to `herdr pane current`
--   * candidates:   `herdr pane list` -> result.panes, filtered to the same tab_id
--   * delivery:     `herdr pane send-text <pane_id> <text>` + `herdr pane send-keys <pane_id> Enter`
local herdr = require("plugins.sidekick.herdr")
local agent_send = require("plugins.herdr.agent_send")

local M = {}

-- Reuse the agent_send max_bytes guard so a giant buffer never gets pasted.
M.max_bytes = agent_send.max_bytes

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.WARN)
end

-- A terminal pane is any pane the agent_send module does NOT consider an agent
-- pane (agent_status "unknown" or absent). Excludes the current pane.
---@param pane table
---@return boolean
function M.is_term_pane(pane)
  return type(pane) == "table" and not agent_send.is_agent_pane(pane)
end

---Pick the terminal pane that shares a tab with `current_pane_id`.
---@param panes table[]
---@param current_pane_id string
---@return table|nil pane
function M.find_term_pane(panes, current_pane_id)
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
  for _, pane in ipairs(panes) do
    if pane.pane_id ~= current_pane_id and pane.tab_id == tab_id and M.is_term_pane(pane) then
      return pane
    end
  end
  return nil
end

---@return table|nil pane
---@return string|nil error
function M.resolve_target()
  local current = agent_send.current_pane_id()
  if not current then
    return nil, "Not running inside a Herdr pane"
  end
  local panes = herdr.list_panes()
  if not panes or #panes == 0 then
    return nil, "No terminal pane found in this tab"
  end
  local pane = M.find_term_pane(panes, current)
  if not pane then
    return nil, "No terminal pane found in this tab"
  end
  return pane, nil
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
    first, last = agent_send.visual_range(bufnr)
  else
    first, last = 1, vim.api.nvim_buf_line_count(bufnr)
  end
  local lines = vim.api.nvim_buf_get_lines(bufnr, first - 1, last, false)
  local body = table.concat(lines, "\n")
  if #body > M.max_bytes then
    body = body:sub(1, M.max_bytes)
  end
  return body, label
end

---@param opts? { visual?: boolean, bufnr?: integer }
---@return boolean sent
function M.send(opts)
  opts = opts or {}
  local bufnr = opts.bufnr or vim.api.nvim_get_current_buf()
  local pane, err = M.resolve_target()
  if not pane then
    notify(err or "No terminal pane found in this tab")
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
    string.format("Sent %s to terminal %s", label, pane.pane_id),
    vim.log.levels.INFO
  )
  return true
end

return M
