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

" nice gray-background colorscheme
Plug 'mhartington/oceanic-next'
Plug 'sonph/onehalf', { 'rtp': 'vim' }

" better language highlighting
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" Native LSP
Plug 'neovim/nvim-lspconfig'
Plug 'glepnir/lspsaga.nvim'
Plug 'mfussenegger/nvim-jdtls'

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
