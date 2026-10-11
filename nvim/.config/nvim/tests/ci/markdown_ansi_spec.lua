-- helpers/markdown_ansi.lua SGR parser regression case (CI row X11, #99).
--
-- The parser is exercised end-to-end through the real module: M.decode turns
-- SGR bytes into plain text + highlight spans, and M.encode serializes them
-- back. Malformed parameter lists must be rejected atomically: the escape
-- bytes stay in the buffer and the active style is unchanged. M.parse runs
-- against a real (bundled) markdown treesitter parser.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local ansi = require("helpers.markdown_ansi")

local ESC = "\27["

local function hl_of(group)
  local attrs = vim.api.nvim_get_hl(0, { name = group, link = false })
  -- nvim_get_hl reports colors as integers; normalize to #rrggbb strings.
  for _, key in ipairs({ "fg", "bg", "sp" }) do
    if type(attrs[key]) == "number" then
      attrs[key] = string.format("#%06x", attrs[key])
    end
  end
  return attrs
end

H.run("markdown_ansi_spec", function()
  -- ── decode: classic, 256-color, truecolor ───────────────────────────────
  local plain, hl = ansi.decode({ ESC .. "31mred" .. ESC .. "0m plain" })
  H.eq(plain, { "red plain" }, "classic SGR: escape bytes removed from plain text")
  H.eq(#hl, 1, "one highlight span covers the styled text")
  local red = hl_of(hl[1].opts.hl_group)
  H.eq(red.fg, "#800000", "classic color 1 resolves to the ANSI red hex")
  H.eq(red.ctermfg, 1, "cterm index preserved for classic colors")

  plain, hl = ansi.decode({ ESC .. "38;5;196mX" .. ESC .. "0m" })
  H.eq(plain, { "X" }, "256-color SGR decodes")
  local idx = hl_of(hl[1].opts.hl_group)
  H.eq(idx.ctermfg, 196, "256-color keeps its palette index")
  H.eq(idx.fg, "#ff0000", "256-color 196 maps to the 6x6x6 cube hex")

  plain, hl = ansi.decode({ ESC .. "38;2;255;100;0mX" .. ESC .. "0m" })
  H.eq(plain, { "X" }, "truecolor SGR decodes")
  H.eq(hl_of(hl[1].opts.hl_group).fg, "#ff6400", "truecolor RGB survives exactly")

  -- background + bright variants
  plain, hl = ansi.decode({ ESC .. "48;5;17m" .. "bg" .. ESC .. "0m" })
  H.eq(hl_of(hl[1].opts.hl_group).ctermbg, 17, "48;5 sets the background index")
  plain, hl = ansi.decode({ ESC .. "92mbright" .. ESC .. "0m" })
  H.eq(hl_of(hl[1].opts.hl_group).ctermfg, 10, "bright foreground 92 maps to index 8+2")

  -- ── style flags and resets ──────────────────────────────────────────────
  plain, hl = ansi.decode({ ESC .. "1;3mA" .. ESC .. "22mB" .. ESC .. "0m" })
  H.eq(plain, { "AB" }, "style flags are concealed like colors")
  H.eq(#hl, 2, "A and B get separate spans")
  local bold_italic = hl_of(hl[1].opts.hl_group)
  H.eq(bold_italic.bold, true, "SGR 1 sets bold")
  H.eq(bold_italic.italic, true, "SGR 3 sets italic")
  local italic_only = hl_of(hl[2].opts.hl_group)
  H.eq(italic_only.bold, nil, "SGR 22 clears bold only")
  H.eq(italic_only.italic, true, "SGR 22 keeps italic")

  -- style reset by 0: no span for unstyled trailing text
  plain, hl = ansi.decode({ "a" .. ESC .. "31mred" .. ESC .. "0m" .. "b" })
  H.eq(plain, { "aredb" }, "reset ends the styled span")
  H.eq(#hl, 1, "text after the reset carries no span")

  -- 39/49 clear fg/bg
  plain, hl = ansi.decode({ ESC .. "31;1mred" .. ESC .. "39mgray" })
  local cleared = hl_of(hl[2].opts.hl_group)
  H.eq(cleared.fg, nil, "SGR 39 clears the foreground")
  H.eq(cleared.bold, true, "SGR 39 keeps other attributes")

  -- state persists across lines (terminal semantics)
  plain, hl = ansi.decode({ ESC .. "31mred", "still styled" })
  H.eq(plain, { "red", "still styled" }, "multi-line decode keeps every line")
  H.eq(#hl, 2, "unclosed style carries into the next line")
  H.eq(hl[1].opts.hl_group, hl[2].opts.hl_group, "the same state reuses one group")

  -- ── malformed parameters: rejected atomically, bytes unchanged ─────────
  local malformed = {
    [ESC .. "1;;3mA"] = "empty parameter",
    [ESC .. ";31mA"] = "leading separator",
    [ESC .. "31;mA"] = "trailing separator",
    [ESC .. "3a1mA"] = "non-digit parameter",
  }
  for input, label in pairs(malformed) do
    local p, h = ansi.decode({ input })
    H.eq(p, { input }, label .. ": escape bytes stay in the plain text")
    H.eq(#h, 0, label .. ": no highlight or conceal span is produced")
  end

  -- rejection leaves the active style running for later text
  local p, h = ansi.decode({ ESC .. "31mok" .. ESC .. "1;;3m" .. "still-red" })
  H.eq(p, { "ok" .. ESC .. "1;;3m" .. "still-red" }, "malformed SGR keeps its bytes inline")
  H.eq(hl_of(h[2].opts.hl_group).fg, "#800000",
    "text after a malformed SGR keeps the previously active color")

  -- valid sequences around a rejected one still parse; the rejected bytes
  -- themselves render as styled text under the still-active state
  local p2, h2 = ansi.decode({ ESC .. "1m" .. "b" .. ESC .. "0;99m" .. "x" })
  H.eq(p2, { "b" .. ESC .. "0;99m" .. "x" }, "an unknown-but-well-formed code (99) is rejected atomically too")
  H.eq(#h2, 3, "b, the rejected bytes, and x all keep the active style")

  -- ── decode -> encode round trip ─────────────────────────────────────────
  local src = {
    ESC .. "1;38;2;10;20;30mstyled" .. ESC .. "0m tail",
    ESC .. "38;5;99midx" .. ESC .. "39m plain",
  }
  local p1, h1 = ansi.decode(src)
  local encoded = ansi.encode(p1, h1)
  H.eq(#encoded, #p1, "encode yields one line per input line")
  local p_rt, h_rt = ansi.decode(encoded)
  H.eq(p_rt, p1, "round trip: plain text is stable")
  H.eq(#h_rt, #h1, "round trip: span count is stable")
  H.eq(hl_of(h_rt[1].opts.hl_group).fg, "#0a141e", "round trip: truecolor survives re-encoding")

  -- ── M.parse on a real markdown treesitter tree ──────────────────────────
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
    "intro line",
    "```ansi",
    ESC .. "31malert" .. ESC .. "0m",
    "```",
    "outro",
  })
  vim.bo[buf].filetype = "markdown"
  local parser = vim.treesitter.get_parser(buf, "markdown")
  local root = parser:parse()[1]:root()
  local marks = ansi.parse({ buf = buf, root = root })
  H.truthy(#marks >= 2, "parse emits conceal marks for SGR bytes and a span for styled text")
  local conceal = vim.tbl_filter(function(m)
    return m.opts.conceal == ""
  end, marks)
  H.eq(#conceal, 2, "both SGR sequences are concealed")
  H.eq(conceal[1].start_row, 2, "conceal mark anchors inside the ansi fence")
  -- hl marks carry conceal=false at the top level; conceal marks carry
  -- conceal="" inside opts (the shape markdown_ansi.decode relies on)
  local span = vim.tbl_filter(function(m)
    return m.conceal == false and m.opts.hl_group ~= nil
  end, marks)
  H.truthy(#span >= 1, "the styled text gets a highlight mark")
  H.eq(span[1].opts.hl_group, hl_of(span[1].opts.hl_group) and span[1].opts.hl_group, "span references a real highlight group")

  -- non-markdown buffers are ignored
  vim.bo[buf].filetype = "lua"
  H.eq(ansi.parse({ buf = buf, root = root }), {}, "parse is a no-op outside markdown buffers")
  vim.bo[buf].filetype = "markdown"

  -- ── M.setup registers the ColorScheme re-apply autocmd ──────────────────
  ansi.setup()
  local autocmds = vim.api.nvim_get_autocmds({ group = "RenderMarkdownAnsiColors" })
  H.eq(#autocmds, 1, "setup installs exactly one ColorScheme autocmd")
  H.eq(autocmds[1].event, "ColorScheme", "the autocmd re-applies groups on colorscheme switch")
  ansi.setup()
  H.eq(#vim.api.nvim_get_autocmds({ group = "RenderMarkdownAnsiColors" }), 1,
    "setup is idempotent (clear=true augroup, one autocmd)")
end)
