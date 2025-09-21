-- add any tools you want to have installed below
return {
  {
    "williamboman/mason.nvim",
    opts = {
      ensure_installed = {
        -- Lua
        "lua-language-server",
        "stylua",

        -- Python
        "basedpyright",
        "black",
        "ruff",

        -- Go
        "gopls",

        -- Rust
        "rust-analyzer",

        -- JSON/YAML
        "json-lsp",
        "yaml-language-server",

        -- Shell/Bash
        "bash-language-server",
        "shellcheck",
        "shfmt",
      },
    },
  },
}
