return {
  -- Extend LazyVim's LSP configuration
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    -- Custom server configurations using LazyVim's approach
    opts.servers = opts.servers or {}

    -- Explicitly disable ruff servers
    opts.servers.ruff = opts.servers.ruff or {}
    opts.servers.ruff.enabled = false
    opts.servers.ruff_lsp = opts.servers.ruff_lsp or {}
    opts.servers.ruff_lsp.enabled = false



    -- gopls configuration
    opts.servers.gopls = {
      filetypes = { "go", "gomod", "gosum", "gotmpl" },
      settings = {
        gopls = {
          analyses = {
            unusedparams = true,
            shadow = true,
            fieldalignment = true,
            nilness = true,
            unusedwrite = true,
            useany = true,
          },
          usePlaceholders = true,
          completeUnimported = true,
          staticcheck = true,
          experimentalPostfixCompletions = true,
          hints = {
            assignVariableTypes = true,
            compositeLiteralFields = true,
            compositeLiteralTypes = true,
            constantValues = true,
            functionTypeParameters = true,
            parameterNames = true,
            rangeVariableTypes = true,
          },
          directoryFilters = { "-.git", "-.vscode", "-.idea", "-.vscode-server", "-node_modules" },
          semanticTokens = true,
          gofumpt = true,
        },
      },
    }

    -- Lua language server configuration
    opts.servers.lua_ls = {
      filetypes = { "lua" },
      settings = {
        Lua = {
          workspace = {
            checkThirdParty = false,
          },
          codeLens = {
            enable = true,
          },
          completion = {
            callSnippet = "Replace",
          },
          doc = {
            privateName = { "^_" },
          },
          hint = {
            enable = true,
            setType = false,
            paramType = true,
            paramName = "Disable",
            semicolon = "Disable",
            arrayIndex = "Disable",
          },
        },
      },
    }

    -- Add custom keymaps with Snacks integration
    opts.keys = vim.list_extend(opts.keys or {}, {
      -- Snacks picker integration
      {
        "gd",
        function()
          Snacks.picker.lsp_definitions()
        end,
        desc = "Goto Definition",
        has = "definition",
      },
      {
        "gD",
        function()
          Snacks.picker.lsp_declarations()
        end,
        desc = "Goto Declaration",
        has = "declaration",
      },
      {
        "gr",
        function()
          Snacks.picker.lsp_references()
        end,
        desc = "References",
        nowait = true,
        has = "references",
      },
      {
        "gI",
        function()
          Snacks.picker.lsp_implementations()
        end,
        desc = "Goto Implementation",
        has = "implementation",
      },
      {
        "gy",
        function()
          Snacks.picker.lsp_type_definitions()
        end,
        desc = "Goto T[y]pe Definition",
        has = "typeDefinition",
      },
      {
        "gai",
        function()
          Snacks.picker.lsp_incoming_calls()
        end,
        desc = "C[a]lls Incoming",
        has = "callHierarchy/incomingCalls",
      },
      {
        "gao",
        function()
          Snacks.picker.lsp_outgoing_calls()
        end,
        desc = "C[a]lls Outgoing",
        has = "callHierarchy/outgoingCalls",
      },
      -- Snacks symbol navigation
      {
        "<leader>ss",
        function()
          Snacks.picker.lsp_symbols()
        end,
        desc = "Document Symbols",
        has = "documentSymbol",
      },
      {
        "<leader>sS",
        function()
          Snacks.picker.lsp_workspace_symbols()
        end,
        desc = "Workspace Symbols",
        has = "workspaceSymbol",
      },
    })

    return opts
  end,
}

