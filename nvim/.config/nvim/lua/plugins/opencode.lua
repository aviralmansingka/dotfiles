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
    -- Toggle opencode UI and focus terminal input
    {
      "gO",
      function()
        require("opencode").toggle()
      end,
      desc = "Toggle opencode and focus terminal",
      mode = { "n", "x" },
    },
    -- Toggle opencode visibility (minimize/maximize)
    {
      "<C-;>",
      function()
        require("opencode").toggle()
      end,
      desc = "Toggle opencode visibility",
      mode = { "n", "x", "t" },
    },
    -- Send selection to opencode ask dialog
    {
      "<leader>as",
      function()
        require("opencode").ask("@this: ", { submit = false })
      end,
      desc = "Send selection to opencode",
      mode = "v",
    },
    -- Open ask dialog
    {
      "<leader>aa",
      function()
        require("opencode").ask("", { submit = false })
      end,
      desc = "Open opencode ask dialog",
      mode = { "n", "x" },
    },
    -- Select available actions/prompts
    {
      "<leader>ad",
      function()
        require("opencode").select()
      end,
      desc = "Select opencode action",
      mode = { "n", "x" },
    },
  },
}
