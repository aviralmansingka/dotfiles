return {
  "stevearc/conform.nvim",
  opts = {
    -- S2: Enable format on save for markdown and python
    format_on_save = function(bufnr)
      local ft = vim.bo[bufnr].filetype
      if ft == "markdown" or ft == "python" or ft == "java" then
        return { timeout_ms = 2000, lsp_fallback = false }
      end
      return nil
    end,
    -- format-on-save is wired up by LazyVim's own BufWritePre handler
    -- (lazyvim/util/format.lua). It respects vim.b.autoformat /
    -- vim.g.autoformat so you can toggle with <leader>uf. Don't set
    -- conform's own format_on_save here — LazyVim strips it and warns.
    default_format_opts = { timeout_ms = 2000, lsp_format = "never" },
    formatters = {
      -- Let Prettier handle tables, code blocks, etc. but NOT prose wrapping
      prettier = {
        prepend_args = { "--prose-wrap", "preserve", "--print-width", "120" },
      },
      -- Conceal-aware prose wrapper: treats [text](url) as just "text"
      -- for line-width calculation, so lines wrap at visual width
      markdown_wrap = {
        format = function(self, ctx, lines, callback)
          local ok, wrap = pcall(require, "helpers.markdown_wrap")
          if ok then
            local tw = vim.bo[ctx.buf].textwidth
            if tw <= 0 then
              tw = 120
            end
            callback(nil, wrap.format_lines(lines, tw))
          else
            callback(nil, lines)
          end
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
      -- Prettier first (structure), then our visual-width wrapper (prose)
      markdown = { "prettier", "markdown_wrap" },
      java = { "google-java-format" },
      go = { "golangci-lint" },
      bzl = { "buildifier" },
      -- Mirrors `inv lint --fix`: ruff check --fix, then ruff format
      python = { "ruff_fix", "ruff_format" },
    },
  },
}
