-- DAP eval-helper regression suite (nvim CI cluster B).
--
-- Guards the #27 merge-clobber class: an accidental revert of the eval
-- helpers shipped inside #24 and nothing caught it. Every symbol is pinned
-- through the REAL module closures (H.upvalue), never copies — if a merge
-- drops `dap_eval_repl_split`, `expression_under_cursor`, `range_contains`
-- or STRINGIFY, or the `<localleader>r` binding, the symbol case fails.
-- Also covers the #23 E565 class (dap-ui opts must merge via `opts`, never
-- a second setup call — asserted structurally: no `config` on the entry)
-- and the #29 java STRINGIFY identity wrapper.
--
-- Offline and deterministic: no plugin bootstrap, no Mason, no network, no
-- real debugger session. DAP state is reached through closure extraction
-- plus a stubbed `package.loaded["dap"]`; treesitter runs on the host's
-- bundled go parser. vim.schedule is replaced with a synchronous shim so
-- evaluate callbacks run inline — no timers, no event-loop waiting.
--
-- No-test (documented in docs/ci-tests/nvim-dap.md): real DAP sessions,
-- delve plumbing, dap-ui live windows, the 2 s idle auto-trigger timer.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2)
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

-- Symbols extracted from the real module; filled by the symbols case.
local M = {}

--- Time + run one case, reporting its CPU time after PASS.
local function case(name, fn)
  local t0 = os.clock()
  H.run(name, fn)
  print(string.format("  time %s %.1f ms", name, (os.clock() - t0) * 1000))
end

--- Create a scratch buffer in a floating window, set lines + filetype,
--- parse it, and return buf, win.
local function go_window(lines)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = "go"
  local win = vim.api.nvim_open_win(buf, true, { relative = "editor", width = 60, height = 12, row = 0, col = 0 })
  vim.treesitter.get_parser(buf, "go"):parse()
  return buf, win
end

