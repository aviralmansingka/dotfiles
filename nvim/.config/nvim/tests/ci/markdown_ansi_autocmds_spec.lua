-- helpers/markdown_ansi.lua autocmd-layer edges (the SGR parser core —
-- decode/encode/parse semantics — is markdown_ansi_spec.lua's surface).
--
-- This case guards the reload and preservation contracts instead:
--   * setup() + a simulated module reload register the fence/highlight
--     autocmds exactly once (clear=true augroup, no duplicate state);
--   * the ColorScheme autocmd really re-applies the recorded definitions
--     after a colorscheme switch clears user groups;
--   * parsing and concealing never mutates buffer bytes: yank keeps the
--     raw ANSI, byte for byte.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local ansi1 = require("helpers.markdown_ansi")

local ESC = "\27["

local function group_autocmds()
  return vim.api.nvim_get_autocmds({ group = "RenderMarkdownAnsiColors" })
end

local function fg_of(group)
  local fg = vim.api.nvim_get_hl(0, { name = group, link = false }).fg
  return fg and string.format("#%06x", fg) or nil
end

H.run("markdown_ansi_autocmds_spec", function()
  -- ── baseline registration, then a simulated reload ──────────────────────
  ansi1.setup()
  H.eq(#group_autocmds(), 1, "the first setup registers one ColorScheme autocmd")

  -- simulate a config reload: drop the module cache and require it fresh
  package.loaded["helpers.markdown_ansi"] = nil
  local ansi2 = require("helpers.markdown_ansi")
  H.truthy(ansi2 ~= ansi1, "the reload produces a fresh module instance")

  ansi2.setup()
  H.eq(#group_autocmds(), 1,
    "a reload re-registers the autocmd exactly once (clear=true group)")
  H.eq(group_autocmds()[1].event, "ColorScheme",
    "the reload keeps listening to ColorScheme")

  ansi2.setup()
  H.eq(#group_autocmds(), 1, "a second setup on the reloaded module adds nothing")

  -- ── no duplicate highlight state across the reload ──────────────────────
  local input = { ESC .. "31malert" .. ESC .. "0m" }
  local _, hl1 = ansi1.decode(input)
  local name1 = hl1[1].opts.hl_group
  local _, hl2 = ansi2.decode(input)
  H.eq(hl2[1].opts.hl_group, name1,
    "the reloaded instance reuses the same group name, not a growing family")
  H.eq(fg_of(name1), "#800000", "the group still resolves to ANSI red")
  local _, hl2b = ansi2.decode(input)
  H.eq(hl2b[1].opts.hl_group, name1,
    "the reloaded instance dedupes one state to one group (no duplicates)")

  -- ── ColorScheme really re-applies the definitions ───────────────────────
  -- switch colorschemes clear user groups; the autocmd must restore them.
  vim.api.nvim_set_hl(0, name1, {})
  H.eq(fg_of(name1), nil, "sanity: the group is cleared")
  vim.api.nvim_exec_autocmds("ColorScheme", {})
  H.eq(fg_of(name1), "#800000", "the ColorScheme autocmd restores the definition")

  -- put the original module back for any later require in this process
  package.loaded["helpers.markdown_ansi"] = ansi1

  -- ── buffer-byte preservation: yank keeps the raw ANSI ───────────────────
  local raw_fence = ESC .. "31malert" .. ESC .. "0m tail"
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
    "intro",
    "```ansi",
    raw_fence,
    "```",
    "outro",
  })
  vim.bo[buf].filetype = "markdown"
  local before = vim.api.nvim_buf_get_lines(buf, 0, -1, false)

  local parser = vim.treesitter.get_parser(buf, "markdown")
  local root = parser:parse()[1]:root()
  local marks = ansi1.parse({ buf = buf, root = root })
  H.truthy(#marks >= 2, "the ansi fence produces conceal and highlight marks")

  -- parse is pure: a second walk yields the identical marks
  local parser2 = vim.treesitter.get_parser(buf, "markdown")
  local marks2 = ansi1.parse({ buf = buf, root = parser2:parse()[1]:root() })
  H.eq(marks2, marks, "re-parsing does not accumulate or drift mark state")

  -- apply the marks for real, as render-markdown.nvim would
  local mark_ns = vim.api.nvim_create_namespace("test-ansi-marks")
  for _, m in ipairs(marks) do
    vim.api.nvim_buf_set_extmark(buf, mark_ns, m.start_row, m.start_col, m.opts)
  end
  vim.wo.conceallevel = 3

  H.eq(vim.api.nvim_buf_get_lines(buf, 0, -1, false), before,
    "conceal marks never rewrite buffer bytes")

  -- yank the styled fence line: the register must hold the raw ANSI
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  vim.cmd("normal! yy")
  H.eq(vim.fn.getreg('"'), raw_fence .. "\n",
    "yank returns the raw ANSI line, escape bytes included (line-wise)")

  -- and a visual-line yank of the whole fence behaves the same
  vim.cmd("normal! 2GV4Gy")
  H.eq(vim.fn.getreg('"'), table.concat({ "```ansi", raw_fence, "```" }, "\n") .. "\n",
    "a line-wise yank keeps every fence byte")
end)
