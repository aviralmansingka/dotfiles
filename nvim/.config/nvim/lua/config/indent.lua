-- Explicit per-filetype indent stance.
--
-- LazyVim ships a global 2-space default and lets extras (go, python, rust)
-- set their language norms. Without this file the stance is entirely
-- implicit: a LazyVim upgrade or a dropped .clang-format could silently
-- break the C editor<->formatter agreement. This declares each language's
-- community-canonical indent in one owned place so the stance is deliberate
-- and durable.
--
-- smartindent / autoindent / shiftround are left to LazyVim's global
-- defaults (options.lua does not override them) and are intentionally NOT
-- re-set here -- re-setting could regress a future LazyVim improvement.
--
-- Filetypes not listed below keep LazyVim's default unchanged: we do not
-- impose a stance where the captain did not name one.
--
-- C editor<->formatter agreement: the editor is 2-space here; clang-format
-- on save (lua/plugins/c.lua via conform) uses the nearest project
-- .clang-format, falling back to clang-format's built-in LLVM (2-space)
-- default, which matches clangd --fallback-style=llvm. The two agree at the
-- default level; a project that ships its own .clang-format owns its style
-- by design -- no global .clang-format is imposed here.
--
-- Sourced from lua/config/autocmds.lua.

--- Community-canonical indent per filetype.
--- expandtab = true  -> spaces; false -> literal tabs.
local INDENT = {
  c = { expandtab = true, shiftwidth = 2, tabstop = 2 }, -- LLVM / clang-format default
  cpp = { expandtab = true, shiftwidth = 2, tabstop = 2 },
  objc = { expandtab = true, shiftwidth = 2, tabstop = 2 },
  objcpp = { expandtab = true, shiftwidth = 2, tabstop = 2 },
  python = { expandtab = true, shiftwidth = 4, tabstop = 4 }, -- PEP 8
  go = { expandtab = false, shiftwidth = 4, tabstop = 4 }, -- gofmt enforces tabs
  rust = { expandtab = true, shiftwidth = 4, tabstop = 4 }, -- rustfmt default
  lua = { expandtab = true, shiftwidth = 2, tabstop = 2 }, -- StyLua default; matches LazyVim
}

local group = vim.api.nvim_create_augroup("IndentStance", { clear = true })

vim.api.nvim_create_autocmd("FileType", {
  group = group,
  pattern = vim.tbl_keys(INDENT),
  callback = function(args)
    local stance = INDENT[args.match]
    local bo = vim.bo[args.buf]
    bo.expandtab = stance.expandtab
    bo.shiftwidth = stance.shiftwidth
    bo.tabstop = stance.tabstop
  end,
  desc = "Declare community-canonical indent for configured filetypes.",
})
