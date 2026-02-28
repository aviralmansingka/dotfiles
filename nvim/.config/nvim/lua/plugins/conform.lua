return {
  "stevearc/conform.nvim",
  opts = {
    -- S2: Enable format on save for markdown
    format_on_save = function(bufnr)
      local ft = vim.bo[bufnr].filetype
      if ft == "markdown" then
        return { timeout_ms = 2000, lsp_fallback = false }
      end
      return nil
    end,
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
    },
    formatters_by_ft = {
      -- Prettier first (structure), then our visual-width wrapper (prose)
      markdown = { "prettier", "markdown_wrap" },
    },
  },
}
