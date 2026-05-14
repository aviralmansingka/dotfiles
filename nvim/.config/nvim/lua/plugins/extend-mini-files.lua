return {
  {
    "nvim-mini/mini.files",
    opts = {
      windows = {
        width_preview = 60,
      },
    },
    keys = {
      {
        "<leader>e",
        function()
          require("mini.files").open(vim.api.nvim_buf_get_name(0), true)
        end,
        desc = "Open mini.files (directory of current file)",
      },
    },
  },
}
