-- cwd_picker.lua private pure functions, reached through the real module's
-- closure graph (H.upvalue) — the real functions are exercised, never copies.
-- Covers the mandate list: normalize, in_cwd_subtree, session_display_label,
-- parse_elapsed, context capture, and the preview scrub chain
-- (scrub_pi_prompt / scrub_codex_prompt / scrub_working_status /
-- trim_terminal_padding) that keeps agent UI chrome out of previews.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()
local env = dofile(vim.fs.dirname(here) .. "/lib/cwd_picker_env.lua")
local cwd_picker = env.require_picker()

local fixture = vim.fn.tempname() .. "-cwd-picker-pure"
vim.fn.mkdir(fixture, "p")

-- Pure helpers are upvalues of the exported list_items.
local list_items = cwd_picker.list_items
local normalize = H.upvalue(list_items, "normalize")
local in_cwd_subtree = H.upvalue(list_items, "in_cwd_subtree")
local session_display_label = H.upvalue(list_items, "session_display_label")
local parse_elapsed = H.upvalue(list_items, "parse_elapsed")
local context_used = H.upvalue(list_items, "context_used")

H.run("cwd_picker_pure_spec", function()
  -- normalize
  H.eq(normalize(fixture .. "/sub/"), fixture .. "/sub", "normalize strips the trailing slash")
  H.eq(normalize("/a//b/../c"), "/a/c", "normalize collapses redundant segments")
  H.eq(normalize(""), "", "empty input normalizes to empty")
  H.eq(normalize(nil), "", "nil input normalizes to empty")
  H.eq(normalize("/"), "", "the degenerate root normalizes to empty (documented)")

  -- in_cwd_subtree (bidirectional containment)
  H.eq(in_cwd_subtree(fixture, fixture), true, "self matches")
  H.eq(in_cwd_subtree(fixture .. "/child", fixture), true, "children match")
  H.eq(in_cwd_subtree(fixture, fixture .. "/child"), true, "parents match (root picked inside a child)")
  H.eq(in_cwd_subtree("/elsewhere", fixture), false, "disjoint paths never match")
  H.eq(in_cwd_subtree("", fixture), false, "empty entry never matches")
  H.eq(in_cwd_subtree(fixture, ""), false, "empty root matches nothing")
  H.eq(in_cwd_subtree(fixture .. "/sub/", fixture .. "/sub"), true, "entry cwd is normalized before matching")

  -- session_display_label precedence: worktree label > session name > fallback
  local feature = { branch = "feat/x", worktree_label = "feat-x-label" }
  local main = { branch = "main" }
  H.eq(session_display_label(feature, "pi-review"), "feat-x-label",
    "non-main rows prefer the worktree label over the session name")
  H.eq(session_display_label(main, "codex-main-hello"), "codex-main-hello",
    "main rows keep the session name")
  H.eq(session_display_label(nil, "codex-notes", "basename"), "basename",
    "non-git rows prefer the cwd basename over the session name")
  H.eq(session_display_label(nil, "codex-notes"), "codex-notes",
    "non-git rows fall back to the session name without a basename")

  -- parse_elapsed
  H.eq(parse_elapsed("1h 2m 3s"), 3723, "h m s mix parses")
  H.eq(parse_elapsed("5m"), 300, "minutes parse")
  H.eq(parse_elapsed("45 s"), 45, "seconds with a space parse")
  H.eq(parse_elapsed("2h"), 7200, "hours parse")
  H.eq(parse_elapsed(nil), nil, "nil stays nil")
  H.eq(parse_elapsed(""), 0, "an empty capture reads as zero")

  -- context percent capture (percent-of-budget and percent-left forms)
  H.eq(context_used("noise\n45%/200k"), "45", "percent-of-budget captured from the last match")
  H.eq(context_used("78% context left"), "22", "percent-left converts to used")
  H.eq(context_used("nothing here"), nil, "no marker means no metric")
  H.eq(context_used("10%/200k\nlater\n90% context left"), "10",
    "the bottom-most marker wins")

  -- ── Scrub chain, reached from the captured picker preview callback ──────
  env.reset()
  local ctx = env.git_context("/repos/dotfiles", fixture, "feat/scrub")
  env.git_by_path[fixture] = ctx
  env.agents = {
    { name = "pi-review", agent = "pi", agent_status = "idle", durable = true, cwd = fixture,
      pane_id = "w:p1", tab_id = "w:t1", terminal_id = "term1", workspace_id = "w" },
  }
  vim.cmd("tcd " .. vim.fn.fnameescape(fixture))
  cwd_picker.open({})
  local preview_cb = env.picker_opts.preview
  H.truthy(type(preview_cb) == "function", "picker captured the preview callback")

  local scrub_preview_output = H.upvalue(preview_cb, "scrub_preview_output")
  local scrub_pi_prompt = H.upvalue(preview_cb, "scrub_pi_prompt")
  local scrub_codex_prompt = H.upvalue(preview_cb, "scrub_codex_prompt")
  local scrub_working_status = H.upvalue(preview_cb, "scrub_working_status")
  local trim_terminal_padding = H.upvalue(preview_cb, "trim_terminal_padding")
  H.truthy(type(scrub_preview_output) == "function", "scrub_preview_output reachable")

  -- scrub_pi_prompt: cut at the second separator above the MCP footer.
  local sep = string.rep("─", 16)
  local pi_lines = {
    "first line",
    "\27[31magent reply\27[0m",
    "",
    "\27[90mWorking...\27[0m",
    sep,
    "",
    sep,
    "MCP: 4 tools",
  }
  H.eq(scrub_pi_prompt(table.concat(pi_lines, "\r\n")),
    "first line\r\n\27[31magent reply\27[0m\27[0m",
    "pi prompt scrub keeps output lines and drops the status/footer frame")

  H.eq(scrub_pi_prompt("plain output"), "plain output",
    "output without an MCP footer is returned unchanged")
  local one_sep = { "out", sep, "MCP: 1 tool" }
  H.eq(scrub_pi_prompt(table.concat(one_sep, "\r\n")), table.concat(one_sep, "\r\n"),
    "a single separator frame is not enough to scrub")

  -- scrub_codex_prompt: cut above the highlighted prompt box.
  local codex_lines = {
    "prior output",
    "",
    "\27[48;2;1;2;3m\27[0m",
    "\27[48;2;9;9;9m› prompt\27[0m",
  }
  H.eq(scrub_codex_prompt(table.concat(codex_lines, "\r\n")), "prior output\27[0m",
    "codex prompt scrub drops the prompt box and its padding row")

  H.eq(scrub_codex_prompt("no prompt box"), "no prompt box",
    "codex output without a prompt box is returned unchanged")

  -- scrub_working_status: only bare "Working" status lines are dropped.
  local working_lines = {
    "\27[31mWorking...\27[0m",
    "keep",
    "Working…",
    "prefix Working... esc to interrupt",
    "Working",
    "x Working y",
  }
  H.eq(scrub_working_status(table.concat(working_lines, "\r\n")),
    "keep\r\nprefix Working... esc to interrupt\r\nWorking\r\nx Working y",
    "bare Working spinners drop; every other line stays")

  -- trim_terminal_padding: trailing blanks move out from under SGR resets.
  H.eq(trim_terminal_padding("text   \27[0m"), "text\27[0m", "padding before a reset is trimmed")
  H.eq(trim_terminal_padding("abc  "), "abc", "plain trailing blanks are trimmed")
  H.eq(trim_terminal_padding("a  \27[31m\27[0m"), "a\27[31m\27[0m", "stacked SGR suffixes survive intact")

  -- scrub_preview_output dispatches by tool.
  H.eq(scrub_preview_output({ tool = "pi" }, "not really a prompt"), "not really a prompt",
    "pi output without markers passes through the dispatch")
  H.eq(scrub_preview_output({ tool = "unknown" }, "\27[31mWorking...\27[0m"), "",
    "the working-status scrub runs for every tool")
  H.eq(scrub_preview_output({ tool = "codex" }, "kept"), "kept", "codex dispatch passes clean output")
end)
