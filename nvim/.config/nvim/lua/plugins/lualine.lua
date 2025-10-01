return {
  "nvim-lualine/lualine.nvim",
  event = "VeryLazy",
  config = function()
    -- Gruvbox Material colors matching your colorscheme.lua
    local colors = {
      bg = "#282828", -- Dark gruvbox background
      fg = "#ebdbb2", -- Light gruvbox foreground
      orange = "#f28534", -- H1 color (titles)
      yellow = "#e9b143", -- H2 color
      green = "#b0b846", -- H3 color
      blue = "#80aa9e", -- H4 color
      purple = "#d3869b", -- H5 color
      red = "#f2594b", -- H6 color
      gray = "#504945", -- Borders, muted elements
      light_gray = "#928374", -- Lighter gray for inactive
      dark_bg = "#1c2021", -- Darker background variant
    }

    -- Custom gruvbox theme for lualine
    local gruvbox_theme = {
      normal = {
        a = { bg = colors.green, fg = colors.bg, gui = "bold" },
        b = { bg = colors.gray, fg = colors.fg },
        c = { bg = colors.bg, fg = colors.light_gray },
      },
      insert = {
        a = { bg = colors.blue, fg = colors.bg, gui = "bold" },
        b = { bg = colors.gray, fg = colors.fg },
        c = { bg = colors.bg, fg = colors.light_gray },
      },
      visual = {
        a = { bg = colors.purple, fg = colors.bg, gui = "bold" },
        b = { bg = colors.gray, fg = colors.fg },
        c = { bg = colors.bg, fg = colors.light_gray },
      },
      replace = {
        a = { bg = colors.red, fg = colors.bg, gui = "bold" },
        b = { bg = colors.gray, fg = colors.fg },
        c = { bg = colors.bg, fg = colors.light_gray },
      },
      command = {
        a = { bg = colors.orange, fg = colors.bg, gui = "bold" },
        b = { bg = colors.gray, fg = colors.fg },
        c = { bg = colors.bg, fg = colors.light_gray },
      },
      inactive = {
        a = { bg = colors.bg, fg = colors.light_gray },
        b = { bg = colors.bg, fg = colors.light_gray },
        c = { bg = colors.bg, fg = colors.light_gray },
      },
    }

    -- Mode icons
    local mode_icons = {
      n = "󰋜",
      i = "󰏫",
      v = "󰸞",
      [""] = "󰸞",
      V = "󰸞",
      c = "󰘳",
      no = "N",
      s = "S",
      S = "S",
      [""] = "S",
      ic = "I",
      R = "R",
      Rv = "R",
      cv = "C",
      ce = "C",
      r = "R",
      rm = "R",
      ["r?"] = "R",
      ["!"] = "!",
      t = "󰙀",
    }

    -- Auto-hide lualine in terminal buffers
    vim.api.nvim_create_autocmd({ "BufEnter", "TermOpen" }, {
      callback = function()
        if vim.bo.buftype == "terminal" then
          vim.opt_local.laststatus = 0
        else
          vim.opt.laststatus = 3 -- global statusline
        end
      end,
    })

    require("lualine").setup({
      options = {
        theme = gruvbox_theme,
        component_separators = { left = "󰿟", right = "󰿢" },
        section_separators = { left = "", right = "" },
        globalstatus = true,
        disabled_filetypes = { statusline = { "dashboard", "alpha" } },
      },
      sections = {
        lualine_a = {
          {
            "mode",
            fmt = function(str)
              local mode = vim.fn.mode()
              return (mode_icons[mode] or str:sub(1, 1)) .. " " .. str:sub(1, 1)
            end,
          },
        },
        lualine_b = {
          {
            "branch",
            icon = "󰊢",
            color = { fg = colors.orange },
          },
          {
            "diff",
            symbols = { added = " ", modified = " ", removed = " " },
            diff_color = {
              added = { fg = colors.green },
              modified = { fg = colors.yellow },
              removed = { fg = colors.red },
            },
          },
        },
        lualine_c = {
          {
            "filename",
            path = 1, -- Show relative path
            symbols = { modified = "", readonly = "🔒" },
            color = { fg = colors.fg },
          },
          {
            "diagnostics",
            symbols = { error = " ", warn = " ", info = " ", hint = " " },
            diagnostics_color = {
              error = { fg = colors.red },
              warn = { fg = colors.yellow },
              info = { fg = colors.blue },
              hint = { fg = colors.purple },
            },
          },
        },
        lualine_x = {
          {
            "filetype",
            colored = true,
            icon_only = false,
            color = { fg = colors.purple },
          },
          {
            "encoding",
            color = { fg = colors.light_gray },
            cond = function()
              return vim.bo.fileencoding ~= "utf-8"
            end,
          },
        },
        lualine_y = {
          {
            "progress",
            color = { fg = colors.orange },
          },
        },
        lualine_z = {
          {
            "location",
            color = { fg = colors.fg },
          },
        },
      },
      inactive_sections = {
        lualine_a = {},
        lualine_b = {},
        lualine_c = { "filename" },
        lualine_x = { "location" },
        lualine_y = {},
        lualine_z = {},
      },
      extensions = { "lazy", "mason", "oil" },
    })
  end,
}
