return {
  -- Configure LSP for Python with BasedPyright
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        pyright = false,
        basedpyright = {
          settings = {
            basedpyright = {
              analysis = {
                typeCheckingMode = "basic", -- Can be "off", "basic", or "strict"
                diagnosticMode = "workspace", -- "openFilesOnly" or "workspace"
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
      -- Add a custom setup function specifically for basedpyright
      setup = {
        basedpyright = function(_, opts)
          -- Get the default handler
          local default_handler = vim.lsp.handlers["textDocument/publishDiagnostics"]

          -- Create a custom handler that disables virtual text for basedpyright only
          vim.lsp.handlers["textDocument/publishDiagnostics"] = function(err, result, ctx, config)
            -- Get client info
            local client = vim.lsp.get_client_by_id(ctx.client_id)

            -- Make a copy of the original config
            local new_config = vim.deepcopy(config or {})

            -- Modify the config only for basedpyright
            if client and client.name == "basedpyright" then
              new_config.virtual_text = false
            end

            -- Call the default handler with our modified config
            default_handler(err, result, ctx, new_config)
          end

          -- Return false to prevent the default setup
          return false
        end,
      },
    },
  }, -- Add Python-specific diagnostic settings using autocmd

  -- Ensure BasedPyright is installed via Mason
  {
    "williamboman/mason.nvim",
    opts = function(_, opts)
      opts.ensure_installed = opts.ensure_installed or {}
      vim.list_extend(opts.ensure_installed, { "basedpyright" })
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
