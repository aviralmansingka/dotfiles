-- add any tools you want to have installed below
return {
  "mason-org/mason.nvim",
  opts = {
    ensure_installed = {
      "lua-language-server",
      "rust-analyzer",
      "stylua",
      "ruff",
      "basedpyright",
      "debugpy",
      "jdtls",
      "java-debug-adapter",
      "vscode-spring-boot-tools",
      "google-java-format",
      "groovy-language-server",
      "gradle-language-server",
      "starpls",
      "buildifier",

      -- C/C++ (LazyVim lang.clangd owns clangd + codelldb; clang-format is the
      -- conform formatter for c/cpp — see lua/plugins/c.lua)
      "clang-format",

      -- Go (LazyVim lang.go + none-ls / dap); keep explicit so installs don't depend on merge order
      "gopls",
      "goimports",
      "gofumpt",
      "golangci-lint",
      "gomodifytags",
      "impl",
      "delve",

      -- Markdown (the in-process visible-width wrap owns prose; markdownlint
      -- checks lines; prettier runs with --prose-wrap preserve. See
      -- after/ftplugin/markdown.lua and lua/plugins/conform.lua)
      "markdownlint-cli2",
      "prettier",
    },
  },
}
