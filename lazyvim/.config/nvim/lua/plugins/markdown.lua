return {
  {
    "preservim/vim-pencil",
    ft = { "markdown" },
    config = function()
      vim.g["pencil#wrapModeDefault"] = "soft"
      vim.g["pencil#textwidth"] = 80
      vim.g["pencil#autoformat"] = 1

      -- Auto-enable pencil for markdown files
      vim.api.nvim_create_autocmd("FileType", {
        pattern = "markdown",
        callback = function()
          vim.cmd("PencilSoft")
          vim.opt_local.textwidth = 80
          vim.opt_local.wrap = true
          vim.opt_local.linebreak = true
        end,
      })
    end,
  },
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
      vim.keymap.set("n", "<CR>", "<cmd>AutolistToggleCheckbox<CR>")
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
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" }, -- if you use the mini.nvim suite
    ft = { "markdown" },
    keys = {
      {
        "<leader>jt",
        function()
          local daily_notes_dir = vim.fn.expand("~/obsidian/personal/journal/")

          -- Create the directory if it doesn't exist
          if vim.fn.isdirectory(daily_notes_dir) == 0 then
            vim.fn.mkdir(daily_notes_dir, "p")
          end

          -- Format today's date as YYYY-MM-DD
          local today = os.date("%Y-%m-%d")
          local filename = daily_notes_dir .. "/" .. today .. ".md"

          -- Check if the file already exists
          if vim.fn.filereadable(filename) == 1 then
            -- Open the existing file
            vim.cmd("edit " .. filename)
          else
            -- Create a new file with template
            vim.cmd("edit " .. filename)

            -- Create the template content
            -- Load template from file or use default
            local template_path = vim.fn.expand("~/notes/templates/daily.md")
            local template
            if vim.fn.filereadable(template_path) == 1 then
              -- Read template from file
              template = vim.fn.readfile(template_path)
              -- Replace any date placeholders in the template
              for i, line in ipairs(template) do
                template[i] = line:gsub("{{date}}", today)
              end
            else
              -- Use default template if file doesn't exist
              template = {
                "# Daily Note: " .. today,
                "",
                "## Habit Tracking",
                "",
                "- [ ] Daily check-in",
                "- [ ] Meditation",
                "- [ ] Monarch",
                "- [ ] Superhuman",
                "- [ ] Stretch",
                "",
                "## Journal",
                "",
                "### Timeline",
                "",
                "### Reflections",
                "",
              }
            end

            -- Insert the template content
            vim.api.nvim_buf_set_lines(0, 0, 0, false, template)

            -- Position cursor at the first task
            vim.api.nvim_win_set_cursor(0, { 5, 6 })

            -- Enter insert mode
            vim.cmd("startinsert")
          end
        end,
        desc = "Open today's daily note",
      },
      {
        "<leader>ft",
        function()
          local journal_dir = vim.fn.expand("~/obsidian/personal/journal/")
          local pickers = require("telescope.pickers")
          local finders = require("telescope.finders")
          local conf = require("telescope.config").values
          local previewers = require("telescope.previewers")

          local function get_todos()
            local todos = {}
            local files = vim.fn.glob(journal_dir .. "*.md", false, true)

            for _, file in ipairs(files) do
              local lines = vim.fn.readfile(file)
              local in_habit_section = false
              local current_section = ""

              for i, line in ipairs(lines) do
                -- Track sections to exclude habit tracking
                if line:match("^## ") then
                  current_section = line:match("^## (.+)")
                  in_habit_section = (current_section == "Habit Tracking")
                elseif line:match("^# ") then
                  current_section = line:match("^# (.+)")
                  in_habit_section = false
                end

                -- Find todos, but skip habit tracking section
                if not in_habit_section and line:match("^%s*- %[ %]") then
                  local todo_text = line:match("^%s*- %[ %] (.+)")
                  if todo_text then
                    table.insert(todos, {
                      file = file,
                      line_number = i,
                      text = todo_text,
                      full_line = line,
                      section = current_section,
                    })
                  end
                end
              end
            end

            return todos
          end

          pickers
            .new({}, {
              prompt_title = "Journal Todos (excluding Habit Tracking)",
              finder = finders.new_table({
                results = get_todos(),
                entry_maker = function(entry)
                  local filename = vim.fn.fnamemodify(entry.file, ":t")
                  local display =
                    string.format("%s:%d [%s] %s", filename, entry.line_number, entry.section or "General", entry.text)
                  return {
                    value = entry,
                    display = display,
                    ordinal = entry.text,
                    filename = entry.file,
                    lnum = entry.line_number,
                  }
                end,
              }),
              sorter = conf.generic_sorter({}),
              previewer = previewers.vim_buffer_cat.new({}),
            })
            :find()
        end,
        desc = "Find todos in journal files (excluding habits)",
      },
      {
        "<leader>fT",
        function()
          local journal_dir = vim.fn.expand("~/obsidian/personal/journal/")
          local pickers = require("telescope.pickers")
          local finders = require("telescope.finders")
          local conf = require("telescope.config").values
          local previewers = require("telescope.previewers")
          local actions = require("telescope.actions")
          local action_state = require("telescope.actions.state")

          local function get_todos_with_tags()
            local todos = {}
            local files = vim.fn.glob(journal_dir .. "*.md", false, true)

            for _, file in ipairs(files) do
              local lines = vim.fn.readfile(file)
              local in_habit_section = false
              local current_section = ""

              for i, line in ipairs(lines) do
                if line:match("^## ") then
                  current_section = line:match("^## (.+)")
                  in_habit_section = (current_section == "Habit Tracking")
                elseif line:match("^# ") then
                  current_section = line:match("^# (.+)")
                  in_habit_section = false
                end

                if not in_habit_section and line:match("^%s*- %[ %]") then
                  local todo_text = line:match("^%s*- %[ %] (.+)")
                  if todo_text then
                    -- Extract tags from todo text
                    local tags = {}
                    for tag in todo_text:gmatch("#(%w+)") do
                      table.insert(tags, tag)
                    end

                    table.insert(todos, {
                      file = file,
                      line_number = i,
                      text = todo_text,
                      full_line = line,
                      section = current_section,
                      tags = tags,
                    })
                  end
                end
              end
            end

            return todos
          end

          pickers
            .new({}, {
              prompt_title = "Journal Todos by Tag (type #tagname to filter)",
              finder = finders.new_table({
                results = get_todos_with_tags(),
                entry_maker = function(entry)
                  local filename = vim.fn.fnamemodify(entry.file, ":t")
                  local tags_str = #entry.tags > 0 and (" #" .. table.concat(entry.tags, " #")) or ""
                  local display = string.format(
                    "%s:%d [%s] %s%s",
                    filename,
                    entry.line_number,
                    entry.section or "General",
                    entry.text,
                    tags_str
                  )
                  return {
                    value = entry,
                    display = display,
                    ordinal = entry.text .. " " .. table.concat(entry.tags, " "),
                    filename = entry.file,
                    lnum = entry.line_number,
                  }
                end,
              }),
              sorter = conf.generic_sorter({}),
              previewer = previewers.vim_buffer_cat.new({}),
            })
            :find()
        end,
        desc = "Find todos by tag in journal files",
      },
    },
    ---@module 'render-markdown'
    ---@type render.md.UserConfig
    opts = {
      render_modes = true,
      anti_conceal = {
        enabled = true,
        -- Which elements to always show, ignoring anti conceal behavior. Values can either be booleans
        -- to fix the behavior or string lists representing modes where anti conceal behavior will be
        -- ignored. Possible keys are:
        --  head_icon, head_background, head_border, code_language, code_background, code_border
        --  dash, bullet, check_icon, check_scope, quote, table_border, callout, link, sign
        ignore = {
          code_background = true,
          sign = true,
        },
        above = 0,
        below = 0,
      },
      checkbox = {
        enabled = true,
        position = "inline",
        unchecked = {
          icon = "󰄱",
          highlight = "RenderMarkdownUnchecked",
          scope_highlight = nil,
        },
        checked = {
          icon = "󰱒",
          highlight = "RenderMarkdownChecked",
          scope_highlight = nil,
        },
        custom = {
          todo = { raw = "[-]", rendered = "󰥔", highlight = "RenderMarkdownTodo", scope_highlight = nil },
          idea = { raw = "[!IDEA]", rendered = "", highlight = "RenderMarkdownTodo", scope_highlight = nil },
        },
      },
      code = {
        enabled = true,
        render_modes = false,
        sign = true,
        style = "full",
        position = "left",
        language_pad = 0,
        language_name = true,
        disable_background = { "diff" },
        width = "full",
        left_margin = 0,
        left_pad = 0,
        right_pad = 0,
        min_width = 0,
        border = "thin",
        above = "▄",
        below = "▀",
        highlight = "RenderMarkdownCode",
        highlight_language = nil,
        inline_pad = 0,
        highlight_inline = "RenderMarkdownCodeInline",
      },
      heading = {
        enabled = true,
        render_modes = false,
        sign = false,
        icons = { "󰲡 ", "󰲣 ", "󰲥 ", "󰲧 ", "󰲩 ", "󰲫 " },
        position = "overlay",
        signs = { "󰫎 " },
        width = "full",
        left_margin = 0,
        left_pad = 0,
        right_pad = 0,
        min_width = 0,
        border = false,
        border_virtual = false,
        border_prefix = false,
        above = "▄",
        below = "▀",
        backgrounds = {
          "RenderMarkdownH1Bg",
          "RenderMarkdownH2Bg",
          "RenderMarkdownH3Bg",
          "RenderMarkdownH4Bg",
          "RenderMarkdownH5Bg",
          "RenderMarkdownH6Bg",
        },
        foregrounds = {
          "RenderMarkdownH1",
          "RenderMarkdownH2",
          "RenderMarkdownH3",
          "RenderMarkdownH4",
          "RenderMarkdownH5",
          "RenderMarkdownH6",
        },
        custom = {},
      },
      -- Custom heading cursor line highlighting
      on_attach = function()
        -- Define 15% blend colors for each heading level
        local heading_cursor_colors = {
          ["^%s*#%s"] = "#462f2d",      -- H1 (Red 15% blend)
          ["^%s*##%s"] = "#463529",     -- H2 (Orange 15% blend)
          ["^%s*###%s"] = "#443c2c",    -- H3 (Yellow 15% blend)
          ["^%s*####%s"] = "#3c3d2c",   -- H4 (Green 15% blend)
          ["^%s*#####%s"] = "#353b39",  -- H5 (Blue 15% blend)
          ["^%s*######%s"] = "#413639", -- H6 (Purple 15% blend)
        }
        
        -- Create autocmd for heading-specific cursor line highlighting
        vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
          buffer = 0,
          callback = function()
            local line = vim.api.nvim_get_current_line()
            local cursor_color = "#32302f" -- Default cursor line color
            
            -- Check for heading patterns (most specific first)
            for pattern, color in pairs(heading_cursor_colors) do
              if line:match(pattern) then
                cursor_color = color
                break
              end
            end
            
            -- Apply the cursor line color
            vim.api.nvim_set_hl(0, "CursorLine", { bg = cursor_color })
          end,
        })
      end,
      link = {
        enabled = true,
        render_modes = false,
        footnote = {
          superscript = true,
          prefix = "",
          suffix = "",
        },
        image = "󰥶 ",
        email = "󰀓 ",
        hyperlink = "󰌹 ",
        highlight = "RenderMarkdownLink",
        wiki = {
          icon = "󱗖 ",
          body = function()
            return nil
          end,
          highlight = "RenderMarkdownWikiLink",
        },
        custom = {
          web = { pattern = "^http", icon = "󰖟 " },
          discord = { pattern = "discord%.com", icon = "󰙯 " },
          github = { pattern = "github%.com", icon = "󰊤 " },
          gitlab = { pattern = "gitlab%.com", icon = "󰮠 " },
          google = { pattern = "google%.com", icon = "󰊭 " },
          neovim = { pattern = "neovim%.io", icon = " " },
          reddit = { pattern = "reddit%.com", icon = "󰑍 " },
          stackoverflow = { pattern = "stackoverflow%.com", icon = "󰓌 " },
          wikipedia = { pattern = "wikipedia%.org", icon = "󰖬 " },
          youtube = { pattern = "youtube%.com", icon = "󰗃 " },
        },
      },
      quote = {
        enabled = true,
        render_modes = false,
        icon = "▋",
        repeat_linebreak = false,
        highlight = "RenderMarkdownQuote",
      },
    },
  },
}
