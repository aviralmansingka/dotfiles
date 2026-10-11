return {
  {
    "folke/snacks.nvim",
    opts = {
      terminal = {
        win = {
          position = "float",
          width = 0.9,
          height = 0.9,
          border = "rounded",
          backdrop = false,
          keys = {
            q = "hide",
            ["<C-]>"] = "term_normal",
          },
        },
        singleton = true,
      },
    },
    keys = {
      {
        "<C-]>",
        function()
          vim.cmd("stopinsert")
        end,
        desc = "Exit terminal mode",
        mode = { "t" },
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
          require("helpers.lazygit").open()
        end,
        desc = "Open Lazy[G]it",
      },
    },
  },
}
