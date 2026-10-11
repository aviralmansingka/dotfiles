-- helpers/markdown_links.lua link select / edit / paste (markdown layer).
--
-- The REAL treesitter markdown_inline walk (the parser bundled with nvim,
-- no Mason) drives every case: select inside/around the URL destination,
-- edit through a stubbed vim.ui.input, URL-aware paste through a stubbed
-- register, and the buffer-local keymap wiring for markdown AND octo
-- buffers. A cursor with no link under it must be a no-op.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local links = require("helpers.markdown_links")

local LINK_LINE = "See [docs](https://example.com/a/b) here."

local function md_buf(lines, ft)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = ft or "markdown"
  vim.api.nvim_set_current_buf(buf)
  return buf
end

---Read a selection mark as {lnum, col} (1-based), after leaving visual mode.
local function mark(name)
  local p = vim.fn.getpos(name)
  return { p[2], p[3] }
end

---Run select_url, exit visual, and return the committed '< '> marks.
local function selection_after(around, ft)
  local buf = md_buf({ LINK_LINE }, ft)
  vim.api.nvim_win_set_cursor(0, { 1, 20 }) -- inside the destination
  links.select_url(around)
  local mode = vim.api.nvim_get_mode().mode
  vim.cmd("normal! \27")
  return mode, mark("'<"), mark("'>"), buf
end

local function buf_keymap(buf, lhs, mode)
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(buf, mode)) do
    if m.lhs == lhs then
      return m
    end
  end
  return nil
end

