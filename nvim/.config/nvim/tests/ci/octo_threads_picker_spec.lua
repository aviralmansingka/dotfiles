-- plugins/octo/threads_picker.lua pure functions (offline harness).
--
-- one_line_preview / thread_line / thread_author / thread_preview /
-- build_items / thread_browser_url are file-locals; the real functions are
-- reached through the closure graph (H.upvalue) after render_picker() has
-- created M._render — never copies. The Snacks picker is stubbed to record
-- options, so the render/toggle round trip runs the real closures offline.
-- Live GraphQL halves (fetch_and_show, resolve_thread, M.open's gh query)
-- are documented as no-test in docs/ci-tests/nvim-octo.md.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local M = require("plugins.octo.threads_picker")

H.run("octo_threads_picker_spec", function()
  -- ── fixtures ───────────────────────────────────────────────────────────
  local THREADS = {
    {
      id = "T1", path = "a.lua", line = 5, isResolved = false, isOutdated = false,
      comments = { nodes = { { body = "first line\r\nsecond line", author = { login = "alice" } } } },
    },
    {
      id = "T2", path = "b.lua", originalLine = 9, isResolved = true, isOutdated = true,
      comments = { nodes = { { body = string.rep("x", 90), author = { login = "bob" } } } },
    },
    {
      id = "T3", path = "c.lua", isResolved = false,
      comments = { nodes = {} },
    },
  }
  local PR = { number = 42, url = "https://github.com/owner/name/pull/42" }

  -- ── stub Snacks + notify before the real render path runs ──────────────
  local pick_calls = {}
  package.loaded["snacks"] = {
    picker = {
      pick = function(opts)
        pick_calls[#pick_calls + 1] = opts
      end,
    },
  }
  local notify_calls, restore_notify = H.capture_notify()

  -- render_picker is a file-local upvalue of fetch_and_show, itself an
  -- upvalue of M.open; running it once creates M._render.
  local render_picker = H.upvalue(M.open, "render_picker")
  render_picker(THREADS, PR)

  H.eq(#pick_calls, 1, "the picker opened once")
  local opts = pick_calls[1]
  H.eq(opts.title, "PR #42 review threads (unresolved)", "title carries the PR number and filter")
  H.eq(#opts.items, 2, "resolved threads stay hidden by default")
  H.eq(opts.items[1].thread_id, "T1")
  H.eq(opts.items[1].path, "a.lua")
  H.eq(opts.items[1].line, 5)
  H.eq(opts.items[1].resolved, false)
  H.eq(opts.items[1].outdated, false)
  H.eq(opts.items[1].author, "alice")
  H.eq(opts.items[1].preview, "first line", "preview keeps the first line only")
  H.eq(opts.items[1].text, "a.lua:5 @alice first line", "search text joins path:line @author preview")
  H.eq(opts.items[2].thread_id, "T3", "the default list keeps the second unresolved thread")
  H.eq(opts.items[2].line, 1, "a thread with no line info resolves to 1")
  H.eq(opts.items[2].author, "", "a thread with no comments renders an empty author")
  H.eq(opts.items[2].preview, "", "a thread with no comments renders an empty preview")

  -- ── real pure functions through the closure graph ──────────────────────
  local build_items = H.upvalue(M._render, "build_items")
  local thread_line = H.upvalue(build_items, "thread_line")
  local thread_author = H.upvalue(build_items, "thread_author")
  local thread_preview = H.upvalue(build_items, "thread_preview")
  local one_line_preview = H.upvalue(thread_preview, "one_line_preview")
  local open_browser = opts.actions.open_browser
  local thread_browser_url = H.upvalue(open_browser, "thread_browser_url")

  -- one_line_preview: empty, truncation, line endings
  H.eq(one_line_preview(nil), "", "nil body previews empty")
  H.eq(one_line_preview(""), "", "empty body previews empty")
  H.eq(one_line_preview("single line"), "single line")
  H.eq(one_line_preview(string.rep("x", 80)), string.rep("x", 80),
    "exactly 80 chars stay intact")
  H.eq(one_line_preview(string.rep("x", 81)), string.rep("x", 77) .. "...",
    "81 chars truncate to 77 + ellipsis")
  H.eq(#one_line_preview(string.rep("y", 200)), 80, "the preview never exceeds 80 chars")
  H.eq(one_line_preview("l1\r\nl2"), "l1", "CRLF bodies keep the first line")
  H.eq(one_line_preview("l1\nl2"), "l1", "LF bodies keep the first line")
  H.eq(one_line_preview("\n\n"), "\n\n",
    "a body of only newlines falls back to the raw body (documented quirk)")

  -- thread_line fallback chain
  H.eq(thread_line({ line = 5 }), 5, "line wins first")
  H.eq(thread_line({ originalLine = 7 }), 7, "originalLine backs up line")
  H.eq(thread_line({ startLine = 3 }), 3, "startLine backs up both")
  H.eq(thread_line({ originalStartLine = 9 }), 9, "originalStartLine is the last fallback")
  H.eq(thread_line({}), 1, "no line info resolves to 1")

  -- thread_author
  H.eq(thread_author(THREADS[1]), "alice", "the first comment's author is the thread author")
  H.eq(thread_author({ comments = { nodes = {} } }), "", "no comments resolve no author")
  H.eq(thread_author({ comments = nil }), "", "a missing comments table resolves no author")
  H.eq(thread_author({ comments = { nodes = { { author = nil } } } }), "",
    "a comment without author resolves no author")

  -- thread_preview
  H.eq(thread_preview(THREADS[1]), "first line", "the preview one-lines the first comment")
  H.eq(thread_preview({ comments = { nodes = {} } }), "", "no comments preview empty")
  H.eq(thread_preview({ comments = nil }), "", "a missing comments table previews empty")

  -- build_items resolved filter
  local all = build_items(THREADS, true)
  H.eq(#all, 3, "show_resolved keeps every thread")
  H.eq(all[2].line, 9, "originalLine backs up a missing line")
  H.eq(all[2].resolved, true, "resolved state lands on the item")
  H.eq(all[2].outdated, true, "outdated state lands on the item")
  H.eq(all[2].preview, string.rep("x", 77) .. "...", "long previews truncate")
  H.eq(all[3].author, "", "an empty thread renders an empty author")
  H.eq(all[3].preview, "", "an empty thread renders an empty preview")
  local unresolved = build_items(THREADS, false)
  H.eq(#unresolved, 2, "the default filter drops resolved threads")

  -- thread_browser_url
  H.eq(thread_browser_url("https://github.com/o/n/pull/42", "TID_abc"),
    "https://github.com/o/n/pull/42/files",
    "the browser url opens the PR Files tab")

  -- ── toggle_resolved round trip through the real closures ───────────────
  local closed = 0
  local fake_picker = { close = function()
    closed = closed + 1
  end }
  opts.actions.toggle_resolved(fake_picker, nil)
  H.eq(closed, 1, "toggle closes the picker")
  H.eq(#pick_calls, 2, "toggle re-renders")
  H.eq(pick_calls[2].title, "PR #42 review threads (all)", "the re-render flips the filter")
  H.eq(#pick_calls[2].items, 3, "the re-render includes resolved threads")
  pick_calls[2].actions.toggle_resolved(fake_picker, nil)
  H.eq(#pick_calls, 3, "a second toggle re-renders again")
  H.eq(pick_calls[3].title, "PR #42 review threads (unresolved)", "the filter flips back")
  H.eq(#pick_calls[3].items, 2)

  -- ── empty thread list notifies instead of opening a picker ─────────────
  render_picker({}, PR)
  H.eq(#pick_calls, 3, "no picker opens for an empty list")
  H.eq(#notify_calls, 1, "the empty list notifies once")
  H.eq(notify_calls[1].level, vim.log.levels.INFO)
  H.truthy(tostring(notify_calls[1].msg):find("no threads to show", 1, true))
  H.truthy(tostring(notify_calls[1].msg):find("unresolved", 1, true),
    "the notify names the active filter")

  -- ── confirm: close, edit the file, land on the thread line ─────────────
  local tmpf = vim.fn.tempname() .. "-thread.lua"
  vim.fn.writefile({ "one", "two", "three", "four" }, tmpf)
  local confirm_closed = 0
  local picker2 = { close = function()
    confirm_closed = confirm_closed + 1
  end }
  opts.confirm(picker2, { path = tmpf, line = 3 })
  H.eq(confirm_closed, 1, "confirm closes the picker")
  H.eq(vim.api.nvim_buf_get_name(0), tmpf, "confirm edits the thread file")
  H.eq(vim.api.nvim_win_get_cursor(0)[1], 3, "confirm lands on the thread line")

  opts.confirm(picker2, { line = 1 })
  H.eq(confirm_closed, 2, "confirm closes even without a path")
  H.eq(vim.api.nvim_buf_get_name(0), tmpf, "confirm without a path edits nothing")

  restore_notify()
end)
