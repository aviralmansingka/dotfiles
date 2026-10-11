-- sidekick/ask/init.lua pipeline spec (offline).
--
-- Drives the real ask/edit lifecycle with stubs at the process boundary
-- only: ui.open_prompt is captured (never opens a float), cli.spawn is
-- replaced (no pi process ever runs), and vim.uv.new_timer is faked so the
-- spinner arms no real timer. Everything between — state, signs, diff
-- parsing, edit_span, apply/reject — runs for real on scratch buffers.
--
-- Race contract pinned here (PR evidence from the feat-hunk session):
--   * a LATE or duplicate callback must not downgrade/remove an entry
--     that already completed (the duplicate-reply race);
--   * EOF/data=nil results fail closed — the entry leaves `pending`, it
--     never waits forever;
--   * a callback for a stale (removed) entry no-ops without error.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local askmod = require("plugins.sidekick.ask")
local state = require("plugins.sidekick.ask.state")
local signs = require("plugins.sidekick.ask.signs")
local ui = require("plugins.sidekick.ask.ui")
local cli = require("plugins.sidekick.ask.cli")

-- ── stubs ─────────────────────────────────────────────────────────────
local prompts = {} -- captured open_prompt opts
local restore_prompt = H.replace(ui, "open_prompt", function(opts)
  prompts[#prompts + 1] = opts
end)

local spawns = {} -- captured cli.spawn calls
local restore_spawn = H.replace(cli, "spawn", function(prompt, on_done, opts)
  local kill_log = {}
  local sysobj = {
    kill = function(_, sig)
      kill_log[#kill_log + 1] = sig
    end,
  }
  spawns[#spawns + 1] = { prompt = prompt, on_done = on_done, opts = opts, sysobj = sysobj, kill_log = kill_log }
  return sysobj
end)

local timers_created = 0
local restore_timer = H.replace(vim.uv, "new_timer", function()
  timers_created = timers_created + 1
  return {
    start = function() end,
    stop = function() end,
    close = function() end,
  }
end)

local notify_calls, restore_notify = H.capture_notify()

-- ── helpers ───────────────────────────────────────────────────────────
local function fresh_buffer(lines, name)
  local buf = vim.api.nvim_create_buf(false, true)
  if name then
    vim.api.nvim_buf_set_name(buf, name)
  end
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  return buf
end

local function mark_details(buf, id)
  local pos = vim.api.nvim_buf_get_extmark_by_id(buf, signs.ns, id, { details = true })
  if not pos or pos[1] == nil then
    return nil
  end
  -- nvim pads sign_text to two display cells; compare the real glyph.
  local sign = ((pos[3] or {}).sign_text or ""):gsub("%s+$", "")
  return { line = pos[1], sign = sign }
end

local function sole_entry(buf)
  local entries = state.entries(buf)
  local n = 0
  for _ in pairs(entries) do
    n = n + 1
  end
  if n ~= 1 then
    error("expected exactly one entry, found " .. n, 2)
  end
  local id, entry = next(entries)
  return id, entry
end

local function count_notify(sub)
  local n = 0
  for _, c in ipairs(notify_calls) do
    if tostring(c.msg):find(sub, 1, true) then
      n = n + 1
    end
  end
  return n
end

--- Run a full ask submission on `buf`; returns the captured spawn call.
local function submit_ask(buf, question)
  local prompts_before = #prompts
  askmod.ask()
  H.eq(#prompts, prompts_before + 1, "ask opens the prompt")
  prompts[#prompts].on_submit(question)
  return spawns[#spawns]
end

--- Run a full edit submission on a NAMED buffer; returns the spawn call.
local function submit_edit(buf, instruction)
  local prompts_before = #prompts
  askmod.edit()
  H.eq(#prompts, prompts_before + 1, "edit opens the prompt")
  prompts[#prompts].on_submit(instruction)
  return spawns[#spawns]
end

local function lines_of(buf)
  return vim.api.nvim_buf_get_lines(buf, 0, -1, false)
end

H.run("ask_pipeline_spec", function()
  -- ══ 1. ask lifecycle + the duplicate-reply race ══════════════════════
  local buf = fresh_buffer({ "local x = 1", "print(x)" })
  local call = submit_ask(buf, "what does this do?")

  H.truthy(call.prompt:find("answer the question: what does this do?", 1, true),
    "prompt embeds the question via render_prompt")
  H.truthy(call.prompt:find("local x = 1", 1, true), "prompt embeds the buffer code")

  local id, entry = sole_entry(buf)
  H.eq(entry.status, "pending", "entry starts pending")
  H.eq(entry.kind, "line", "normal-mode ask anchors a single line")
  H.eq(entry.mode, "ask", "entry mode is ask")
  H.eq(entry.sysobj, call.sysobj, "entry holds the sysobj for cancellation")
  H.truthy(timers_created >= 1, "the spinner was started")

  call.on_done({ ok = true, result = "it sets x and prints it", duration_ms = 12, tokens = { input = 2, output = 3 } })
  H.eq(entry.status, "done", "successful completion marks the entry done")
  H.eq(entry.answer, "it sets x and prints it", "answer is stored")
  H.eq(entry.tokens, { input = 2, output = 3 }, "tokens are stored")
  H.eq(entry.duration_ms, 12, "duration is stored")
  H.eq(entry.sysobj, nil, "sysobj released after completion")
  H.eq(mark_details(buf, entry.extmark_id).sign, "?", "done icon replaces the spinner")

  -- LATE FAILED after done: must NOT downgrade or remove the entry.
  local notify_before = #notify_calls
  call.on_done({ ok = false, err = "late race failure" })
  H.eq(entry.status, "done", "a late FAILED callback does not downgrade a done entry")
  H.eq(entry.answer, "it sets x and prints it", "a late FAILED callback does not wipe the answer")
  H.eq(state.entries(buf)[id], entry, "a late FAILED callback does not remove a done entry")
  H.eq(#notify_calls, notify_before, "a late FAILED callback on a done entry stays silent")

  -- duplicate successful reply: equally a no-op
  call.on_done({ ok = true, result = "duplicate reply", duration_ms = 1, tokens = { input = 0, output = 0 } })
  H.eq(entry.answer, "it sets x and prints it", "a duplicate reply does not overwrite the answer")

  -- stale entry (removed elsewhere): callback no-ops without error
  state.remove(buf, id)
  call.on_done({ ok = false, err = "too late" })
  H.eq(state.entries(buf)[id], nil, "a stale callback does not resurrect the entry")
  H.eq(#notify_calls, notify_before, "a stale callback stays silent")

  -- ══ 2. ask fail-closed contract (EOF / data=nil / ambiguous) ════════
  -- Every terminal shape must leave no pending entry behind.
  local function fail_closed_case(label, result, want_notify)
    local b = fresh_buffer({ "code line" })
    local c = submit_ask(b, "q")
    local notify_before = #notify_calls
    c.on_done(result)
    local entries = state.entries(b)
    for _, e in pairs(entries) do
      H.ne(e.status, "pending", label .. ": no entry may stay pending")
    end
    if want_notify then
      local got = false
      for i = notify_before + 1, #notify_calls do
        if tostring(notify_calls[i].msg):find(want_notify, 1, true) then
          got = true
        end
      end
      H.truthy(got, label .. ": surfaces '" .. want_notify .. "'")
    end
  end

  fail_closed_case("explicit error", { ok = false, err = "pi: empty result" }, "ask: pi: empty result")
  fail_closed_case("EOF with no data", { ok = true, result = nil }, "ask: pi: no result data")
  fail_closed_case("failure with no err text", { ok = false }, "ask: pi failed")

  -- ══ 3. edit lifecycle: parse verdicts ═══════════════════════════════
  local ebuf = fresh_buffer({ "one", "two", "three", "four", "five" }, "ask_pipeline_probe.lua")
  local ecall = submit_edit(ebuf, "make it loud")

  H.truthy(ecall.prompt:find("file: ask_pipeline_probe.lua", 1, true), "edit prompt names the file")
  H.truthy(ecall.prompt:find("lines to edit: 1-5", 1, true), "edit prompt scopes the whole fallback range")
  local _, eentry = sole_entry(ebuf)
  H.eq(eentry.mode, "edit", "entry mode is edit")
  H.eq(eentry.kind, "range", "multi-line scope anchors a range")
  H.eq(mark_details(ebuf, eentry.extmark_id).line, 0, "edit anchor sits at the scope start")

  local good_diff = table.concat({
    "--- a/ask_pipeline_probe.lua",
    "+++ b/ask_pipeline_probe.lua",
    "@@ -1,5 +1,2 @@",
    "-one", "-two", "-three", "-four", "-five",
    "+ONE", "+TWO",
  }, "\n")
  ecall.on_done({ ok = true, result = good_diff, duration_ms = 3, tokens = { input = 1, output = 1 } })
  H.eq(eentry.status, "done", "parsed diff completes the edit entry")
  H.eq(eentry.added, { "ONE", "TWO" }, "the + lines become the replacement")
  H.eq(mark_details(ebuf, eentry.extmark_id).sign, "±", "edit done icon is ±")

  -- late failed on a done edit: no downgrade either
  local notify_before = #notify_calls
  ecall.on_done({ ok = false, err = "late race failure" })
  H.eq(eentry.status, "done", "a late FAILED callback does not downgrade a done edit entry")
  H.eq(eentry.added, { "ONE", "TWO" }, "the parsed replacement survives a late failure")
  H.eq(#notify_calls, notify_before, "late failure on done edit stays silent")

  -- NOOP verdict
  local nbuf = fresh_buffer({ "stay" }, "noop_probe.lua")
  local ncall = submit_edit(nbuf, "change nothing")
  local _, nentry = sole_entry(nbuf)
  ncall.on_done({ ok = true, result = "NOOP", duration_ms = 1 })
  H.eq(nentry.status, "done", "NOOP completes the entry")
  H.eq(nentry.added, {}, "NOOP parses to an empty replacement")
  H.truthy(count_notify("edit: model returned NOOP") >= 1, "NOOP notifies the user once")
  askmod.apply_line() -- cursor is still on the anchored line
  H.eq(lines_of(nbuf), { "stay" }, "applying a NOOP writes nothing")
  H.eq(next(state.entries(nbuf)), nil, "apply removes the NOOP entry")

  -- unparseable reply: fail closed with the parse error
  local pbuf = fresh_buffer({ "keep" }, "parse_probe.lua")
  local pcall = submit_edit(pbuf, "do a thing")
  pcall.on_done({ ok = true, result = "I would rather explain than edit." })
  H.eq(next(state.entries(pbuf)), nil, "an unparseable reply removes the entry")
  H.truthy(count_notify("no diff or NOOP found") >= 1, "the parse error surfaces via notify")

  -- EOF/data=nil on the edit path: fail closed too
  local e2buf = fresh_buffer({ "keep" }, "eof_probe.lua")
  local e2call = submit_edit(e2buf, "edit it")
  local notify_e2 = #notify_calls
  e2call.on_done({ ok = true, result = nil })
  H.eq(next(state.entries(e2buf)), nil, "an EOF edit reply leaves no pending entry")
  H.truthy(#notify_calls > notify_e2, "the EOF edit reply surfaces an error")

  -- ══ 4. edit_span recomputes from live extmarks ══════════════════════
  local edit_span = H.upvalue(askmod.apply_line, "edit_span")
  local sbuf = fresh_buffer({ "a", "b", "c", "d", "e", "f" })
  local anchor = vim.api.nvim_buf_set_extmark(sbuf, signs.ns, 2, 0, {})
  local r1 = vim.api.nvim_buf_set_extmark(sbuf, signs.ns, 3, 0, {})
  local r2 = vim.api.nvim_buf_set_extmark(sbuf, signs.ns, 4, 0, {})
  local sentry = { kind = "range", mode = "edit", extmark_id = anchor, range_extmarks = { r1, r2 } }
  H.eq({ edit_span(sbuf, sentry) }, { 2, 4 }, "span reads the live extmark positions")
  vim.api.nvim_buf_set_lines(sbuf, 0, 0, false, { "x", "y" }) -- edit ABOVE the block
  H.eq({ edit_span(sbuf, sentry) }, { 4, 6 }, "span follows the extmarks after an edit above")
  vim.api.nvim_buf_del_extmark(sbuf, signs.ns, anchor)
  H.eq({ edit_span(sbuf, sentry) }, { nil, nil }, "a deleted anchor yields no span")

  -- ══ 5. apply_line writes the drifted span exactly once ══════════════
  local abuf = fresh_buffer({ "one", "two", "three", "four", "five" }, "apply_probe.lua")
  local acall = submit_edit(abuf, "make it loud")
  local _, aentry = sole_entry(abuf)
  acall.on_done({ ok = true, result = good_diff, duration_ms = 2 })
  vim.api.nvim_buf_set_lines(abuf, 0, 0, false, { "x", "y" }) -- drift the block down by 2

  local writes = {}
  local real_setlines = vim.api.nvim_buf_set_lines
  local restore_setlines = H.replace(vim.api, "nvim_buf_set_lines", function(b, s, e, strict, repl)
    if b == abuf then
      writes[#writes + 1] = { s, e, strict, repl }
    end
    return real_setlines(b, s, e, strict, repl)
  end)

  vim.api.nvim_win_set_cursor(0, { 3, 0 }) -- 0-based line 2 = drifted block start
  askmod.apply_line()
  restore_setlines()

  H.eq(writes, { { 2, 7, false, { "ONE", "TWO" } } },
    "apply writes the drifted live span exactly once")
  H.eq(lines_of(abuf), { "x", "y", "ONE", "TWO" }, "buffer holds the replacement")
  H.eq(next(state.entries(abuf)), nil, "apply removes the entry")
  H.eq(mark_details(abuf, aentry.extmark_id), nil, "apply clears the anchor sign")
  for _, rid in ipairs(aentry.range_extmarks) do
    H.eq(mark_details(abuf, rid), nil, "apply clears the range bar")
  end

  -- guards: pending entry / no entry
  local gbuf = fresh_buffer({ "wait" }, "guard_probe.lua")
  local gcall = submit_edit(gbuf, "slow edit")
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.apply_line()
  H.eq(lines_of(gbuf), { "wait" }, "a pending entry is not applied")
  H.truthy(count_notify("still working on this line") >= 1, "pending apply warns the user")
  local _, gentry = sole_entry(gbuf)
  H.eq(gentry.status, "pending", "the pending entry stays")

  local empty = fresh_buffer({ "nothing here" })
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.apply_line()
  H.truthy(count_notify("no diff on this line") >= 1, "apply with no entry warns the user")

  -- ══ 6. reject_line kills the running process ════════════════════════
  local rbuf = fresh_buffer({ "reject me" }, "reject_probe.lua")
  local rcall = submit_edit(rbuf, "edit that will be rejected")
  local _, rentry = sole_entry(rbuf)
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.reject_line()
  H.eq(rcall.kill_log, { "sigterm" }, "reject sigterms the sysobj")
  H.eq(next(state.entries(rbuf)), nil, "reject removes the entry")
  H.eq(mark_details(rbuf, rentry.extmark_id), nil, "reject clears the anchor sign")

  local r2 = fresh_buffer({ "no entry" })
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.reject_line()
  H.truthy(count_notify("no diff on this line") >= 1, "reject with no entry warns the user")

  -- ══ 7. clear_line and yank_line ═════════════════════════════════════
  local cbuf = fresh_buffer({ "clear me" })
  local ccall = submit_ask(cbuf, "clear question")
  local _, centry = sole_entry(cbuf)
  ccall.on_done({ ok = true, result = "the answer", duration_ms = 1 })
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.clear_line()
  H.eq(next(state.entries(cbuf)), nil, "clear_line removes a done entry")
  H.eq(mark_details(cbuf, centry.extmark_id), nil, "clear_line clears the sign")

  local ybuf = fresh_buffer({ "yank me" })
  local ycall = submit_ask(ybuf, "yank question")
  ycall.on_done({ ok = true, result = "yanked answer", duration_ms = 1 })
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.yank_line()
  H.truthy(count_notify("answer yanked") >= 1, "yank_line reports the yank")
  local _, yentry = sole_entry(ybuf)
  H.eq(yentry.answer, "yanked answer", "yank_line keeps the entry (repeatable)")
  -- yank with nothing done: warns instead of erroring
  local y2 = fresh_buffer({ "no answer" })
  submit_ask(y2, "pending question")
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  askmod.yank_line()
  H.truthy(count_notify("no answer on this line") >= 1, "yank without an answer warns")

  -- ══ 8. setup wiring: autocmds + buffer-wipe cleanup ═════════════════
  -- setup ran the highlight definitions (signs.setup_highlights)
  H.eq(vim.fn.hlexists("SidekickAskSign"), 1, "ask sign highlight is defined")
  H.eq(vim.fn.hlexists("SidekickEditSign"), 1, "edit sign highlight is defined")
  H.eq(vim.fn.hlexists("SidekickEditRange"), 1, "edit range highlight is defined")

  local events = {}
  for _, am in ipairs(vim.api.nvim_get_autocmds({ group = "sidekick.ask" })) do
    events[am.event] = true
  end
  H.truthy(events["BufWipeout"] or events["BufDelete"], "buffer wipe is wired to cleanup_buffer")
  H.truthy(events["CursorMoved"], "hover autocmds are registered")
  H.truthy(events["VimLeavePre"], "VimLeavePre is wired to cleanup_all")

  local wbuf = fresh_buffer({ "wipe me" })
  local wcall = submit_ask(wbuf, "question on a doomed buffer")
  vim.api.nvim_buf_delete(wbuf, { force = true })
  H.eq(wcall.kill_log, { "sigterm" }, "wiping the buffer sigterms its sysobj")
  H.eq(state.state[wbuf], nil, "wiping the buffer clears its anchor table")

  -- restore the stubbed boundaries
  restore_prompt()
  restore_spawn()
  restore_timer()
  restore_notify()
  state.cleanup_all()
end)
