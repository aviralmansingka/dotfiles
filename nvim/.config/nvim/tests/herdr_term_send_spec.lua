local config_root = vim.fn.getcwd()
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

local term_send = require("plugins.herdr.term_send")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local tmp = vim.fn.tempname()
vim.fn.mkdir(tmp, "p")
local file = tmp .. "/sample.lua"
vim.fn.writefile({ "line one", "line two", "line three" }, file)
vim.cmd("edit " .. vim.fn.fnameescape(file))
local bufnr = vim.api.nvim_get_current_buf()

-- Buffer payload is raw text with no "From neovim buffer" header.
local text = term_send.build_payload(bufnr, false)
assert_eq(text, "line one\nline two\nline three", "buffer payload is raw text with no header")

-- Selection payload is raw selected text with no header.
vim.api.nvim_buf_set_mark(bufnr, "<", 2, 0, {})
vim.api.nvim_buf_set_mark(bufnr, ">", 3, 0, {})
local selection = term_send.build_payload(bufnr, true)
assert_eq(selection, "line two\nline three", "selection payload is raw selected text with no header")

-- Truncation caps the raw body without adding any header note.
local saved_max = term_send.max_bytes
term_send.max_bytes = 10
local truncated = term_send.build_payload(bufnr, false)
assert_eq(#truncated <= 10, true, "raw payload respects the byte cap")
term_send.max_bytes = saved_max

-- term_cwd mirrors LazyVim.root so we target the same terminal as <leader>ft.
assert_eq(type(term_send.resolve_target), "function", "resolve_target is exposed for the Snacks terminal")

print("herdr_term_send_spec: ok")
