-- Helper used by smart-tab/cycle/dismiss handlers below. Returns true when
-- Codeium has a ghost-text suggestion currently rendered.
local function codeium_visible()
  local ok, vt = pcall(require, "codeium.virtual_text")
  if not ok then
    return false
  end
  local s = vt.status()
  return s and s.state == "completions" and (s.total or 0) > 0
end

return {
  -- blink.compat for nvim-cmp source compatibility (obsidian.nvim)
  {
    "saghen/blink.compat",
    version = "2.*",
    lazy = true,
    opts = {},
  },

  -- blink.cmp completion engine
  {
    "saghen/blink.cmp",
    event = { "InsertEnter", "CmdlineEnter" },
    version = "*",
    opts = {
      enabled = function()
        -- Disable completion in terminal buffers and in any buffer that
        -- opts out via `vim.b.completion = false` (e.g. the sidekick ask prompt).
        if vim.bo.buftype == "terminal" then
          return false
        end
        if vim.b.completion == false then
          return false
        end
        return true
      end,
      keymap = {
        preset = "default",
        ["<C-b>"] = false,
        ["<C-l>"] = { "snippet_forward", "fallback" },
        ["<C-h>"] = { "snippet_backward", "fallback" },

        ["<Tab>"] = {
          function()
            if codeium_visible() then
              -- M.accept() is upstream-defined with expr=true. Its return
              -- string is the key-sequence nvim should type — including
              -- term-encoded specials like <C-g>u, <Esc>, <C-R><C-O>=...<CR>
              -- that delete the typed-so-far text and atomically re-insert
              -- the full completion via the expression register.
              --
              -- Two steps to dispatch this correctly:
              --   1. nvim_replace_termcodes(...) converts <C-g> etc. into
              --      actual control bytes.
              --   2. nvim_feedkeys(..., "n", false) types them: "n" so the
              --      bytes are not re-mapped, false because replace_termcodes
              --      already produced K_SPECIAL-encoded bytes.
              local raw = require("codeium.virtual_text").accept()
              if type(raw) == "string" and raw ~= "" then
                local keys = vim.api.nvim_replace_termcodes(raw, true, false, true)
                vim.api.nvim_feedkeys(keys, "n", false)
              end
              return true
            end
            return false
          end,
          "select_and_accept",
          "fallback",
        },

        ["<S-Tab>"] = {
          function()
            if codeium_visible() then
              require("codeium.virtual_text").clear()
              return true
            end
            return false
          end,
          "hide",
          "fallback",
        },

        ["<C-Space>"] = {
          function()
            local ok, vt = pcall(require, "codeium.virtual_text")
            if ok then
              pcall(vt.complete)
            end
            return false
          end,
          "show",
          "fallback",
        },
      },

      appearance = {
        nerd_font_variant = "mono",
      },

      sources = {
        default = { "lsp", "path", "snippets", "buffer", "emoji", "obsidian", "obsidian_new", "obsidian_tags" },
        providers = {
          git = {
            name = "git",
            module = "blink.cmp.sources.git",
          },
          emoji = {
            name = "Emoji",
            module = "blink-emoji",
            score_offset = 15,
            opts = { insert = true },
            should_show_items = function()
              return vim.tbl_contains({ "gitcommit", "markdown", "text" }, vim.o.filetype)
            end,
          },
          -- Obsidian completion sources (via blink.compat)
          obsidian = {
            name = "obsidian",
            module = "blink.compat.source",
            score_offset = 10,
            should_show_items = function()
              return vim.o.filetype == "markdown"
            end,
          },
          obsidian_new = {
            name = "obsidian_new",
            module = "blink.compat.source",
            score_offset = 8,
            should_show_items = function()
              return vim.o.filetype == "markdown"
            end,
          },
          obsidian_tags = {
            name = "obsidian_tags",
            module = "blink.compat.source",
            score_offset = 5,
            should_show_items = function()
              return vim.o.filetype == "markdown"
            end,
          },
        },
      },
      completion = {
        accept = {
          auto_brackets = {
            enabled = true,
          },
        },
        menu = {
          border = "rounded",
          draw = {
            columns = { { "label", "label_description", gap = 1 }, { "kind_icon", "kind" }, { "source_name", gap = 1 } },
            treesitter = { "lsp" },
          },
        },
        documentation = {
          auto_show = true,
          auto_show_delay_ms = 200,
          window = {
            border = "rounded",
            winhighlight = "Normal:BlinkCmpDoc,FloatBorder:BlinkCmpDocBorder,CursorLine:BlinkCmpDocCursorLine,Search:None",
          },
        },
        ghost_text = {
          enabled = false,
        },
      },

      signature = {
        enabled = true,
        window = {
          border = "rounded",
        },
      },
    },
    dependencies = {
      "rafamadriz/friendly-snippets",
      "moyiz/blink-emoji.nvim",
      {
        "L3MON4D3/LuaSnip",
        build = (function()
          if vim.fn.has("win32") == 1 or vim.fn.executable("make") == 0 then
            return
          end
          return "make install_jsregexp"
        end)(),
        opts = {
          history = true,
          region_check_events = "InsertEnter",
          delete_check_events = "TextChanged",
          enable_autosnippets = true,
        },
        dependencies = {
          {
            "rafamadriz/friendly-snippets",
            config = function()
              require("luasnip.loaders.from_vscode").lazy_load()
              require("luasnip.loaders.from_lua").lazy_load({
                paths = vim.fn.stdpath("config") .. "/luasnippets",
              })
            end,
          },
        },
      },
    },
  },
}
