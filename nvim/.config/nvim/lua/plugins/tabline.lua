return {
  -- Disable LazyVim's default bufferline
  { "akinsho/bufferline.nvim", enabled = false },

  -- tabby.nvim for tab management
  {
    "nanozuki/tabby.nvim",
    event = "VimEnter",
    dependencies = "nvim-tree/nvim-web-devicons",
    keys = {
      { "<S-h>", "<cmd>bprevious<cr>", desc = "Prev Buffer" },
      { "<S-l>", "<cmd>bnext<cr>", desc = "Next Buffer" },
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
              return {
                line.sep(right_sep, hl, theme.fill),
                tab.in_jump_mode() and tab.jump_key() or {
                  tab.is_current() and tab_active or tab_inactive,
                  tab.number(),
                  margin = " ",
                },
                tab.name(),
                tab.close_btn(close_icon),
                line.sep(left_sep, hl, theme.fill),
                hl = hl,
                margin = " ",
              }
            end, { sep = " " }),
            line.spacer(),
            line.bufs().filter(function(buf)
              return buf.type() == ""
            end).foreach(function(buf)
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
