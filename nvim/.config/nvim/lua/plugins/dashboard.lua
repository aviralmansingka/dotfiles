return {
  "folke/snacks.nvim",
  opts = {
    dashboard = {
      preset = {
        keys = {
          { icon = " ", key = "f", desc = "Find File", action = ":lua Snacks.dashboard.pick('files')" },
          { icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
          {
            icon = " ",
            key = "s",
            desc = "Restore Session",
            action = ":lua require('persistence').load({ last = true })",
          },
          {
            icon = " ",
            key = "w",
            desc = "Workspaces",
            action = function()
              require("plugins.herdr.workspaces").open()
            end,
          },
          { icon = "󰊢 ", key = "g", desc = "LazyGit", action = ":lua Snacks.lazygit()" },
          { icon = " ", key = "q", desc = "Quit", action = ":qa" },
        },
      },
    },
  },
}
