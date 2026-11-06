-- helpers/markdown_motions.lua: h/l/w/b/e across concealed Markdown syntax.
--
-- Two conceal layers are exercised headless: the treesitter highlighter (real
-- `#set! conceal ""` captures from the parser bundled with nvim, started with
-- vim.treesitter.start) and renderer extmarks (the `conceal = ""` marks
-- render-markdown draws over wiki-link brackets and a hidden destination).
-- Forward and backward crossings, counts, multiword labels, UTF-8 byte
-- columns, and the native fallbacks (conceal off, no highlighter, other
-- buffers) are all asserted. Operator-pending stays native and `.` keeps
-- repeating the last change.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local motions = require("helpers.markdown_motions")

local LINK = "See [Some long label](https://example.com/a/b) here."
local WIKI = "and [[3_logs/backlog|Weekly Note]] now."
local UTF8 = "héllo [wörld](https://ü.example) ok"

local render_ns = vim.api.nvim_create_namespace("render-markdown-test")

--- A markdown buffer with treesitter conceal running, like a real session.
local function md_buf(lines)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = "markdown"
  vim.api.nvim_set_current_buf(buf)
  vim.wo.conceallevel = 3
  vim.wo.concealcursor = "nvic"
  vim.treesitter.start(buf, "markdown")
  return buf
end

--- The extmarks render-markdown puts on a `[[path|alias]]` shortcut link.
local function conceal_wiki(buf, row, line)
  local open = line:find("%[%[", 1, false) -- 1-based
  local pipe = line:find("|", 1, true)
  local close = line:find("%]%]", 1, false)
  -- "[["
  vim.api.nvim_buf_set_extmark(buf, render_ns, row, open - 1, { end_col = open + 1, conceal = "" })
  -- hidden destination plus its "|"
  vim.api.nvim_buf_set_extmark(buf, render_ns, row, open + 1, { end_col = pipe, conceal = "" })
  -- "]]"
  vim.api.nvim_buf_set_extmark(buf, render_ns, row, close - 1, { end_col = close + 1, conceal = "" })
end

local function hidden_of(buf, row)
  return motions.hidden(buf, row)
end

local function set(row, col)
  vim.api.nvim_win_set_cursor(0, { row, col })
end

--- Run one motion from `row:col` and return the landing column.
local function from(row, col, motion, count)
  set(row, col)
  motions.move(motion, count or 1)
  return vim.api.nvim_win_get_cursor(0)[2]
end

