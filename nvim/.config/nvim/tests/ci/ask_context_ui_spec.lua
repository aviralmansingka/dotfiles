-- sidekick/ask/context.lua + ui.lua offline spec.
--
-- context: the pure prompt builders run for real; M.build runs against
-- scratch buffers with nvim's BUNDLED lua parser (works under -u NONE) —
-- the textobjects query is absent offline, so the whole-buffer fallback and
-- its notify-once behavior are the asserted paths. LSP hover is faked at
-- the vim.lsp.buf_request_sync boundary so symbol enrichment is exercised
-- without a live client.
--
-- ui: shape-offline parts only — hover_lines (via upvalue), the
-- render_diff_inline / clear_diff_inline extmark pair, and no-op safety of
-- close_hover / clear_diff_inline. open_prompt itself needs a live float
-- (class C): documented as no-test in docs/ci-tests/nvim-ask.md.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local context = require("plugins.sidekick.ask.context")
local ui = require("plugins.sidekick.ask.ui")

local function fresh_buffer(lines, filetype)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  if filetype then
    vim.bo[buf].filetype = filetype
  end
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  return buf
end

H.run("ask_context_ui_spec", function()
  -- ══ render_symbols_block ═════════════════════════════════════════════
  H.eq(context.render_symbols_block({}), "", "no symbols renders an empty block")
  H.eq(context.render_symbols_block({ { name = "foo", hover = "foo is a var" } }),
    "foo\n\nfoo:\nfoo is a var\n", "one symbol renders name list plus hover")
  H.eq(context.render_symbols_block({
    { name = "foo", hover = "foo is a var" },
    { name = "bar", hover = "bar is a fn" },
  }), "foo, bar\n\nfoo:\nfoo is a var\n\nbar:\nbar is a fn\n",
    "symbols render as a comma-separated name list then each hover")

  -- ══ render_prompt (pure assembly) ════════════════════════════════════
  local plain = context.render_prompt("why?", { code = "local x = 1", symbols = {} })
  H.eq(plain, "answer the question: why?\n\nwith code:\nlocal x = 1\n\nKeep the answer to 2-4 sentences at most.",
    "prompt without symbols has the exact shape")
  local with_syms = context.render_prompt("why?", {
    code = "local x = 1",
    symbols = { { name = "x", hover = "x is a number" } },
  })
  H.eq(with_syms,
    "answer the question: why?\n\nwith code:\nlocal x = 1\n\nsymbols:\nx\n\nx:\nx is a number\n\n\nKeep the answer to 2-4 sentences at most.",
    "prompt with symbols embeds the symbols block")

  -- ══ line_numbered (upvalue: the numbering format) ════════════════════
  local line_numbered = H.upvalue(context.render_edit_prompt, "line_numbered")
  H.eq(line_numbered("a\nb", 0), " 1 │a\n 2 │b",
    "numbering right-aligns to width 2 and the │ separator glues the content")
  H.eq(line_numbered("a\nb\nc", 9), "10 │a\n11 │b\n12 │c",
    "numbering continues from the 0-based start line")
  H.eq(line_numbered("  indented", 0), " 1 │  indented",
    "indentation after │ is content, not a separator gap")

  -- ══ render_edit_prompt (pure assembly) ═══════════════════════════════
  local p = context.render_edit_prompt("make it short",
    { code = "a\nb\nc", symbols = {}, start_line = 0, end_line = 2 }, "f.lua")
  H.truthy(p:find("file: f.lua", 1, true), "edit prompt names the file")
  H.truthy(p:find("lines to edit: 1-3  (3 lines", 1, true), "edit prompt states the 1-based line span")
  H.truthy(p:find("1 │a", 1, true) and p:find("2 │b", 1, true) and p:find("3 │c", 1, true),
    "edit prompt embeds the numbered snippet")
  H.truthy(p:find("@@ -1,3 +1,M @@", 1, true), "edit prompt teaches the hunk header format")
  H.truthy(not p:find("symbols (for reference", 1, true), "no symbols block without symbols")
  local p2 = context.render_edit_prompt("make it short",
    { code = "a", symbols = { { name = "a", hover = "a is a var" } }, start_line = 4, end_line = 4 }, "f.lua")
  H.truthy(p2:find("5 │a", 1, true), "snippet numbering follows start_line")
  H.truthy(p2:find("lines to edit: 5-5", 1, true), "single-line span is stated")
  H.truthy(p2:find("symbols (for reference", 1, true), "symbols block is appended when present")

  -- ══ M.build: visual selection (pure path) ════════════════════════════
  local vbuf = fresh_buffer({ "alpha", "beta", "gamma", "delta" })
  local vctx = context.build({ mode = "visual", bufnr = vbuf, range = { start_line = 1, end_line = 2 } })
  H.eq(vctx.code, "beta\ngamma", "visual scope carries only the selected lines")
  H.eq(vctx.scope_kind, "selection", "visual scope is a selection")
  H.eq(vctx.start_line, 1, "selection start is the 0-based range start")
  H.eq(vctx.end_line, 2, "selection end is the 0-based range end")
  H.eq(vctx.symbols, {}, "no parser means no symbols")

  -- ══ M.build: normal-mode fallbacks + notify-once ═════════════════════
  local notify_calls, restore_notify = H.capture_notify()

  -- lua filetype: nvim's bundled parser loads, but the textobjects query
  -- is absent offline, so the whole-buffer fallback fires.
  local lbuf = fresh_buffer({ "local x = 1", "return x" }, "lua")
  local lctx = context.build({ mode = "normal", bufnr = lbuf, range = nil })
  H.eq(lctx.code, "local x = 1\nreturn x", "fallback sends the whole buffer")
  H.eq(lctx.scope_kind, "buffer", "fallback scope is the whole buffer")
  H.eq(lctx.start_line, 0, "fallback starts at line 0")
  H.eq(lctx.end_line, 1, "fallback ends at the last line")
  H.eq(lctx.symbols, {}, "fallback sends no symbols")
  local warned = #notify_calls
  context.build({ mode = "normal", bufnr = lbuf, range = nil }) -- second build: silent
  H.eq(#notify_calls, warned, "the scope fallback notifies once per buffer")
  H.truthy(tostring(notify_calls[warned].msg):find("no treesitter scope match", 1, true),
    "the fallback names the missing scope match")

  -- unknown filetype: no parser at all, a different once-only message.
  local tbuf = fresh_buffer({ "plain text" }, "text")
  context.build({ mode = "normal", bufnr = tbuf, range = nil })
  context.build({ mode = "normal", bufnr = tbuf, range = nil })
  local parser_warns = 0
  for _, c in ipairs(notify_calls) do
    if tostring(c.msg):find("no treesitter parser", 1, true) then
      parser_warns = parser_warns + 1
    end
  end
  H.eq(parser_warns, 1, "the missing-parser fallback notifies once per buffer")

  -- ══ symbol enrichment with a faked LSP hover ═════════════════════════
  -- Visual selection over lua code: collect_identifiers_in_range runs on
  -- the bundled parser, and the hover text comes from a canned
  -- buf_request_sync — three response shapes cover hover_text's branches.
  local lua_buf = fresh_buffer({
    "local function greet(name)",
    '  local msg = "hi"',
    "  return msg .. name",
    "end",
  }, "lua")
  local shape = 0
  local restore_lsp = H.replace(vim.lsp, "buf_request_sync", function(_, _, _, _)
    shape = shape + 1
    if shape == 1 then
      return { [1] = { result = { contents = { value = "hover: value shape" } } } }
    elseif shape == 2 then
      return { [1] = { result = { contents = "hover: plain string shape" } } }
    end
    return { [1] = { result = { contents = { "hover: part one", { value = "part two" } } } } }
  end)
  local sctx = context.build({ mode = "visual", bufnr = lua_buf, range = { start_line = 0, end_line = 3 } })
  restore_lsp()

  local names = {}
  for _, s in ipairs(sctx.symbols) do
    names[#names + 1] = s.name
  end
  table.sort(names)
  H.eq(names, { "greet", "msg", "name" }, "identifiers in the selection become symbols, deduplicated")
  local by_name = {}
  for _, s in ipairs(sctx.symbols) do
    by_name[s.name] = s.hover
  end
  H.truthy(by_name.greet and by_name.greet:find("hover:", 1, true), "value-shaped hover text is used")
  H.truthy(by_name.msg or by_name.name, "remaining symbols carry hover text too")

  restore_notify()

  -- ══ ui: hover_lines (upvalue) ════════════════════════════════════════
  local hover_lines = H.upvalue(ui.open_hover, "hover_lines")
  local pending = {
    question = "what is this?",
    status = "pending",
    answer = nil,
    started_at = vim.uv.hrtime() - 5e6,
  }
  local pl = hover_lines(pending)
  H.eq(pl[1], "> **Q:** what is this?", "pending hover shows the question")
  H.truthy(vim.tbl_contains(pl, "*working...*"), "pending hover says it is working")
  local working_footer = false
  for _, l in ipairs(pl) do
    if l:find("working", 1, true) and l:find("...", 1, true) then
      working_footer = true
    end
  end
  H.truthy(working_footer, "pending hover footer shows elapsed time")

  local done = {
    question = "what is this?",
    status = "done",
    answer = "line one\nline two",
    duration_ms = 1500,
    tokens = { input = 2, output = 3 },
  }
  local dl = hover_lines(done)
  H.truthy(vim.tbl_contains(dl, "line one") and vim.tbl_contains(dl, "line two"),
    "done hover shows the answer lines")
  H.truthy(vim.tbl_contains(dl, "*1.5s · in:2 out:3*"), "done hover footer shows duration and tokens")

  -- ══ ui: no-op safety of the closers ══════════════════════════════════
  ui.close_hover() -- nothing active: no error
  ui.clear_diff_inline() -- nothing active: no error

  -- ══ ui: render_diff_inline / clear_diff_inline extmark pair ══════════
  local diff_ns = vim.api.nvim_create_namespace("sidekick.ask.diff_preview")
  local dbuf = fresh_buffer({ "oldA", "oldB", "tail" })
  local function mark_count(b)
    return #vim.api.nvim_buf_get_extmarks(b, diff_ns, 0, -1, {})
  end

  ui.render_diff_inline(dbuf, 0, 1, { "newA", "newB" })
  H.eq(mark_count(dbuf), 3, "two line-highlights plus one virt_lines extmark")
  local marks = vim.api.nvim_buf_get_extmarks(dbuf, diff_ns, 0, -1, { details = true })
  local virt = 0
  for _, m in ipairs(marks) do
    if (m[4] or {}).virt_lines then
      virt = virt + 1
    end
  end
  H.eq(virt, 1, "the preview block renders as virt_lines")
  ui.clear_diff_inline()
  H.eq(mark_count(dbuf), 0, "clear removes every preview extmark")
  ui.clear_diff_inline() -- idempotent
  H.eq(mark_count(dbuf), 0, "a second clear stays clean")

  -- NOOP preview: line highlights only, no virt_lines block
  ui.render_diff_inline(dbuf, 0, 1, {})
  H.eq(mark_count(dbuf), 2, "a NOOP preview only tints the replaced span")
  ui.clear_diff_inline()

  -- nil added: pure clear, nothing rendered
  ui.render_diff_inline(dbuf, 0, 1, nil)
  H.eq(mark_count(dbuf), 0, "nil added renders nothing")

  -- out-of-range end is clamped to the buffer (3 tinted lines + 1 virt)
  ui.render_diff_inline(dbuf, 0, 99, { "x" })
  H.eq(mark_count(dbuf), 4, "an oversized span clamps to the last line")
  ui.clear_diff_inline()

  -- a lua buffer drives the bundled-parser highlight path end to end
  -- (highlight_added_lines parses the full post-apply file).
  local ldbuf = fresh_buffer({ "local a = 1", "return a", "tail" }, "lua")
  ui.render_diff_inline(ldbuf, 0, 1, { "local b = 2", "return b" })
  H.eq(mark_count(ldbuf), 3, "the treesitter-highlighted preview renders the same extmark pair")
  ui.clear_diff_inline()
  H.eq(mark_count(ldbuf), 0, "the treesitter-highlighted preview clears cleanly")
end)
