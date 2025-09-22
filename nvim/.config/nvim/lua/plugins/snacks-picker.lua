return {
  "folke/snacks.nvim",
  opts = {
    picker = {
      enabled = true,
      win = {
        input = {
          keys = {
            ["<C-j>"] = { "move", "down" },
            ["<C-k>"] = { "move", "up" },
          },
        },
      },
      sources = {
        files = {
          hidden = false,
          follow = true,
          exclude = {
            ".git",
            "node_modules",
            ".DS_Store",
          },
        },
        grep = {
          hidden = false,
          follow = true,
        },
      },
      formatters = {
        file = {
          filename_first = true,
        },
      },
      -- Configure layout similar to Telescope's horizontal layout
      layout = {
        preset = "select",
        backdrop = 60,
        cycle = true,
        reverse = false,
        border = "rounded",
      },
    },
  },
  keys = {
    -- Replace the custom find plugin files keymap from example.lua
    {
      "<leader>fp",
      function()
        require("project_nvim.utils").get_recent_projects()
        vim.ui.select(require("project_nvim").get_recent_projects(), {
          prompt = "Select Project: ",
          format_item = function(item)
            return vim.fn.fnamemodify(item, ":~")
          end,
        }, function(choice)
          if choice then
            vim.cmd("cd " .. choice)
            Snacks.picker.files({ cwd = choice })
          end
        end)
      end,
      desc = "Find Project",
    },
  },
}