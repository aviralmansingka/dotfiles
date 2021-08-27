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
noremap <s-j> <c-w>j
noremap <s-k> <c-w>k
noremap <s-h> <c-w>h
noremap <s-l> <c-w>l

" Relative Line numbering
set rnu
set number

" Enable syntax highlighting
syntax on

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

" Enable filetype detection, indentation
filetype plugin indent on

" Move cursor to correct location on new line
set autoindent
set smartindent

" god awful swap files
set nobackup
set nowritebackup
set noswapfile

" Start adding plugins
call plug#begin('~/.config/nvim/plugged')

" nice gray-background colorscheme
Plug 'nanotech/jellybeans.vim'

" setup completion servers
Plug 'neoclide/coc.nvim', {'branch': 'release'}

" better language highlighting
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" file explorer
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'

call plug#end()

" Activating colorscheme and syntax
color jellybeans

" Common extensions to use throughout
let g:coc_global_extensions = ['coc-json', 'coc-git', 'coc-yaml', 'coc-sql']

" Navigate files and grep
nnoremap <leader>ff <cmd>Telescope find_files<cr>
nnoremap <leader>fg <cmd>Telescope live_grep<cr>
nnoremap <leader>fb <cmd>Telescope buffers<cr>
nnoremap <leader>fh <cmd>Telescope help_tags<cr>
