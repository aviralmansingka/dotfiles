local config_root = vim.fn.getcwd()
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

local helper = require("helpers.lazygit")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local function normalize(path)
  return vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
end

local tmp = vim.fn.tempname()
vim.fn.mkdir(tmp, "p")
local file = tmp .. "/file.lua"
vim.fn.writefile({ "return true" }, file)
local invalid_root = tmp .. "/missing"

Snacks = {
  git = {
    get_root = function()
      return invalid_root
    end,
  },
  lazygit = function(opts)
    _G.__lazygit_opts = opts
  end,
}

vim.cmd("edit " .. vim.fn.fnameescape(file))
local edited_dir = normalize(vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ":h"))
local cwd = helper.cwd_for_buffer(0)
assert_eq(cwd, edited_dir, "invalid git root should fall back to the valid buffer directory")

helper.open()
assert_eq(_G.__lazygit_opts.cwd, edited_dir, "lazygit should receive a valid fallback cwd")

vim.cmd("enew!")
vim.api.nvim_buf_set_name(0, invalid_root .. "/ghost.lua")
cwd = helper.cwd_for_buffer(0)
assert_eq(cwd, normalize(config_root), "invalid buffer directory should fall back to Neovim cwd")
