" BASIC VIMRC SKELETON "
" Owner: Aviral Mansingka (github:aviralmansingka) "

" Automatic reloading of .vimrc on file change
autocmd! bufwritepost ~/.config/nvim/init.vim source %

" changing leader to something more fun :-)
let mapleader="\<Space>"

" Normal backspace
set backspace=2

" ENTIRELY Personal Preference Mappings
" Easy normal mode
imap jk <Esc>

" Easy pane movement
noremap <C-j> <c-w>j
noremap <C-k> <c-w>k
noremap <C-h> <c-w>h
noremap <C-l> <c-w>l

" Relative Line numbering
set rnu
set number

" Use system clipboard in vim
set clipboard=unnamedplus

" Tabs vs. Spaces: The winner is spaces ;-)
set expandtab
" How wide is a tab in general
set tabstop=4
" How wide is key-press of <TAB>, <BS>
set softtabstop=4
" How wide is an indent
set shiftwidth=4
" Round up indent to nearest shiftwidth
set shiftround

" Start adding plugins
call plug#begin('~/.config/nvim/plugged')

" nice gray-background colorscheme
Plug 'mhartington/oceanic-next'
Plug 'sonph/onehalf', { 'rtp': 'vim' }

" better language highlighting
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" Native LSP
Plug 'neovim/nvim-lspconfig'

" file explorer
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'

" git integration
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-rhubarb'

" File Explorer
Plug 'kyazdani42/nvim-tree.lua'

" Icons
Plug 'kyazdani42/nvim-web-devicons' " for file icons
Plug 'yamatsum/nvim-nonicons'

" statusline tabline
Plug 'vim-airline/vim-airline'
Plug 'romgrk/barbar.nvim'

call plug#end()

" Enable filetype detection, indentation
filetype plugin indent on

" Move cursor to correct location on new line
set autoindent
set smartindent

" god awful swap files
set nobackup
set nowritebackup
set noswapfile

if exists('+termguicolors')
  let &t_8f = "\<Esc>[38;2;%lu;%lu;%lum"
  let &t_8b = "\<Esc>[48;2;%lu;%lu;%lum"
  set termguicolors
endif
set t_Co=256
set cursorline


" Activating colorscheme and syntax
colorscheme onehalfdark
let g:airline_theme='onehalfdark'
let g:airline#extensions#coc#enabled = 1

" Common extensions to use throughout
let g:coc_global_extensions = ['coc-json', 'coc-git', 'coc-yaml', 'coc-sql']

" Navigate files and grep
nnoremap <leader>ff <cmd>Telescope find_files<cr>
nnoremap <leader>fg <cmd>Telescope live_grep<cr>
nnoremap <leader>fb <cmd>Telescope buffers<cr>
nnoremap <leader>fh <cmd>Telescope help_tags<cr>

" treesitter.lua
lua <<EOF
require'nvim-treesitter.configs'.setup {
  highlight = {
    enable = true,
    additional_vim_regex_highlighting = false,
  },
  incremental_selection = {
    enable = true,
    keymaps = {
      init_selection = "gnn",
      node_incremental = "grn",
      scope_incremental = "grc",
      node_decremental = "grm",
    }
  },
  indent = {
    enable = true
  }
}
EOF
set foldmethod=expr
set foldexpr=nvim_treesitter#foldexpr()
echo nvim_treesitter#statusline(0)

" nvim-tree
let g:nvim_tree_side = 'left'
let g:nvim_tree_width = 40
let g:nvim_tree_ignore = [ '.git', 'node_modules', '.cache', '.out'] "empty by default
let g:nvim_tree_gitignore = 1
let g:nvim_tree_auto_open = 0 "0 by default, opens the tree when typing `vim $DIR` or `vim`
let g:nvim_tree_auto_close = 1 "0 by default, closes the tree when it's the last window
let g:nvim_tree_auto_ignore_ft = [] "empty by default, don't auto open tree on specific filetypes.
let g:nvim_tree_quit_on_open = 1 "0 by default, closes the tree when you open a file
let g:nvim_tree_follow = 1 "0 by default, this option allows the cursor to be updated when entering a buffer
let g:nvim_tree_indent_markers = 1 "0 by default, this option shows indent markers when folders are open
let g:nvim_tree_hide_dotfiles = 0 "0 by default, this option hides files and folders starting with a dot `.`
let g:nvim_tree_git_hl = 1 "0 by default, will enable file highlight for git attributes (can be used without the icons).
let g:nvim_tree_highlight_opened_files = 1 "0 by default, will enable folder and file icon highlight for opened files/directories.
let g:nvim_tree_root_folder_modifier = ':~' "This is the default. See :help filename-modifiers for more options
let g:nvim_tree_tab_open = 1 "0 by default, will open the tree when entering a new tab and the tree was previously open
let g:nvim_tree_auto_resize = 0 "1 by default, will resize the tree to its saved width when opening a file
let g:nvim_tree_disable_netrw = 0 "1 by default, disables netrw
let g:nvim_tree_hijack_netrw = 0 "1 by default, prevents netrw from automatically opening when opening directories (but lets you keep its other utilities)
let g:nvim_tree_add_trailing = 1 "0 by default, append a trailing slash to folder names
let g:nvim_tree_group_empty = 1 " 0 by default, compact folders that only contain a single folder into one node in the file tree
let g:nvim_tree_lsp_diagnostics = 1 "0 by default, will show lsp diagnostics in the signcolumn. See :help nvim_tree_lsp_diagnostics
let g:nvim_tree_disable_window_picker = 1 "0 by default, will disable the window picker.
let g:nvim_tree_hijack_cursor = 0 "1 by default, when moving cursor in the tree, will position the cursor at the start of the file on the current line
let g:nvim_tree_icon_padding = ' ' "one space by default, used for rendering the space between the icon and the filename. Use with caution, it could break rendering if you set an empty string depending on your font.
let g:nvim_tree_symlink_arrow = ' ➛ ' " defaults to ' ➛ '. used as a separator between symlinks' source and target.
let g:nvim_tree_update_cwd = 1 "0 by default, will update the tree cwd when changing nvim's directory (DirChanged event). Behaves strangely with autochdir set.
let g:nvim_tree_respect_buf_cwd = 1 "0 by default, will change cwd of nvim-tree to that of new buffer's when opening nvim-tree.
let g:nvim_tree_window_picker_exclude = {
    \   'filetype': [
    \     'packer',
    \     'qf'
    \   ],
    \   'buftype': [
    \     'terminal'
    \   ]
    \ }
" Dictionary of buffer option names mapped to a list of option values that
" indicates to the window picker that the buffer's window should not be
" selectable.
let g:nvim_tree_special_files = { 'README.md': 1, 'Makefile': 1, 'MAKEFILE': 1 } " List of filenames that gets highlighted with NvimTreeSpecialFile
let g:nvim_tree_show_icons = {
    \ 'git': 1,
    \ 'folders': 1,
    \ 'files': 1,
    \ 'folder_arrows': 1,
    \ }
"If 0, do not show the icons for one of 'git' 'folder' and 'files'
"1 by default, notice that if 'files' is 1, it will only display
"if nvim-web-devicons is installed and on your runtimepath.
"if folder is 1, you can also tell folder_arrows 1 to show small arrows next to the folder icons.
"but this will not work when you set indent_markers (because of UI conflict)

" default will show icon by default if no icon is provided

nnoremap <leader>n :NvimTreeToggle<CR>
" NvimTreeOpen, NvimTreeClose and NvimTreeFocus are also available if you need them
