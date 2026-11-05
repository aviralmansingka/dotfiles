-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Declare each language's community-canonical indent explicitly instead of
-- relying on LazyVim's implicit per-extra defaults. See lua/config/indent.lua.
require("config.indent")

-- Yank highlight on nvim 0.13.
--
-- LazyVim's TextYankPost handler branches on `has("nvim-0.13")` and then calls
-- `vim.hl.hl_op()`. On the dev builds installed here (0.13.0-dev) `vim.hl`
-- exists but has no `hl_op`, so every yank raised
-- "attempt to call field 'hl_op' (a nil value)" from
-- lazyvim/config/autocmds.lua:22. `vim.hl.on_yank` is present on the same
-- build, so we drop LazyVim's augroup and re-register the event with an
-- API-detected handler. The group is prefixed `lazyvim_` by LazyVim's own
-- augroup() helper; the pcall keeps this inert if that default is ever disabled.
pcall(vim.api.nvim_del_augroup_by_name, "lazyvim_highlight_yank")
vim.api.nvim_create_autocmd("TextYankPost", {
  group = vim.api.nvim_create_augroup("highlight_yank", { clear = true }),
  callback = function()
    local hl = vim.hl or vim.highlight
    if hl.on_yank then
      hl.on_yank()
    else
      hl.hl_op()
    end
  end,
})

