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

-- Reload a buffer whose file changed outside Neovim.
--
-- 'autoread' on its own never fires: Neovim only runs :checktime on a few
-- internal events, so a pane left open keeps stale text until a manual :e.
-- Check the timestamps where an outside change can show up instead: regaining
-- terminal focus (tab switches, tmux attach, mosh), entering a buffer, idling,
-- leaving terminal mode, and after a :write of another buffer.
--
-- A buffer with local edits is never reloaded: those edits win, and Neovim's
-- own "changed on disk" warning still covers the manual :e path. The reload
-- keeps the cursor, the window view, the alternate file and the jumplist where
-- they were. It drops that buffer's undo history and folds, and it does not
-- re-run buffer setup hooks (:e! under noautocmd): the filetype, syntax and
-- attached LSP client of a reloaded buffer stay what they were.
vim.opt.autoread = true

local on_disk = vim.api.nvim_create_augroup("autoread_changed_on_disk", { clear = true })

-- Timestamp, in nanoseconds, of the version loaded in each buffer. Whole
-- seconds are too coarse: two writes inside one second would compare equal and
-- the second change would never reload.
local loaded_at = {}

local function file_mtime(path)
  local stat = vim.uv.fs_stat(path)
  if not stat then
    return nil
  end
  return stat.mtime.sec * 1000000000 + (stat.mtime.nsec or 0)
end

local function insert_mode()
  return vim.api.nvim_get_mode().mode:sub(1, 1) == "i"
end

-- A reload hides a pending command-line window, splits the undo block of a
-- running insert, and makes a replayed macro act on a buffer it was not
-- recorded against, so those three states are left alone.
local function reload_blocked()
  if vim.fn.getcmdwintype() ~= "" then
    return true
  end
  return vim.fn.reg_recording() ~= "" or vim.fn.reg_executing() ~= ""
end

--- Reload one buffer when its file is newer than the loaded version.
--- @param buf integer
--- @return boolean reloaded
local function reload_if_changed(buf)
  if not vim.api.nvim_buf_is_loaded(buf) then
    return false
  end
  -- terminal, help, prompt, quickfix and nofile buffers have no file to read
  if vim.bo[buf].buftype ~= "" then
    return false
  end
  -- local edits win over the disk copy
  if vim.bo[buf].modified then
    return false
  end
  local name = vim.api.nvim_buf_get_name(buf)
  if name == "" then
    return false
  end
  local mtime = file_mtime(name)
  if mtime == nil then
    -- Deleted or moved outside Neovim: keep the text and stop watching. A
    -- :write of this buffer recreates the file and re-arms the check.
    loaded_at[buf] = nil
    return false
  end
  if mtime == loaded_at[buf] then
    return false
  end
  if loaded_at[buf] == nil then
    loaded_at[buf] = mtime -- first sight, nothing to compare against yet
    return false
  end
  vim.api.nvim_buf_call(buf, function()
    vim.cmd("silent! noautocmd keepalt keepjumps edit!")
  end)
  loaded_at[buf] = file_mtime(name)
  return true
end

--- Check one buffer, unless it is the buffer under an unfinished insert.
local function check(buf)
  if reload_blocked() then
    return
  end
  -- Reloading the buffer being inserted into would move text beneath the
  -- cursor; every other buffer is safe to refresh.
  if insert_mode() and buf == vim.api.nvim_get_current_buf() then
    return
  end
  if reload_if_changed(buf) then
    vim.notify(
      "Reloaded " .. vim.fn.fnamemodify(vim.api.nvim_buf_get_name(buf), ":~:.") .. " (changed on disk)",
      vim.log.levels.INFO
    )
  end
end

--- Check every loaded buffer except `skip`: the buffer just written, or the
--- buffer being typed into.
local function check_all(skip)
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if buf ~= skip then
      check(buf)
    end
  end
end

-- The events that can reveal an outside change.
vim.api.nvim_create_autocmd({ "FocusGained", "TermLeave" }, {
  group = on_disk,
  callback = function()
    check_all()
  end,
})

vim.api.nvim_create_autocmd("BufEnter", {
  group = on_disk,
  callback = function(args)
    check(args.buf)
  end,
})

vim.api.nvim_create_autocmd("CursorHold", {
  group = on_disk,
  callback = function(args)
    check(args.buf)
  end,
})

-- Idling in insert mode: the current buffer is skipped by check(), so this
-- refreshes the other windows without disturbing the pending insert.
vim.api.nvim_create_autocmd("CursorHoldI", {
  group = on_disk,
  callback = function(args)
    check_all(args.buf)
  end,
})

-- A :write of one buffer is a cheap moment to look at the others.
vim.api.nvim_create_autocmd("BufWritePost", {
  group = on_disk,
  callback = function(args)
    check_all(args.buf)
  end,
})

-- Record the version a buffer holds after every read and write.
vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost" }, {
  group = on_disk,
  callback = function(args)
    local name = vim.api.nvim_buf_get_name(args.buf)
    loaded_at[args.buf] = (name ~= "" and file_mtime(name)) or nil
  end,
})

vim.api.nvim_create_autocmd({ "BufDelete", "BufWipeout" }, {
  group = on_disk,
  callback = function(args)
    loaded_at[args.buf] = nil
  end,
})

-- LazyVim turns 'wrap' and 'spell' on for markdown. Markdown prose is
-- hard-wrapped on save (after/ftplugin/markdown.lua), so the soft wrap only
-- hides the tail of a table or a diagram. This autocmd registers after
-- LazyVim's lazyvim_wrap_spell, so it runs last and wins. Spell stays on.
vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("markdown_no_soft_wrap", { clear = true }),
  pattern = "markdown",
  callback = function()
    vim.wo.wrap = false
  end,
})
