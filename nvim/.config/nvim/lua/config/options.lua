vim.opt.termguicolors = true

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

-- Stack jumplist configuration
vim.opt.jumpoptions = "stack" -- Use stack-based jumplist behavior

-- Configure LazyVim to use Snacks picker for LSP operations
vim.g.lazyvim_picker = "snacks"
