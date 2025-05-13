return {
  "folke/persistence.nvim",
  event = "VeryLazy",
  opts = {
    -- Persistence options
    dir = vim.fn.stdpath("state") .. "/sessions/", -- directory where session files are saved
    options = { "buffers", "curdir", "tabpages", "winsize", "winpos", "folds", "globals" }, -- sessionoptions
    pre_save = nil, -- function to call before saving the session
  },
  -- setup keymaps
  config = function(_, opts)
    require("persistence").setup(opts)

    -- Keymaps for saving/loading sessions
    vim.keymap.set("n", "<leader>qs", function()
      require("persistence").load()
    end, { desc = "Restore session" })

    vim.keymap.set("n", "<leader>ql", function()
      require("persistence").load({ last = true })
    end, { desc = "Restore last session" })

    vim.keymap.set("n", "<leader>qd", function()
      require("persistence").stop()
    end, { desc = "Don't save current session" })
  end,
}
