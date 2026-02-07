-- Neovide-specific configuration
if not vim.g.neovide then
  return {}
end

-- Font configuration (matches Ghostty)
vim.o.guifont = "JetBrainsMono Nerd Font Mono:h16"

-- Enable macOS Cmd key support
vim.g.neovide_input_use_logo = true
vim.g.neovide_input_macos_option_key_is_meta = "only_left"

-- Disable system bell/beep
vim.o.errorbells = false
vim.o.visualbell = true
vim.o.belloff = "all"

-- System clipboard keymaps (Cmd+C/Cmd+V)
vim.keymap.set({ "n", "v" }, "<D-c>", '"+y', { noremap = true, desc = "Copy" })
vim.keymap.set({ "n", "v", "i", "c" }, "<D-v>", function()
  vim.api.nvim_paste(vim.fn.getreg("+"), true, -1)
end, { noremap = true, desc = "Paste" })
vim.keymap.set("t", "<D-v>", function()
  vim.api.nvim_paste(vim.fn.getreg("+"), true, -1)
end, { noremap = true, desc = "Paste in terminal" })

-- Cmd+A select all
vim.keymap.set({ "n", "v", "i" }, "<D-a>", "<Esc>ggVG", { noremap = true, desc = "Select all" })

-- Cmd+S save
vim.keymap.set({ "n", "v", "i" }, "<D-s>", "<Cmd>w<CR>", { noremap = true, desc = "Save" })

-- Font size adjustment with Cmd+/Cmd-
vim.g.neovide_scale_factor = 1.0

vim.keymap.set({ "n", "v", "i" }, "<D-=>", function()
  vim.g.neovide_scale_factor = vim.g.neovide_scale_factor * 1.1
end, { noremap = true, desc = "Increase font size" })

vim.keymap.set({ "n", "v", "i" }, "<D-->", function()
  vim.g.neovide_scale_factor = vim.g.neovide_scale_factor / 1.1
end, { noremap = true, desc = "Decrease font size" })

vim.keymap.set({ "n", "v", "i" }, "<D-0>", function()
  vim.g.neovide_scale_factor = 1.0
end, { noremap = true, desc = "Reset font size" })

return {}
