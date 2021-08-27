" BASIC VIMRC SKELETON "
" Owner: Aviral Mansingka (github:aviralmansingka) "

" Automatic reloading of .vimrc on file change
autocmd! bufwritepost ~/.config/nvim/init.vim source %

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
Plug 'nanotech/jellybeans'
call plug#end()

" Activating colorscheme and syntax
color delek
