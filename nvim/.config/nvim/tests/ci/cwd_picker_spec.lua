-- cwd_picker.lua pure-function and rendering-contract regression case.
--
-- Pins the #135/#138/#139/#140 picker contract through the real module:
--   * in_cwd_subtree / normalize local-session filtering
--   * session_display_label precedence: session name -> worktree label -> cwd
--   * diff_chunks (+added −removed / clean) and diff_stats gating
--   * agent_metrics (parse_elapsed working_since / running_seconds / context_used)
--   * rendering: non-main rows carry the  branch marker with the
--     SidekickBranch highlight group; main rows carry NO marker, NO diff
--     totals, and backend chrome on the label (#139 was right text with the
--     WRONG highlight group — highlight groups are asserted, not just text).

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()
local env = dofile(vim.fs.dirname(here) .. "/lib/cwd_picker_env.lua")
local cwd_picker = env.require_picker()
local branding = require("plugins.sidekick.branding")

-- U+E0A0 powerline branch glyph, the exact bytes cwd_picker renders.
local branch_marker = "\238\130\160 "

local fixture = vim.fn.tempname() .. "-cwd-picker"
vim.fn.mkdir(fixture, "p")
for _, dir in ipairs({ "repo-main", "feature-one", "feature-one/nested", "plain", "plain/nested", "elsewhere" }) do
  vim.fn.mkdir(fixture .. "/" .. dir, "p")
end

local repo = "/repos/dotfiles"
local main_ctx = env.git_context(repo, fixture .. "/repo-main", "main")
local feature_ctx = env.git_context(repo, fixture .. "/feature-one", "feat/robust-ci", "feat/robust-ci-label")
env.git_by_path[fixture .. "/repo-main"] = main_ctx
env.git_by_path[fixture .. "/feature-one"] = feature_ctx
env.git_by_path[fixture .. "/feature-one/nested"] = feature_ctx

local title_hl = {}
for _, tool in ipairs({ "pi", "codex" }) do
  title_hl[tool] = branding.hl_groups(branding.tool_of(tool)).title
end

