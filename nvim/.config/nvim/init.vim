" BASIC VIMRC SKELETON
" Owner: Aviral Mansingka (github:aviralmansingka)


source ~/.config/nvim/options.vim
source ~/.config/nvim/mappings.vim
source ~/.config/nvim/plugin_options.vim

" Start adding plugins
call plug#begin('~/.config/nvim/plugged')

Plug 'christoomey/vim-tmux-navigator'

" General plugin used by everyone
Plug 'nvim-lua/plenary.nvim'

" appearences and themes
Plug 'morhetz/gruvbox'
Plug 'mhartington/oceanic-next'
Plug 'sonph/onehalf', { 'rtp': 'vim' }

" icons
Plug 'kyazdani42/nvim-web-devicons'
Plug 'yamatsum/nvim-nonicons'

" statusline tabline
Plug 'vim-airline/vim-airline'

" after/plugin/nvim-tree.rc.vim
Plug 'kyazdani42/nvim-tree.lua'

" after/plugin/telescope.rc.vim
Plug 'nvim-telescope/telescope.nvim'

" after/plugin/vim-rooter.rc.vim
Plug 'airblade/vim-rooter'

" after/plugin/startify.rc.vim
Plug 'mhinz/vim-startify'

" after/plugin/nvim-notify.rc.vim
Plug 'rcarriga/nvim-notify'

" after/plugin/git.rc.vim
Plug 'tpope/vim-fugitive'
Plug 'kdheepak/lazygit.nvim'
Plug 'lewis6991/gitsigns.nvim'
Plug 'tpope/vim-rhubarb'

" after/plugin/treesitter.rc.vim
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" after/plugin/nvim-lspconfig.rc.vim
Plug 'neovim/nvim-lspconfig'
Plug 'jose-elias-alvarez/null-ls.nvim'
Plug 'gbrlsnchs/telescope-lsp-handlers.nvim'

Plug 'fladson/vim-kitty'

" after/plugin/test.tc.vim
Plug 'vim-test/vim-test'
Plug 'rcarriga/vim-ultest', { 'do': ':UpdateRemotePlugins' }

" after/plugin/nvim-dap.rc.vim
Plug 'mfussenegger/nvim-dap'
Plug 'leoluz/nvim-dap-go'
Plug 'theHamsta/nvim-dap-virtual-text'
Plug 'rcarriga/nvim-dap-ui'
" TODO: Plug 'nvim-telescope/telescope-dap.nvim'

" after/plugin/vim-floaterm
Plug 'voldikss/vim-floaterm'

" after/plugin/compe.rc.vim
Plug 'hrsh7th/nvim-compe'
Plug 'hrsh7th/vim-vsnip'

call plug#end()
