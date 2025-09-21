return {
  -- blink.cmp completion engine
  {
    "saghen/blink.cmp",
    event = { "InsertEnter", "CmdlineEnter" },
    version = "*",
    opts = {
      keymap = { preset = "default" },

      appearance = {
        use_nvim_cmp_as_default = true,
        nerd_font_variant = "mono",
      },

      sources = {
        default = { "lsp", "path", "snippets", "buffer" },
        providers = {
          git = {
            name = "git",
            module = "blink.compat.source",
            opts = {
              compat = "cmp-git",
            },
          },
          emoji = {
            name = "emoji",
            module = "blink.compat.source",
            opts = {
              compat = "cmp-emoji",
            },
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
          draw = {
            treesitter = { "lsp" },
          },
        },
        documentation = {
          auto_show = true,
          auto_show_delay_ms = 200,
        },
      },

      signature = { enabled = true },
    },
    dependencies = {
      "rafamadriz/friendly-snippets",
      {
        "L3MON4D3/LuaSnip",
        build = (function()
          if vim.fn.has("win32") == 1 or vim.fn.executable("make") == 0 then
            return
          end
          return "make install_jsregexp"
        end)(),
        dependencies = {
          {
            "rafamadriz/friendly-snippets",
            config = function()
              require("luasnip.loaders.from_vscode").lazy_load()
            end,
          },
        },
      },
      {
        "saghen/blink.compat",
        opts = {},
        version = "*",
      },
    },
  },

  -- Disable default completion providers that conflict with blink.cmp
  {
    "hrsh7th/nvim-cmp",
    enabled = false,
  },
  {
    "hrsh7th/cmp-nvim-lsp",
    enabled = false,
  },
  {
    "hrsh7th/cmp-buffer",
    enabled = false,
  },
  {
    "hrsh7th/cmp-path",
    enabled = false,
  },
  {
    "saadparwaiz1/cmp_luasnip",
    enabled = false,
  },
}

