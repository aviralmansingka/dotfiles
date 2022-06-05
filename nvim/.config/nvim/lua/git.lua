-- gitsigns
require("gitsigns").setup()
vim.cmd([[
set statusline+=%{get(b:,'gitsigns_status','')}

" lazygit
let g:lazygit_floating_window_winblend = 1 " transparency of floating window
let g:lazygit_floating_window_scaling_factor = 0.9 " scaling factor for floating window
let g:lazygit_floating_window_corner_chars = ['╭', '╮', '╰', '╯'] " customize lazygit popup window corner characters
let g:lazygit_floating_window_use_plenary = 1 " use plenary.nvim to manage floating window if available
let g:lazygit_use_neovim_remote = 0 " fallback to 0 if neovim-remote is not installed
]])
