-- add any tools you want to have installed below
return {
  "mason-org/mason.nvim",
  opts = {
    ensure_installed = {
      "lua-language-server",
      "stylua",
    },
  },
}
