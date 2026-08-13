return {
  "folke/snacks.nvim",
  init = function()
    require("helpers.workspace").setup()
    require("plugins.herdr.workspaces").setup()
  end,
  keys = {
    {
      "<leader>fw",
      function()
        require("plugins.herdr.workspaces").open()
      end,
      desc = "Herdr Workspaces",
    },
  },
}
