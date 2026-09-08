-- Run: nvim --headless -u NONE -l scripts/test-sidekick-view-focus.lua
-- Real Sidekick terminal lifecycle, local cat clients; no production Herdr calls.
vim.opt.rtp:prepend(vim.fn.stdpath("data") .. "/lazy/sidekick.nvim")
vim.opt.rtp:prepend(vim.fn.getcwd() .. "/nvim/.config/nvim")
package.path = vim.fn.getcwd() .. "/nvim/.config/nvim/lua/?.lua;" .. package.path
vim.o.columns, vim.o.lines = 160, 50

local Config = require("sidekick.config")
local Session = require("sidekick.cli.session")
local Terminal = require("sidekick.cli.terminal")
local Cli = require("sidekick.cli")
local Focus = require("plugins.sidekick.view_focus")
Config.cli.watch = false
Config.cli.win.layout = "float"
Config.cli.win.float = { width = 0.8, height = 0.8 }
Config.cli.win.keys = {}
Config.cli.win.config = Focus.configure
Config.cli.tools.focus_test = { cmd = { "cat" }, native_scroll = true }
Session.register("terminal", Terminal)
Session.register("herdr", {
  attach = function(self)
    if self.attach_error then
      error("temporary attach failure")
    end
    return { cmd = { "cat" } }
  end,
  start = function()
    error("must never restart a durable agent")
  end,
  is_running = function(self)
    return self.alive
  end,
})
Session.backends.herdr.__index = Session.backends.herdr
Session.did_setup = true
Focus.setup()
Focus.setup() -- setup remains idempotent
local function event(name)
  vim.api.nvim_exec_autocmds(name, {})
end
local function drain()
  vim.wait(30, function()
    return false
  end)
end
local function parent(id)
  return Session.new({
    id = id,
    tool = require("sidekick.cli.tool").get("focus_test"),
    cwd = vim.fn.getcwd() .. "/" .. id,
    backend = "herdr",
    started = true,
    alive = true,
  })
end
local function open(p)
  -- The test cwd must exist, but sid remains unique per fake durable session.
  p.cwd = vim.fn.getcwd()
  local term = Session.attach(p)
  term:focus()
  assert(term:is_running(), "local client should start")
  return term
end
local function view(p)
  for _, term in pairs(Terminal.terminals) do
    if term.parent == p then
      return term
    end
  end
end
local function wait_for(term, text)
  assert(vim.wait(1000, function()
    if not term:buf_valid() then
      return false
    end
    local output = table.concat(vim.api.nvim_buf_get_lines(term.buf, 0, -1, false), "\n")
    return output:find(text, 1, true) ~= nil
  end, 10), "terminal did not receive " .. text)
end
local p = parent("one")
local term = open(p)
term.normal_mode = true
local original_job = term.job
local original_tab = vim.api.nvim_get_current_tabpage()
local before_enqueue = "queued before focus loss"
Cli.send({ msg = before_enqueue, filter = { session = term.id }, focus = false })
event("FocusLost")
assert(term.closed and not view(p), "focus loss must close the local attachment")
assert(p.alive, "durable session must survive release")
assert(vim.fn.jobwait({ original_job }, 1000)[1] ~= -1, "local client must stop")
drain()
event("FocusLost") -- repeated event must not forget the saved view
event("FocusGained")
local restored = assert(view(p), "focus gain must reattach the exact parent")
assert(restored ~= term and restored.parent.id == p.id)
assert(restored.normal_mode and restored:is_focused(), "restore focus and normal mode")
assert(restored.opts.layout == "float")
restored:on_ready()
wait_for(restored, before_enqueue)

event("FocusGained")
assert(view(p) == restored, "duplicate gain must not attach twice")
drain()
assert(view(p) == restored, "old close callbacks must not close the new client")

local before_write = "dequeued before focus loss"
Cli.send({ msg = before_write, filter = { session = restored.id }, focus = false })
drain()
local timer = restored.timer
timer:close()
local fake_timer = { closed = false }
function fake_timer:start(_, _, callback)
  callback()
end
function fake_timer:is_closing()
  return self.closed
end
function fake_timer:close()
  self.closed = true
end
restored.timer = fake_timer
local scheduled_write
local schedule = vim.schedule
vim.schedule = function(callback)
  assert(not scheduled_write, "expected one pending terminal write")
  scheduled_write = callback
