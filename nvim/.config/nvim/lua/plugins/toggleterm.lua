return {
  {
    "folke/snacks.nvim",
    opts = {
      terminal = {
        win = {
          position = "float",
          width = 0.9,
          height = 0.9,
          border = vim.g.neovide and vim.g.neovide_fancy_borders and vim.g.neovide_fancy_borders.current or "rounded",
          backdrop = 60,
          keys = {
            q = "hide",
            ["<C-\\>"] = "hide",
            ["<C-]>"] = "term_normal",
          },
        },
        singleton = true,
      },
    },
    keys = {
      {
        "<C-\\>",
        function()
          Snacks.terminal.toggle()
        end,
        desc = "Toggle [T]erminal",
        mode = { "n", "t" },
      },
      {
        "gk",
        function()
          Snacks.terminal.toggle("k9s", { cwd = vim.fn.getcwd() })
        end,
        desc = "Toggle [K]9s",
      },
      {
        "gG",
        function()
          Snacks.lazygit()
        end,
        desc = "Open Lazy[G]it",
      },
    },
  },
}
