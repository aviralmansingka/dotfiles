vim.opt.termguicolors = true
vim.opt.number = true

-- OSC52 Clipboard Configuration
-- Supports both local and remote (SSH) development
-- Copy works over SSH via OSC52, paste uses local Neovim buffer to avoid timeouts
vim.o.clipboard = "unnamedplus"

local function paste()
  return {
    vim.split(vim.fn.getreg(""), "\n"),
    vim.fn.getregtype(""),
  }
end

if vim.env.SSH_TTY then
  -- SSH session: Use OSC52 for copy, local buffer for paste (no timeouts)
  vim.g.clipboard = {
    name = "OSC 52",
    copy = {
      ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
      ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
    },
    paste = {
      ["+"] = paste,
      ["*"] = paste,
    },
  }
end

-- Re-wrap pastes into :term buffers with bracketed-paste markers, so nested
-- terminal programs (tmux + vim inside :term) see a paste, not raw keystrokes
-- (\n = Ctrl-J = vim normal-mode `j`).
local default_paste = vim.paste
vim.paste = function(lines, phase)
  if vim.bo.buftype == "terminal" and vim.b.terminal_job_id then
    local content = table.concat(lines, "\n")
    local out
    if phase == -1 then
      out = "\27[200~" .. content .. "\27[201~"
    elseif phase == 1 then
      out = "\27[200~" .. content
    elseif phase == 3 then
      out = content .. "\27[201~"
    else
      out = content
    end
    vim.api.nvim_chan_send(vim.b.terminal_job_id, out)
    return true
  end
  return default_paste(lines, phase)
end

-- Stack jumplist configuration
vim.opt.jumpoptions = "stack" -- Use stack-based jumplist behavior

-- Configure LazyVim to use Snacks picker for LSP operations
vim.g.lazyvim_picker = "snacks"
vim.g.root_spec = { "cwd" }

-- Python: use basedpyright (stricter pyright fork) via lazyvim.plugins.extras.lang.python
vim.g.lazyvim_python_lsp = "basedpyright"
