-- Bash Language Server Configuration
return {
  settings = {
    bashIde = {
      -- Enable/disable background analysis
      backgroundAnalysisMaxFiles = 500,
      -- Enable completion for commands
      enableSourceErrorDiagnostics = false,
      -- Include all workspace files in analysis
      includeAllWorkspaceSymbols = true,
    },
  },
  filetypes = { "sh", "bash", "zsh" },
}