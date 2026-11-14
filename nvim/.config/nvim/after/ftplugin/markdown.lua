-- Markdown: hard-wrap at 99, keep column 100 free. No soft wrap: the save
-- hook rewraps prose at a visible width, so every line already fits the
-- column and a screen wrap would only hide the tail of a table or a diagram.
vim.opt_local.textwidth = 99
vim.opt_local.colorcolumn = "100"
vim.opt_local.wrap = false
vim.opt_local.number = false
vim.opt_local.relativenumber = false
vim.opt_local.formatexpr = "v:lua.require'helpers.markdown_wrap'.formatexpr()"

-- Prose leaves a trailing space on every empty list item (`- `), and the
-- default `trail:-` glyph draws that space as a second dash, so the marker
-- reads as `--` until you type on the line. Mark the cell with a middle dot
-- instead: the space still shows, and no marker ever looks doubled.
vim.opt_local.listchars = vim.tbl_extend("force", vim.opt_local.listchars:get(), { trail = "·" })

-- Insert-mode Tab and Shift-Tab indent and de-indent a list through autolist.
-- Buffer-local on purpose: the plugin config runs once, so a global mapping
-- there would follow every filetype after the first markdown buffer loads.
-- `<cmd>` resolves when the key is pressed, so the order of plugin loading does
-- not matter.
vim.keymap.set("i", "<tab>", "<cmd>AutolistTab<cr>", { buffer = true })
vim.keymap.set("i", "<s-tab>", "<cmd>AutolistShiftTab<cr>", { buffer = true })

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