H.run("markdown_links_spec", function()
  -- ── select_url: inside and around, on markdown and octo ─────────────────
  local mode, s, e
  mode, s, e = selection_after(false)
  H.eq(mode, "v", "select_url enters visual mode")
  H.eq(s, { 1, 12 }, "inside: the selection starts at the destination text")
  H.eq(e, { 1, 34 }, "inside: the selection ends at the destination text")

  mode, s, e = selection_after(false, "octo")
  H.eq(s, { 1, 12 }, "octo buffers get the same treesitter link walk")
  H.eq(e, { 1, 34 }, "octo: the destination range is identical")

  _, s, e = selection_after(true)
  H.eq(s, { 1, 11 }, "around: the opening paren joins the selection")
  H.eq(e, { 1, 35 }, "around: the closing paren joins the selection")

  -- ── no link under the cursor: a no-op with a warning ────────────────────
  local buf = md_buf({ LINK_LINE })
  vim.api.nvim_win_set_cursor(0, { 1, 0 }) -- plain text
  local notify_calls, restore_notify = H.capture_notify()
  links.select_url(false)
  H.eq(vim.api.nvim_get_mode().mode, "n", "no link: visual mode is never entered")
  H.eq(vim.api.nvim_win_get_cursor(0), { 1, 0 }, "no link: the cursor does not move")
  H.eq(#notify_calls, 1, "no link: exactly one notice")
  H.eq(notify_calls[1].msg, "No inline link under cursor", "the notice names the miss")
  H.eq(notify_calls[1].level, vim.log.levels.WARN, "the miss is a warning, not an error")
  restore_notify()

  -- ── edit_url: stubbed input replaces only the destination ───────────────
  buf = md_buf({ LINK_LINE })
  vim.api.nvim_win_set_cursor(0, { 1, 20 })
  local input_args
  local restore_input = H.replace(vim.ui, "input", function(opts, on_choice)
    input_args = opts
    on_choice("https://changed.example.com/z")
  end)
  links.edit_url()
  H.eq(input_args.default, "https://example.com/a/b", "edit_url prefills the current URL")
  H.eq(vim.api.nvim_buf_get_lines(buf, 0, -1, false),
    { "See [docs](https://changed.example.com/z) here." },
    "edit_url rewrites only the destination text")

  -- cancelling the prompt keeps the buffer untouched
  vim.api.nvim_win_set_cursor(0, { 1, 20 })
  H.replace(vim.ui, "input", function(_, on_choice)
    on_choice(nil)
  end)
  links.edit_url()
  H.eq(vim.api.nvim_buf_get_lines(buf, 0, -1, false),
    { "See [docs](https://changed.example.com/z) here." },
    "a cancelled edit_url changes nothing")
  restore_input()

  -- ── paste_as_link: a URL register builds the [text](url) form ───────────
  local function paste_case(reg, start_col, visual_cmd)
    local b = md_buf({ "plain selection line" })
    vim.fn.setreg(reg, { "https://paste.example.com/x" }, "v")
    vim.api.nvim_win_set_cursor(0, { 1, start_col })
    vim.cmd("normal! " .. visual_cmd)
    links.paste_as_link("p")
    return b, vim.api.nvim_buf_get_lines(b, 0, -1, false)[1],
      vim.api.nvim_win_get_cursor(0)
  end

  -- select the word "selection" (cols 6..15 0-based) with viw
  local b, line, cur = paste_case('"', 8, "viw")
  local repl = "[selection](https://paste.example.com/x)"
  H.eq(line, "plain " .. repl .. " line",
    "a URL register turns the selection into a markdown link")
  H.eq(cur, { 1, 6 + #repl },
    "the cursor lands after the inserted link text")

  -- the + register is the fallback when the unnamed register is empty.
  -- The clipboard provider is absent under -u NONE, so getreg is stubbed
  -- directly: the module's own empty-to-plus fallback is the unit.
  local restore_getreg = H.replace(vim.fn, "getreg", function(regname)
    if regname == '"' then
      return ""
    end
    return "https://paste.example.com/x"
  end)
  b, line, _ = paste_case('"', 8, "viw")
  H.eq(line, "plain [selection](https://paste.example.com/x) line",
    "an empty unnamed register falls back to the + register")
  restore_getreg()

  -- surrounding whitespace in the register is trimmed before the match
  b = md_buf({ "plain selection line" })
  vim.fn.setreg('"', { "   https://trim.example.com/y   " }, "v")
  vim.api.nvim_win_set_cursor(0, { 1, 8 })
  vim.cmd("normal! viw")
  links.paste_as_link("p")
  H.eq(vim.api.nvim_buf_get_lines(b, 0, -1, false)[1],
    "plain [selection](https://trim.example.com/y) line",
    "register whitespace is trimmed, so the URL still matches")

  -- ── non-URL or multi-line selection: plain paste fallback ───────────────
  local scheduled = {}
  local restore_schedule = H.replace(vim, "schedule", function(fn)
    scheduled[#scheduled + 1] = fn
  end)

  b = md_buf({ "plain selection line" })
  vim.fn.setreg('"', { "not a url" }, "v")
  vim.api.nvim_win_set_cursor(0, { 1, 8 })
  vim.cmd("normal! viw")
  links.paste_as_link("p")
  H.eq(#scheduled, 1, "a non-URL register defers to the plain-paste path")
  H.eq(vim.api.nvim_buf_get_lines(b, 0, -1, false), { "plain selection line" },
    "the URL-aware path never rewrites the buffer itself")

  b = md_buf({ "first line", "second line" })
  vim.fn.setreg('"', { "https://multi.example.com/z" }, "v")
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  vim.cmd("normal! vj")
  links.paste_as_link("p")
  H.eq(#scheduled, 2, "a multi-line selection also defers to plain paste")
  H.eq(vim.api.nvim_buf_get_lines(b, 0, -1, false), { "first line", "second line" },
    "multi-line: the URL-aware path is skipped")

  -- the deferred fallback is the gv re-select paste
  scheduled = {}
  restore_schedule()

  -- ── setup: keymaps + conceal on markdown and octo only ──────────────────
  -- <leader> is recorded expanded in the keymap listing; under -u NONE the
  -- default mapleader is the backslash.
  local leader = vim.g.mapleader or "\\"

  -- an unsupported buffer first: setup must leave it completely alone
  local other = md_buf({ "print('hi')" }, "lua")
  links.setup()
  H.eq(buf_keymap(other, leader .. "mu", "n"), nil, "non-markdown buffers get no keymaps")
  H.eq(vim.wo.conceallevel, 0, "non-markdown buffers keep conceal off")
  H.eq(vim.wo.concealcursor, "", "non-markdown buffers keep the cursor-mode default")

  local md = md_buf({ LINK_LINE })
  links.setup()
  H.truthy(buf_keymap(md, leader .. "mu", "n"), "markdown: <leader>mu edit keymap")
  H.truthy(buf_keymap(md, "iu", "o"), "markdown: iu text-object (operator)")
  H.truthy(buf_keymap(md, "au", "x"), "markdown: au text-object (visual)")
  H.truthy(buf_keymap(md, "p", "x"), "markdown: visual p is URL-aware")
  H.truthy(buf_keymap(md, "P", "x"), "markdown: visual P is URL-aware")
  H.eq(vim.wo.conceallevel, 3, "markdown: link conceal is at level 3")
  H.eq(vim.wo.concealcursor, "nvic", "markdown: links stay concealed under the cursor")

  local octo = md_buf({ LINK_LINE }, "octo")
  links.setup()
  H.truthy(buf_keymap(octo, leader .. "mu", "n"), "octo: <leader>mu edit keymap")
  H.truthy(buf_keymap(octo, "iu", "o"), "octo: iu text-object")
  H.eq(vim.wo.conceallevel, 3, "octo: link conceal is at level 3")
end)
