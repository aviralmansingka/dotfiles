-- Go Language Server (gopls) Configuration
return {
  settings = {
    gopls = {
      -- Analysis settings
      analyses = {
        unusedparams = true,
        shadow = true,
        fieldalignment = true,
        nilness = true,
        unusedwrite = true,
        useany = true,
      },
      -- Code completion settings
      usePlaceholders = true,
      completeUnimported = true,
      staticcheck = true,
      -- Experimental features
      experimentalPostfixCompletions = true,
      -- Inlay hints for Go
      hints = {
        assignVariableTypes = true,
        compositeLiteralFields = true,
        compositeLiteralTypes = true,
        constantValues = true,
        functionTypeParameters = true,
        parameterNames = true,
        rangeVariableTypes = true,
      },
      -- Workspace settings
      directoryFilters = { "-.git", "-.vscode", "-.idea", "-.vscode-server", "-node_modules" },
      semanticTokens = true,
      -- Import organization
      gofumpt = true, -- Use gofumpt for formatting
    },
  },
}