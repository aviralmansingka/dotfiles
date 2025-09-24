vim.opt.termguicolors = true

-- Conditional clipboard configuration
if vim.g.neovide then
  -- Disable OSC52 in Neovide, use system clipboard instead
  vim.g.clipboard = "unnamedplus"
  vim.keymap.set({ "n", "x" }, "<D-c>", '"+y', { desc = "Copy system clipboard" })
  vim.keymap.set({ "n", "x" }, "<D-v>", '"+p', { desc = "Paste system clipboard" })
else
  -- Use OSC52 for terminal environments (SSH, etc.)
  vim.g.clipboard = "osc52"
end

-- Stack jumplist configuration
vim.opt.jumpoptions = "stack" -- Use stack-based jumplist behavior

-- Disable scrolloff to prevent cursor jumping when scrolling
vim.opt.scrolloff = 0

-- Neovide GUI configuration
if vim.g.neovide then
  -- Font configuration to match ghostty
  vim.opt.guifont = "JetBrainsMono Nerd Font:h16"

  -- Remove window header/title bar
  vim.g.neovide_fullscreen = false
  vim.g.neovide_remember_window_size = true
  vim.g.neovide_title_hidden = true -- This removes the title bar
  vim.g.neovide_detach_on_quit = "always_detach"
  vim.g.neovide_floating_shadow = false
  vim.g.neovide_floating_corner_radius = 0.5
  vim.g.neovide_show_border = true

  -- TODO(human): Add blur and transparency settings here
  -- Customize these values based on your visual preferences:
  vim.g.neovide_window_blur = true
  -- vim.g.neovide_floating_blur_amount_x = 2.0
  -- vim.g.neovide_floating_blur_amount_y = 2.0
  vim.g.neovide_opacity = 1.0
  vim.g.neovide_background_color = "#282828"
end
