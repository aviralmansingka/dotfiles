return {
  {
    "ojroques/nvim-osc52",
    event = "VeryLazy",
    config = function()
      require("osc52").setup({
        max_length = 0, -- Maximum length of selection (0 for no limit)
        silent = false, -- Disable message on successful copy
        trim = false, -- Trim surrounding whitespaces before copy
      })

      -- Auto-copy to system clipboard when yanking in SSH sessions
      if vim.env.SSH_TTY or vim.env.SSH_CONNECTION then
        local function copy()
          if vim.v.event.operator == "y" and vim.v.event.regname == "+" then
            require("osc52").copy_register("+")
          end
        end

        vim.api.nvim_create_autocmd("TextYankPost", { callback = copy })
      end
    end,
  },
}

