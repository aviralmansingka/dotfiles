-- Octo buffers hold review threads and diffs. Wrap stays off because the
-- conceal/wrap interaction leaves phantom whitespace when a long URL is in
-- the buffer.
vim.opt_local.textwidth = 120
vim.opt_local.formatexpr = ""
vim.opt_local.wrap = false

require("helpers.markdown_links").setup()