H.run("markdown_motions_spec", function()
  -- ── what the conceal layers hide ────────────────────────────────────────
  local buf = md_buf({ LINK, WIKI, UTF8 })
  conceal_wiki(buf, 1, WIKI)

  local hidden = hidden_of(buf, 0)
  H.eq(hidden[4], true, "the opening bracket is concealed")
  H.eq(hidden[20], true, "the closing bracket is concealed")
  H.eq(hidden[21], true, "the opening paren is concealed")
  H.eq(hidden[22], true, "the destination start is concealed")
  H.eq(hidden[44], true, "the destination end is concealed")
  H.eq(hidden[45], true, "the closing paren is concealed")
  for col = 5, 19 do
    H.eq(hidden[col], nil, "the link title stays visible (col " .. col .. ")")
  end

  local wiki = hidden_of(buf, 1)
  H.eq({ wiki[4], wiki[5] }, { true, true }, "the wiki double bracket is concealed")
  H.eq(wiki[6], true, "the wiki destination is concealed")
  H.eq(wiki[20], true, "the wiki pipe is concealed")
  H.eq({ wiki[32], wiki[33] }, { true, true }, "the closing wiki bracket is concealed")
  for col = 21, 31 do
    H.eq(wiki[col], nil, "the wiki alias stays visible (col " .. col .. ")")
  end

  -- ── w: forward across the hidden destination ────────────────────────────
  H.eq(from(1, 0, "w"), 5, "w stops on the link title, not on the concealed [")
  H.eq(from(1, 0, "w", 2), 10, "2w reaches the second title word")
  H.eq(from(1, 0, "w", 3), 15, "3w reaches the third title word")
  H.eq(from(1, 0, "w", 4), 47, "4w crosses the hidden destination to the next word")
  H.eq(from(1, 0, "w", 5), 51, "5w lands on the final punctuation")

  -- ── b/e: backward and forward word ends ─────────────────────────────────
  H.eq(from(1, 51, "b"), 47, "b steps to the previous word start")
  H.eq(from(1, 51, "b", 2), 15, "2b crosses the hidden destination backwards")
  H.eq(from(1, 0, "e"), 2, "e lands on the first word end")
  H.eq(from(1, 0, "e", 2), 8, "2e lands on a title word end")
  H.eq(from(1, 0, "e", 3), 13, "3e lands on the next title word end")
  H.eq(from(1, 0, "e", 4), 19, "4e ends the title")
  H.eq(from(1, 0, "e", 5), 50, "5e skips the hidden destination to the next word end")

  -- ── h/l: character steps inside one line ────────────────────────────────
  H.eq(from(1, 4, "l"), 5, "l leaves the concealed bracket for the title")
  H.eq(from(1, 45, "h"), 19, "h leaves the concealed paren for the title end")
  H.eq(from(1, 3, "l"), 5, "l skips a hidden bracket run of one cell")
  H.eq(from(1, 20, "l"), 46, "l stops on the first visible cell after the hidden destination")

  -- ── renderer extmarks: wiki-link brackets and destination ───────────────
  H.eq(from(2, 0, "w"), 21, "w skips [[ and the hidden destination to the alias")
  H.eq(from(2, 0, "w", 2), 28, "2w reaches the second alias word")
  H.eq(from(2, 0, "w", 3), 35, "3w crosses the closing bracket to the next word")
  H.eq(from(2, 0, "e", 2), 26, "2e ends the first alias word")
  H.eq(from(2, 38, "b"), 35, "b lands on the last visible word")
  H.eq(from(2, 38, "b", 2), 28, "2b reaches the second alias word")
  H.eq(from(2, 38, "b", 3), 21, "3b reaches the alias start")
  H.eq(from(2, 38, "b", 4), 0, "4b crosses the hidden destination backwards")

  -- ── UTF-8: byte columns, multi-byte labels ──────────────────────────────
  H.eq(from(3, 0, "w"), 8, "w lands on the multi-byte title start")
  H.eq(from(3, 0, "w", 2), 36, "2w crosses a multi-byte destination")
  H.eq(from(3, 0, "e", 2), 13, "2e ends the multi-byte title")
  H.eq(from(3, 7, "l"), 8, "l leaves the concealed bracket for the title")
  H.eq(from(3, 36, "h", 2), 13, "2h crosses the multi-byte destination backwards")

  -- ── native fallbacks ────────────────────────────────────────────────────
  vim.wo.conceallevel = 0
  H.eq(from(1, 0, "w"), 4, "conceallevel=0 keeps the native w")
  vim.wo.conceallevel = 3
  vim.wo.concealcursor = "vic"
  H.eq(from(1, 0, "w"), 4, "no 'n' in concealcursor keeps the native w")
  vim.wo.concealcursor = "nvic"

  -- a stopped highlighter draws no query conceal, so the buffer is raw again
  vim.treesitter.stop(buf)
  H.eq(from(1, 0, "w"), 4, "without the highlighter w is native")
  H.eq(hidden_of(buf, 0)[4], nil, "no highlighter: the query conceal is not drawn")

  -- ── other buffers keep native motions and no buffer-local maps ──────────
  local plain = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(plain, 0, -1, false, { LINK })
  vim.bo[plain].filetype = "text"
  vim.api.nvim_set_current_buf(plain)
  vim.wo.conceallevel = 3
  H.eq(from(1, 0, "w"), 4, "a text buffer keeps the native w")
  H.eq(#vim.api.nvim_buf_get_keymap(plain, "n"), 0, "a text buffer gets no markdown motion maps")

  -- ── wiring: normal mode only ─────────────────────────────────────────────
  buf = md_buf({ LINK })
  vim.wo.conceallevel = 3
  vim.wo.concealcursor = "nvic"
  vim.treesitter.start(buf, "markdown")
  motions.setup()

  local mapped = {}
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(buf, "n")) do
    mapped[m.lhs] = true
  end
  for _, key in ipairs({ "h", "l", "w", "b", "e" }) do
    H.eq(mapped[key], true, "normal mode maps " .. key)
  end
  H.eq(#vim.api.nvim_buf_get_keymap(buf, "x"), 0, "visual mode keeps its motions")
  H.eq(#vim.api.nvim_buf_get_keymap(buf, "o"), 0, "operator-pending keeps its motions")

  -- real keypresses reach the mapping, and the count survives it
  set(1, 0)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("3w", true, false, true), "x", false)
  H.eq(vim.api.nvim_win_get_cursor(0)[2], 15, "3w skips the concealed bracket and lands on the third title word")
  set(1, 0)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("4l", true, false, true), "x", false)
  H.eq(vim.api.nvim_win_get_cursor(0)[2], 5, "4l steps over the concealed bracket onto the title")

  -- operator-pending still uses the native motion range
  set(1, 0)
  vim.cmd("normal! dw")
  H.eq(vim.api.nvim_get_current_line(), "[Some long label](https://example.com/a/b) here.",
    "dw keeps the native word boundary (the concealed bracket stays in the buffer)")

  -- dot-repeat still repeats the change, not the motion
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "abcdef chain" })
  set(1, 0)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("xl.", true, false, true), "x", false)
  H.eq(vim.api.nvim_get_current_line(), "bdef chain", "`.` repeats x, never the motion")
end)
