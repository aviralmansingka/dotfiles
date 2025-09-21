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
    -- Force disable virtual text for this specific buffer
    vim.diagnostic.config({
      virtual_text = false,
      underline = true,
      severity_sort = true,
      float = {
        border = "rounded",
        source = "always",
      },
    }, bufnr)

    -- Hook into the diagnostics callback to intercept and modify
    local ns = vim.lsp.diagnostic.get_namespace(client.id)
    if ns then
      vim.diagnostic.config({ virtual_text = false }, ns)
    end
  end,
}