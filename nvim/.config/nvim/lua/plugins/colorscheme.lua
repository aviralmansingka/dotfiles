return {
  {
    "sainnhe/gruvbox-material",
    enabled = true,
    priority = 1000,
    config = function()
      -- Disable transparent background for Neovide compatibility
      vim.g.gruvbox_material_transparent_background = 0

      vim.o.background = "dark"
      vim.g.gruvbox_material_foreground = "mix"
      vim.g.gruvbox_material_background = "medium"
      vim.g.gruvbox_material_ui_contrast = "low"
      vim.g.gruvbox_material_float_style = "blend"
      vim.g.gruvbox_material_statusline_style = "afterglow" -- Options: "original", "material", "mix", "afterglow"
      vim.g.gruvbox_material_cursor = "auto"
      vim.g.gruvbox_material_enable_italic = 1
      vim.g.gruvbox_material_enable_bold = 1
      vim.g.gruvbox_material_diagnostic_line_highlight = 1
      vim.g.gruvbox_material_dim_inactive_windows = 0

      -- vim.g.gruvbox_material_colors_override = { bg0 = '#16181A' } -- #0e1010
      -- vim.g.gruvbox_material_better_performance = 1

      vim.cmd.colorscheme("gruvbox-material")

      -- Set custom highlights after colorscheme is loaded
      vim.api.nvim_create_autocmd("ColorScheme", {
        callback = function()
          -- Custom floating window background override
          vim.api.nvim_set_hl(0, "FloatTitle", { bg = "#282828", fg = "#f28534" }) -- Match background with subtle border
          vim.api.nvim_set_hl(0, "NormalFloat", { bg = "#282828" }) -- Dark gruvbox background
          vim.api.nvim_set_hl(0, "FloatBorder", { bg = "#282828", fg = "#504945" }) -- Match background with subtle border
          vim.api.nvim_set_hl(0, "VertSplit", { bg = "#282828", fg = "#504945" }) -- Match background with subtle border
          vim.api.nvim_set_hl(0, "TerminalNormal", { bg = "#282828", fg = "#ebdbb2" }) -- Terminal in floating windows

          -- Snacks picker highlight groups - use gruvbox material background
          local gruvbox_bg = "#282828"  -- Hard background from gruvbox material
          local normal_fg = "#ebdbb2"

          -- Set all SnacksPicker groups to match gruvbox background
          local snacks_groups = {
            "SnacksPicker",
            "SnacksPickerTitle",
            "SnacksPickerFooter",
            "SnacksPickerPrompt",
            "SnacksPickerTotals",
            "SnacksPickerInputCursorLine",
            "SnacksPickerListCursorLine",
            "SnacksPickerMatch",
            "SnacksPickerDir",
            "SnacksPickerBufFlags",
            "SnacksPickerKeymapRhs",
            "SnacksPickerToggle",
            "SnacksPickerInputBorder",
            "SnacksPickerInputSearch",
            "SnacksPickerListBorder",
            "SnacksPickerList",
            "SnacksPickerListTitle",
            "SnacksPickerPreviewBorder",
            "SnacksPickerPreview",
            "SnacksPickerPreviewTitle",
            "SnacksPickerBoxBorder",
          }

          for _, group in ipairs(snacks_groups) do
            vim.api.nvim_set_hl(0, group, { bg = gruvbox_bg, fg = normal_fg })
          end

          -- Keep border subtle but matching background
          vim.api.nvim_set_hl(0, "SnacksPickerBorder", { bg = gruvbox_bg, fg = "#504945" })

          -- Also set the window background to match
          vim.api.nvim_set_hl(0, "SnacksPickerWindow", { bg = gruvbox_bg })
        end,
      })

      -- Trigger the autocmd immediately to set highlights now
      vim.cmd("doautocmd ColorScheme")

      -- Custom statusline highlights
      -- vim.api.nvim_set_hl(0, "StatusLine", {
      --   bg = "#1C2021", -- Dark gray background
      --   fg = "#ebdbb2", -- Light text
      --   bold = false
      -- })
      --
      -- vim.api.nvim_set_hl(0, "StatusLineNC", {
      --   bg = "#1C2021", -- Darker background for inactive windows
      --   fg = "#928374", -- Muted text
      --   bold = false
      -- })

      -- Custom markdown rendering highlights for render-markdown.nvim
      -- GruvboxDarkHard heading colors (Orange → Yellow → Green → Blue → Purple → Red)
      vim.api.nvim_set_hl(0, "markdownListMarker", { fg = "#80aa9e", bold = true })
      vim.api.nvim_set_hl(0, "markdownH1", { fg = "#f28534", bold = true }) -- GruvboxDarkHard Orange
      vim.api.nvim_set_hl(0, "markdownH2", { fg = "#e9b143", bold = true }) -- GruvboxDarkHard Yellow
      vim.api.nvim_set_hl(0, "markdownH3", { fg = "#b0b846", bold = true }) -- GruvboxDarkHard Green
      vim.api.nvim_set_hl(0, "markdownH4", { fg = "#80aa9e", bold = true }) -- GruvboxDarkHard Blue
      vim.api.nvim_set_hl(0, "markdownH5", { fg = "#d3869b", bold = true }) -- GruvboxDarkHard Purple
      vim.api.nvim_set_hl(0, "markdownH6", { fg = "#f2594b", bold = true }) -- GruvboxDarkHard Red
      vim.api.nvim_set_hl(0, "RenderMarkdownH1", { fg = "#f28534", bold = true }) -- GruvboxDarkHard Orange
      vim.api.nvim_set_hl(0, "RenderMarkdownH2", { fg = "#e9b143", bold = true }) -- GruvboxDarkHard Yellow
      vim.api.nvim_set_hl(0, "RenderMarkdownH3", { fg = "#b0b846", bold = true }) -- GruvboxDarkHard Green
      vim.api.nvim_set_hl(0, "RenderMarkdownH4", { fg = "#80aa9e", bold = true }) -- GruvboxDarkHard Blue
      vim.api.nvim_set_hl(0, "RenderMarkdownH5", { fg = "#d3869b", bold = true }) -- GruvboxDarkHard Purple
      vim.api.nvim_set_hl(0, "RenderMarkdownH6", { fg = "#f2594b", bold = true }) -- GruvboxDarkHard Red

      -- Heading backgrounds (30% blend with #282828 base)
      vim.api.nvim_set_hl(0, "RenderMarkdownH1Bg", { bg = "#64432b" }) -- Orange 30% blend
      vim.api.nvim_set_hl(0, "RenderMarkdownH2Bg", { bg = "#615130" }) -- Yellow 30% blend
      vim.api.nvim_set_hl(0, "RenderMarkdownH3Bg", { bg = "#505331" }) -- Green 30% blend
      vim.api.nvim_set_hl(0, "RenderMarkdownH4Bg", { bg = "#424f4b" }) -- Blue 30% blend
      vim.api.nvim_set_hl(0, "RenderMarkdownH5Bg", { bg = "#5b444a" }) -- Purple 30% blend
      vim.api.nvim_set_hl(0, "RenderMarkdownH6Bg", { bg = "#643632" }) -- Red 30% blend

      -- Checkboxes
      vim.api.nvim_set_hl(0, "RenderMarkdownChecked", { fg = "#b8bb26" }) -- GruvboxDark green for checked
      vim.api.nvim_set_hl(0, "RenderMarkdownUnchecked", { fg = "#504945" }) -- gray for unchecked
      vim.api.nvim_set_hl(0, "RenderMarkdownTodo", { fg = "#fabd2f" }) -- Yellow for todo

      -- Claude Code highlight group
      vim.api.nvim_set_hl(0, "ClaudeCodeBorder", { fg = "#da7756", bg = "#282828" }) -- Claude terra cotta
    end,
  },
}
