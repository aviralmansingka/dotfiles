-- sidekick/view_focus.lua core spec (send cluster, #219 view-focus handoff).
--
-- Runs against a FAKE sidekick.cli.terminal / sidekick.cli.session pair that
-- mirrors the real module contract: a `terminals` registry table,
-- send/submit/on_ready methods, close() that removes the registry entry and
-- deletes the buffer, and Session attach/detach bookkeeping. The real plugin
-- lives outside this worktree, so loading it here would test the wrong tree.
-- No PTY and no live mux: timers are fakes that fire their callback on
-- demand, and the scheduled writes are pumped with 10 ms sleeps.
--
-- Coverage: Terminal send/submit patch idempotency, send-on-closed routing
-- (current view, pending queue, reported drop), release/resume state
-- transitions, and the pending queue replaying exactly once on restore.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

-- ── fakes, installed before view_focus loads ────────────────────────────
local registry = {}
local base = { send = {}, submit = {}, on_ready = {} }

local Terminal = { terminals = registry }

function Terminal:send(input)
  base.send[#base.send + 1] = { term = self, input = input }
  if self.running then
    table.insert(self.send_queue, input)
  end
end

function Terminal:submit()
  base.submit[#base.submit + 1] = self
  self:send("\r")
end

function Terminal:on_ready()
  base.on_ready[#base.on_ready + 1] = self
end

function Terminal:close()
  if self.closed then
    return
  end
  self.closed = true
  self.running = false
  registry[self.id] = nil
  local win = self.win
  self.win = nil
  if win and vim.api.nvim_win_is_valid(win) then
    pcall(vim.api.nvim_win_close, win, true)
  end
  if self.buf and vim.api.nvim_buf_is_valid(self.buf) then
    pcall(vim.api.nvim_buf_delete, self.buf, { force = true })
  end
  self.buf = nil
end

function Terminal:win_valid()
  return self.win ~= nil and vim.api.nvim_win_is_valid(self.win)
end

function Terminal:buf_valid()
  return self.buf ~= nil and vim.api.nvim_buf_is_valid(self.buf)
end

function Terminal:is_running()
  return self.running
end

function Terminal:is_focused()
  return self.focused
end

function Terminal:focus()
  self.focus_calls = (self.focus_calls or 0) + 1
end

local next_id = 0
local function make_parent(id, backend)
  return {
    id = id,
    backend = backend,
    alive = true,
    is_running = function(self)
      return self.alive
    end,
  }
end

local open -- forward declaration: Session.attach creates clients through it

local Session = { _attached = {}, attach_calls = 0 }

function Session.detach(term)
  Session._attached[term.id] = nil
  term.detached = (term.detached or 0) + 1
end

function Session.attach(parent)
  Session.attach_calls = Session.attach_calls + 1
  if parent.attach_error then
    error("temporary attach failure")
  end
  local term = open(parent)
  term.running = not parent.quick_fail
  if term.running then
    -- Mirrors Config.cli.win.config = view_focus.configure firing inside a
    -- real attach: the restore copies opts and the send queue here.
    require("plugins.sidekick.view_focus").configure(term)
  end
  return term
end

function open(parent, as_float)
  next_id = next_id + 1
  local term = {
    id = parent.id .. "-" .. next_id,
    parent = parent,
    closed = false,
    running = true,
    focused = false,
    normal_mode = false,
    buf = vim.api.nvim_create_buf(false, true),
    opts = { layout = parent.layout or "right" },
    send_queue = {},
    group = nil,
  }
  setmetatable(term, { __index = Terminal })
  term.timer = {}
  function term.timer:start(_, _, callback)
    term.timer._cb = callback
  end
  term.win = as_float
      and vim.api.nvim_open_win(term.buf, false, {
        relative = "editor", row = 1, col = 1, width = 20, height = 5,
      })
      or vim.api.nvim_open_win(term.buf, false, { split = "right" })
  registry[term.id] = term
  Session._attached[term.id] = term
  return term
end

local function view_of(parent)
  for _, term in pairs(registry) do
    if term.parent == parent and not term.closed then
      return term
    end
  end
end

package.loaded["sidekick.cli.terminal"] = Terminal
package.loaded["sidekick.cli.session"] = Session

H.run("sidekick_view_focus_spec", function()
  local notify_calls, restore_notify = H.capture_notify()
  local Focus = require("plugins.sidekick.view_focus")
  local pending = H.upvalue(Focus.release, "pending")
  local function refetch_pending()
    -- release(false) reassigns the module-local table; re-read it.
    pending = H.upvalue(Focus.release, "pending")
  end
  local function forget_all()
    Focus.release(false)
    refetch_pending()
    for _, term in pairs(vim.tbl_values(registry)) do
      term:close()
    end
  end
  local function last_notify()
    return notify_calls[#notify_calls]
  end

  -- ── patch idempotency: setup twice, base pass-through stays single ────
  local base_send, base_submit, base_on_ready = Terminal.send, Terminal.submit, Terminal.on_ready
  Focus.setup()
  Focus.setup()
  H.eq(Terminal._dotfiles_view_focus_send, base_send, "the second setup does not re-patch send")
  H.eq(Terminal._dotfiles_view_focus_submit, base_submit, "the second setup does not re-patch submit")
  H.eq(Terminal._dotfiles_view_focus_on_ready, base_on_ready, "the second setup does not re-patch on_ready")

  local plain = open(make_parent("plain", "terminal"))
  plain:send("abc")
  H.eq(#base.send, 1, "an open non-Herdr terminal sends through the base path")
  H.eq(base.send[1].input, "abc", "the base send receives the input verbatim")
  H.eq(base.send[1].term == plain, true, "the base send targets the same terminal")
  plain:submit()
  H.eq(#base.submit, 1, "an open non-Herdr terminal submits through the base path")
  H.eq(#base.send, 2, "the base submit routes its carriage return through the base send")
  H.eq(base.send[2].input, "\r", "the base submit sends a carriage return")
  plain:on_ready()
  H.eq(#base.on_ready, 1, "an open non-Herdr terminal runs the base on_ready")

  local wired = {}
  for _, a in ipairs(vim.api.nvim_get_autocmds({ group = "plugins.sidekick.view_focus" })) do
    wired[a.event] = true
  end
  for _, event in ipairs({ "FocusLost", "FocusGained", "TabEnter", "WinClosed" }) do
    H.truthy(wired[event], event .. " wiring is registered")
  end

  -- ── send-on-closed: no view and no queue -> reported, never silent ────
  local p1 = make_parent("p1", "herdr")
  local t1 = open(p1)
  t1.closed = true
  t1:send("lost input")
  H.eq(#base.send, 2, "a closed Herdr terminal never reaches the base send")
  H.eq(t1.detached, 1, "send-on-closed detaches the dead local client")
  H.truthy(last_notify() ~= nil and last_notify().msg:find("not delivered", 1, true) ~= nil,
    "an undeliverable input reports failure (never a silent success)")
  H.eq(last_notify().level, vim.log.levels.WARN, "the undeliverable-input notice is a warning")

  -- ── release with memory: snapshot fields, closed client, live parent ──
  local p2 = make_parent("p2", "herdr")
  local t2 = open(p2)
  t2.normal_mode = true
  t2.send_queue = { "queued\r\nat release" }
  local t2_tab = vim.api.nvim_win_get_tabpage(t2.win)
  Focus.release(true)
  H.eq(t2.closed, true, "release closes the local client")
  H.eq(p2.alive, true, "the durable parent keeps running")
  H.truthy(pending["p2"] ~= nil, "release remembers the view")
  H.eq(pending["p2"].parent == p2, true, "the saved view points at the parent")
  H.eq(pending["p2"].tab, t2_tab, "the saved view records its tab")
  H.eq(pending["p2"].normal_mode, true, "the saved view records normal mode")
  t2.send_queue[1] = "mutated after release"
  H.eq(pending["p2"].send_queue, { "queued\r\nat release" },
    "the saved queue is a copy, not a shared table")

  -- ── send-on-closed with a saved view: the input queues for replay ─────
  t2:send("late input")
  H.eq(#base.send, 2, "a queued input never reaches the base send")
  H.eq(pending["p2"].send_queue, { "queued\r\nat release", "late input" },
    "the late input joins the pending queue")

  -- ── send-on-closed with a live sibling view: the input routes there ───
  local live = open(p2)
  t2:send("route me")
  H.eq(#base.send, 3, "the input routes to the current view of the parent")
  H.eq(base.send[#base.send].term == live, true, "the sibling view receives it")
  H.eq(base.send[#base.send].input, "route me", "the routed input is verbatim")

  -- ── submit-on-closed routes through send("\r") ────────────────────────
  local base_submits = #base.submit
  t2:submit()
  H.eq(#base.submit, base_submits, "the base submit is bypassed on a closed view")
  H.eq(base.send[#base.send].input, "\r", "submit on a closed view sends a carriage return")
  live:submit()
  H.eq(#base.submit, base_submits + 1, "an open view submits through the base path")

  plain:close()
  plain:send("still base")
  H.eq(base.send[#base.send].term == plain, true,
    "a closed non-Herdr terminal keeps the base send")

  -- ── layout snapshot: float stays float, split shows its real shape ────
  local pf = make_parent("pf", "herdr")
  local tf = open(pf, true) -- a real floating window
  tf.opts.layout = "float"
  Focus.release(true)
  H.eq(pending["pf"].opts.layout, "float", "a floating window restores as float")

  local ps = make_parent("ps", "herdr")
  local ts = open(ps) -- a split window
  ts.opts.layout = "float" -- stale opts; the window is a split now
  Focus.release(true)
  H.eq(pending["ps"].opts.layout, "right",
    "a split window restores as right, not from stale float opts")

  -- ── manual release forgets everything ─────────────────────────────────
  forget_all()
  H.eq(vim.tbl_isempty(pending), true, "a full release forgets all saved views")
  vim.cmd.SidekickRelease()
  refetch_pending()
  H.eq(vim.tbl_isempty(pending), true, "the command path clears the saved views too")

  -- ── the FocusLost wiring releases with memory; unfocused resume is off ─
  local pg = make_parent("pg", "herdr")
  local tg = open(pg)
  vim.api.nvim_exec_autocmds("FocusLost", {})
  H.eq(tg.closed, true, "the FocusLost wiring releases the local view")
  H.truthy(pending["pg"] ~= nil, "the release remembers the view")
  local before_attach = Session.attach_calls
  Focus.resume()
  H.eq(Session.attach_calls, before_attach, "resume while unfocused attaches nothing")
  H.truthy(pending["pg"] ~= nil, "an unfocused resume keeps the view saved")
  vim.api.nvim_exec_autocmds("FocusGained", {})
  H.eq(Session.attach_calls, before_attach + 1, "the FocusGained wiring restores the view")
  local restored_g = view_of(pg)
  H.truthy(restored_g ~= nil and restored_g ~= tg, "the restored client is a new one")

  -- ── resume edge paths ─────────────────────────────────────────────────
  forget_all()
  local first_tab = vim.api.nvim_get_current_tabpage()

  pending["gone"] = { parent = make_parent("gone", "herdr"), tab = 999999, opts = {}, send_queue = {} }
  Focus.resume()
  H.eq(pending["gone"], nil, "a view whose tab closed is dropped")

  -- A view in another tab does not restore until that tab is entered.
  vim.cmd("tabnew")
  local other_tab = vim.api.nvim_get_current_tabpage()
  vim.api.nvim_set_current_tabpage(first_tab)
  pending["other"] = { parent = make_parent("other", "herdr"), tab = other_tab, opts = {}, send_queue = {} }
  before_attach = Session.attach_calls
  Focus.resume()
  H.eq(Session.attach_calls, before_attach, "a foreign-tab view does not attach here")
  H.truthy(pending["other"] ~= nil, "the foreign-tab view stays saved")
  vim.api.nvim_set_current_tabpage(other_tab) -- fires TabEnter -> resume
  H.eq(Session.attach_calls, before_attach + 1, "entering the tab restores its view")
  vim.cmd("tabclose")
  vim.cmd("sleep 10m") -- flush the tabclose window handlers now, not later
  H.eq(pending["other"], nil, "closing the tab drops its saved view")

  -- A client already attached without restore state clears the saved view.
  forget_all()
  local pd = make_parent("dup", "herdr")
  open(pd)
  pending["dup"] = { parent = pd, tab = first_tab, opts = {}, send_queue = {} }
  before_attach = Session.attach_calls
  Focus.resume()
  H.eq(Session.attach_calls, before_attach, "no second client is attached for a live view")
  H.eq(pending["dup"], nil, "the duplicate-gain guard clears the saved view")

  -- An exited parent is never resurrected.
  forget_all()
  local dead = make_parent("dead", "herdr")
  dead.alive = false
  pending["dead"] = { parent = dead, tab = first_tab, opts = {}, send_queue = {} }
  Focus.resume()
  H.eq(pending["dead"], nil, "an exited durable agent is not resurrected")

  -- Indeterminate liveness keeps the view saved without attaching.
  local indet = make_parent("indet", "herdr")
  indet.alive = nil
  pending["indet"] = { parent = indet, tab = first_tab, opts = {}, send_queue = {} }
  before_attach = Session.attach_calls
  Focus.resume()
  H.eq(pending["indet"] ~= nil, true, "indeterminate liveness keeps the view")
  H.eq(Session.attach_calls, before_attach, "indeterminate liveness attaches nothing")

  -- A failed attachment reports the failure and keeps the view for retry.
  local perr = make_parent("err", "herdr")
  perr.attach_error = true
  pending["err"] = { parent = perr, tab = first_tab, opts = {}, send_queue = { "retry me" } }
  Focus.resume()
  H.truthy(pending["err"] ~= nil, "a failed restore keeps the view")
  H.truthy(last_notify() ~= nil
      and last_notify().msg:find("could not restore Herdr view", 1, true) ~= nil,
    "a failed restore reports the failure")
  H.eq(last_notify().level, vim.log.levels.WARN, "the restore failure is a warning")

  -- A quick-failing attachment is discarded but the view stays retryable.
  perr.attach_error = false
  perr.quick_fail = true
  Focus.resume()
  H.truthy(pending["err"] ~= nil, "a quick-failing restore keeps the view")
  H.truthy(last_notify() ~= nil
      and last_notify().msg:find("could not restore Herdr view", 1, true) ~= nil,
    "a quick-failing restore reports the failure")

  -- The retry succeeds and replays the queue exactly once.
  perr.quick_fail = false
  Focus.resume()
  local restored = view_of(perr)
  H.truthy(restored ~= nil, "the retried restore attaches a client")
  H.eq(restored.send_queue, { "retry me" }, "the saved queue was copied to the client")
  H.eq(restored._dotfiles_view_focus_restore == pending["err"], true,
    "the client carries the restore marker")

  restored:on_ready()
  H.eq(pending["err"], nil, "on_ready consumes the saved view")
  restored.timer._cb() -- the drain tick
  vim.cmd("sleep 10m") -- pump the one scheduled write
  H.eq(vim.api.nvim_buf_get_lines(restored.buf, 0, -1, false), { "retry me" },
    "the queued input is written to the client exactly once")
  H.eq(#restored.send_queue, 0, "the queue drains fully")
  restored.timer._cb() -- a second tick must add nothing
  vim.cmd("sleep 10m")
  H.eq(vim.api.nvim_buf_get_lines(restored.buf, 0, -1, false), { "retry me" },
    "the replay never repeats")

  -- A restored normal-mode view keeps its mode across the round trip.
  forget_all()
  local pr = make_parent("replay", "herdr")
  local tr = open(pr)
  tr.send_queue = { "first\r\nsecond" }
  tr.normal_mode = true
  vim.api.nvim_exec_autocmds("FocusLost", {})
  vim.api.nvim_exec_autocmds("FocusGained", {})
  local restored_r = view_of(pr)
  H.truthy(restored_r ~= nil and restored_r ~= tr, "the focus round trip swaps the client")
  H.eq(restored_r.normal_mode, true, "the restored client keeps normal mode")
  H.eq(restored_r.send_queue, { "first\r\nsecond" }, "the release-time queue was carried over")
  restored_r:on_ready()
  restored_r.timer._cb()
  vim.cmd("sleep 10m")
  H.eq(vim.api.nvim_buf_get_lines(restored_r.buf, 0, -1, false), { "first", "second" },
    "a multi-line queue entry replays as separate lines, once")
  H.eq(pending["replay"], nil, "the replay consumed the saved view")

  -- ── WinClosed wiring: closing the window releases client and memory ──
  forget_all()
  local pw = make_parent("winclosed", "herdr")
  local tw = open(pw)
  Focus.release(true)
  local tw2 = open(pw)
  H.truthy(pending["winclosed"] ~= nil, "the saved view exists before the window closes")
  vim.api.nvim_win_close(tw2.win, true)
  vim.cmd("sleep 10m") -- pump the scheduled WinClosed handler
  H.eq(tw2.closed, true, "closing the window releases the client")
  H.eq(pending["winclosed"], nil, "the WinClosed wiring forgets the saved view")

  restore_notify()
end)

print("sidekick_view_focus_spec: ok")
