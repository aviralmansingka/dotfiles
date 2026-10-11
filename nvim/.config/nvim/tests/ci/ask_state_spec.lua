-- sidekick/ask/state.lua anchor table spec (offline).
--
-- Covers: add/remove/entries lifecycle, find_at anchor math with a stubbed
-- nvim_buf_get_extmark_by_id (line + range boundaries), anchor drift
-- detection (a deleted extmark removes the entry — real nvim returns {}
-- for a deleted mark, both against the real API and the stub), and
-- cleanup_buffer/cleanup_all killing sysobj processes (the orphan class).

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local state = require("plugins.sidekick.ask.state")
local ns = vim.api.nvim_create_namespace("ask_state_spec")

local function fresh_buffer(lines)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  return buf
end

local function first_id(...)
  return (select(1, ...))
end

local function fake_sysobj(log)
  return {
    kill = function(_, sig)
      log[#log + 1] = sig
    end,
  }
end

H.run("ask_state_spec", function()
  -- ── add / entries / remove lifecycle ────────────────────────────────
  local buf = fresh_buffer({ "one", "two", "three", "four", "five", "six", "seven" })
  local e1 = { kind = "line", mode = "ask", extmark_id = 501, question = "q1", status = "pending" }
  local id1 = state.add(buf, e1)
  H.eq(id1, state.next_anchor_id - 1, "add returns the id it consumed")
  H.eq(state.entries(buf)[id1], e1, "entries returns the exact entry table")

  local e2 = { kind = "line", mode = "ask", extmark_id = 502, question = "q2", status = "pending" }
  local id2 = state.add(buf, e2)
  H.truthy(id2 > id1, "anchor ids are monotonic")
  H.eq(state.by_extmark[buf][501], id1, "by_extmark maps extmark to anchor id")

  state.remove(buf, id1)
  H.eq(state.entries(buf)[id1], nil, "remove drops the entry")
  H.eq(state.by_extmark[buf][501], nil, "remove drops the by_extmark mapping")
  state.remove(buf, id2)
  H.eq(state.state[buf], nil, "removing the last entry clears the buffer key")
  H.eq(state.by_extmark[buf], nil, "by_extmark buffer key cleared too")
  state.remove(buf, 9999) -- unknown anchor: must not error
  state.remove(424242, 1) -- unknown buffer: must not error

  -- ── find_at anchor math with a stubbed extmark reader ───────────────
  -- Synthetic buffer id 9001; extmark positions served from a map so the
  -- boundary math is exact. Unknown/deleted marks return {} (the real
  -- nvim_buf_get_extmark_by_id return for a deleted mark).
  local SYN = 9001
  local positions = {
    [101] = { 5, 0 }, -- line-kind anchor
    [201] = { 10, 0 }, -- range-kind anchor
    [202] = { 11, 0 },
    [203] = { 12, 0 }, -- last range extmark
  }
  local restore_get = H.replace(vim.api, "nvim_buf_get_extmark_by_id", function(b, _, mark, _)
    if b ~= SYN then
      return {}
    end
    return positions[mark] or {}
  end)

  local line_entry = { kind = "line", mode = "ask", extmark_id = 101, status = "pending" }
  local line_id = state.add(SYN, line_entry)
  local found_id, found = state.find_at(SYN, 5, ns)
  H.eq(found_id, line_id, "find_at matches the anchor line exactly")
  H.eq(found, line_entry, "find_at returns the entry")
  H.eq(first_id(state.find_at(SYN, 4, ns)), nil, "line above the anchor does not match")
  H.eq(first_id(state.find_at(SYN, 6, ns)), nil, "line below the anchor does not match")

  local range_entry = {
    kind = "range",
    mode = "edit",
    extmark_id = 201,
    range_extmarks = { 202, 203 },
    status = "pending",
  }
  local range_id = state.add(SYN, range_entry)
  for line = 10, 12 do
    H.eq(first_id(state.find_at(SYN, line, ns)), range_id,
      "find_at matches every line inside the range (" .. line .. ")")
  end
  H.eq(first_id(state.find_at(SYN, 9, ns)), nil, "line above the range does not match")
  H.eq(first_id(state.find_at(SYN, 13, ns)), nil, "line below the range does not match")
  -- the line-kind entry is still found independently
  H.eq(first_id(state.find_at(SYN, 5, ns)), line_id, "entries do not shadow each other")

  -- ── anchor drift: a deleted anchor extmark removes the entry ────────
  positions[101] = nil
  H.eq(first_id(state.find_at(SYN, 5, ns)), nil, "a drifted anchor no longer matches")
  H.eq(state.entries(SYN)[line_id], nil, "the drifted entry was removed by find_at")
  H.eq(state.by_extmark[SYN][101], nil, "the drifted entry's mapping was removed too")

  restore_get()

  -- ── drift against the REAL nvim api ─────────────────────────────────
  local buf2 = fresh_buffer({ "a", "b", "c" })
  local mark = vim.api.nvim_buf_set_extmark(buf2, ns, 1, 0, {})
  local real_entry = { kind = "line", mode = "ask", extmark_id = mark, status = "pending" }
  local real_id = state.add(buf2, real_entry)
  H.eq(first_id(state.find_at(buf2, 1, ns)), real_id, "real extmark matches its line")
  vim.api.nvim_buf_del_extmark(buf2, ns, mark)
  H.eq(first_id(state.find_at(buf2, 1, ns)), nil, "deleted real extmark no longer matches")
  H.eq(state.entries(buf2)[real_id], nil, "deleted real extmark removed its entry (drift)")

  -- ── cleanup_buffer kills sysobj processes (orphan class) ────────────
  local kill_log = {}
  local p1 = fake_sysobj(kill_log)
  local p2 = fake_sysobj(kill_log)
  local cbuf = fresh_buffer({ "x" })
  state.add(cbuf, { kind = "line", mode = "ask", extmark_id = 1, status = "pending", sysobj = p1 })
  state.add(cbuf, { kind = "line", mode = "ask", extmark_id = 2, status = "pending", sysobj = p2 })
  state.cleanup_buffer(cbuf)
  H.eq(kill_log, { "sigterm", "sigterm" }, "cleanup_buffer sigterms every sysobj")
  H.eq(state.state[cbuf], nil, "cleanup_buffer clears the anchor table")
  H.eq(state.by_extmark[cbuf], nil, "cleanup_buffer clears by_extmark")
  state.cleanup_buffer(cbuf) -- idempotent on an already-clean buffer
  state.cleanup_buffer(555555) -- unknown buffer: must not error

  -- a sysobj whose kill() throws must not abort cleanup of the rest
  local kill_log2 = {}
  local bad = { kill = function() error("already dead") end }
  local good = fake_sysobj(kill_log2)
  local cbuf2 = fresh_buffer({ "x" })
  state.add(cbuf2, { kind = "line", mode = "ask", extmark_id = 1, status = "pending", sysobj = bad })
  state.add(cbuf2, { kind = "line", mode = "ask", extmark_id = 2, status = "pending", sysobj = good })
  state.cleanup_buffer(cbuf2)
  H.eq(kill_log2, { "sigterm" }, "a throwing sysobj kill is isolated via pcall")
  H.eq(state.state[cbuf2], nil, "cleanup completes despite a throwing kill")

  -- ── cleanup_all sweeps every buffer ─────────────────────────────────
  local kill_log3 = {}
  local b1 = fresh_buffer({ "x" })
  local b2 = fresh_buffer({ "x" })
  state.add(b1, { kind = "line", mode = "ask", extmark_id = 1, status = "pending", sysobj = fake_sysobj(kill_log3) })
  state.add(b2, { kind = "line", mode = "ask", extmark_id = 2, status = "pending", sysobj = fake_sysobj(kill_log3) })
  state.cleanup_all()
  H.eq(kill_log3, { "sigterm", "sigterm" }, "cleanup_all kills sysobjs across buffers")
  H.eq(next(state.state), nil, "cleanup_all empties the whole anchor table")
end)
