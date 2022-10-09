local fn = vim.fn

-- Automatically install packer
local install_path = fn.stdpath("data") .. "/site/pack/packer/start/packer.nvim"
if fn.empty(fn.glob(install_path)) > 0 then
	PACKER_BOOTSTRAP = fn.system({
		"git",
		"clone",
		"--depth",
		"1",
		"https://github.com/wbthomason/packer.nvim",
		install_path,
	})
	print("Installing packer close and reopen Neovim...")
	vim.cmd([[packadd packer.nvim]])
end

-- Autocommand that reloads neovim whenever you save the plugins.lua file
vim.cmd([[
  augroup packer_user_config
    autocmd!
    autocmd BufWritePost plugins.lua source <afile> | PackerSync
  augroup end
]])

-- Use a protected call so we don't error out on first use
local status_ok, packer = pcall(require, "packer")
if not status_ok then
	return
end

-- Have packer use a popup window
packer.init({
	display = {
		open_fn = function()
			return require("packer.util").float({ border = "rounded" })
		end,
	},
})
return packer.startup(function(use)
	use({ "wbthomason/packer.nvim" })
	use({ "williamboman/mason.nvim" })
	use({ "WhoIsSethDaniel/mason-tool-installer.nvim" })
	use({ "williamboman/mason-lspconfig.nvim" })
	use({ "nvim-lua/lsp-status.nvim" })
	use({ "henriquehbr/nvim-startup.lua" })

	use("nvim-lua/popup.nvim")
	use("nvim-lua/plenary.nvim")

	use({ "nvim-orgmode/orgmode" })
	use({
		"akinsho/org-bullets.nvim",
		config = function()
			require("org-bullets").setup()
		end,
	})

	use("ellisonleao/gruvbox.nvim")

	use("kyazdani42/nvim-web-devicons")
	use("yamatsum/nvim-nonicons")

	use({ "akinsho/bufferline.nvim", tag = "v2.*", requires = "kyazdani42/nvim-web-devicons" })
	use("nvim-lualine/lualine.nvim")

	use("kyazdani42/nvim-tree.lua")

	use("nvim-telescope/telescope.nvim")
	use("jvgrootveld/telescope-zoxide")

	use("airblade/vim-rooter")

	use("mhinz/vim-startify")

	use("nvim-treesitter/nvim-treesitter")
	use("nvim-treesitter/nvim-treesitter-refactor")
	use("nvim-treesitter/nvim-treesitter-textobjects")
	use("nvim-treesitter/playground")
	use("andymass/vim-matchup")
	use("windwp/nvim-ts-autotag")
	use("windwp/nvim-autopairs")

	use("tpope/vim-fugitive")
	use("kdheepak/lazygit.nvim")
	use("lewis6991/gitsigns.nvim")
	use("tpope/vim-rhubarb")

	use("numToStr/Comment.nvim")

	use("L3MON4D3/LuaSnip")
	use("rafamadriz/friendly-snippets")

	use("hrsh7th/nvim-cmp")
	use("hrsh7th/cmp-buffer")
	use("hrsh7th/cmp-path")
	use("hrsh7th/cmp-nvim-lua")
	use("hrsh7th/cmp-nvim-lsp")
	use("saadparwaiz1/cmp_luasnip")
	use("onsails/lspkind.nvim")

	use("ray-x/lsp_signature.nvim")
	use("neovim/nvim-lspconfig")
	use("jose-elias-alvarez/null-ls.nvim")
	use("jose-elias-alvarez/nvim-lsp-ts-utils")
	use("gbrlsnchs/telescope-lsp-handlers.nvim")

	use("voldikss/vim-floaterm")
	use("akinsho/toggleterm.nvim")

	use({ "rcarriga/vim-ultest", requires = { "vim-test/vim-test" }, run = ":UpdateRemotePlugins" })

	use("mfussenegger/nvim-dap")
	use("leoluz/nvim-dap-go")
	use("theHamsta/nvim-dap-virtual-text")
	use("rcarriga/nvim-dap-ui")

	use("aserowy/tmux.nvim")
	use("fladson/vim-kitty")

	-- Automatically set up your configuration after cloning packer.nvim
	-- Put this at the end after all plugins
	if PACKER_BOOTSTRAP then
		require("packer").sync()
	end
end)