--- A stub nvim-dap session: paused, typed, request-recording.
--- err / eval_result fields are mutable between calls to steer responses.
local function make_session(typ)
  local s = {
    stopped_thread_id = 42,
    config = { type = typ },
    current_frame = { id = 7 },
    requests = {},
    eval_result = "= stub-result",
    err = nil,
  }
  s.request = function(self, command, payload, cb)
    self.requests[#self.requests + 1] = { command = command, payload = payload }
    if self.err then
      local e = self.err
      self.err = nil
      cb(e, nil)
    else
      cb(nil, { result = self.eval_result })
    end
  end
  return s
end

--- Counters for the fake `dap` module (functions cannot carry fields).
local repl_calls = { opened = 0, executed = {} }

--- Install a fake `dap` module; returns the session so callers can mutate it.
local function stub_dap(session)
  package.loaded["dap"] = {
    session = function()
      return session
    end,
    repl = {
      open = function()
        repl_calls.opened = repl_calls.opened + 1
      end,
      execute = function(expr)
        repl_calls.executed[#repl_calls.executed + 1] = expr
      end,
    },
  }
  return session
end

local function unstub_dap()
  package.loaded["dap"] = nil
  repl_calls.opened = 0
  repl_calls.executed = {}
end

--- Replace vim.schedule with a synchronous shim (evaluate callbacks run
--- inline). Returns the restore function.
local function sync_schedule()
  return H.replace(vim, "schedule", function(f)
    f()
  end)
end

-- The go fixture used by the cursor cases. Columns are computed from the
-- line text, never hardcoded, so a fixture tweak cannot rot the offsets.
local SRC_LINES = {
  "package main",
  "func main() {",
  '\tw.Header().Set("a", b)',
  "\tif x > 1 {",
  "\t\t_ = x",
  "\t}",
  "}",
}

case("dap_eval_spec:symbols", function()
  -- Structural regression (#27 class): the spec file must still contain
  -- every eval-helper symbol, reachable through real closures.
  local spec = dofile(root .. "/lua/plugins/dap.lua")
  M.spec = spec

  local dapui_entry, dap_entry
  for _, entry in ipairs(spec) do
    if entry[1] == "rcarriga/nvim-dap-ui" then
      dapui_entry = entry
    elseif entry[1] == "mfussenegger/nvim-dap" then
      dap_entry = entry
    end
  end
  H.truthy(dap_entry ~= nil, "dap.lua still ships the nvim-dap plugin spec")
  H.truthy(dapui_entry ~= nil, "dap.lua still ships the nvim-dap-ui plugin spec")
  M.dap_entry = dap_entry
  M.dapui_entry = dapui_entry

  -- The <localleader>r REPL-eval binding: a function handler + a desc.
  local binding
  for _, k in ipairs(dap_entry.keys or {}) do
    if k[1] == "<localleader>r" then
      binding = k
    end
  end
  H.truthy(binding ~= nil, "nvim-dap spec still binds <localleader>r (REPL eval)")
  H.truthy(type(binding[2]) == "function", "the <localleader>r binding has a function handler")
  H.truthy(type(binding.desc) == "string" and binding.desc ~= "", "the <localleader>r binding carries a desc")

  -- C33: the manual-focus hover branch is deleted — fe8f112 dropped the
  -- <localleader>g keymap (gitsigns claimed it), and the idle timer is the
  -- only caller, always auto. Structural pin: no nvim-dap key binding
  -- mentions the hover, so the dead branch stays deleted/unwired.
  for _, k in ipairs(dap_entry.keys or {}) do
    H.truthy(not (k.desc or ""):lower():find("hover", 1, true),
      "no nvim-dap key binding re-wires the eval hover (C33)")
  end

  -- Pull the real locals out of the closure graph. H.upvalue errors
  -- ("not reachable") when a merge silently dropped one — the #27 guard.
  M.eval_repl = H.upvalue(binding[2], "dap_eval_repl_split")
  M.get_cursor_expression = H.upvalue(M.eval_repl, "get_cursor_expression")
  M.expression_under_cursor = H.upvalue(M.eval_repl, "expression_under_cursor")
  M.range_contains = H.upvalue(M.eval_repl, "range_contains")
  M.find_repl_window = H.upvalue(M.eval_repl, "find_repl_window")
  M._eval_state = H.upvalue(M.eval_repl, "_eval_state")
  H.truthy(type(M._eval_state) == "table",
    "the hover lifecycle state table exists (last_expr tracking is exercised in the hover case)")

  -- dap_eval_hover and dap_yank_stringify live behind the module-level
  -- autocmds; grab their callbacks, then silence the group so no idle
  -- timers can start while the spec moves the cursor around.
  local filetypes, idle = {}, {}
  for _, a in ipairs(vim.api.nvim_get_autocmds({ group = "dap_eval_idle" })) do
    if a.event == "FileType" and a.pattern == "dap-repl" then
      filetypes[#filetypes + 1] = a
    elseif a.event == "CursorMoved" or a.event == "BufEnter" or a.event == "InsertEnter" or a.event == "WinEnter" then
      idle[#idle + 1] = a
    end
  end
  H.truthy(#filetypes == 1, "exactly one dap-repl FileType autocmd binds <localleader>y on REPL buffers")
  M.yank = H.upvalue(filetypes[1].callback, "dap_yank_stringify")
  H.truthy(#idle >= 1, "the idle auto-trigger autocmd is registered")
  M.hover = H.upvalue(idle[1].callback, "dap_eval_hover")

  -- STRINGIFY is reachable from the yank closure (checked fully below).
  M.STRINGIFY = H.upvalue(M.yank, "STRINGIFY")
  H.truthy(type(M.STRINGIFY) == "table", "STRINGIFY is a dispatch table")

  -- The dap-repl FileType autocmd actually binds <localleader>y live: set a
  -- buffer's filetype and the buffer-local yank keymap must appear.
  vim.g.maplocalleader = ","
  local repl_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[repl_buf].filetype = "dap-repl"
  local repl_lhs = {}
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(repl_buf, "n")) do
    repl_lhs[m.lhs] = m.desc
  end
  H.truthy(repl_lhs[",y"] ~= nil, "the FileType autocmd binds <localleader>y on dap-repl buffers")
  H.eq(repl_lhs[",y"], "DAP: Yank stringified value", "the REPL yank binding carries its desc")
  vim.api.nvim_buf_delete(repl_buf, { force = true })

  -- No more autocmd interference for the rest of the spec.
  vim.api.nvim_clear_autocmds({ group = "dap_eval_idle" })
end)

case("dap_eval_spec:range_contains", function()
  local rc = M.range_contains
  H.eq(rc(nil, 0, 0), false, "a nil node contains nothing")

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
    "package main",
    "func main() {",
    '\tw.Header().Set(',
    '\t\t"a",',
    "\t\tb,",
    "\t)",
    "}",
  })
  vim.bo[buf].filetype = "go"
  local root_node = vim.treesitter.get_parser(buf, "go"):parse()[1]:root()

  -- Collect every call_expression in the tree; pick by text.
  local calls = {}
  local function collect(n)
    if n:type() == "call_expression" then
      calls[#calls + 1] = n
    end
    for c in n:iter_children() do
      if c:named() then
        collect(c)
      end
    end
  end
  collect(root_node)
  local single, multi
  for _, c in ipairs(calls) do
    local text = vim.treesitter.get_node_text(c, buf)
    if text == "w.Header()" then
      single = c
    end
    if text:find("^w%.Header%(%)%.Set", 1, false) then
      multi = c
    end
  end
  H.truthy(single ~= nil, "the single-line call `w.Header()` is present in the tree")
  H.truthy(multi ~= nil, "the multi-line call `w.Header().Set(...)` is present in the tree")

  -- Single-line boundary matrix (start inclusive, end col inclusive,
  -- outside the span on any edge false).
  local sr, sc, er, ec = single:range()
  H.eq(er, sr, "the single-line node spans exactly one row")
  H.eq(rc(single, sr, sc), true, "cursor on the first character is contained")
  H.eq(rc(single, sr, sc - 1), false, "cursor one column before the start is not contained")
  H.eq(rc(single, sr, sc + 1), true, "cursor inside the node is contained")
  H.eq(rc(single, er, ec), true, "cursor on the end column is contained (inclusive end)")
  H.eq(rc(single, er, ec + 1), false, "cursor one column past the end is not contained")
  H.eq(rc(single, sr - 1, sc), false, "cursor on the row above is not contained")
  H.eq(rc(single, er + 1, ec), false, "cursor on the row below is not contained")

  -- Multi-line boundary matrix.
  sr, sc, er, ec = multi:range()
  H.truthy(er > sr, "the multi-line node spans several rows")
  H.eq(rc(multi, sr, sc), true, "start corner is contained")
  H.eq(rc(multi, sr, sc - 1), false, "one column before the start row is not contained")
  H.eq(rc(multi, sr, 200), true, "any column past the start on the start row is contained")
  H.eq(rc(multi, sr + 1, 0), true, "any column on an interior row is contained")
  H.eq(rc(multi, er, 0), true, "the end row before the end column is contained")
  H.eq(rc(multi, er, ec), true, "the end corner is contained (inclusive end)")
  H.eq(rc(multi, er, ec + 1), false, "one column past the end corner is not contained")
  H.eq(rc(multi, sr - 1, 100), false, "the row above the node is not contained")
  H.eq(rc(multi, er + 1, 0), false, "the row below the node is not contained")

  vim.api.nvim_buf_delete(buf, { force = true })
end)

case("dap_eval_spec:expression_under_cursor", function()
  local buf, win = go_window(SRC_LINES)
  local line3 = SRC_LINES[3]

  local function at(row, col)
    vim.api.nvim_win_set_cursor(win, { row, col })
    local n = M.expression_under_cursor()
    return n and vim.treesitter.get_node_text(n, buf) or nil
  end

  local col_w = line3:find("w", 1, true) - 1
  local col_header = line3:find("Header", 1, true) - 1
  local col_open1 = line3:find("(", 1, true) - 1
  local col_set = line3:find("Set", 1, true) - 1
  local col_str = line3:find('"a"', 1, true) - 1
  local col_b = line3:find("b", 1, true) - 1

  -- Smallest-call selection on a nested chain (#24/#27 pin): cursor inside
  -- `Header` evaluates w.Header(), never the whole chain.
  H.eq(at(3, col_w), "w.Header()", "cursor on `w` evaluates the smallest call w.Header()")
  H.eq(at(3, col_header), "w.Header()", "cursor inside `Header` evaluates w.Header(), not the chain")
  H.eq(at(3, col_header + 5), "w.Header()", "cursor on the last char of `Header` still evaluates w.Header()")
  H.eq(at(3, col_open1), "w.Header()", "cursor on the opening paren evaluates w.Header()")
  H.eq(at(3, col_set), 'w.Header().Set("a", b)', "cursor on `Set` evaluates the whole chain")
  H.eq(at(3, col_str), '"a"', "cursor on a string argument evaluates just the string")
  H.eq(at(3, col_b), "b", "cursor on the identifier argument evaluates just it")

  -- Keyword / whitespace / statement-boundary edges bail with nil.
  H.eq(at(3, 0), nil, "cursor on leading whitespace returns nil")
  H.eq(at(4, SRC_LINES[4]:find("if", 1, true) - 1), nil, "cursor on the `if` keyword returns nil")
  H.eq(at(6, 0), nil, "cursor on an empty line returns nil")
  H.eq(at(4, SRC_LINES[4]:find("x", 1, true) - 1), "x", "cursor on a plain identifier evaluates it")

  -- Empty buffer: the tree parses to an empty source file — nil, no throw.
  local empty = vim.api.nvim_create_buf(false, true)
  vim.bo[empty].filetype = "go"
  vim.api.nvim_win_set_buf(win, empty)
  local ok, res = pcall(M.expression_under_cursor)
  H.truthy(ok, "expression_under_cursor never throws on an empty buffer")
  H.eq(res, nil, "an empty buffer yields no expression")

  -- No parser for the filetype: get_node gives nil — still nil, no throw.
  local plain = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(plain, 0, -1, false, { "just plain text" })
  vim.bo[plain].filetype = "text"
  vim.api.nvim_win_set_buf(win, plain)
  vim.api.nvim_win_set_cursor(win, { 1, 3 })
  ok, res = pcall(M.expression_under_cursor)
  H.truthy(ok, "expression_under_cursor never throws without a parser")
  H.eq(res, nil, "a parser-less filetype yields no expression")

  -- get_cursor_expression: the text bridge + the dap-repl guard.
  vim.api.nvim_win_set_buf(win, buf)
  vim.api.nvim_win_set_cursor(win, { 3, col_header })
  H.eq(M.get_cursor_expression(), "w.Header()", "get_cursor_expression returns the node text")
  vim.bo[buf].filetype = "dap-repl"
  H.eq(M.get_cursor_expression(), nil, "get_cursor_expression bails inside the REPL buffer")
  vim.bo[buf].filetype = "go"

  vim.api.nvim_win_close(win, true)
  vim.api.nvim_buf_delete(buf, { force = true })
  vim.api.nvim_buf_delete(empty, { force = true })
  vim.api.nvim_buf_delete(plain, { force = true })
end)

case("dap_eval_spec:stringify_dispatch", function()
  local S = M.STRINGIFY
  -- Per-language wrappers on representative value snippets. python wraps
  -- in str(); go/delve pass through; java passes through because
  -- java-debug-adapter already returns the toString() form (#29).
  H.eq(S.python("resp.StatusCode"), "str(resp.StatusCode)", "python wraps in str()")
  H.eq(S.python("cfg['x'] + 1"), "str(cfg['x'] + 1)", "python wraps multi-token expressions verbatim")
  H.eq(S.go("&obj{Field: 1}"), "&obj{Field: 1}", "go is the identity wrapper")
  H.eq(S.delve("arr[2:4]"), "arr[2:4]", "delve is the identity wrapper")
  H.eq(S.java("myObj.toString()"), "myObj.toString()", "java is the identity wrapper (#29)")
  for _, lang in ipairs({ "python", "go", "delve", "java" }) do
    H.truthy(type(S[lang]) == "function", "STRINGIFY." .. lang .. " is a function")
  end
end)

case("dap_eval_spec:repl_guards", function()
  local calls, restore_notify = H.capture_notify()
  local function notified(msg)
    for _, c in ipairs(calls) do
      if type(c.msg) == "string" and c.msg:find(msg, 1, true) then
        return true
      end
    end
    return false
  end

  -- No `dap` module at all (fresh headless env): silent return, never throw.
  unstub_dap()
  H.truthy(not pcall(require, "dap"), "precondition: no dap module is loadable here")
  local ok = pcall(M.eval_repl)
  H.truthy(ok, "dap_eval_repl_split never throws when nvim-dap is absent")
  H.eq(#calls, 0, "no notification when nvim-dap is absent (silent return)")

  -- dap present, no session: WARN notify, no REPL plumbing.
  stub_dap(nil)
  ok = pcall(M.eval_repl)
  H.truthy(ok, "dap_eval_repl_split never throws without a session")
  H.truthy(notified("DAP: no paused session"), "no session warns the user")
  H.eq(repl_calls.opened, 0, "no session never opens a REPL")

  -- Session alive but not stopped: same guard.
  local session = stub_dap(make_session("go"))
  session.stopped_thread_id = nil
  ok = pcall(M.eval_repl)
  H.truthy(ok, "dap_eval_repl_split never throws on a running (not paused) session")
  H.truthy(notified("DAP: no paused session"), "a running session warns the user too")
  H.eq(repl_calls.opened, 0, "a running session never opens a REPL")

  -- Paused session, cursor on nothing evaluable: silent, no REPL open.
  session.stopped_thread_id = 42
  local buf, win = go_window(SRC_LINES)
  vim.api.nvim_win_set_cursor(win, { 3, 0 }) -- leading tab: whitespace edge
  M.eval_repl()
  H.eq(repl_calls.opened, 0, "no expression under the cursor means no REPL open")
  H.eq(#repl_calls.executed, 0, "no expression under the cursor means no execute")

  -- Happy path, no REPL window yet: find_repl_window absence opens one,
  -- the smallest call is executed, focus returns to the source window.
  vim.api.nvim_win_set_cursor(win, { 3, SRC_LINES[3]:find("Header", 1, true) - 1 })
  M.eval_repl()
  H.eq(repl_calls.opened, 1, "a missing REPL window is opened exactly once")
  H.eq(repl_calls.executed, { "w.Header()" }, "the REPL executes the cursor expression")
  H.eq(vim.api.nvim_get_current_win(), win, "focus stays on the source window")

  -- An existing dap-repl window is reused: no second open.
  local repl_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[repl_buf].filetype = "dap-repl"
  local repl_win = vim.api.nvim_open_win(repl_buf, false, { relative = "editor", width = 40, height = 6, row = 0, col = 70 })
  repl_calls.opened = 0
  M.eval_repl()
  H.eq(repl_calls.opened, 0, "an existing dap-repl window is reused, not re-opened")
  H.eq(repl_calls.executed[#repl_calls.executed], "w.Header()", "the existing REPL still executes the expression")
  H.eq(vim.api.nvim_get_current_win(), win, "focus still returns to the source window")

  vim.api.nvim_win_close(repl_win, true)
  vim.api.nvim_buf_delete(repl_buf, { force = true })
  vim.api.nvim_win_close(win, true)
  vim.api.nvim_buf_delete(buf, { force = true })
  unstub_dap()
  restore_notify()
end)

case("dap_eval_spec:hover_lifecycle", function()
  local calls, restore_notify = H.capture_notify()
  local restore_sched = sync_schedule()
  local session = stub_dap(make_session("go"))
  local state = M._eval_state

  -- Guard: no paused session. The manual-focus branch is deleted (C33),
  -- so hover is always silent without a paused session — never throws.
  session.stopped_thread_id = nil
  local ok = pcall(M.hover)
  H.truthy(ok, "hover never throws without a paused session")
  H.eq(#calls, 0, "hover without a paused session is silent (no manual notify path)")
  H.eq(#session.requests, 0, "no paused session means no evaluate request")

  -- Auto idle eval: request payload, float opened, state tracked, keymaps set.
  session.stopped_thread_id = 42
  local buf, win = go_window(SRC_LINES)
  vim.g.maplocalleader = ","
  vim.api.nvim_win_set_cursor(win, { 3, SRC_LINES[3]:find("Header", 1, true) - 1 })
  M.hover()
  H.eq(#session.requests, 1, "hover issues exactly one evaluate request")
  local req = session.requests[1]
  H.eq(req.command, "evaluate", "the request is an evaluate")
  H.eq(req.payload.expression, "w.Header()", "the request evaluates the cursor expression")
  H.eq(req.payload.frameId, 7, "the request carries the current frame id")
  H.eq(req.payload.context, "repl", "the request uses the repl context")
  H.truthy(state.hover_win and vim.api.nvim_win_is_valid(state.hover_win), "the hover float is open and tracked")
  H.truthy(state.hover_buf == vim.api.nvim_win_get_buf(state.hover_win), "hover_buf matches the float buffer")
  H.eq(state.last_expr, "w.Header()", "last_expr tracks the evaluated expression")
  local body = vim.api.nvim_buf_get_lines(state.hover_buf, 0, -1, false)
  H.eq(body[1], "= stub-result", "the float shows the evaluate result")

  local descs, lhs = {}, {}
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(state.hover_buf, "n")) do
    descs[m.desc] = true
    lhs[m.lhs] = true
  end
  H.truthy(lhs[",y"], "the float binds <localleader>y for yank-stringify")
  H.truthy(descs["DAP: Yank stringified value"], "the yank binding carries its desc")
  H.truthy(descs["DAP: Close eval hover"], "the float binds a close key (q/<Esc>)")

  -- Re-eval suppression: same expression + live float = no second request,
  -- and the float never steals focus (the deleted manual branch was the
  -- only focus-moving path, C33).
  M.hover()
  H.eq(#session.requests, 1, "auto re-hover on the same expression is suppressed")
  H.eq(vim.api.nvim_get_current_win(), win, "a live hover float never steals focus")

  -- The hover_buf guard (state steered directly — making the hover buffer
  -- current via the API would close the preview through its own
  -- BufLeave/CursorMoved handlers): when the current buffer IS the tracked
  -- hover buffer, hover returns before fetching any expression.
  local hover_buf_saved, hover_win_saved = state.hover_buf, state.hover_win
  state.hover_win = nil
  state.hover_buf = buf
  M.hover()
  H.eq(#session.requests, 1, "hovering while the hover buffer is current is a no-op")
  state.hover_buf, state.hover_win = hover_buf_saved, hover_win_saved

  -- New expression: the old float is gone (cursor moved), a fresh request
  -- and a fresh float appear.
  vim.api.nvim_win_set_cursor(win, { 3, SRC_LINES[3]:find("Set", 1, true) - 1 })
  M.hover()
  H.eq(#session.requests, 2, "a different expression triggers a new evaluate")
  H.eq(session.requests[2].payload.expression, 'w.Header().Set("a", b)', "the new request carries the chain expression")
  H.eq(state.last_expr, 'w.Header().Set("a", b)', "last_expr advances to the new expression")

  -- Adapter error path: the float surfaces the error, never throws.
  vim.api.nvim_win_set_cursor(win, { 4, SRC_LINES[4]:find("x", 1, true) - 1 })
  session.err = { message = "boom" }
  M.hover()
  H.eq(#session.requests, 3, "the error path still issues the request")
  body = vim.api.nvim_buf_get_lines(state.hover_buf, 0, -1, false)
  H.eq(body[1], "Error: boom", "the float shows the adapter error message")

  pcall(vim.api.nvim_win_close, state.hover_win, true)
  state.hover_buf, state.hover_win, state.last_expr = nil, nil, nil
  vim.api.nvim_win_close(win, true)
  vim.api.nvim_buf_delete(buf, { force = true })
  unstub_dap()
  restore_sched()
  restore_notify()
end)

case("dap_eval_spec:yank_stringify", function()
  local calls, restore_notify = H.capture_notify()
  local restore_sched = sync_schedule()
  local state = M._eval_state
  state.last_expr = "cfg['x'] + 1"

  local function last_notify()
    return calls[#calls] and calls[#calls].msg or nil
  end

  -- Guard: no session.
  stub_dap(nil)
  local ok = pcall(M.yank)
  H.truthy(ok, "yank never throws without a session")
  H.truthy(last_notify() and last_notify():find("DAP: no paused session", 1, true),
    "yank warns without a session")

  -- Guard: session but no tracked expression.
  local session = stub_dap(make_session("python"))
  session.stopped_thread_id = nil
  ok = pcall(M.yank)
  H.truthy(ok, "yank never throws on a running session")
  H.truthy(last_notify() and last_notify():find("DAP: no paused session", 1, true),
    "yank warns on a running session")

  session.stopped_thread_id = 42
  state.last_expr = nil
  ok = pcall(M.yank)
  H.truthy(ok, "yank never throws without a tracked expression")
  H.truthy(last_notify() and last_notify():find("no expression tracked", 1, true),
    "yank tells the user to evaluate first")

  -- Dispatch per session type: the wrapped expression is what gets sent.
  state.last_expr = "cfg['x'] + 1"
  M.yank()
  H.eq(#session.requests, 1, "yank issues one evaluate request")
  H.eq(session.requests[1].payload.expression, "str(cfg['x'] + 1)",
    "a python session yanks the str()-wrapped expression")
  H.eq(session.requests[1].payload.context, "clipboard", "yank evaluates in the clipboard context")
  H.eq(vim.fn.getreg('"'), "= stub-result", "the yank result lands in the unnamed register")

  session = stub_dap(make_session("go"))
  M.yank()
  H.eq(session.requests[1].payload.expression, "cfg['x'] + 1", "a go session yanks the raw expression")

  session = stub_dap(make_session("delve"))
  M.yank()
  H.eq(session.requests[1].payload.expression, "cfg['x'] + 1", "a delve session yanks the raw expression")

  session = stub_dap(make_session("java"))
  M.yank()
  H.eq(session.requests[1].payload.expression, "cfg['x'] + 1",
    "a java session yanks the raw expression (toString() comes from the adapter, #29)")

  -- Unknown adapter type falls back to identity, never nil dispatch.
  session = stub_dap(make_session("rust"))
  M.yank()
  H.eq(session.requests[1].payload.expression, "cfg['x'] + 1", "an unknown adapter type falls back to identity")

  -- Adapter error path: ERROR notify, never throws.
  session = stub_dap(make_session("python"))
  session.err = { message = "adapter exploded" }
  ok = pcall(M.yank)
  H.truthy(ok, "yank never throws on an adapter error")
  H.truthy(last_notify() and last_notify():find("DAP yank error", 1, true),
    "an adapter error surfaces as a DAP yank error notify")

  state.last_expr = nil
  unstub_dap()
  restore_sched()
  restore_notify()
end)

case("dap_eval_spec:repl_window_detection", function()
  local find = M.find_repl_window
  H.eq(find(), nil, "no dap-repl window means nil")

  -- A floating dap-repl window is detected.
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "dap repl" })
  vim.bo[buf].filetype = "dap-repl"
  local win = vim.api.nvim_open_win(buf, true, { relative = "editor", width = 40, height = 6, row = 0, col = 0 })
  H.eq(find(), win, "a visible dap-repl window is found")

  -- Window-based, not buffer-based: an undisplayed repl buffer is not found.
  vim.api.nvim_win_close(win, true)
  H.eq(find(), nil, "a dap-repl buffer with no window is not found")

  -- Non-repl windows never match.
  local src = vim.api.nvim_create_buf(false, true)
  vim.bo[src].filetype = "go"
  local srcwin = vim.api.nvim_open_win(src, true, { relative = "editor", width = 40, height = 6, row = 0, col = 50 })
  H.eq(find(), nil, "a plain go window is not a REPL window")

  vim.api.nvim_win_close(srcwin, true)
  vim.api.nvim_buf_delete(src, { force = true })
  vim.api.nvim_buf_delete(buf, { force = true })
end)

case("dap_eval_spec:dapui_opts_shape", function()
  -- #23 E565 class: dap-ui must be configured ONLY through opts merging.
  -- A `config` on this entry would call dapui.setup a second time
  -- (LazyVim's extras.dap.core already sets it up) and trip E565.
  local entry = M.dapui_entry
  H.truthy(entry.optional == true, "the dap-ui entry stays optional so LazyVim's extra owns loading")
  H.eq(entry.config, nil, "the dap-ui entry has no config (opts merging only — the E565 guard)")
  H.eq(entry.opts, {
    icons = { expanded = "▾", collapsed = "▸", current_frame = "*" },
    controls = {
      icons = {
        pause = "⏸",
        play = "▶",
        step_into = "⏎",
        step_over = "⏭",
        step_out = "⏮",
        step_back = "b",
        run_last = "▶▶",
        terminate = "⏹",
        disconnect = "⏏",
      },
    },
  }, "the dap-ui opts table keeps its exact icon shape")
end)
