-- Prettier formats everything it can parse. Markdown is the exception: it
-- keeps the prose line breaks it has, so helpers.markdown_wrap owns width.
local prettier_fts = {
  "css",
  "graphql",
  "handlebars",
  "html",
  "javascript",
  "javascriptreact",
  "json",
  "jsonc",
  "less",
  "markdown",
  "markdown.mdx",
  "scss",
  "typescript",
  "typescriptreact",
  "vue",
  "yaml",
}

local by_ft = {
  lua = { "stylua" },
  java = { "google-java-format" },
  go = { "goimports", "gofumpt" },
  bzl = { "buildifier" },
  -- Mirrors `inv lint --fix`: ruff check --fix, then ruff format
  python = { "ruff_fix", "ruff_format" },
}
for _, ft in ipairs(prettier_fts) do
  by_ft[ft] = { "prettier" }
end

--- Prefer the project venv's ruff so behavior tracks pyproject ruff config;
--- falls back to Mason ruff outside a uv project.
local function ruff_command(_, ctx)
  local found = vim.fs.find(".venv/bin/ruff", {
    upward = true,
    type = "file",
    limit = 1,
    path = ctx.dirname,
  })[1]
  return found or "ruff"
end

return {
  "stevearc/conform.nvim",
  opts = {
    default_format_opts = { timeout_ms = 2000, lsp_format = "never" },
    formatters_by_ft = by_ft,
    formatters = {
      ["markdownlint-cli2"] = {
        prepend_args = { "--config", vim.fn.expand("~/.markdownlint-cli2.yaml") },
        condition = function()
          return true
        end,
      },
      prettier = {
        prepend_args = { "--prose-wrap", "preserve" },
      },
      ruff_fix = { command = ruff_command },
      ruff_format = { command = ruff_command },
    },
  },
}
