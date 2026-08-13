return {
  -- Disable LazyVim's default bufferline
  { "akinsho/bufferline.nvim", enabled = false },

  -- tabby.nvim for tab management
  {
    "nanozuki/tabby.nvim",
    event = "VimEnter",
    dependencies = "nvim-tree/nvim-web-devicons",
    keys = {
      {
        "<S-h>",
        function()
          require("helpers.workspace").cycle(-1)
        end,
        desc = "Prev Tab Buffer",
      },
      {
        "<S-l>",
        function()
          require("helpers.workspace").cycle(1)
        end,
        desc = "Next Tab Buffer",
      },
      { "[b", "<cmd>bprevious<cr>", desc = "Prev Global Buffer" },
      { "]b", "<cmd>bnext<cr>", desc = "Next Global Buffer" },
      {
        "<S-q>",
        function()
          Snacks.bufdelete()
        end,
        desc = "Close Buffer",
      },
    },
    config = function()
      vim.o.showtabline = 2

      -- Gruvbox Material colors (matching tmux config)
      local colors = {
        bg = "#282828",
        bg0 = "#32302f",
        bg1 = "#3c3836",
        bg2 = "#504945",
        fg = "#ebdbb2",
        fg4 = "#928374",
        red = "#ea6962",
        green = "#a9b665",
        yellow = "#d8a657",
        blue = "#7daea3",
        purple = "#d3869b",
        aqua = "#89b482",
        orange = "#e78a4e",
      }

      local theme = {
        fill = { fg = colors.fg4, bg = colors.bg },
        head = { fg = colors.bg, bg = colors.green, style = "bold" },
        current_tab = { fg = colors.bg, bg = colors.yellow, style = "bold" },
        tab = { fg = colors.fg4, bg = colors.bg1 },
        current_buf = { fg = colors.fg, bg = colors.bg1, style = "bold" },
        buf = { fg = colors.fg4, bg = colors.bg },
        tail = { fg = colors.bg, bg = colors.blue, style = "bold" },
      }

      local left_sep = "\u{e0b0}"
      local right_sep = "\u{e0b2}"
      local nvim_icon = "\u{e7c5}"
      local tab_active = "\u{f0e65}"
      local tab_inactive = "\u{f01a3}"
      local close_icon = "\u{f00d3}"
      local modified_icon = "\u{f0e1f}"

      require("tabby").setup({
        line = function(line)
          return {
            {
              { " " .. nvim_icon .. " ", hl = theme.head },
              line.sep(left_sep, theme.head, theme.fill),
            },
            " ",
            line.tabs().foreach(function(tab)
              local hl = tab.is_current() and theme.current_tab or theme.tab
              local workspace = require("helpers.workspace").get(tab.id)
              local state_ok, review_state = pcall(vim.api.nvim_tabpage_get_var, tab.id, "octo_review_state")
              local unseen_ok, unseen = pcall(vim.api.nvim_tabpage_get_var, tab.id, "octo_review_unseen")
              local review = state_ok
                  and ({
                    open = { "\u{f407}", colors.green },
                    merged = { "\u{f419}", colors.purple },
                    closed = { "\u{f4dc}", colors.red },
                    draft = { "\u{f4dd}", colors.fg4 },
                  })[review_state]
                or nil
              local tab_bg = tab.is_current() and colors.yellow or colors.bg1
              return {
                line.sep(right_sep, hl, theme.fill),
                tab.in_jump_mode() and tab.jump_key() or {
                  tab.is_current() and tab_active or tab_inactive,
                  tab.number(),
                  margin = " ",
                },
                review and { review[1] .. " ", hl = { fg = review[2], bg = tab_bg, style = "bold" } } or "",
                workspace and workspace.label or tab.name(),
                unseen_ok and unseen and { " ●", hl = { fg = colors.yellow, bg = tab_bg, style = "bold" } } or "",
                tab.close_btn(close_icon),
                line.sep(left_sep, hl, theme.fill),
                hl = hl,
                margin = " ",
              }
            end, { sep = " " }),
            line.spacer(),
            line
              .bufs()
              .filter(function(buf)
                return buf.type() == "" and require("helpers.workspace").contains(buf.id)
              end)
              .foreach(function(buf)
                local hl = buf.is_current() and theme.current_buf or theme.buf
                return {
                  line.sep(right_sep, hl, theme.fill),
                  buf.is_current() and tab_active or "",
                  buf.file_icon(),
                  buf.name(),
                  buf.is_changed() and (" " .. modified_icon) or "",
                  line.sep(left_sep, hl, theme.fill),
                  hl = hl,
                  margin = " ",
                }
              end, { sep = " " }),
            " ",
            {
              line.sep(right_sep, theme.tail, theme.fill),
              { " " .. nvim_icon .. " ", hl = theme.tail },
            },
            hl = theme.fill,
          }
        end,
      })
    end,
  },
}
