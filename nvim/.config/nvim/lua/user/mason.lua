require("mason").setup({
	ui = {
		border = "rounded",
		icons = {
			package_installed = "✓",
			package_pending = "➜",
			package_uninstalled = "✗",
		},
	},
})

require("mason-tool-installer").setup({
	ensure_installed = {
		"bash-language-server",
		"terraform-ls",
		"lua-language-server",
		"dockerfile-language-server",
		"html-lsp",
		"jdtls",
		"json-lsp",
		"jsonnet-language-server",
		"pyright",
		"rust-analyzer",
		"yaml-language-server",
		"gopls",
		"markdownlint",
		"eslint_d",
		"tflint",
		"yamllint",
		"shellcheck",
		"staticcheck",
		"prettierd",
		"gofumpt",
		"golines",
		"stylua",
		"luacheck",
		"shfmt",
		"delve",
		"debugpy",
	},
	auto_update = false,
	run_on_start = true,
	start_delay = 3000, -- 3 second delay
})
