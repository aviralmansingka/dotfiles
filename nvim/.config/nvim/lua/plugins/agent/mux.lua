-- Which multiplexer this Neovim runs inside, and the adapter that knows its CLI.
--
-- Rex sets $REX_SESSION and $REX_BLOCK on every process in a block, so a nested
-- Herdr pane inside a Rex block still resolves to Rex: the innermost mux owns
-- the blocks. Nothing here talks to a mux; the adapters do.
local M = {}

---@return "rex"|"herdr"|nil
function M.kind()
  local rex_session = vim.env.REX_SESSION
  local rex_block = vim.env.REX_BLOCK
  if rex_session and rex_session ~= "" and rex_block and rex_block ~= "" then
    return "rex"
  end
  if vim.env.HERDR_PANE_ID and vim.env.HERDR_PANE_ID ~= "" then
    return "herdr"
  end
  return nil
end

---@return table|nil adapter
function M.backend()
  local kind = M.kind()
  if kind == "rex" then
    return require("plugins.agent.rex")
  end
  if kind == "herdr" then
    return require("plugins.agent.herdr")
  end
  return nil
end

return M
