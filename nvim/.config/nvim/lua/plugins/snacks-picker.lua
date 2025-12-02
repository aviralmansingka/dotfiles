return {
  -- Disable Telescope since we're using Snacks picker
  {
    "nvim-telescope/telescope.nvim",
    enabled = false,
  },
  -- Disable fzf-lua since we're using Snacks picker
  {
    "ibhagwan/fzf-lua",
    enabled = false,
  },
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        enabled = true,
        sources = {
          files = {
            hidden = true,
            follow = true,
            exclude = {
              ".git",
              "node_modules",
              ".DS_Store",
            },
          },
          grep = {
            hidden = true,
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
          preset = "telescope",
          cycle = true,
          reverse = false,
          border = "rounded",
        },
        -- Ensure window background matches gruvbox
        winhighlight = {
          Normal = "Normal",
          NormalFloat = "NormalFloat",
          FloatBorder = "SnacksPickerBorder",
          FloatTitle = "SnacksPickerTitle",
        },
      },
    },
    keys = {
      -- Find Project functionality
      {
        "<leader>fp",
        function()
          local project_nvim = require("project_nvim")
          local recent_projects = project_nvim.get_recent_projects()

          if not recent_projects or #recent_projects == 0 then
            vim.notify("No recent projects found", vim.log.levels.WARN)
            return
          end

          vim.ui.select(recent_projects, {
            prompt = "Select Project: ",
            format_item = function(item)
              return vim.fn.fnamemodify(item, ":~")
            end,
          }, function(choice)
            if choice then
              vim.cmd("cd " .. vim.fn.fnameescape(choice))
              Snacks.picker.files({ cwd = choice })
            end
          end)
        end,
        desc = "Find Project",
      },
    },
  },
}
