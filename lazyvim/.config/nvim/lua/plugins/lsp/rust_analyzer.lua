-- Rust Language Server (rust-analyzer) Configuration
return {
  settings = {
    ["rust-analyzer"] = {
      -- Cargo settings
      cargo = {
        allFeatures = true,
        loadOutDirsFromCheck = true,
        buildScripts = {
          enable = true,
        },
      },
      -- Proc macro settings
      procMacro = {
        enable = true,
        ignored = {
          ["async-trait"] = { "async_trait" },
          ["napi-derive"] = { "napi" },
          ["async-recursion"] = { "async_recursion" },
        },
      },
      -- Check settings
      check = {
        command = "clippy", -- Use clippy instead of check for better linting
        features = "all",
      },
      -- Completion settings
      completion = {
        postfix = {
          enable = false, -- Disable postfix completions (can be intrusive)
        },
        privateEditable = {
          enable = true,
        },
      },
      -- Inlay hints settings
      inlayHints = {
        bindingModeHints = {
          enable = false,
        },
        chainingHints = {
          enable = true,
        },
        closingBraceHints = {
          enable = true,
          minLines = 25,
        },
        closureReturnTypeHints = {
          enable = "never",
        },
        lifetimeElisionHints = {
          enable = "never",
          useParameterNames = false,
        },
        maxLength = 25,
        parameterHints = {
          enable = true,
        },
        reborrowHints = {
          enable = "never",
        },
        renderColons = true,
        typeHints = {
          enable = true,
          hideClosureInitialization = false,
          hideNamedConstructor = false,
        },
      },
      -- Lens settings
      lens = {
        enable = true,
        debug = {
          enable = true,
        },
        implementations = {
          enable = true,
        },
        run = {
          enable = true,
        },
        methodReferences = {
          enable = true,
        },
        references = {
          adt = {
            enable = true,
          },
          enumVariant = {
            enable = true,
          },
          method = {
            enable = true,
          },
          trait = {
            enable = true,
          },
        },
      },
      -- Workspace settings
      files = {
        excludeDirs = { ".git", "target", "node_modules" },
      },
      -- Semantic highlighting
      semanticHighlighting = {
        strings = {
          enable = true,
        },
      },
      -- Typing settings
      typing = {
        autoClosingAngleBrackets = {
          enable = false,
        },
      },
    },
  },
}