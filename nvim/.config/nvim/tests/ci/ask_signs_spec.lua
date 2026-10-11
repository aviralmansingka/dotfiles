-- sidekick/ask/signs.lua spec (offline): extmark set/clear pairs and the
-- spinner timer.
--
-- The extmark APIs run for real on scratch buffers (they work headless);
-- only vim.uv.new_timer is stubbed, so the spinner never arms a real timer
-- and no sleep is ever needed. tick() is reached through H.upvalue on
-- start_spinner — the real private closure, never a copy.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local signs = require("plugins.sidekick.ask.signs")
local state = require("plugins.sidekick.ask.state")

local function fresh_buffer(lines)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  return buf
end

--- Fetch one extmark's details by id ({} when deleted).
local function mark_details(buf, id)
  local pos = vim.api.nvim_buf_get_extmark_by_id(buf, signs.ns, id, { details = true })
  if not pos or pos[1] == nil then
    return nil
  end
  local d = pos[3] or {}
  -- nvim pads sign_text to two display cells; compare the real glyph.
  return {
    line = pos[1],
    details = {
      sign_text = (d.sign_text or ""):gsub("%s+$", ""),
      sign_hl_group = d.sign_hl_group,
      priority = d.priority,
    },
  }
end

H.run("ask_signs_spec", function()
  H.truthy(type(signs.ns) == "number" and signs.ns > 0, "namespace id is a real handle")

  local buf = fresh_buffer({ "one", "two", "three", "four", "five" })

  -- ── anchor + range bar set pairs ────────────────────────────────────
  local anchor = signs.create_anchor(buf, 1, "ask")
  local m = mark_details(buf, anchor)
  H.truthy(m, "anchor extmark exists after create_anchor")
  H.eq(m.line, 1, "anchor sits on the requested line")
  H.eq(m.details.sign_text, "⠋", "anchor starts on spinner frame 1")
  H.eq(m.details.sign_hl_group, "SidekickAskSign", "ask anchor uses the ask highlight")
  H.eq(m.details.priority, 30, "anchor uses spinner priority")

  local edit_anchor = signs.create_anchor(buf, 4, "edit")
  local em = mark_details(buf, edit_anchor)
  H.eq(em.details.sign_hl_group, "SidekickEditSign", "edit anchor uses the edit highlight")

  local bar = signs.create_range_bar(buf, 2, 3, "ask")
  H.eq(#bar, 2, "range bar creates one extmark per line")
  H.eq(mark_details(buf, bar[1]).line, 2, "first range extmark on start line")
  H.eq(mark_details(buf, bar[2]).line, 3, "last range extmark on end line")
  H.eq(mark_details(buf, bar[1]).details.sign_text, "│", "range bar uses the bar glyph")
  H.eq(mark_details(buf, bar[1]).details.sign_hl_group, "SidekickAskRange", "range bar uses the range highlight")
  H.eq(mark_details(buf, bar[1]).details.priority, 20, "range bar uses range priority")

  -- ── mark_done rewrites the anchor sign in place ─────────────────────
  signs.mark_done(buf, { mode = "ask", extmark_id = anchor, range_extmarks = {} })
  local dm = mark_details(buf, anchor)
  H.eq(dm.details.sign_text, "?", "ask done icon replaces the spinner")
  H.eq(dm.line, 1, "mark_done keeps the anchor position")
  signs.mark_done(buf, { mode = "edit", extmark_id = edit_anchor, range_extmarks = {} })
  H.eq(mark_details(buf, edit_anchor).details.sign_text, "±", "edit done icon is ±")

  -- mark_done on a deleted anchor must be a no-op, not an error
  local ghost = vim.api.nvim_buf_set_extmark(buf, signs.ns, 0, 0, {})
  vim.api.nvim_buf_del_extmark(buf, signs.ns, ghost)
  signs.mark_done(buf, { mode = "ask", extmark_id = ghost, range_extmarks = {} })

  -- ── clear removes exactly the entry's marks ─────────────────────────
  signs.clear(buf, { mode = "ask", extmark_id = anchor, range_extmarks = bar })
  H.eq(mark_details(buf, anchor), nil, "clear removes the anchor")
  H.eq(mark_details(buf, bar[1]), nil, "clear removes range extmarks")
  H.eq(mark_details(buf, bar[2]), nil, "clear removes the last range extmark")
  H.truthy(mark_details(buf, edit_anchor), "clear leaves other entries' marks alone")
  -- clearing an already-cleared entry must not error
  signs.clear(buf, { mode = "ask", extmark_id = anchor, range_extmarks = bar })

  -- ── spinner: fake uv timer, no real arming ──────────────────────────
  local created, starts, stops, closes = 0, 0, 0, 0
  local restore_timer = H.replace(vim.uv, "new_timer", function()
    created = created + 1
    return {
      start = function() starts = starts + 1 end,
      stop = function() stops = stops + 1 end,
      close = function() closes = closes + 1 end,
    }
  end)

  signs.stop_spinner() -- no timer yet: idempotent no-op
  H.eq(created, 0, "stop without a timer creates nothing")

  signs.start_spinner()
  H.eq(created, 1, "start_spinner creates one timer")
  H.eq(starts, 1, "timer armed once")
  signs.start_spinner() -- second start while running: no new timer
  H.eq(created, 1, "start_spinner is idempotent while running")
  H.eq(starts, 1, "idempotent start does not re-arm")

  signs.stop_spinner()
  H.eq(stops, 1, "stop_spinner stops the timer")
  H.eq(closes, 1, "stop_spinner closes the timer")
  signs.stop_spinner() -- second stop: idempotent
  H.eq(stops, 1, "second stop is a no-op")

  signs.start_spinner() -- restart after stop creates a fresh timer
  H.eq(created, 2, "restart after stop creates a new timer")

  -- ── tick drives frames without a real timer ─────────────────────────
  local tick = H.upvalue(signs.start_spinner, "tick")
  local tbuf = fresh_buffer({ "x", "y" })
  local tanchor = signs.create_anchor(tbuf, 0, "edit")
  local entry = {
    kind = "line",
    mode = "edit",
    extmark_id = tanchor,
    range_extmarks = {},
    status = "pending",
    spinner_frame = 1,
  }
  state.add(tbuf, entry)
  signs.start_spinner()
  tick()
  H.eq(entry.spinner_frame, 2, "tick advances the spinner frame")
  H.eq(mark_details(tbuf, tanchor).details.sign_text, "⠙", "tick writes spinner frame 2 to the sign")
  H.eq(mark_details(tbuf, tanchor).details.sign_hl_group, "SidekickEditSign", "tick keeps the mode highlight")
  tick()
  H.eq(entry.spinner_frame, 3, "tick advances again")

  -- no pending entries left -> tick stops the spinner itself
  entry.status = "done"
  local stops_before = stops
  tick()
  H.eq(stops, stops_before + 1, "tick stops the timer when nothing is pending")

  -- ── ensure_spinner_running ──────────────────────────────────────────
  local created_before = created
  signs.ensure_spinner_running() -- nothing pending: creates nothing
  H.eq(created, created_before, "ensure_spinner_running is a no-op with no pending entries")
  entry.status = "pending"
  signs.ensure_spinner_running() -- pending present: arms the spinner
  H.eq(created, created_before + 1, "ensure_spinner_running starts with a pending entry")

  -- leave the fake timer slot clean for the rest of the process
  entry.status = "done"
  signs.stop_spinner()
  restore_timer()
  state.cleanup_all()
end)
