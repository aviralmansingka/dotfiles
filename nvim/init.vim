" BASIC VIMRC SKELETON "
" Owner: Aviral Mansingka (github:aviralmansingka) "
" Automatic reloading of .vimrc on file change
autocmd! bufwritepost ~/.config/nvim/init.vim source %


let g:python3_host_prog = $HOME . '/opt/miniconda3/bin/python'

source ~/.config/nvim/options.vim
source ~/.config/nvim/mappings.vim
source ~/.config/nvim/plugin_options.vim

" Start adding plugins
call plug#begin('~/.config/nvim/plugged')

" appearences and themes
Plug 'mhartington/oceanic-next'
Plug 'sonph/onehalf', { 'rtp': 'vim' }
Plug 'kyazdani42/nvim-web-devicons'
Plug 'yamatsum/nvim-nonicons'

" statusline tabline
Plug 'vim-airline/vim-airline'
Plug 'romgrk/barbar.nvim'
"
" file explorer
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'kyazdani42/nvim-tree.lua'

" start screen
Plug 'mhinz/vim-startify'

" git integration
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-rhubarb'
Plug 'kdheepak/lazygit.nvim'
Plug 'lewis6991/gitsigns.nvim'

" better language highlighting
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" native LSP
Plug 'neovim/nvim-lspconfig'
Plug 'glepnir/lspsaga.nvim'
Plug 'kabouzeid/nvim-lspinstall'
Plug 'voldikss/vim-floaterm'

" completion
Plug 'hrsh7th/nvim-compe'
Plug 'hrsh7th/vim-vsnip'

call plug#end()

lua << EOF
require('gitsigns').setup()
EOF
set statusline+=%{get(b:,'gitsigns_status','')}
