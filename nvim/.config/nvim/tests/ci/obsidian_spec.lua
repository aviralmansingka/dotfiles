-- helpers/obsidian.lua weekly-backlog date math (CI row X11, #84).
--
-- The clock is frozen via an os.time stub and the vault is redirected to a
-- temp root, so file creation and heading placement are deterministic.
-- The entry runs this case once per TZ: America/New_York (DST boundary
-- fixtures — os.date cannot switch zones inside one process) and UTC.
-- Expected ids are pinned from the ISO calendar, not recomputed in-test.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local tz = os.getenv("TZ") or "UTC"
local backlog = require("helpers.obsidian")

-- Frozen instants (noon local, so a DST shift can never move the date).
-- Epochs from the zoneinfo calendar:
--   2026-03-08 12:00 America/New_York = 1772985600 (spring-forward Sunday)
--   2026-07-25 12:00 UTC              = 1784980800
local fixtures = {
  ["America/New_York"] = {
    now = 1772985600,
    base_date = { year = 2026, month = 3, day = 8 },
    today = { week = "2026-W10", heading = "### Sunday, 2026-03-08" },
    yesterday = { week = "2026-W10", heading = "### Saturday, 2026-03-07" },
    tomorrow = { week = "2026-W11", heading = "### Monday, 2026-03-09" },
    scope_date = { year = 2026, month = 4, day = 6 },
    scope_week = "2026-W15",
    scope_heading = "### Monday, 2026-04-06",
  },
  UTC = {
    now = 1784980800,
    base_date = { year = 2026, month = 7, day = 25 },
    today = { week = "2026-W30", heading = "### Saturday, 2026-07-25" },
    yesterday = { week = "2026-W30", heading = "### Friday, 2026-07-24" },
    tomorrow = { week = "2026-W30", heading = "### Sunday, 2026-07-26" },
    scope_date = { year = 2026, month = 4, day = 6 },
    scope_week = "2026-W15",
    scope_heading = "### Monday, 2026-04-06",
  },
}
local fx = fixtures[tz] or error("obsidian_spec: unsupported TZ fixture " .. tz, 0)

H.run("obsidian_spec[" .. tz .. "]", function()
  local root = vim.fn.tempname() .. "-obsidian"
  vim.fn.mkdir(root .. "/3_logs", "p")

  -- Redirect ~/vault to the temp root and freeze the clock.
  local original_expand = vim.fn.expand
  local original_time = os.time
  local fixed_now = fx.now
  vim.fn.expand = function(path, ...)
    if type(path) == "string" and path:sub(1, 7) == "~/vault" then
      return root .. path:sub(8)
    end
    return original_expand(path, ...)
  end
  os.time = function(value)
    if value == nil then
      return fixed_now
    end
    return original_time(value)
  end

  local function open_at(date, offset)
    fixed_now = original_time(vim.tbl_extend("force", { hour = 12, min = 0, sec = 0 }, date))
    vim.cmd("enew!")
    backlog.open_weekly_backlog(offset or 0)
  end

  local function path_for(week)
    return root .. "/3_logs/" .. week .. "/backlog.md"
  end

  local function assert_exists(path)
    if vim.fn.filereadable(path) ~= 1 then
      error("expected backlog file: " .. path, 2)
    end
  end

  local function assert_heading(heading)
    if vim.fn.search("^" .. heading .. "$", "nw") == 0 then
      error("missing heading " .. heading .. " in " .. vim.fn.expand("%"), 2)
    end
  end

  -- ── Day and week ids across the today/yesterday/tomorrow offsets ────────
  open_at(fx.base_date)
  assert_exists(path_for(fx.today.week))
  assert_heading(fx.today.heading)

  backlog.yesterday()
  assert_exists(path_for(fx.yesterday.week))
  assert_heading(fx.yesterday.heading)

  backlog.tomorrow()
  assert_exists(path_for(fx.tomorrow.week))
  assert_heading(fx.tomorrow.heading)

  -- Canonical file skeleton for a fresh week.
  local fresh_week = fx.scope_week
  local fresh = path_for(fresh_week)
  vim.fn.mkdir(vim.fs.dirname(fresh), "p")
  vim.fn.writefile({ "stale" }, fresh)
  open_at(fx.scope_date)
  local lines = vim.fn.readfile(fresh)
  H.eq(lines, {
    "stale",
    "",
    "## Log",
    "",
    fx.scope_heading,
    "",
  }, "a file without ## Log gets the Log section and today's heading appended")

  -- ── First-##-Log-only heading placement ─────────────────────────────────
  local scoped = path_for(fresh_week)
  vim.fn.writefile({
    "# Existing",
    "",
    fx.scope_heading,
    "",
    "outside log",
    "",
    "## Log",
    "",
    "existing log",
    "",
    "## Backlog",
    "",
    "- keep",
  }, scoped)
  open_at(fx.scope_date)
  local scoped_lines = vim.fn.readfile(scoped)
  local log_idx, backlog_idx, heading_in_log, heading_count = nil, nil, nil, 0
  for i, line in ipairs(scoped_lines) do
    if line == "## Log" then
      log_idx = log_idx or i
    elseif line == "## Backlog" then
      backlog_idx = backlog_idx or i
    elseif line == fx.scope_heading then
      heading_count = heading_count + 1
      if log_idx and not backlog_idx then
        heading_in_log = i
      end
    end
  end
  H.eq(heading_count, 2, "the crafted fixture keeps both dated headings")
  H.truthy(heading_in_log and heading_in_log > log_idx and heading_in_log < backlog_idx,
    "a dated heading is inserted inside the FIRST ## Log, before the next section")
  H.eq(scoped_lines[5], "outside log", "content before Log is untouched")

  -- Reopening the same day reuses the existing heading, never duplicates it.
  open_at(fx.scope_date)
  local after_reopen = vim.fn.readfile(scoped)
  local count = 0
  for _, line in ipairs(after_reopen) do
    if line == fx.scope_heading then
      count = count + 1
    end
  end
  H.eq(count, 2, "opening an already-headed day does not insert a second heading")

  -- The cursor lands below the day heading, ready for input.
  local cursor = vim.api.nvim_win_get_cursor(0)
  H.truthy(cursor[1] > heading_in_log and cursor[1] <= vim.api.nvim_buf_line_count(0),
    "the cursor moves below the day heading inside the Log section")

  -- open_daily_note stays an alias of the weekly backlog.
  local opened = false
  local saved_open = backlog.open_weekly_backlog
  backlog.open_weekly_backlog = function(offset)
    opened = offset
  end
  backlog.open_daily_note(0)
  backlog.open_daily_note(3)
  backlog.open_weekly_backlog = saved_open
  H.eq(opened, 3, "open_daily_note forwards its offset to the weekly backlog")

  vim.fn.expand = original_expand
  os.time = original_time
end)
