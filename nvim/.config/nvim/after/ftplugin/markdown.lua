-- Markdown: hard-wrap at 99, keep column 100 free. No soft wrap: the save
-- hook rewraps prose at a visible width, so every line already fits the
-- column and a screen wrap would only hide the tail of a table or a diagram.
vim.opt_local.textwidth = 99
vim.opt_local.colorcolumn = "100"
vim.opt_local.wrap = false
vim.opt_local.number = false
vim.opt_local.relativenumber = false
vim.opt_local.formatexpr = "v:lua.require'helpers.markdown_wrap'.formatexpr()"

-- h/l/w/b/e stop on a visible cell instead of a concealed one.
require("helpers.markdown_links").setup()
require("helpers.markdown_motions").setup()

-- Reflow prose on save by rendered width. Link destinations do not count, so a
-- long URL never leaves blank space in a wrapped line. The rule mirrors
-- LazyVim's autoformat switch.
local function autoformat_enabled()
  local buffer = vim.b.autoformat
  if buffer ~= nil then
    return buffer
  end
  return vim.g.autoformat == nil or vim.g.autoformat
end

vim.api.nvim_create_autocmd("BufWritePre", {
  buffer = vim.api.nvim_get_current_buf(),
  group = vim.api.nvim_create_augroup("markdown_visible_wrap", { clear = false }),
  callback = function()
    if autoformat_enabled() then
      require("helpers.markdown_wrap").buffer()
    end
  end,
})
