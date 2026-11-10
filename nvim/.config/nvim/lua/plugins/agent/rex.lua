-- Rex adapter for the agent send path.
--
-- Target contract:
--   * this block:  $REX_BLOCK, inside $REX_SESSION
--   * candidates:  `rex block ls -s <session> --json` -> blocks
--   * is an agent: `rex block call -s <session> -b <block> process` reports
--                  foreground.argv0 == "pi" (Rex has no agent-status field)
--   * delivery:    `rex send -- <text>` + `rex send-key ... enter`
--
-- Preference: a pi block in THIS window, else the first pi block in the
-- session. Sending stays inside the session, so it never types into another
-- repository's agent.
local M = {}

---Run one rex call and decode its JSON. Returns nil plus the error on failure.
---@param args string[]
---@param quiet? boolean
---@return table|nil decoded
---@return string|nil error
function M.run(args, quiet)
  local cmd = { "rex" }
  vim.list_extend(cmd, args)
  local result = vim.system(cmd, { text = true }):wait()
  if result.code ~= 0 then
    local err = (result.stderr or ""):gsub("%s+$", "")
    err = err ~= "" and err or ("rex " .. table.concat(args, " ") .. " failed")
    if not quiet then
      vim.notify("Agent send: " .. err, vim.log.levels.WARN)
    end
    return nil, err
  end
  local out = result.stdout or ""
  if out:match("^%s*$") then
    return {}
  end
  local ok, decoded = pcall(vim.json.decode, out)
  if not ok or type(decoded) ~= "table" then
    return nil, "invalid Rex JSON response"
  end
  return decoded
end

---@return string|nil
function M.session()
  local session = vim.env.REX_SESSION
  return session ~= "" and session or nil
end

---@return string|nil
function M.current_block()
  local block = vim.env.REX_BLOCK
  return block ~= "" and block or nil
end

---@return table[]
function M.blocks()
  local session = M.session()
  if not session then
    return {}
  end
  local listed = M.run({ "block", "ls", "-s", session, "--json" }, true)
  return (listed and listed.blocks) or {}
end

---True when pi owns the block's foreground process.
---@param block_id string
---@return boolean
function M.is_agent_block(block_id)
  local session = M.session()
  if not session then
    return false
  end
  local info = M.run({ "block", "call", "-s", session, "-b", block_id, "process" }, true)
  local foreground = info and info.foreground
  if type(foreground) ~= "table" then
    return false
  end
  return foreground.argv0 == "pi" or foreground.name == "pi"
end

---Resolve the agent block to send to.
---@return table|nil target { id, label, window, mux }
---@return string|nil error
function M.resolve()
  local current = M.current_block()
  if not M.session() or not current then
    return nil, "Not running inside a Rex block"
  end
  local blocks = M.blocks()
  local window
  for _, block in ipairs(blocks) do
    if block.block_id == current then
      window = block.window_id
      break
    end
  end
  local fallback
  for _, block in ipairs(blocks) do
    if block.block_id ~= current and M.is_agent_block(block.block_id) then
      local target = { id = block.block_id, label = "pi", window = block.window_id, mux = "rex" }
      if window and block.window_id == window then
        return target, nil
      end
      fallback = fallback or target
    end
  end
  if fallback then
    return fallback, nil
  end
  return nil, "No pi block found in this Rex session"
end

---Bracketed paste keeps a multi-line payload from submitting line by line.
---@param text string
---@return string
function M.paste(text)
  return "\27[200~" .. (text:gsub("\27%[201~", "")) .. "\27[201~"
end

---Type the text into the target block, then submit it.
---@param target table
---@param text string
---@return boolean sent
function M.deliver(target, text)
  local session = M.session()
  if not session or type(target) ~= "table" or type(target.id) ~= "string" then
    return false
  end
  if M.run({ "send", "-s", session, "-b", target.id, "--", M.paste(text) }, true) == nil then
    return false
  end
  return M.run({ "send-key", "-s", session, "-b", target.id, "enter" }, true) ~= nil
end

return M
