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
          local current_file = vim.fn.expand("%:p")
          local git_root = vim.fn.system("git -C " .. vim.fn.shellescape(vim.fn.fnamemodify(current_file, ":h")) .. " rev-parse --show-toplevel 2>/dev/null"):gsub("\n", "")
          if vim.v.shell_error == 0 and git_root ~= "" then
            Snacks.lazygit({ cwd = git_root })
          else
            Snacks.lazygit()
          end
        end,
        desc = "Open Lazy[G]it",
      },
    },
  },
}
