return {
  "stevearc/conform.nvim",
  opts = {
    default_format_opts = { timeout_ms = 2000, lsp_format = "never" },
    formatters = {
      -- Normalize Markdown structure, then let markdownlint apply its
      -- conceal-aware visual-width rule.
      prettier = {
        prepend_args = { "--prose-wrap", "never" },
      },
      ["markdownlint-cli2"] = {
        prepend_args = { "--config", vim.fn.expand("~/.markdownlint-cli2.yaml") },
        condition = function()
          return true
        end,
      },
      -- Prefer the project venv's ruff so behavior tracks pyproject ruff
      -- config; falls back to Mason ruff outside a uv project.
      ruff_fix = {
        command = function(_, ctx)
          local r = vim.fs.find(".venv/bin/ruff", {
            upward = true,
            type = "file",
            limit = 1,
            path = ctx.dirname,
          })[1]
          return r or "ruff"
        end,
      },
      ruff_format = {
        command = function(_, ctx)
          local r = vim.fs.find(".venv/bin/ruff", {
            upward = true,
            type = "file",
            limit = 1,
            path = ctx.dirname,
          })[1]
          return r or "ruff"
        end,
      },
    },
    formatters_by_ft = {
      markdown = { "prettier", "markdownlint-cli2" },
      lua = { "stylua" },
      java = { "google-java-format" },
      go = { "goimports", "gofumpt" },
      bzl = { "buildifier" },
      -- Mirrors `inv lint --fix`: ruff check --fix, then ruff format
      python = { "ruff_fix", "ruff_format" },
    },
  },
}
