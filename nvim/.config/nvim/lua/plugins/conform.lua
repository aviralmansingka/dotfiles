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
      prettier = {
        prepend_args = { "--prose-wrap", "always", "--print-width", "120" },
      },
    },
    formatters_by_ft = {
      markdown = { "prettier" },
    },
  },
}
