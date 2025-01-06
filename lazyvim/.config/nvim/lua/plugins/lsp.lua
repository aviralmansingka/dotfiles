return {
  -- add lua_ls to lspconfig
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        lua_ls = {},
      },
    },
  },
  -- add pyright to lspconfig
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        pyright = {},
      },
    },
  },
}
