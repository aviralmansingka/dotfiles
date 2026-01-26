-- W1: Centralized vault paths
local VAULT_DIR = vim.fn.expand("~/obsidian/personal/")
local JOURNAL_DIR = VAULT_DIR .. "journal/"

return {
  {
    "preservim/vim-pencil",
    ft = { "markdown" },
    config = function()
      vim.g["pencil#wrapModeDefault"] = "soft"
      vim.g["pencil#textwidth"] = 120
      vim.g["pencil#autoformat"] = 1

      -- Auto-enable pencil for markdown files
      vim.api.nvim_create_autocmd("FileType", {
        pattern = "markdown",
        callback = function()
          vim.cmd("PencilSoft")
          vim.opt_local.textwidth = 120
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
        "<leader>ft",
        function()
          local journal_dir = JOURNAL_DIR

          local function get_todos()
            local todos = {}
            -- Get all markdown files from weekly folders
            local files = vim.fn.glob(journal_dir .. "**/*.md", false, true)

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
                      pos = { i, 0 },
                    })
                  end
                end
              end
            end

            return todos
          end

          Snacks.picker.pick({
            source = "journal-todos",
            items = get_todos(),
            title = "Journal Todos (excluding Habit Tracking)",
            preview = "file",
          })
        end,
        desc = "Find todos in journal files (excluding habits)",
      },
      {
        "<leader>fT",
        function()
          local journal_dir = JOURNAL_DIR

          local function get_todos_with_tags()
            local todos = {}
            -- Get all markdown files from weekly folders
            local files = vim.fn.glob(journal_dir .. "**/*.md", false, true)

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
                    local display =
                      string.format("%s:%d [%s] %s%s", filename, i, current_section or "General", todo_text, tags_str)
                    table.insert(todos, {
                      text = display,
                      file = file,
                      pos = { i, 0 },
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
            source = "journal-todos-tags",
            items = get_todos_with_tags(),
            title = "Journal Todos by Tag (type #tagname to filter)",
            preview = "file",
          })
        end,
        desc = "Find todos by tag in journal files",
      },
      {
        "<leader>ot",
        function()
          local vault_dir = VAULT_DIR

          local function get_tags()
            local tag_files = {} -- tag -> list of {file, line}
            local files = vim.fn.glob(vault_dir .. "**/*.md", false, true)

            for _, file in ipairs(files) do
              local lines = vim.fn.readfile(file)
              local in_frontmatter = false
              local in_tags_section = false
              local frontmatter_done = false

              for i, line in ipairs(lines) do
                -- Track frontmatter boundaries
                if i == 1 and line == "---" then
                  in_frontmatter = true
                elseif in_frontmatter and line == "---" then
                  in_frontmatter = false
                  in_tags_section = false
                  frontmatter_done = true
                end

                -- Extract tags from frontmatter
                if in_frontmatter then
                  -- Check if we're entering/leaving tags section
                  if line:match("^tags:") then
                    in_tags_section = true
                    -- Array format: tags: [tag1, tag2]
                    local array_tags = line:match("^tags:%s*%[(.+)%]")
                    if array_tags then
                      for tag in array_tags:gmatch("[^,%s%[%]]+") do
                        tag = tag:gsub('^"', ""):gsub('"$', ""):gsub("^'", ""):gsub("'$", "")
                        if tag ~= "" then
                          tag_files[tag] = tag_files[tag] or {}
                          table.insert(tag_files[tag], { file = file, line = i })
                        end
                      end
                      in_tags_section = false
                    end
                  elseif in_tags_section then
                    -- W2: Check if we've left the tags section (non-indented key at root level)
                    if line:match("^[%w_-]+:") and not line:match("^%s") then
                      in_tags_section = false
                    elseif line:match("^%s*-%s") then
                      -- List item format:   - tag1 or   - "tag1"
                      local list_tag = line:match("^%s*-%s+(.+)%s*$")
                      if list_tag then
                        -- Remove quotes if present
                        list_tag = list_tag:gsub('^"', ""):gsub('"$', ""):gsub("^'", ""):gsub("'$", "")
                        if list_tag ~= "" then
                          tag_files[list_tag] = tag_files[list_tag] or {}
                          table.insert(tag_files[list_tag], { file = file, line = i })
                        end
                      end
                    end
                  end
                end

                -- Extract inline #tags (not in frontmatter, not in code blocks)
                if frontmatter_done or (i == 1 and line ~= "---") then
                  for tag in line:gmatch("#([%w_/-]+)") do
                    -- Skip if it looks like a heading or code
                    if not line:match("^#") and not line:match("^%s*```") then
                      tag_files[tag] = tag_files[tag] or {}
                      table.insert(tag_files[tag], { file = file, line = i })
                    end
                  end
                end
              end
            end

            -- Convert to picker items (flat list with tag + filename)
            local items = {}
            for tag, locations in pairs(tag_files) do
              for _, loc in ipairs(locations) do
                local filename = vim.fn.fnamemodify(loc.file, ":t:r")
                table.insert(items, {
                  text = string.format("#%s │ %s", tag, filename),
                  tag = tag,
                  file = loc.file,
                  pos = { loc.line, 0 },
                })
              end
            end

            -- Sort by tag name, then filename
            table.sort(items, function(a, b)
              if a.tag == b.tag then
                return a.file < b.file
              end
              return a.tag < b.tag
            end)

            return items
          end

          -- S1: Show scanning indicator
          vim.notify("Scanning vault for tags...", vim.log.levels.INFO)
          local items = get_tags()

          if #items == 0 then
            vim.notify("No tags found in vault", vim.log.levels.INFO)
            return
          end

          Snacks.picker.pick({
            source = "obsidian-tags",
            items = items,
            title = string.format("Obsidian Tags (%d results)", #items),
            preview = "file",
          })
        end,
        desc = "Search Obsidian tags",
      },
      {
        "<leader>ob",
        function()
          local vault_dir = VAULT_DIR
          local current_file = vim.fn.expand("%:p")
          local current_name = vim.fn.expand("%:t:r") -- filename without extension

          local function get_backlinks()
            local backlinks = {}
            local files = vim.fn.glob(vault_dir .. "**/*.md", false, true)

            -- C3: Case-insensitive matching for wiki links
            local current_name_lower = current_name:lower()
            local current_name_pattern = vim.pesc(current_name_lower)

            for _, file in ipairs(files) do
              -- Skip the current file
              if file ~= current_file then
                local lines = vim.fn.readfile(file)
                for i, line in ipairs(lines) do
                  -- Look for wiki links to current file (case-insensitive)
                  local line_lower = line:lower()
                  if
                    line_lower:match("%[%[" .. current_name_pattern .. "%]%]")
                    or line_lower:match("%[%[" .. current_name_pattern .. "|[^%]]*%]%]")
                  then
                    local filename = vim.fn.fnamemodify(file, ":t:r")
                    local context = line:gsub("^%s+", ""):sub(1, 80)
                    table.insert(backlinks, {
                      text = string.format("%s:%d %s", filename, i, context),
                      file = file,
                      pos = { i, 0 },
                    })
                  end
                end
              end
            end

            return backlinks
          end

          local items = get_backlinks()

          if #items == 0 then
            vim.notify("No backlinks found for " .. current_name, vim.log.levels.INFO)
            return
          end

          Snacks.picker.pick({
            source = "obsidian-backlinks",
            items = items,
            title = "Backlinks to " .. current_name,
            preview = "file",
          })
        end,
        desc = "Find backlinks to current note",
      },
      {
        "<leader>ol",
        function()
          local vault_dir = VAULT_DIR
          local current_file = vim.fn.expand("%:p")

          -- Check if file exists (C2: handle unsaved buffers)
          if vim.fn.filereadable(current_file) == 0 then
            vim.notify("No file open or file not saved", vim.log.levels.WARN)
            return
          end

          local lines = vim.fn.readfile(current_file)

          local function get_outgoing_links()
            local links = {}
            local seen = {}

            for i, line in ipairs(lines) do
              -- Find all wiki links: [[link]] or [[link|alias]] (C1: fixed pattern)
              for link in line:gmatch("%[%[([^|%]]+)") do
                if not seen[link] then
                  seen[link] = true
                  -- Try to find the target file
                  local target_files = vim.fn.glob(vault_dir .. "**/" .. link .. ".md", false, true)
                  local target_file = target_files[1]
                  if target_file then
                    table.insert(links, {
                      text = string.format("[[%s]] (line %d)", link, i),
                      file = target_file,
                      pos = { 1, 0 },
                      link = link,
                    })
                  else
                    table.insert(links, {
                      text = string.format("[[%s]] (line %d) [not found]", link, i),
                      file = current_file,
                      pos = { i, 0 },
                      link = link,
                    })
                  end
                end
              end
            end

            return links
          end

          local items = get_outgoing_links()

          if #items == 0 then
            vim.notify("No outgoing links found", vim.log.levels.INFO)
            return
          end

          Snacks.picker.pick({
            source = "obsidian-outgoing",
            items = items,
            title = "Outgoing links",
            preview = "file",
          })
        end,
        desc = "Find outgoing links from current note",
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
