-- add any tools you want to have installed below
return {
  "mason-org/mason.nvim",
  opts = {
    ensure_installed = {
      "copilot-language-server",
      "lua-language-server",
      "rust-analyzer",
      "stylua",
      "ruff",
      "basedpyright",
      "debugpy",
      "jdtls",
      "java-debug-adapter",
      "java-test",
      "vscode-spring-boot-tools",
      "google-java-format",
      "groovy-language-server",
      "gradle-language-server",
      "starpls",
      "buildifier",

      -- Go (LazyVim lang.go + none-ls / dap); keep explicit so installs don't depend on merge order
      "gopls",
      "goimports",
      "gofumpt",
      "golangci-lint",
      "gomodifytags",
      "impl",
      "delve",
    },
  },
}
