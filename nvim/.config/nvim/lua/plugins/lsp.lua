-- Custom LSP server configurations
-- LazyVim handles core LSP setup, we just add custom server configs
return {
  "neovim/nvim-lspconfig",
  opts = {
    servers = {
      -- Load detailed custom configurations that exceed LazyVim extras
      basedpyright = require("plugins.lsp.basedpyright"),
      gopls = require("plugins.lsp.gopls"),
      bashls = require("plugins.lsp.bashls"),
      jsonls = require("plugins.lsp.jsonls"),
      lua_ls = require("plugins.lsp.lua_ls"),
      yamlls = require("plugins.lsp.yamlls"),
      -- Disable pyright since we use basedpyright
      pyright = { enabled = false },
    },
  },
}

