return {
  -- fidget.nvim: LSP progress notifications
  -- Shows LSP server progress (indexing, compilation, etc.) in the corner
  -- Compatible with trouble.nvim and blink.cmp
  {
    "j-hui/fidget.nvim",
    event = "LspAttach", -- Load when LSP attaches
    opts = {
      -- LSP progress notifications
      progress = {
        -- Show all LSP progress messages
        poll_rate = 0,                -- How often to poll for progress (0 = immediate)
        suppress_on_insert = false,   -- Don't suppress messages in insert mode
        ignore_done_already = false,  -- Show messages even if task is already complete
        ignore_empty_message = false, -- Show messages even if empty

        -- Display options
        display = {
          render_limit = 16,          -- Max messages to show at once
          done_ttl = 3,               -- How long completed messages persist (seconds)
          done_icon = "✔",            -- Icon for completed tasks
          done_style = "Constant",    -- Highlight group for completed tasks
          progress_ttl = math.huge,   -- How long in-progress messages persist
          progress_icon = { "dots" }, -- Animation for in-progress tasks
          progress_style = "WarningMsg", -- Highlight group for in-progress tasks
          group_style = "Title",      -- Highlight group for LSP server names
          icon_style = "Question",    -- Highlight group for icons
          priority = 30,              -- Display priority
          skip_history = true,        -- Don't save to history
        },

        -- LSP client options
        lsp = {
          progress_ringbuf_size = 0, -- LSP progress ring buffer size
        },
      },

      -- Notification window appearance
      notification = {
        poll_rate = 10,               -- How often to update notifications
        filter = vim.log.levels.INFO, -- Minimum log level to show
        history_size = 128,           -- Max notifications in history
        override_vim_notify = false,  -- Don't override vim.notify()

        -- Window appearance
        window = {
          normal_hl = "Comment",      -- Base highlight group
          winblend = 100,             -- Transparency (0-100)
          border = "none",            -- Border style
          zindex = 45,                -- Stacking order
          max_width = 0,              -- Max width (0 = auto)
          max_height = 0,             -- Max height (0 = auto)
          x_padding = 1,              -- Horizontal padding
          y_padding = 0,              -- Vertical padding
          align = "bottom",           -- Alignment: "top"|"bottom"|"avoid"
          relative = "editor",        -- Relative to: "editor"|"win"
        },
      },
    },
  },
}