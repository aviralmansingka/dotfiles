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

      -- Snacks picker highlight groups - use gruvbox material background
      local gruvbox_bg = "#282828" -- Hard background from gruvbox material
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

      -- Blink.cmp ghost text highlight to match gruvbox material
      vim.api.nvim_set_hl(0, "BlinkGhostText", { fg = "#665c54", bg = "#282828" }) -- Match gruvbox background

      -- Blink.cmp completion window highlights to match gruvbox material
      vim.api.nvim_set_hl(0, "BlinkCmpMenu", { bg = "#282828", fg = "#ebdbb2" }) -- Completion menu background
      vim.api.nvim_set_hl(0, "BlinkCmpMenuBorder", { bg = "#282828", fg = "#ebdbb2" }) -- Menu border - brighter white like snacks.picker
      vim.api.nvim_set_hl(0, "BlinkCmpDoc", { bg = "#282828", fg = "#ebdbb2" }) -- Documentation window
      vim.api.nvim_set_hl(0, "BlinkCmpDocBorder", { bg = "#282828", fg = "#ebdbb2" }) -- Documentation border - brighter white
      vim.api.nvim_set_hl(0, "BlinkCmpSource", { bg = "#282828", fg = "#928374" }) -- Package/source name with gruvbox background
      -- Enhanced DAP signs with better debugging visibility
      vim.fn.sign_define(
        "DapBreakpoint",
        { text = "●", texthl = "DapBreakpoint", linehl = "DapBreakpointLine", numhl = "DapBreakpointNum" }
      )
      vim.fn.sign_define(
        "DapBreakpointCondition",
        { text = "◐", texthl = "DapBreakpointCondition", linehl = "DapBreakpointLine", numhl = "DapBreakpointNum" }
      )
      vim.fn.sign_define("DapLogPoint", { text = "◆", texthl = "DapLogPoint", linehl = "", numhl = "" })
      vim.fn.sign_define(
        "DapStopped",
        { text = "→", texthl = "DapStopped", linehl = "DapStoppedLine", numhl = "DapStoppedNum" }
      )
      vim.fn.sign_define(
        "DapBreakpointRejected",
        { text = "○", texthl = "DapBreakpointRejected", linehl = "", numhl = "" }
      )
      vim.fn.sign_define(
        "DapException",
        { text = "❌", texthl = "DapException", linehl = "DapExceptionLine", numhl = "DapExceptionNum" }
      )

      -- Define custom highlight groups for debugging
      vim.api.nvim_set_hl(0, "DapBreakpoint", { fg = "#d8a657" }) -- Gruvbox yellow
      vim.api.nvim_set_hl(0, "DapBreakpointLine", { bg = "#3c3110" }) -- Subtle yellow background
      vim.api.nvim_set_hl(0, "DapBreakpointNum", { fg = "#d8a657" })
      vim.api.nvim_set_hl(0, "DapBreakpointCondition", { fg = "#fabd2f" }) -- Brighter yellow for conditions
      vim.api.nvim_set_hl(0, "DapStopped", { fg = "#7daea3" }) -- Gruvbox blue
      vim.api.nvim_set_hl(0, "DapStoppedLine", { bg = "#1f2c2e" }) -- Blue background for current line
      vim.api.nvim_set_hl(0, "DapStoppedNum", { fg = "#7daea3", bold = true })
      vim.api.nvim_set_hl(0, "DapLogPoint", { fg = "#89b482" }) -- Gruvbox teal
      vim.api.nvim_set_hl(0, "DapBreakpointRejected", { fg = "#928374" }) -- Gruvbox gray
      vim.api.nvim_set_hl(0, "DapException", { fg = "#ea6962" }) -- Gruvbox red
      vim.api.nvim_set_hl(0, "DapExceptionLine", { bg = "#3d1f1f" }) -- Red background for exceptions
      vim.api.nvim_set_hl(0, "DapExceptionNum", { fg = "#ea6962", bold = true })
    end,
  },
}
