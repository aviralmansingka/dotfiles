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
		-- "bash-language-server",
		-- "terraform-ls",
		"dockerfile-language-server",
		-- "html-lsp",
		"jdtls",
		"java-debug-adapter",
		"java-test",
		"json-lsp",
		-- "jsonnet-language-server",
		-- "pyright",
		-- "rust-analyzer",
		"yamllint",
		"yaml-language-server",
		"markdownlint",
		-- "eslint_d",
		-- "tflint",
		-- "shellcheck",
		-- "staticcheck",
		-- "prettierd",
		-- "golines",
		"stylua",
		"lua-language-server",
		"luacheck",
		-- "shfmt",
		"gopls",
		"goimports",
		"delve",
		-- "debugpy",
	},
	auto_update = false,
	run_on_start = true,
	start_delay = 3000, -- 3 second delay
})
