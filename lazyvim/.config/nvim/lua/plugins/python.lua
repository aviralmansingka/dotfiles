return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      -- Explicitly disable pyright server
      setup = {
        pyright = function()
          -- Return true to indicate we're handling the setup
          -- This prevents the default pyright setup from running
          vim.api.nvim_create_autocmd("FileType", {
            pattern = "python",
            callback = function()
              -- Apply Python-specific diagnostic settings
              vim.diagnostic.config({
                virtual_text = false,
                update_in_insert = false,
                underline = true,
                severity_sort = true,
                float = {
                  border = "rounded",
                  source = "always",
                  header = "",
                  prefix = "",
                },
              })
              -- Set up diagnostic highlighting with undercurl for Python
              vim.cmd([[
                highlight DiagnosticUnderlineError gui=undercurl guisp=#db4b4b
                highlight DiagnosticUnderlineWarn gui=undercurl guisp=#e0af68
                highlight DiagnosticUnderlineInfo gui=undercurl guisp=#0db9d7
                highlight DiagnosticUnderlineHint gui=undercurl guisp=#1abc9c
              ]])
            end,
          })
          return true
        end,
      },
    },
  },
  -- Configure LSP for Python with BasedPyright
  {
    "neovim/nvim-lspconfig",
    ft = "python",
    opts = {
      servers = {
        pyright = false,
        basedpyright = {
          settings = {
            basedpyright = {
              analysis = {
                autoImportCompletions = true,
                typeCheckingMode = "off", -- Can be "off", "basic", or "strict"
                autoSearchPaths = true,
                diagnosticMode = "openFilesOnly", -- "openFilesOnly" or "workspace"
                inlayHints = {
                  variableTypes = true,
                  functionReturnTypes = true,
                },
                useLibraryCodeForTypes = true,
                diagnosticSeverityOverrides = {
                  -- Customize severity of different diagnostic rules
                  -- Example: "reportUnusedVariable": "warning"
                },
              },
            },
          },
        },
      },
    },
  }, -- Add Python-specific diagnostic settings using autocmd

  -- Ensure BasedPyright is installed via Mason
  {
    "williamboman/mason.nvim",
    opts = function(_, opts)
      opts.ensure_installed = opts.ensure_installed or {}
      vim.list_extend(opts.ensure_installed, { "basedpyright" })
      vim.list_extend(opts.ensure_installed, { "black" })
    end,
  },

  -- Disable Python linting via nvim-lint since we'll use BasedPyright
  {
    "mfussenegger/nvim-lint",
    optional = true,
    opts = {
      linters_by_ft = {
        python = {}, -- Empty array disables linters for Python
      },
    },
  },

  -- Configure formatting to use a single tool
  {
    "stevearc/conform.nvim",
    optional = true,
    opts = {
      formatters_by_ft = {
        python = { "black" }, -- Use only Black for formatting
      },
    },
  },
}
