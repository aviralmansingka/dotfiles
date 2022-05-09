lua << EOF
require("null-ls").setup({
    sources = {
        require("null-ls").builtins.formatting.rustfmt,
        require("null-ls").builtins.formatting.gofmt,
        require("null-ls").builtins.formatting.goimports,
        require("null-ls").builtins.formatting.stylua,
        require("null-ls").builtins.formatting.prettier,
        require("null-ls").builtins.diagnostics.eslint,
    },

    -- you can reuse a shared lspconfig on_attach callback here
    on_attach = function(client)
        if client.resolved_capabilities.document_formatting then
            vim.cmd([[
            augroup LspFormatting
                autocmd! * <buffer>
                autocmd BufWritePre <buffer> lua vim.lsp.buf.formatting_sync()
            augroup END
            ]])
        end
    end
})
EOF
