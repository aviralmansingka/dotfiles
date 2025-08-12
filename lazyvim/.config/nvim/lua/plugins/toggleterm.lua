return {
  "akinsho/toggleterm.nvim",
  version = "*",
  opts = {
    size = 20,
    hide_numbers = true,
    direction = "float",
    shell = vim.o.shell,
    on_create = function(term)
      term:change_dir(vim.fn.getcwd())
    end,
    highlights = {
      Normal = {
        guibg = "black",
      },
      NormalFloat = {
        link = "black",
      },
      FloatBorder = {
        guifg = "black", -- set the border color
      },
    },
    float_opts = {
      border = "shadow",
      winblend = 3,
    },
  },
  config = function()
    local Terminal = require("toggleterm.terminal").Terminal
    local shell = Terminal:new({
      hidden = true,
      on_open = function(term)
        local opts = { noremap = true }
        term:change_dir(vim.fn.getcwd())

        vim.keymap.set("t", "<C-\\>", "<cmd>lua _SHELL_TOGGLE()<cr>", opts)
        vim.keymap.set("t", "<C-]>", [[<C-\><C-n>]], opts)
      end,
    })
    local columns = vim.o.columns * 0.33
    function _SHELL_TOGGLE()
      shell:toggle(columns, "float")
    end
    vim.keymap.set("n", "<C-\\>", "<cmd>lua _SHELL_TOGGLE()<CR>", { desc = "Open [T]erminal" })

    local lazygit = Terminal:new({
      cmd = "lazygit",
      direction = "float",
      hidden = true,
      on_open = function(term)
        local opts = { noremap = true }
        term:change_dir(vim.fn.getcwd())

        vim.keymap.set("t", "<C-\\>", "<cmd>lua _LAZYGIT_TOGGLE()<cr>", opts)
        vim.keymap.set("t", "<C-]>", [[<C-\><C-n>]], opts)
      end,
    })
    function _LAZYGIT_TOGGLE()
      lazygit:toggle(columns, "float")
    end

    vim.keymap.set("n", "gG", "<cmd>lua _LAZYGIT_TOGGLE()<CR>", { desc = "Open Lazy[G]it" })

    local crush = Terminal:new({
      cmd = "opencode",
      direction = "horizontal",
      hidden = true,
      on_open = function(term)
        local opts = { noremap = true }
        term:change_dir(vim.fn.getcwd())

        vim.keymap.set("t", "<C-\\>", "<cmd>lua _OPENCODE_TOGGLE()<cr>", opts)
        vim.keymap.set("t", "<C-]>", [[<C-\><C-n>]], opts)
      end,
    })
    function _OPENCODE_TOGGLE()
      crush:toggle(columns, "float")
    end

    vim.keymap.set("n", "gO", "<cmd>lua _OPENCODE_TOGGLE()<CR>", { desc = "Open [O]pencode" })

    local k9s = Terminal:new({
      cmd = "k9s",
      direction = "float",
      hidden = true,
      on_open = function(term)
        local opts = { noremap = true }
        term:change_dir(vim.fn.getcwd())

        vim.keymap.set("t", "<C-\\>", "<cmd>lua _K9S_TOGGLE()<cr>", opts)
        vim.keymap.set("t", "<C-]>", [[<C-\><C-n>]], opts)
      end,
    })
    function _K9S_TOGGLE()
      k9s:toggle(columns, "float")
    end

    vim.keymap.set("n", "gk", "<cmd>lua _K9S_TOGGLE()<CR>", { desc = "Open [K]9s" })
  end,
}
