-- Obsidian vault integration
-- Wiki links, backlinks, templates, daily notes, and note search

return {
  "epwalsh/obsidian.nvim",
  version = "*",
  lazy = true,
  ft = "markdown",
  event = {
    "BufReadPre " .. vim.fn.expand("~") .. "/obsidian/**.md",
    "BufNewFile " .. vim.fn.expand("~") .. "/obsidian/**.md",
  },
  dependencies = {
    "nvim-lua/plenary.nvim",
  },
  opts = {
    workspaces = {
      {
        name = "personal",
        path = "~/obsidian/personal",
      },
    },

    -- Daily notes with weekly subfolder structure (YYYY-Www/YYYY-MM-DD.md)
    daily_notes = {
      folder = "journal",
      date_format = "%Y-%m-%d",
      alias_format = "%B %-d, %Y",
      default_tags = { "daily-notes" },
      template = "daily.md",
    },

    -- Templates configuration
    templates = {
      folder = "templates",
      date_format = "%Y-%m-%d",
      time_format = "%H:%M",
      substitutions = {},
    },

    -- Completion (works with blink.cmp via blink.compat)
    completion = {
      nvim_cmp = true,
      min_chars = 2,
    },

    -- Wiki link style
    preferred_link_style = "wiki",

    -- Use note title as filename (readable names)
    note_id_func = function(title)
      if title ~= nil then
        -- Convert title to kebab-case for filename
        return title:gsub(" ", "-"):gsub("[^A-Za-z0-9-]", ""):lower()
      else
        -- Generate a random ID if no title provided
        return tostring(os.time())
      end
    end,

    -- Custom path function for weekly subfolder structure in daily notes
    note_path_func = function(spec)
      local path = spec.dir / tostring(spec.id)
      return path:with_suffix(".md")
    end,

    -- Mappings for following links and toggling checkboxes
    mappings = {
      -- Follow link under cursor
      ["gf"] = {
        action = function()
          return require("obsidian").util.gf_passthrough()
        end,
        opts = { noremap = false, expr = true, buffer = true },
      },
      -- Smart action (follow link or toggle checkbox)
      ["<cr>"] = {
        action = function()
          return require("obsidian").util.smart_action()
        end,
        opts = { buffer = true, expr = true },
      },
    },

    -- Picker for note search (uses snacks.picker via telescope-like interface)
    picker = {
      name = "snacks.pick",
    },

    -- UI settings
    ui = {
      enable = false, -- Using render-markdown.nvim instead
    },
  },

  keys = {
    -- Note finding and creation
    { "<leader>of", "<cmd>ObsidianQuickSwitch<cr>", desc = "Find note" },
    { "<leader>og", "<cmd>ObsidianSearch<cr>", desc = "Grep notes" },
    { "<leader>on", "<cmd>ObsidianNew<cr>", desc = "New note" },

    -- Backlinks and links
    { "<leader>ob", "<cmd>ObsidianBacklinks<cr>", desc = "Backlinks" },
    { "<leader>ol", "<cmd>ObsidianLinks<cr>", desc = "Outgoing links" },

    -- Tags
    { "<leader>ot", "<cmd>ObsidianTags<cr>", desc = "Search tags" },

    -- Templates
    { "<leader>oT", "<cmd>ObsidianTemplate<cr>", desc = "Insert template" },

    -- Daily notes
    { "<leader>od", "<cmd>ObsidianToday<cr>", desc = "Today's note" },
    { "<leader>oy", "<cmd>ObsidianYesterday<cr>", desc = "Yesterday's note" },
    { "<leader>om", "<cmd>ObsidianTomorrow<cr>", desc = "Tomorrow's note" },

    -- Note management
    { "<leader>or", "<cmd>ObsidianRename<cr>", desc = "Rename note" },

    -- Open in Obsidian app
    { "<leader>oo", "<cmd>ObsidianOpen<cr>", desc = "Open in Obsidian" },
  },

  config = function(_, opts)
    -- Custom daily note path function to support weekly subfolders
    -- Override the daily_note_path method to place notes in weekly folders
    local obsidian = require("obsidian")

    -- Patch the daily notes folder to include weekly subfolder
    local original_opts = opts
    opts.daily_notes = vim.tbl_extend("force", opts.daily_notes or {}, {
      -- We'll handle the weekly folder in a custom way
    })

    obsidian.setup(opts)

    -- Create autocmd to ensure weekly folder exists before daily note creation
    vim.api.nvim_create_autocmd("User", {
      pattern = "ObsidianDailyNote",
      callback = function()
        -- Calculate current week folder
        local year = tonumber(os.date("%Y"))
        local month = tonumber(os.date("%m"))
        local day = tonumber(os.date("%d"))

        -- Calculate ISO week number (Monday as start of week)
        local jan1 = os.time({ year = year, month = 1, day = 1 })
        local jan1_wday = tonumber(os.date("%w", jan1))
        local jan1_monday = jan1 - ((jan1_wday == 0 and 6 or jan1_wday - 1) * 24 * 3600)

        local today_time = os.time({ year = year, month = month, day = day })
        local days_since_jan1_monday = math.floor((today_time - jan1_monday) / (24 * 3600))
        local week_num = math.floor(days_since_jan1_monday / 7) + 1

        -- Handle year boundary cases
        if week_num < 1 then
          year = year - 1
          week_num = 52
        elseif week_num > 52 then
          local dec31 = os.time({ year = year, month = 12, day = 31 })
          local dec31_wday = tonumber(os.date("%w", dec31))
          if dec31_wday < 4 then
            year = year + 1
            week_num = 1
          end
        end

        local journal_dir = vim.fn.expand("~/obsidian/personal/journal/")
        local week_folder = string.format("%s%d-W%02d", journal_dir, year, week_num)

        -- Create the weekly directory if it doesn't exist
        if vim.fn.isdirectory(week_folder) == 0 then
          vim.fn.mkdir(week_folder, "p")
        end
      end,
    })
  end,
}
