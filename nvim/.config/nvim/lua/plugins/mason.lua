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
      "pyright",
      "jdtls",
      "java-debug-adapter",
      "java-test",
      "vscode-spring-boot-tools",
      "google-java-format",
      "groovy-language-server",
      "starpls",
      "buildifier",
    },
  },
}
