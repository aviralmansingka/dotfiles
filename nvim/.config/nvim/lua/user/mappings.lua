vim.cmd([[
" changing leader to something more fun :-)
let mapleader="\<Space>"

" ENTIRELY Personal Preference Mappings
" Easy normal mode
imap jk <Esc>

" Easy pane movement
noremap <C-j> <c-w>j
noremap <C-k> <c-w>k
noremap <C-h> <c-w>h
noremap <C-l> <c-w>l

command Bd bp | sp | bn | bd
]])
