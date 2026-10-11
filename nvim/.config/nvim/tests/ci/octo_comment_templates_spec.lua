-- plugins/octo/comment_templates.lua compose guard chain (offline harness).
--
-- The real module loads with no octo present; compose() only reaches
-- octo.reviews through a pcall'd require, so every guard branch runs
-- offline against stub modules preloaded in package.loaded (pattern A7).
-- Assertions check the notify level, the absence of side effects
-- (no comment buffer, no scheduled feedkeys), and the happy-path
-- prefix fed into the compose buffer.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local M = require("plugins.octo.comment_templates")

H.run("octo_comment_templates_spec", function()
  -- ── PREFIXES map (the four wired <localleader>c* keymaps) ──────────────
  local PREFIXES = H.upvalue(M.compose, "PREFIXES")
  H.eq(PREFIXES, {
    nit = "nit: ",
    q = "Q: ",
    b = "blocker: ",
    ["+"] = "+1, ",
  }, "PREFIXES pins the four keymap prefixes")

  -- ── recording stubs ────────────────────────────────────────────────────
  local notify_calls, restore_notify = H.capture_notify()
  local scheduled = {}
  local restore_schedule = H.replace(vim, "schedule", function(fn)
    scheduled[#scheduled + 1] = fn
  end)
  local fed = {}
  local restore_feedkeys = H.replace(vim.api, "nvim_feedkeys", function(keys, mode, escape)
    fed[#fed + 1] = { keys = keys, mode = mode, escape = escape }
  end)

  local state = { review = nil, add_calls = {} }
  local reviews = {
    get_current_review = function()
      return state.review
    end,
    add_review_comment = function(is_pending)
      state.add_calls[#state.add_calls + 1] = is_pending
    end,
  }
  package.loaded["octo.reviews"] = reviews

  -- ── unknown kind → ERROR notify, no side effect ────────────────────────
  M.compose("bogus")
  H.eq(#notify_calls, 1, "unknown kind notifies once")
  H.eq(notify_calls[1].level, vim.log.levels.ERROR, "unknown kind notifies at ERROR")
  H.truthy(tostring(notify_calls[1].msg):find("unknown kind", 1, true),
    "the notify names the unknown kind")
  H.eq(#state.add_calls, 0, "unknown kind opens no comment buffer")
  H.eq(#scheduled, 0, "unknown keymap schedules nothing")

  -- ── no review session → WARN, no side effect ───────────────────────────
  state.review = nil
  M.compose("nit")
  H.eq(#notify_calls, 2, "missing review notifies once")
  H.eq(notify_calls[2].level, vim.log.levels.WARN, "missing review notifies at WARN")
  H.truthy(tostring(notify_calls[2].msg):find("no active review", 1, true),
    "the notify says there is no active review")
  H.eq(#state.add_calls, 0, "missing review opens no comment buffer")
  H.eq(#scheduled, 0, "missing review schedules nothing")

  -- ── review.id == -1 (no pending review created yet) → same WARN ────────
  state.review = { id = -1 }
  M.compose("q")
  H.eq(#notify_calls, 3, "a -1 review id notifies once")
  H.eq(notify_calls[3].level, vim.log.levels.WARN, "a -1 review id notifies at WARN")
  H.eq(#state.add_calls, 0, "a -1 review id opens no comment buffer")
  H.eq(#scheduled, 0, "a -1 review id schedules nothing")

  -- ── octo.reviews require fails → ERROR via the pcall, no crash ─────────
  package.loaded["octo.reviews"] = nil
  package.preload["octo.reviews"] = function()
    error("octo module exploded")
  end
  M.compose("b")
  H.eq(#notify_calls, 4, "a failed require notifies once")
  H.eq(notify_calls[4].level, vim.log.levels.ERROR, "a failed require notifies at ERROR")
  H.truthy(tostring(notify_calls[4].msg):find("octo.reviews not available", 1, true),
    "the notify names the missing module")
  H.eq(#state.add_calls, 0, "a failed require opens no comment buffer")
  H.eq(#scheduled, 0, "a failed require schedules nothing")
  package.preload["octo.reviews"] = nil

  -- ── happy path: buffer opens, prefix feeds one tick later ──────────────
  package.loaded["octo.reviews"] = reviews
  state.review = { id = "RR_1" }
  for kind in pairs(PREFIXES) do
    M.compose(kind)
  end
  H.eq(#state.add_calls, 4, "each kind opened one comment buffer")
  H.truthy(vim.tbl_contains(state.add_calls, false), "add_review_comment runs as non-pending")
  H.eq(#scheduled, 4, "each kind queued one schedule tick")
  H.eq(#notify_calls, 4, "the happy path stays silent")

  for _, fn in ipairs(scheduled) do
    fn()
  end
  H.eq(#fed, 4, "each schedule tick fed the prefix exactly once")
  local by_keys = {}
  for _, f in ipairs(fed) do
    H.eq(f.mode, "n", "prefix feeds in normal mode")
    H.eq(f.escape, false, "prefix feeds unescaped")
    by_keys[f.keys] = true
  end
  for _, prefix in pairs(PREFIXES) do
    H.truthy(by_keys[prefix], "prefix '" .. prefix .. "' reached the compose buffer")
  end

  restore_feedkeys()
  restore_schedule()
  restore_notify()
end)
