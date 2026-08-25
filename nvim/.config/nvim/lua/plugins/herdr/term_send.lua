-- Send the current buffer (or visual selection) to the floating Snacks terminal
-- (the same singleton float toggled by `<leader>ft`). If the terminal has not
-- been opened yet this session, create it, then paste the raw text into it.
--
-- Delivery uses the terminal buffer's pty job id (`terminal_job_id`) via
-- `vim.api.nvim_chan_send`, which is equivalent to physically pasting the bytes
-- into the terminal — no "From neovim buffer" header, no agent formatting. A
-- trailing newline is added so a single-line selection runs immediately; a
-- multi-line selection runs line by line, just like a real paste.
local agent_send = require("plugins.herdr.agent_send")

local M = {}

-- Guard against pasting a giant buffer into a terminal prompt.
M.max_bytes = agent_send.max_bytes

-- Resolve the project root the same way LazyVim's `<leader>ft` does so this
-- targets the very same terminal the user would toggle with that key.
local function term_cwd()
  if LazyVim and LazyVim.root then
    return LazyVim.root()
  end
  return vim.fn.getcwd()
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

---Get-or-create the floating Snacks terminal and return its pty job id.
---@return number|nil job_id
---@return string|nil error
function M.resolve_target()
  local Snacks = package.loaded["snacks"] and require("snacks") or _G.Snacks
  if not Snacks or not Snacks.terminal then
    return nil, "Snacks terminal not available"
  end
  -- `get` creates the terminal if it does not yet exist and returns it plus a
  -- `created` flag. `show` ensures the float is visible whether or not it was
  -- just created (it may already exist but be hidden).
  local terminal, created = Snacks.terminal.get(nil, { cwd = term_cwd() })
  if not terminal or not terminal.buf or not vim.api.nvim_buf_is_valid(terminal.buf) then
    return nil, "Could not open floating terminal"
  end
  if not created then
    pcall(function()
      terminal:show()
    end)
  end
  if terminal.focus then
    pcall(function()
      terminal:focus()
    end)
  end
  local job = vim.b[terminal.buf].terminal_job_id
  if not job then
    return nil, "Floating terminal has no pty job"
  end
  return job, nil
end

---@param opts? { visual?: boolean, bufnr?: integer }
---@return boolean sent
function M.send(opts)
  opts = opts or {}
  local bufnr = opts.bufnr or vim.api.nvim_get_current_buf()
  local job, err = M.resolve_target()
  if not job then
    vim.notify(err or "Could not open floating terminal", vim.log.levels.WARN)
    return false
  end
  local text, label = M.build_payload(bufnr, opts.visual == true)
  -- Paste the raw bytes into the pty. A trailing newline submits a single-line
  -- selection so it runs immediately, mirroring `<leader>at` pressing Enter.
  if not text:find("\n$", 1, true) then
    text = text .. "\n"
  end
  vim.api.nvim_chan_send(job, text)
  vim.notify(string.format("Sent %s to floating terminal", label), vim.log.levels.INFO)
  return true
end

return M
