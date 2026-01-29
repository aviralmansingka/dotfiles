-- add any tools you want to have installed below
return {
  "mason-org/mason.nvim",
  opts = {
    ensure_installed = {
      "copilot-language-server",
      "lua-language-server",
      "stylua",
      "ruff",
      "pyright",
    },
  },
}
