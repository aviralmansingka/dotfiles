-- plugins/octo/pr_review_picker.lua pure halves (offline harness).
--
-- gh-search flag assembly runs through the REAL M.open with vim.system,
-- vim.schedule and Snacks stubbed (pattern A7): the recorder captures the
-- exact argv, the dedup/reason mapping runs in the real callbacks, and the
-- completion path opens the stubbed picker. to_item / preview_lines /
-- iso_days_ago are the real file-locals reached via H.upvalue. The live
-- `gh` process is never started; see docs/ci-tests/nvim-octo.md for the
-- no-test rows.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local M = require("plugins.octo.pr_review_picker")

local JSON_FIELDS = "number,title,url,repository,state,author,updatedAt,closedAt"

H.run("octo_pr_review_picker_spec", function()
  -- ── real file-locals through the closure graph ─────────────────────────
  local show = H.upvalue(M.open, "show")
  local to_item = H.upvalue(M.open, "to_item")
  local iso_days_ago = H.upvalue(M.open, "iso_days_ago")
  local preview_lines = H.upvalue(show, "preview_lines")

  -- iso_days_ago on a frozen clock
  local FIXED = 1700000000
  local restore_time = H.replace(os, "time", function()
    return FIXED
  end)
  H.eq(iso_days_ago(7), os.date("!%Y-%m-%d", FIXED - 7 * 86400),
    "iso_days_ago(7) is the UTC date one week back")
  H.eq(iso_days_ago(0), os.date("!%Y-%m-%d", FIXED), "iso_days_ago(0) is today (UTC)")
  H.eq(iso_days_ago(7), "2023-11-07", "the frozen clock pins the date")
  local since = os.date("!%Y-%m-%d", FIXED - 7 * 86400)

  -- to_item
  local item = to_item({
    number = 42,
    title = "Fix it",
    url = "https://github.com/o/n/pull/42",
    repository = { nameWithOwner = "o/n" },
    state = "OPEN",
    author = { login = "alice" },
    updatedAt = "2024-01-02T03:04:05Z",
    closedAt = "2024-01-03T00:00:00Z",
  }, "review")
  H.eq(item.repo, "o/n")
  H.eq(item.number, 42)
  H.eq(item.title, "Fix it")
  H.eq(item.state, "open", "state lowercases")
  H.eq(item.author, "alice")
  H.eq(item.reason, "review")
  H.eq(item.closed_at, "2024-01-03T00:00:00Z")
  H.eq(item.text, "o/n#42 Fix it @alice", "search text joins repo#number title @author")

  local bare = to_item({ number = 7, url = "u7" }, "assigned")
  H.eq(bare.repo, "?", "a missing repository renders ?")
  H.eq(bare.author, "", "a missing author renders empty")
  H.eq(bare.title, "", "a missing title renders empty")
  H.eq(bare.state, "", "a missing state renders empty")
  H.eq(bare.text, "?#7  @", "degraded inputs still build a searchable text")

  -- preview_lines
  local lines = preview_lines(item)
  H.eq(lines[1], "o/n#42  open", "the header joins repo#number and state")
  H.eq(lines[2], "Fix it")
  H.eq(lines[3], "")
  H.eq(lines[4], "reason:    review-requested", "the review reason maps to its label")
  H.eq(lines[5], "author:    @alice")
  H.eq(lines[6], "updated:   2024-01-02T03:04:05Z")
  H.eq(lines[7], "closed:    2024-01-03T00:00:00Z", "a closed item shows its closed date")
  H.eq(lines[8], "url:       https://github.com/o/n/pull/42")

  local open_lines = preview_lines(to_item({ number = 8, url = "u8" }, "assigned"))
  H.eq(open_lines[4], "reason:    assigned (open)", "the assigned reason maps to its label")
  H.eq(open_lines[7], "url:       u8", "an open item shows no closed line")

  local merged_lines = preview_lines(to_item(
    { number = 9, url = "u9", closedAt = "2024-02-02" }, "assigned-merged"))
  H.eq(merged_lines[4], "reason:    assigned (merged)", "the merged reason maps to its label")

  local unknown_lines = preview_lines(to_item({ number = 10, url = "u10" }, "weird"))
  H.eq(unknown_lines[4], "reason:    weird", "an unknown reason passes through raw")
  local anon = preview_lines(to_item({ number = 11, url = "u11" }, "review"))
  H.eq(anon[5], "author:    @?", "a missing author renders @?")

  -- ── M.open against a stubbed vim.system ────────────────────────────────
  local notify_calls, restore_notify = H.capture_notify()
  local scheduled = {}
  local restore_schedule = H.replace(vim, "schedule", function(fn)
    scheduled[#scheduled + 1] = fn
  end)
  local pick_calls = {}
  package.loaded["snacks"] = {
    picker = {
      pick = function(opts)
        pick_calls[#pick_calls + 1] = opts
      end,
    },
  }

  local PR_A = {
    number = 1, title = "Review me", url = "https://x/a/1",
    repository = { nameWithOwner = "x/a" }, state = "OPEN",
    author = { login = "aa" }, updatedAt = "u1",
  }
  local PR_B = {
    number = 2, title = "Assigned", url = "https://x/b/2",
    repository = { nameWithOwner = "x/b" }, state = "OPEN",
    author = { login = "bb" }, updatedAt = "u2",
  }
  local PR_C = {
    number = 3, title = "Merged", url = "https://x/c/3",
    repository = { nameWithOwner = "x/c" }, state = "MERGED",
    author = { login = "cc" }, updatedAt = "u3", closedAt = "2024-01-01",
  }

  local cmds = {}
  local mode = "ok" -- "ok" returns fixtures, "fail" simulates gh failure
  local restore_system = H.replace(vim, "system", function(cmd, _opts, cb)
    cmds[#cmds + 1] = cmd
    if mode == "fail" then
      cb({ code = 1, stdout = "", stderr = "gh exploded" })
      return
    end
    local joined = table.concat(cmd, " ")
    local out
    if joined:find("--review-requested=@me", 1, true) then
      out = { PR_A }
    elseif joined:find("--merged", 1, true) then
      out = { PR_C }
    else
      out = { PR_A, PR_B }
    end
    cb({ code = 0, stdout = vim.json.encode(out), stderr = "" })
  end)

  -- ── happy path: exact argv, dedup, reason labels ───────────────────────
  M.open()
  H.eq(#cmds, 3, "three gh searches ran")
  H.eq(cmds[1], { "gh", "search", "prs", "--review-requested=@me", "--state=open",
    "--json", JSON_FIELDS, "--limit", "100" }, "review-requested argv assembles exactly")
  H.eq(cmds[2], { "gh", "search", "prs", "--assignee=@me", "--state=open",
    "--json", JSON_FIELDS, "--limit", "100" }, "assigned-open argv assembles exactly")
  H.eq(cmds[3], { "gh", "search", "prs", "--assignee=@me", "--merged",
    "--merged-at=>=" .. since, "--json", JSON_FIELDS, "--limit", "100" },
    "assigned-merged argv assembles exactly, with the 7-day window")
  H.eq(#scheduled, 1, "the completion tick scheduled once")
  H.eq(#notify_calls, 0, "the happy path stays silent")

  for _, fn in ipairs(scheduled) do
    fn()
  end
  H.eq(#pick_calls, 1, "the picker opened once")
  H.eq(pick_calls[1].title, "PRs: to review + assigned (incl. merged <7d)",
    "the title states the merged window")
  local items = pick_calls[1].items
  H.eq(#items, 3, "a PR seen by two queries appears once")
  H.eq(items[1].url, PR_A.url, "the first query's reason wins the dedup")
  H.eq(items[1].reason, "review")
  H.eq(items[1].text, "x/a#1 Review me @aa")
  H.eq(items[2].reason, "assigned")
  H.eq(items[3].reason, "assigned-merged")
  H.eq(items[3].state, "merged", "state lowercases for MERGED")
  H.eq(items[3].closed_at, "2024-01-01")

  -- the real format fn renders icon, repo#number, @author, merged date
  local cells = pick_calls[1].format(items[3])
  local has_id, has_merged_cell = false, false
  for _, cell in ipairs(cells) do
    if cell[1] == "x/c#3" then
      has_id = true
    end
    if cell[1] == "  [merged 2024-01-01]" then
      has_merged_cell = true
    end
  end
  H.truthy(has_id, "format renders the repo#number identifier")
  H.truthy(has_merged_cell, "format renders the merged-date cell")

  -- ── failure path: ERROR notify, empty result, no picker ────────────────
  mode = "fail"
  cmds = {}
  scheduled = {}
  M.open()
  H.eq(#cmds, 3, "the failure path still ran all three searches")
  H.eq(#scheduled, 4, "three error notifies plus one completion tick")
  for _, fn in ipairs(scheduled) do
    fn()
  end
  H.eq(#pick_calls, 1, "a failed search opens no picker")
  local errors = vim.tbl_filter(function(c)
    return c.level == vim.log.levels.ERROR
  end, notify_calls)
  H.eq(#errors, 3, "each failed search notifies at ERROR")
  H.truthy(tostring(errors[1].msg):find("gh search failed", 1, true), "the notify names the failure")
  H.truthy(tostring(errors[1].msg):find("gh exploded", 1, true), "the notify carries gh's stderr")
  local infos = vim.tbl_filter(function(c)
    return c.level == vim.log.levels.INFO
  end, notify_calls)
  H.eq(#infos, 1, "the empty result notifies once at INFO")
  H.truthy(tostring(infos[1].msg):find("nothing to show", 1, true))

  restore_system()
  restore_schedule()
  restore_notify()
  restore_time()
end)
