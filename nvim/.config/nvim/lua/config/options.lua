vim.opt.termguicolors = true
vim.g.clipboard = "osc52"

-- Stack jumplist configuration
vim.opt.jumpoptions = "stack" -- Use stack-based jumplist behavior

-- Neovide GUI configuration
if vim.g.neovide then
  -- Font configuration to match ghostty
  vim.opt.guifont = "JetBrainsMono Nerd Font:h16"

  -- Additional neovide settings
  vim.g.neovide_remember_window_size = true
  vim.g.neovide_cursor_animation_length = 0.05
  vim.g.neovide_cursor_trail_size = 0.3
end
