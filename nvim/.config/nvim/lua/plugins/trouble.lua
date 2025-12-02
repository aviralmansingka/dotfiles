return {
  -- trouble.nvim: Pretty diagnostics, references, telescope results, quickfix and location lists
  -- Provides a pretty list for showing diagnostics, references, telescope results, quickfix and location lists
  -- Compatible with fidget.nvim and blink.cmp
  {
    "folke/trouble.nvim",
    cmd = "Trouble", -- Load on command
    keys = {
      -- LSP Diagnostics
      { "<leader>xx", "<cmd>Trouble diagnostics toggle<cr>", desc = "Diagnostics (Trouble)" },
      { "<leader>xX", "<cmd>Trouble diagnostics toggle filter.buf=0<cr>", desc = "Buffer Diagnostics (Trouble)" },

      -- LSP Symbols and References
      { "<leader>cs", "<cmd>Trouble symbols toggle focus=false<cr>", desc = "Symbols (Trouble)" },
      { "<leader>cl", "<cmd>Trouble lsp toggle focus=false win.position=right<cr>", desc = "LSP References (Trouble)" },

      -- Quickfix/Location Lists
      { "<leader>xL", "<cmd>Trouble loclist toggle<cr>", desc = "Location List (Trouble)" },
      { "<leader>xQ", "<cmd>Trouble qflist toggle<cr>", desc = "Quickfix List (Trouble)" },
    },
    opts = {
      -- Behavior
      auto_close = false,     -- Don't auto-close when no items
      auto_open = false,      -- Don't auto-open when items exist
      auto_preview = true,    -- Auto-preview items on cursor
      auto_refresh = true,    -- Auto-refresh when open
      auto_jump = false,      -- Don't auto-jump to single item
      focus = false,          -- Don't focus window when opened
      restore = true,         -- Restore cursor position
      follow = true,          -- Follow cursor in source buffer
      indent_guides = true,   -- Show indent guides
      max_items = 200,        -- Max items per section
      multiline = true,       -- Support multi-line messages
      pinned = false,         -- Don't pin to current buffer
      warn_no_results = true, -- Warn when no results
      open_no_results = false, -- Don't open window with no results

      -- Preview window (shows in main editor)
      preview = {
        type = "main",        -- Show preview in main window
        scratch = true,       -- Use scratch buffer for unloaded files
      },

      -- Custom modes/views
      modes = {
        -- Document symbols with custom filtering
        symbols = {
          desc = "document symbols",
          mode = "lsp_document_symbols",
          focus = false,
          win = { position = "right", size = 50 },
          filter = {
            -- Remove Lua Package symbols (control flow)
            ["not"] = { ft = "lua", kind = "Package" },
            any = {
              -- All symbols for help/markdown files
              ft = { "help", "markdown" },
              -- Common programming symbols
              kind = {
                "Class", "Function", "Method", "Interface",
                "Module", "Namespace", "Property", "Field",
                "Constructor", "Enum", "Struct", "Trait",
              },
            },
          },
        },
      },

      -- Icons for different item types
      icons = {
        -- Indent guides
        indent = {
          top = "│ ",
          middle = "├╴",
          last = "└╴",
          fold_open = " ",
          fold_closed = " ",
          ws = "  ",
        },
        -- Folder icons
        folder_closed = " ",
        folder_open = " ",
        -- LSP symbol kind icons
        kinds = {
          Array = " ",
          Boolean = "󰨙 ",
          Class = " ",
          Constant = "󰏿 ",
          Constructor = " ",
          Enum = " ",
          EnumMember = " ",
          Event = " ",
          Field = " ",
          File = " ",
          Function = "󰊕 ",
          Interface = " ",
          Key = " ",
          Method = "󰊕 ",
          Module = " ",
          Namespace = "󰦮 ",
          Null = " ",
          Number = "󰎠 ",
          Object = " ",
          Operator = " ",
          Package = " ",
          Property = " ",
          String = " ",
          Struct = "󰆼 ",
          TypeParameter = " ",
          Variable = "󰀫 ",
        },
      },
    },
  },
}