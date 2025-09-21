-- BasedPyright Language Server Configuration
return {
  settings = {
    basedpyright = {
      analysis = {
        autoImportCompletions = true,
        typeCheckingMode = "basic", -- "off", "basic", or "strict"
        autoSearchPaths = true,
        diagnosticMode = "openFilesOnly", -- "openFilesOnly" or "workspace"
        inlayHints = {
          variableTypes = true,
          functionReturnTypes = true,
        },
        useLibraryCodeForTypes = true,
        diagnosticSeverityOverrides = {
          -- Customize severity of different diagnostic rules
          -- Example: "reportUnusedVariable": "warning"
        },
      },
    },
  },
  -- Custom on_attach to disable virtual text for cleaner Python experience
  on_attach = function(client, bufnr)
    -- Get the proper diagnostic namespace for this LSP client
    local ns = vim.lsp.diagnostic.get_namespace(client.id)

    -- Configure diagnostics for this specific LSP client
    vim.diagnostic.config({
      virtual_text = false,
      underline = true,
      severity_sort = true,
      float = {
        border = "rounded",
        source = "always",
      },
    }, ns) -- Use the LSP client's namespace, not the buffer number
  end,
}