H.run("cwd_picker_spec", function()
  -- ── Scenario A: cwd inside a non-main git worktree ─────────────────────
  env.reset()
  env.git_by_path[fixture .. "/repo-main"] = main_ctx
  env.git_by_path[fixture .. "/feature-one"] = feature_ctx
  env.git_by_path[fixture .. "/feature-one/nested"] = feature_ctx
  env.diff_by_worktree[fixture .. "/feature-one"] = { added = 3, removed = 1 }
  env.read_output["codex-notes"] = "Goal achieved (5m)\n35%/200k"
  env.agents = {
    { name = "pi-review", agent = "pi", agent_status = "idle", durable = true, cwd = fixture .. "/feature-one",
      pane_id = "wA:p1", tab_id = "wA:t1", terminal_id = "termA1", workspace_id = "wA" },
    { name = "codex-notes", agent = "codex", agent_status = "done", durable = true,
      cwd = fixture .. "/feature-one/nested", pane_id = "wA:p2", tab_id = "wA:t2", terminal_id = "termA2",
      workspace_id = "wA" },
    { name = "pi-blocked", agent = "pi", agent_status = "blocked", durable = true, cwd = fixture .. "/feature-one",
      pane_id = "wA:p3", tab_id = "wA:t3", terminal_id = "termA3", workspace_id = "wA" },
    { name = "codex-main-hello", agent = "codex", agent_status = "working", durable = true,
      cwd = fixture .. "/repo-main", pane_id = "wB:p1", tab_id = "wB:t1", terminal_id = "termB1", workspace_id = "wB" },
    { name = "review-child", agent = "pi", agent_status = "idle", durable = false,
      cwd = fixture .. "/feature-one", pane_id = "wA:p4", tab_id = "wA:t4", terminal_id = "termA4", workspace_id = "wA" },
    { name = "pi-elsewhere", agent = "pi", agent_status = "idle", durable = true,
      cwd = fixture .. "/elsewhere", pane_id = "wC:p1", tab_id = "wC:t1", terminal_id = "termC1", workspace_id = "wC" },
  }
  vim.cmd("tcd " .. vim.fn.fnameescape(fixture .. "/feature-one"))

  local items = cwd_picker.list_items({})
  H.eq(#items, 3, "only same-worktree durable sessions are local from a git cwd")
  -- status_rank: working < blocked < done < idle
  H.eq({ items[1].agent_name, items[2].agent_name, items[3].agent_name },
    { "pi-blocked", "codex-notes", "pi-review" }, "status rank sorts blocked, done, idle")

  local blocked_item = items[1]
  H.eq(blocked_item.display_label, "feat/robust-ci-label",
    "non-main rows show the worktree label, not the session name")
  H.eq(blocked_item.branch, "feat/robust-ci", "item carries the branch")
  H.eq(blocked_item.diff, { added = 3, removed = 1 }, "item carries +3 −1 diff stats against main")

  local done_item = items[2]
  H.eq(done_item.running_seconds, 300, "Goal achieved (5m) parses to 300 running seconds")
  H.eq(done_item.context_used, "35", "percent-of-context capture reaches agent_metrics")

  local idle_item = items[3]
  H.eq(idle_item.display_label, "feat/robust-ci-label", "worktree label precedence on idle row too")
  H.eq(idle_item.working_since, nil, "idle rows never expose working_since")

  -- Rendering contract via the real M.open (Snacks stub captures format).
  cwd_picker.open({})
  local opts = env.picker_opts
  H.truthy(opts, "cwd_picker.open reached Snacks.picker.pick")
  H.eq(opts.title, "Sidekick Session in Worktree: feat/robust-ci-label", "title names the worktree")

  local function chunk_texts(chunks)
    return vim.tbl_map(function(c)
      return c[1]
    end, chunks)
  end

  local blocked_chunks = opts.format(blocked_item)
  H.eq(blocked_chunks, {
    { "! ", "DiagnosticError" },
    { branch_marker, "SidekickBranch" },
    { "feat/robust-ci-label", "SidekickBranch" },
    { " · ", "Comment" },
    { "+3", "DiagnosticOk" },
    { " ", "Comment" },
    { "−1", "DiagnosticError" },
  }, "non-main row: status glyph, branch marker + SidekickBranch highlight, label in SidekickBranch, +3 −1 totals")

  local idle_chunks = opts.format(idle_item)
  H.eq(idle_chunks[2][2], "SidekickBranch", "branch marker chunk uses the SidekickBranch highlight group")
  H.eq(idle_chunks[3][2], "SidekickBranch", "non-main label chunk uses the SidekickBranch highlight group")
  H.truthy(vim.tbl_contains(chunk_texts(idle_chunks), "+3"), "diff totals render on non-main rows")
  H.truthy(not vim.tbl_contains(chunk_texts(idle_chunks), "main"), "no 'main' text leaks into non-main rows")

  -- Clean worktree: clean chunk instead of totals.
  env.diff_by_worktree[fixture .. "/feature-one"] = { added = 0, removed = 0 }
  local items_clean = cwd_picker.list_items({})
  local clean_chunks = opts.format(items_clean[3])
  H.eq({ clean_chunks[4] }, { { " · clean", "Comment" } }, "zero-diff non-main rows show the clean chunk")
  env.diff_by_worktree[fixture .. "/feature-one"] = { added = 3, removed = 1 }

  -- ── Scenario B: cwd on the main checkout ────────────────────────────────
  env.reset()
  env.git_by_path[fixture .. "/repo-main"] = main_ctx
  env.git_by_path[fixture .. "/feature-one"] = feature_ctx
  env.diff_by_worktree[fixture .. "/feature-one"] = { added = 999, removed = 999 }
  env.read_output["codex-main-hello"] = "Working (1h 2m 3s • esc to interrupt\n42%/200k"
  env.agents = {
    { name = "codex-main-hello", agent = "codex", agent_status = "working", durable = true,
      cwd = fixture .. "/repo-main", pane_id = "wB:p1", tab_id = "wB:t1", terminal_id = "termB1", workspace_id = "wB" },
    { name = "pi-review", agent = "pi", agent_status = "idle", durable = true, cwd = fixture .. "/feature-one",
      pane_id = "wA:p1", tab_id = "wA:t1", terminal_id = "termA1", workspace_id = "wA" },
  }
  vim.cmd("tcd " .. vim.fn.fnameescape(fixture .. "/repo-main"))

  local main_items = cwd_picker.list_items({})
  H.eq(#main_items, 1, "a git cwd keeps only same-worktree sessions local")
  local main_item = main_items[1]
  H.eq(main_item.display_label, "codex-main-hello", "main rows show the friendly session name")
  H.eq(main_item.diff, nil, "main rows never fetch diff totals")
  H.eq(main_item.branch, "main", "main rows carry the main branch")
  H.eq(#env.calls, 0, "no herdr workspace calls happened during list_items")

  local before = vim.uv.now()
  cwd_picker.open({})
  local after = vim.uv.now()
  local main_opts = env.picker_opts
  H.eq(main_opts.title, "Sidekick Session in Worktree: main", "main title uses the branch label")
  local working_chunks = main_opts.format(main_item)
  H.eq(working_chunks, {
    { "S ", "DiagnosticInfo" },
    { "codex-main-hello", title_hl.codex },
  }, "main row: status glyph and backend chrome only — no marker, no totals")
  H.truthy(main_item.working_since ~= nil, "Working (1h 2m 3s) sets working_since")
  H.truthy(main_item.working_since >= before - 3723000 and main_item.working_since <= after - 3723000,
    "working_since = now - 1h2m3s (3723 s)")
  H.eq(main_item.context_used, "42", "context percent captured on a working session")
  H.eq(main_item.running_seconds, nil, "working rows never expose running_seconds")

  -- ── Scenario C: non-git cwd — in_cwd_subtree filtering ─────────────────
  env.reset()
  env.agents = {
    { name = "codex-notes", agent = "codex", agent_status = "done", durable = true, cwd = fixture .. "/plain",
      pane_id = "wD:p1", tab_id = "wD:t1", terminal_id = "termD1", workspace_id = "wD" },
    { name = "codex-sub", agent = "codex", agent_status = "idle", durable = true, cwd = fixture .. "/plain/nested",
      pane_id = "wD:p2", tab_id = "wD:t2", terminal_id = "termD2", workspace_id = "wD" },
    { name = "codex-parent", agent = "codex", agent_status = "idle", durable = true, cwd = fixture,
      pane_id = "wD:p3", tab_id = "wD:t3", terminal_id = "termD3", workspace_id = "wD" },
    { name = "codex-out", agent = "codex", agent_status = "idle", durable = true, cwd = fixture .. "/elsewhere",
      pane_id = "wE:p1", tab_id = "wE:t1", terminal_id = "termE1", workspace_id = "wE" },
  }
  vim.cmd("tcd " .. vim.fn.fnameescape(fixture .. "/plain"))

  local plain_items = cwd_picker.list_items({})
  H.eq(#plain_items, 3, "non-git cwd keeps self, children, and parents (bidirectional subtree)")
  local names = {}
  for _, item in ipairs(plain_items) do
    names[#names + 1] = item.display_label
  end
  table.sort(names)
  H.eq(names, { "codex-notes", "codex-parent", "codex-sub" }, "subtree sessions sorted by label after status rank")
  H.eq(plain_items[1].display_label, "codex-notes", "non-git rows fall back to the session label")

  -- ── Scenario D: empty state ─────────────────────────────────────────────
  env.reset()
  env.agents = {}
  vim.cmd("tcd " .. vim.fn.fnameescape(fixture .. "/elsewhere"))
  cwd_picker.open({})
  local empty_opts = env.picker_opts
  H.eq(#empty_opts.items, 1, "empty state renders one placeholder item")
  H.eq(empty_opts.items[1]._empty, true, "placeholder item is flagged empty")
  H.eq(empty_opts.items[1].text, "(no named sessions in cwd)", "non-git empty state names the cwd scope")
  H.eq(empty_opts.format(empty_opts.items[1]), { { "(no named sessions in cwd)", "Comment" } },
    "placeholder row renders dim in Comment")
end)
