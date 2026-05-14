return {
  "Exafunction/windsurf.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  event = "InsertEnter",
  cmd = { "Codeium" },
  build = ":Codeium Auth",
  keys = {
    {
      "<leader>ai",
      function()
        local current = vim.b.codeium_enabled
        if current == nil then
          current = true
        end
        vim.b.codeium_enabled = not current
        if not vim.b.codeium_enabled then
          pcall(require("codeium.virtual_text").clear)
        end
        vim.notify("Codeium " .. (vim.b.codeium_enabled and "enabled" or "disabled") .. " (buffer)")
      end,
      desc = "Codeium: toggle buffer",
    },
    {
      "<leader>aI",
      "<cmd>Codeium Toggle<cr>",
      desc = "Codeium: toggle global",
    },
  },
  config = function()
    require("codeium").setup({
      enable_chat = false,
      enable_cmp_source = false,
      virtual_text = {
        enabled = true,
        manual = false,
        idle_delay = 75,
        map_keys = false,
        default_filetype_enabled = true,
        filetypes = {
          markdown = false,
          gitcommit = false,
          gitrebase = false,
          text = false,
          help = false,
          oil = false,
          ["neo-tree"] = false,
          snacks_picker = false,
          snacks_dashboard = false,
          TelescopePrompt = false,
          ["mini-files"] = false,
          ["mini.files"] = false,
          NvimTree = false,
          codecompanion = false,
          sidekick_terminal = false,
          lazy = false,
          mason = false,
          toggleterm = false,
          terminal = false,
        },
        key_bindings = {
          -- Bind accept to a <Plug> mapping (registered by windsurf as expr=true).
          -- blink's <Tab> handler then feedkeys this <Plug> so the expr-return
          -- string (the actual completion text) gets typed into the buffer.
          accept = "<Plug>(CodeiumAccept)",
          accept_word = false,
          accept_line = false,
          clear = false,
          next = false,
          prev = false,
        },
      },
    })

    pcall(function()
      require("codeium.virtual_text").set_statusbar_refresh(function()
        require("lualine").refresh()
      end)
    end)

    -- Per-buffer disable: clear ghost text on text/cursor changes when
    -- vim.b.codeium_enabled is explicitly false. Requests still fire but
    -- the rendering never persists.
    local aug = vim.api.nvim_create_augroup("codeium_buffer_toggle", { clear = true })
    vim.api.nvim_create_autocmd({ "TextChangedI", "InsertEnter", "BufEnter" }, {
      group = aug,
      callback = function(args)
        if vim.b[args.buf].codeium_enabled == false then
          pcall(require("codeium.virtual_text").clear)
        end
      end,
    })
  end,
}