end
restored:on_ready()
vim.schedule = schedule
assert(scheduled_write, "terminal send must schedule its write")
event("FocusLost")
scheduled_write()
event("FocusGained")
restored = assert(view(p), "dequeued send must retain its view")
restored:on_ready()
wait_for(restored, before_write)

package.loaded["plugins.sidekick.branding"] = {
  apply_split_for = function() end,
  apply = function() end,
  clear_split_styling = function() end,
}
local toggle = require("plugins.sidekick.float_toggle")
toggle.toggle()
drain()
assert(restored:win_valid() and restored:is_running(), "float/split conversion must retain the client")
assert(vim.api.nvim_win_get_config(restored.win).relative == "", "toggle must produce a split")
event("FocusLost")
event("FocusGained")
restored = assert(view(p), "split must survive handoff")
assert(restored.opts.layout == "right", "restore the actual layout, not stale float opts")
toggle.toggle()
drain()
assert(vim.api.nvim_win_get_config(restored.win).relative ~= "", "toggle back to float")
event("FocusLost")
event("FocusGained")
restored = assert(view(p))
assert(restored.opts.layout == "float", "restore floated split as float")
restored:hide()
drain()
assert(restored.closed and not view(p), "hidden clients must release sizing")
event("FocusLost")
event("FocusGained")
assert(not view(p), "hidden views must stay hidden")

term = open(p)
event("FocusLost")
vim.cmd.SidekickRelease()
event("FocusGained")
assert(not view(p), "manual release must cancel pending automatic reattachment")
term = open(p)
vim.api.nvim_win_close(term.win, true)
drain()
assert(term.closed, "closing the window directly must release its client")
term = open(p)
vim.cmd.SidekickRelease()
assert(term.closed and p.alive, "manual release must stop only the local client")
event("FocusGained")
assert(not view(p), "manual release must stay released")

term = open(p)
event("FocusLost")
p.alive = false
event("FocusGained")
assert(not view(p), "exited durable agents must not be resurrected")
p.alive = true
term = open(p)
event("FocusLost")
p.alive = nil
event("FocusGained")
assert(not view(p), "indeterminate liveness must not discard or restore the view")
p.alive = true
p.attach_error = true
event("FocusGained")
assert(not view(p), "failed attachment must retain the pending view")
p.attach_error = false
event("FocusGained")
assert(view(p), "pending view must retry after transient failures")
term = assert(view(p))
event("FocusLost")
local reopened = open(p)
event("FocusGained")
assert(view(p) == reopened, "explicit reopen must not create a duplicate")

vim.cmd.tabnew()
local second_tab = vim.api.nvim_get_current_tabpage()
local other = parent("two")
local other_term = open(other)
other_term.normal_mode = true
other_term:blur()
assert(not other_term:is_focused(), "background the normal-mode terminal before handoff")
event("FocusLost")
event("FocusGained")
local restored_other = assert(view(other), "restore only the current tab initially")
assert(not view(p))
assert(restored_other.normal_mode and not restored_other:is_focused(), "restore background terminal mode without focus")
vim.api.nvim_set_current_win(restored_other.win)
assert(vim.fn.mode() ~= "t", "entering the restored terminal must preserve normal mode")
vim.api.nvim_set_current_tabpage(original_tab)
assert(view(p), "restore suspended views on tab return")
assert(vim.api.nvim_get_current_tabpage() == original_tab, "restore must not switch tabs")
event("FocusLost")
vim.api.nvim_set_current_tabpage(second_tab)
assert(not view(other), "TabEnter while unfocused must not reacquire ownership")
vim.cmd.tabclose()
event("FocusGained")
assert(view(p) and not view(other), "closed tabs must not reopen")

-- Non-Herdr terminals are not ours to release.
local ordinary = Terminal.new({
  tool = require("sidekick.cli.tool").get("focus_test"),
  cwd = vim.fn.getcwd(),
  id = "ordinary",
})
ordinary:start()
event("FocusLost")
assert(ordinary:is_running(), "non-Herdr terminal must survive focus loss")
Focus.release(false)
ordinary:close()
drain()
assert(vim.tbl_isempty(Terminal.terminals), "test must leave no clients behind")
print("PASS sidekick-view-focus")
