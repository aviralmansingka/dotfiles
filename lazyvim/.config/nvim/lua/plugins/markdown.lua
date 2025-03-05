return {
  {
    -- Smart list continuation and auto-formatting for markdown
    "gaoDean/autolist.nvim",
    ft = { "markdown" },
    config = function(_, opts)
      require("autolist").setup(opts)
      vim.keymap.set("i", "<tab>", "<cmd>AutolistTab<cr>")
      vim.keymap.set("i", "<s-tab>", "<cmd>AutolistShiftTab<cr>")
      -- vim.keymap.set("i", "<c-t>", "<c-t><cmd>AutolistRecalculate<cr>") -- an example of using <c-t> to indent
      vim.keymap.set("i", "<CR>", "<CR><cmd>AutolistNewBullet<cr>")
      vim.keymap.set("n", "o", "o<cmd>AutolistNewBullet<cr>")
      vim.keymap.set("n", "O", "O<cmd>AutolistNewBulletBefore<cr>")
      vim.keymap.set("n", "<CR>", "<cmd>AutolistToggleCheckbox<cr><CR>")
      vim.keymap.set("n", "<C-r>", "<cmd>AutolistRecalculate<cr>")

      -- cycle list types with dot-repeat
      vim.keymap.set("n", "<leader>cn", require("autolist").cycle_next_dr, { expr = true })
      vim.keymap.set("n", "<leader>cp", require("autolist").cycle_prev_dr, { expr = true })

      -- if you don't want dot-repeat
      -- vim.keymap.set("n", "<leader>cn", "<cmd>AutolistCycleNext<cr>")
      -- vim.keymap.set("n", "<leader>cp", "<cmd>AutolistCycleNext<cr>")

      -- functions to recalculate list on edit
      vim.keymap.set("n", ">>", ">><cmd>AutolistRecalculate<cr>")
      vim.keymap.set("n", "<<", "<<<cmd>AutolistRecalculate<cr>")
      vim.keymap.set("n", "dd", "dd<cmd>AutolistRecalculate<cr>")
      vim.keymap.set("v", "d", "d<cmd>AutolistRecalculate<cr>")
    end,
  },
  {
    'MeanderingProgrammer/render-markdown.nvim',
    dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' }, -- if you use the mini.nvim suite
    ft = { "markdown", },
    ---@module 'render-markdown'
    ---@type render.md.UserConfig
    opts = {
      checkbox = {
        enabled = true,
        render_modes = false,
        position = 'inline',
        unchecked = {
          icon = '󰄱 ',
          highlight = 'RenderMarkdownUnchecked',
          scope_highlight = nil,
        },
        checked = {
          icon = '󰱒 ',
          highlight = 'RenderMarkdownChecked',
          scope_highlight = nil,
        },
        custom = {
          todo = { raw = '[-]', rendered = '󰥔 ', highlight = 'RenderMarkdownTodo', scope_highlight = nil },
        },
      },
      code = {
        enabled = true,
        render_modes = false,
        sign = true,
        style = 'full',
        position = 'left',
        language_pad = 0,
        language_name = true,
        disable_background = { 'diff' },
        width = 'full',
        left_margin = 0,
        left_pad = 0,
        right_pad = 0,
        min_width = 0,
        border = 'thin',
        above = '▄',
        below = '▀',
        highlight = 'RenderMarkdownCode',
        highlight_language = nil,
        inline_pad = 0,
        highlight_inline = 'RenderMarkdownCodeInline',
      },
      heading = {
        enabled = true,
        render_modes = false,
        sign = true,
        icons = { '󰲡 ', '󰲣 ', '󰲥 ', '󰲧 ', '󰲩 ', '󰲫 ' },
        position = 'overlay',
        signs = { '󰫎 ' },
        width = 'full',
        left_margin = 0,
        left_pad = 0,
        right_pad = 0,
        min_width = 0,
        border = false,
        border_virtual = false,
        border_prefix = false,
        above = '▄',
        below = '▀',
        backgrounds = {
          'RenderMarkdownH1Bg',
          'RenderMarkdownH2Bg',
          'RenderMarkdownH3Bg',
          'RenderMarkdownH4Bg',
          'RenderMarkdownH5Bg',
          'RenderMarkdownH6Bg',
        },
        foregrounds = {
          'RenderMarkdownH1',
          'RenderMarkdownH2',
          'RenderMarkdownH3',
          'RenderMarkdownH4',
          'RenderMarkdownH5',
          'RenderMarkdownH6',
        },
        custom = {},
      },
      link = {
        enabled = true,
        render_modes = false,
        footnote = {
          superscript = true,
          prefix = '',
          suffix = '',
        },
        image = '󰥶 ',
        email = '󰀓 ',
        hyperlink = '󰌹 ',
        highlight = 'RenderMarkdownLink',
        wiki = {
          icon = '󱗖 ',
          body = function()
            return nil
          end,
          highlight = 'RenderMarkdownWikiLink',
        },
        custom = {
          web = { pattern = '^http', icon = '󰖟 ' },
          discord = { pattern = 'discord%.com', icon = '󰙯 ' },
          github = { pattern = 'github%.com', icon = '󰊤 ' },
          gitlab = { pattern = 'gitlab%.com', icon = '󰮠 ' },
          google = { pattern = 'google%.com', icon = '󰊭 ' },
          neovim = { pattern = 'neovim%.io', icon = ' ' },
          reddit = { pattern = 'reddit%.com', icon = '󰑍 ' },
          stackoverflow = { pattern = 'stackoverflow%.com', icon = '󰓌 ' },
          wikipedia = { pattern = 'wikipedia%.org', icon = '󰖬 ' },
          youtube = { pattern = 'youtube%.com', icon = '󰗃 ' },
        },
      },
      quote = {
        enabled = true,
        render_modes = false,
        icon = '▋',
        repeat_linebreak = false,
        highlight = 'RenderMarkdownQuote',
      },
    },
  },
}
