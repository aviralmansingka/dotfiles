require("nvim-treesitter.configs").setup({
	highlight = {
		enable = true,
		additional_vim_regex_highlighting = false,
		disable = {},
	},
	indent = {
		enable = true,
		disable = { "yaml" },
	},
	matchup = {
		enable = true,
	},
	incremental_selection = {
		enable = true,
		keymaps = {
			init_selection = "gnn",
			node_incremental = "grn",
			scope_incremental = "grc",
			node_decremental = "grm",
		},
	},
	ensure_installed = {
		"bash",
		"dockerfile",
		"go",
		"hcl",
		"java",
		"json",
		"lua",
		"proto",
		"python",
		"vim",
		"yaml",
	},
})

vim.cmd([[
set foldmethod=expr
set foldexpr=nvim_treesitter#foldexpr()
]])
