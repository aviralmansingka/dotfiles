-- nvim/.config/nvim/lua/plugins/sidekick/ask/state.lua
-- In-memory anchor table. Keyed by bufnr; anchor_id is monotonic.
local M = {}

M.state = {}
M.by_extmark = {}
M.next_anchor_id = 1

---@class AskEntry
---@field kind 'line'|'range'
---@field mode 'ask'|'edit'
---@field extmark_id integer  primary anchor (start of the highlighted scope for edit mode)
---@field range_extmarks integer[]
---@field question string
---@field answer string?
---@field added string[]?  edit-mode replacement lines (nil while pending, {} for NOOP)
---@field err string?
---@field status 'pending'|'done'|'error'
---@field started_at integer
---@field duration_ms integer?
---@field tokens { input: integer, output: integer }?
---@field sysobj table?
---@field spinner_frame integer

---@param bufnr integer
---@param entry AskEntry
---@return integer anchor_id
function M.add(bufnr, entry)
  local id = M.next_anchor_id
  M.next_anchor_id = id + 1
  M.state[bufnr] = M.state[bufnr] or {}
  M.state[bufnr][id] = entry
  M.by_extmark[bufnr] = M.by_extmark[bufnr] or {}
  M.by_extmark[bufnr][entry.extmark_id] = id
  return id
end

---@param bufnr integer
---@return table<integer, AskEntry>
function M.entries(bufnr)
  return M.state[bufnr] or {}
end

---@param bufnr integer
---@param anchor_id integer
function M.remove(bufnr, anchor_id)
  local buf = M.state[bufnr]
  if not buf then return end
  local entry = buf[anchor_id]
  if entry and M.by_extmark[bufnr] then
    M.by_extmark[bufnr][entry.extmark_id] = nil
  end
  buf[anchor_id] = nil
  if next(buf) == nil then
    M.state[bufnr] = nil
    M.by_extmark[bufnr] = nil
  end
end

---@param bufnr integer
---@param line integer
---@param ns integer
---@return integer? anchor_id, AskEntry? entry
function M.find_at(bufnr, line, ns)
  local buf = M.state[bufnr]
  if not buf then return nil, nil end
  for id, entry in pairs(buf) do
    local pos = vim.api.nvim_buf_get_extmark_by_id(bufnr, ns, entry.extmark_id, {})
    if not pos or not pos[1] then
      M.remove(bufnr, id)
    else
      local start_line = pos[1]
      local end_line = start_line
      if entry.kind == 'range' and entry.range_extmarks and #entry.range_extmarks > 0 then
        local last = entry.range_extmarks[#entry.range_extmarks]
        local lpos = vim.api.nvim_buf_get_extmark_by_id(bufnr, ns, last, {})
        if lpos and lpos[1] then end_line = lpos[1] end
      end
      if line >= start_line and line <= end_line then
        return id, entry
      end
    end
  end
  return nil, nil
end

---@param bufnr integer
function M.cleanup_buffer(bufnr)
  local buf = M.state[bufnr]
  if not buf then return end
  for _, entry in pairs(buf) do
    if entry.sysobj then
      pcall(function() entry.sysobj:kill('sigterm') end)
    end
  end
  M.state[bufnr] = nil
  M.by_extmark[bufnr] = nil
end

function M.cleanup_all()
  for bufnr in pairs(M.state) do
    M.cleanup_buffer(bufnr)
  end
end

return M
