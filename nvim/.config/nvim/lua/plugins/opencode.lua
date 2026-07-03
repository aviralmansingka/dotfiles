return {
  "NickvanDyke/opencode.nvim",
  dependencies = {
    { "folke/snacks.nvim", opts = { input = {}, picker = {}, terminal = {} } },
  },
  config = function()
    vim.g.opencode_opts = {
      command = vim.env.HOME .. "/.opencode/bin/opencode",
      provider = {
        enabled = "snacks",
        snacks = {
          auto_close = true,
          win = {
            position = "float",
            enter = true,
            width = 0.9,
            height = 0.9,
            border = vim.g.neovide and vim.g.neovide_fancy_borders and vim.g.neovide_fancy_borders.current or "rounded",
            backdrop = false,
            wo = {
              winbar = "",
              wrap = false,
            },
            bo = {
              filetype = "opencode_terminal",
            },
          },
        },
      },
    }
    vim.o.autoread = true
  end,
  keys = {
  },
}
