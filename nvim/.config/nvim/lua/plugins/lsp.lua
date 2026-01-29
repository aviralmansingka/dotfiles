return {
  -- Extend LazyVim's LSP configuration
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    -- Custom server configurations using LazyVim's approach
    opts.servers = opts.servers or {}

    -- Lua language server configuration
    opts.servers.lua_ls = {
      filetypes = { "lua" },
      settings = {
        Lua = {
          runtime = {
            version = "LuaJIT",
          },
          diagnostics = {
            globals = { "vim" },
          },
          workspace = {
            library = vim.api.nvim_get_runtime_file("", true),
            checkThirdParty = false,
          },
          codeLens = {
            enable = true,
          },
          completion = {
            callSnippet = "Replace",
          },
          doc = {
            privateName = { "^_" },
          },
          hint = {
            enable = true,
            setType = false,
            paramType = true,
            paramName = false,
            semicolon = false,
            arrayIndex = false,
          },
          telemetry = {
            enable = false,
          },
        },
      },
    }

    -- Copilot language server for Sidekick NES
    opts.servers.copilot = {}
    return opts
  end,
}
