-- Send the current buffer (or visual selection) to the agent that runs beside
-- this Neovim, whichever multiplexer carries it.
--
-- The mux seam is `plugins.agent.mux`: Rex when `$REX_SESSION`/`$REX_BLOCK` are
-- set, Herdr when `$HERDR_PANE_ID` is, and no adapter otherwise. The adapters
-- resolve a target and deliver text; this module owns only the payload: the
-- header, the 64 KiB cap, and the Markdown quote for an instructed selection.
--
-- With no agent beside this Neovim, the caller's fallback runs (the Sidekick
-- "Send This" stack), so `<leader>at` still does something useful.
local mux = require("plugins.agent.mux")
local herdr = require("plugins.agent.herdr")

local M = {}

-- Back-compat: the Herdr helpers were this module's public surface before the
-- mux seam existed, and the headless specs still assert them here.
M.agent_statuses = herdr.agent_statuses
M.current_pane_id = herdr.current_pane_id
M.is_agent_pane = herdr.is_agent_pane
M.find_agent_pane = herdr.find_agent_pane
M.resolve_target = herdr.resolve

-- Guard against pasting a giant buffer into an agent prompt.
M.max_bytes = 64 * 1024

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.WARN)
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

---@param instruction string
---@param selection string
---@return string
function M.format_prompt(instruction, selection)
  return instruction .. "\n\n> " .. selection:gsub("\n", "\n> ")
end

---@param bufnr integer
---@return string text
---@return string label
function M.selection_text(bufnr)
  local first, last = M.visual_range(bufnr)
  local lines = vim.api.nvim_buf_get_lines(bufnr, first - 1, last, false)
  local text = table.concat(lines, "\n")
  if #text > M.max_bytes then
    text = text:sub(1, M.max_bytes)
  end
  local name = vim.api.nvim_buf_get_name(bufnr)
  local label = name ~= "" and vim.fn.fnamemodify(name, ":~:.") or "[No Name]"
  return text, label
end

function M.exit_visual_mode()
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    vim.cmd("normal! " .. mode)
  end
end

---@param opts? { bufnr?: integer, fallback?: fun(payload?:string, label?:string):boolean }
function M.prompt_selection(opts)
  opts = opts or {}
  local bufnr = opts.bufnr or vim.api.nvim_get_current_buf()
  local selection, label = M.selection_text(bufnr)
  vim.ui.input({ prompt = "Agent instruction: " }, function(instruction)
    if instruction == nil then
      return
    end
    M.exit_visual_mode()
    M.send({
      bufnr = bufnr,
      payload = M.format_prompt(instruction, selection),
      label = label,
      fallback = opts.fallback,
    })
  end)
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

---@param opts? { visual?: boolean, bufnr?: integer, payload?: string, label?: string, fallback?: fun(payload?:string, label?:string):boolean }
---@return boolean sent
function M.send(opts)
  opts = opts or {}
  local bufnr = opts.bufnr or vim.api.nvim_get_current_buf()
  local backend = mux.backend()
  local target, err = nil, nil
  if backend then
    target, err = backend.resolve()
  else
    err = "Not running inside a multiplexer"
  end
  if not target then
    -- When no agent sits beside this pane, hand off to the caller's fallback
    -- (e.g. the original sidekick "Send This" stack) instead of warning.
    if opts.fallback then
      return opts.fallback(opts.payload, opts.label) == true
    end
    notify(err or "No agent pane found in this tab")
    return false
  end
  local text, label = opts.payload, opts.label
  if not text then
    text, label = M.build_payload(bufnr, opts.visual == true)
  end
  label = label or "selection"
  if not backend.deliver(target, text) then
    return false
  end
  notify(
    string.format("Sent %s to %s (%s)", label, target.label or target.agent or "agent", target.id or target.pane_id or "?"),
    vim.log.levels.INFO
  )
  return true
end

return M
