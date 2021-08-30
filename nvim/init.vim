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

let g:python3_host_prog = '/Users/amansingka/opt/miniconda3/bin/python'
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
Plug 'glepnir/lspsaga.nvim'

Plug 'mhinz/vim-startify'

" Completion
Plug 'hrsh7th/nvim-compe'
Plug 'hrsh7th/vim-vsnip'

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
Plug 'voldikss/vim-floaterm'

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
set background=dark
let g:airline_theme='onehalfdark'

" Navigate files and grep
nnoremap <leader>ff <cmd>Telescope find_files<cr>
nnoremap <leader>fg <cmd>Telescope live_grep<cr>
nnoremap <leader>fb <cmd>Telescope buffers<cr>
nnoremap <leader>fh <cmd>Telescope help_tags<cr>

