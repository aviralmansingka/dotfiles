-- Obsidian vault integration
-- Wiki links, backlinks, templates, work logs, and note search

return {
  "epwalsh/obsidian.nvim",
  version = "*",
  lazy = true,
  ft = "markdown",
  event = {
    "BufReadPre " .. vim.fn.expand("~") .. "/vault/**.md",
    "BufNewFile " .. vim.fn.expand("~") .. "/vault/**.md",
  },
  dependencies = {
    "nvim-lua/plenary.nvim",
  },
  opts = {
    workspaces = {
      {
        name = "personal",
        path = "~/vault",
      },
    },

    -- Obsidian.nvim daily commands remain available, but vault work logging
    -- is mapped to 3_logs/YYYY-WW/backlog.md below.
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

    -- Picker: disabled (snacks.pick not supported by obsidian.nvim)
    -- Use custom Snacks pickers in markdown.lua for tags/todos instead
    picker = nil,

    -- UI settings
    ui = {
      enable = false, -- Using render-markdown.nvim instead
      -- Define checkbox states for toggle cycling (space -> - -> x -> space)
      checkboxes = {
        [" "] = { char = "󰄱", hl_group = "ObsidianTodo" },
        ["-"] = { char = "󰥔", hl_group = "ObsidianRightArrow" },
        ["x"] = { char = "󰱒", hl_group = "ObsidianDone" },
      },
    },
  },

  keys = {
    -- Note finding and creation
    { "<leader>of", "<cmd>ObsidianQuickSwitch<cr>", desc = "Find note" },
    { "<leader>og", "<cmd>ObsidianSearch<cr>", desc = "Grep notes" },
    { "<leader>oi", "<cmd>edit ~/vault/0_inbox/0.inbox.md<cr>", desc = "Open inbox" },
    { "<leader>on", "<cmd>ObsidianNew<cr>", desc = "New note" },

    -- Backlinks and links: handled by custom Snacks picker in markdown.lua
    -- (<leader>ob for backlinks, <leader>ol for outgoing links)

    -- Tags: handled by custom Snacks picker in markdown.lua (<leader>ot)

    -- Templates
    { "<leader>oT", "<cmd>ObsidianTemplate<cr>", desc = "Insert template" },

    -- Weekly backlog work logs
    {
      "<leader>od",
      function()
        require("helpers.obsidian").today()
      end,
      desc = "Today's backlog",
    },
    {
      "<leader>oy",
      function()
        require("helpers.obsidian").yesterday()
      end,
      desc = "Yesterday's backlog",
    },
    {
      "<leader>om",
      function()
        require("helpers.obsidian").tomorrow()
      end,
      desc = "Tomorrow's backlog",
    },

    -- Note management
    { "<leader>or", "<cmd>ObsidianRename<cr>", desc = "Rename note" },

    -- Open in Obsidian app
    { "<leader>oo", "<cmd>ObsidianOpen<cr>", desc = "Open in Obsidian" },
  },

  config = function(_, opts)
    local obsidian = require("obsidian")

    opts.daily_notes = vim.tbl_extend("force", opts.daily_notes or {}, {})

    obsidian.setup(opts)

    local backlog = require("helpers.obsidian")
    vim.api.nvim_create_user_command("VaultBacklogToday", backlog.today, { desc = "Open today's weekly backlog" })
    vim.api.nvim_create_user_command("VaultBacklogYesterday", backlog.yesterday, { desc = "Open yesterday's weekly backlog" })
    vim.api.nvim_create_user_command("VaultBacklogTomorrow", backlog.tomorrow, { desc = "Open tomorrow's weekly backlog" })
    vim.api.nvim_create_user_command("ObsidianToday", backlog.today, { desc = "Open today's weekly backlog" })
    vim.api.nvim_create_user_command("ObsidianYesterday", backlog.yesterday, { desc = "Open yesterday's weekly backlog" })
    vim.api.nvim_create_user_command("ObsidianTomorrow", backlog.tomorrow, { desc = "Open tomorrow's weekly backlog" })
  end,
}
