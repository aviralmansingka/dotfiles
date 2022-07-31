vim.cmd([[
" BASIC VIMRC SKELETON
" Owner: Aviral Mansingka (github:aviralmansingka)

" Start adding plugins
call plug#begin('~/.config/nvim/plugged')

Plug 'declancm/maximize.nvim'

" General plugin used by everyone
Plug 'nvim-lua/popup.nvim'
Plug 'nvim-lua/plenary.nvim'

" appearences and themes
Plug 'ellisonleao/gruvbox.nvim'

" icons
Plug 'kyazdani42/nvim-web-devicons'
Plug 'yamatsum/nvim-nonicons'

" statusline tabline
Plug 'akinsho/bufferline.nvim', { 'tag': 'v2.*' }
Plug 'nvim-lualine/lualine.nvim'

" after/plugin/nvim-tree.rc.vim
Plug 'kyazdani42/nvim-tree.lua'

" after/plugin/telescope.rc.vim
Plug 'nvim-telescope/telescope.nvim'
Plug 'jvgrootveld/telescope-zoxide'

" after/plugin/vim-rooter.rc.vim
Plug 'airblade/vim-rooter'

" after/plugin/startify.rc.vim
Plug 'mhinz/vim-startify'

" after/plugin/treesitter.rc.vim
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
Plug 'nvim-treesitter/nvim-treesitter-refactor'
Plug 'nvim-treesitter/nvim-treesitter-textobjects'
Plug 'nvim-treesitter/playground'
Plug 'andymass/vim-matchup'
Plug 'windwp/nvim-ts-autotag'
Plug 'windwp/nvim-autopairs'

" after/plugin/git.rc.vim
Plug 'tpope/vim-fugitive'
Plug 'kdheepak/lazygit.nvim'
Plug 'lewis6991/gitsigns.nvim'
Plug 'tpope/vim-rhubarb'

" comments
Plug 'numToStr/Comment.nvim'

" after/plugin/snippets.rc.vim
Plug 'L3MON4D3/LuaSnip'
Plug 'rafamadriz/friendly-snippets'

" after/plugin/nvim-cmp.rc.vim
Plug 'hrsh7th/nvim-cmp'
Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/cmp-nvim-lua'
Plug 'hrsh7th/cmp-nvim-lsp'
Plug 'saadparwaiz1/cmp_luasnip'
Plug 'onsails/lspkind.nvim'

" after/plugin/nvim-lspconfig.rc.vim
Plug 'ray-x/lsp_signature.nvim'
Plug 'neovim/nvim-lspconfig'
Plug 'jose-elias-alvarez/null-ls.nvim'
Plug 'jose-elias-alvarez/nvim-lsp-ts-utils'
Plug 'gbrlsnchs/telescope-lsp-handlers.nvim'

" after/plugin/vim-floaterm
Plug 'voldikss/vim-floaterm'
Plug 'akinsho/toggleterm.nvim'

" after/plugin/test.tc.vim
Plug 'vim-test/vim-test'
Plug 'rcarriga/vim-ultest', { 'do': ':UpdateRemotePlugins' }

" after/plugin/nvim-dap.rc.vim
Plug 'mfussenegger/nvim-dap'
Plug 'leoluz/nvim-dap-go'
Plug 'theHamsta/nvim-dap-virtual-text'
Plug 'rcarriga/nvim-dap-ui'
" TODO: Plug 'nvim-telescope/telescope-dap.nvim'

Plug 'aserowy/tmux.nvim'
Plug 'fladson/vim-kitty'

call plug#end()
]])
