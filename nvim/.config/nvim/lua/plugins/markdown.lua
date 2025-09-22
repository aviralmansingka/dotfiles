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
          local journal_dir = vim.fn.expand("~/obsidian/personal/journal/")

          -- Calculate current week folder (ISO week format)
          local year = tonumber(os.date("%Y"))
          local month = tonumber(os.date("%m"))
          local day = tonumber(os.date("%d"))

          -- Calculate ISO week number (Monday as start of week)
          local jan1 = os.time({year=year, month=1, day=1})
          local jan1_wday = tonumber(os.date("%w", jan1)) -- 0=Sunday, 1=Monday, etc
          local jan1_monday = jan1 - ((jan1_wday == 0 and 6 or jan1_wday - 1) * 24 * 3600)

          local today_time = os.time({year=year, month=month, day=day})
          local days_since_jan1_monday = math.floor((today_time - jan1_monday) / (24 * 3600))
          local week_num = math.floor(days_since_jan1_monday / 7) + 1

          -- Handle year boundary cases
          if week_num < 1 then
            year = year - 1
            week_num = 52 -- Approximate, could be 53
          elseif week_num > 52 then
            -- Check if this should be week 1 of next year
            local dec31 = os.time({year=year, month=12, day=31})
            local dec31_wday = tonumber(os.date("%w", dec31))
            if dec31_wday < 4 then -- Thursday or earlier
              year = year + 1
              week_num = 1
            end
          end

          local week_folder = string.format("%s/%d-W%02d", journal_dir, year, week_num)

          -- Create the weekly directory if it doesn't exist
          if vim.fn.isdirectory(week_folder) == 0 then
            vim.fn.mkdir(week_folder, "p")
          end

          -- Format today's date as YYYY-MM-DD
          local today = os.date("%Y-%m-%d")
          local filename = week_folder .. "/" .. today .. ".md"

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
                "## Life Situation Tracking",
                "",
                "- **Decision complexity** (1-5): _/5",
                "- **Social interaction richness** (0-3): _/3",
                "- **Learning/curiosity activation**: [ ] Yes",
                "- **Life planning mode**: [ ] Yes",
                "- **Processing need** (1-5): _/5",
                "- **Timeline consciousness**: [ ] Yes",
                "- **Location variety** (1-3): _/3",
                "- **Relationship interaction quality** (1-5): _/5",
                "",
                "## Journal",
                "",
                "### Timeline",
                "",
                "### Reflections",
                "",
                "### Questions of the day",
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

          local function get_todos()
            local todos = {}
            -- Get all markdown files from weekly folders
            local files = vim.fn.glob(journal_dir .. "*/**.md", false, true)

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
                    local filename = vim.fn.fnamemodify(file, ":t")
                    local display = string.format("%s:%d [%s] %s", filename, i, current_section or "General", todo_text)
                    table.insert(todos, {
                      text = display,
                      file = file,
                      line = i,
                      col = 1,
                    })
                  end
                end
              end
            end

            return todos
          end

          Snacks.picker.pick({
            source = {
              name = "journal-todos",
              get = get_todos,
            },
            title = "Journal Todos (excluding Habit Tracking)",
            preview = {
              type = "file",
            },
          })
        end,
        desc = "Find todos in journal files (excluding habits)",
      },
      {
        "<leader>fT",
        function()
          local journal_dir = vim.fn.expand("~/obsidian/personal/journal/")

          local function get_todos_with_tags()
            local todos = {}
            -- Get all markdown files from weekly folders
            local files = vim.fn.glob(journal_dir .. "*/**.md", false, true)

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

                    local filename = vim.fn.fnamemodify(file, ":t")
                    local tags_str = #tags > 0 and (" #" .. table.concat(tags, " #")) or ""
                    local display = string.format(
                      "%s:%d [%s] %s%s",
                      filename,
                      i,
                      current_section or "General",
                      todo_text,
                      tags_str
                    )
                    table.insert(todos, {
                      text = display,
                      file = file,
                      line = i,
                      col = 1,
                      tags = tags,
                      todo_text = todo_text,
                    })
                  end
                end
              end
            end

            return todos
          end

          Snacks.picker.pick({
            source = {
              name = "journal-todos-tags",
              get = get_todos_with_tags,
            },
            title = "Journal Todos by Tag (type #tagname to filter)",
            preview = {
              type = "file",
            },
          })
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
