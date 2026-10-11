-- plugins/herdr/workspaces.lua + the herdr-workspaces wiring +
-- helpers/herdr_scrollback.lua: workspace tab cluster 3 — the highest-risk
-- untested surface of the Neovim subsystem (CI rows #133/#135/#127).
--
--   * close_tabs cross-worktree safety (#135): a killed session must not
--     close tabs of a different worktree that shares the repository.
--   * agent_closed: early-returns while a same-worktree agent lives; closes
--     the workspace only when empty AND listed.
--   * snapshot ordering (#133): tab number then list order; cwd comes from
--     the first pane of a workspace.
--   * bind_tab/unbind: association moves, no dangling tab vars.
--   * create/rename/close pickers: argv/state seam with mocked calls.
--   * herdr_scrollback: document() capture format, path() identity hash,
--     save refusal on changed-on-disk captures, load round trip.
--
-- Everything offline: herdr.call and herdr.git_context are field-stubbed on
-- the real module table; helpers.markdown_ansi is require-stubbed (it
-- belongs to a sibling agent); tabs and buffers are real (headless, no UI).

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

-- ── shared fixtures ────────────────────────────────────────────────────
local base = vim.fn.tempname() .. "-ws-spec"
local wt_main = base .. "/repo/wt-main"
local wt_feature = base .. "/repo/wt-feature"
local wt_live = base .. "/live"
local wt_other = base .. "/other"
local plain_dir = base .. "/plain"
local plain_two = base .. "/plain-two"
for _, dir in ipairs({ wt_main, wt_feature, wt_live, wt_other, plain_dir, plain_two }) do
  vim.fn.mkdir(dir, "p")
end

local herdr = require("plugins.sidekick.herdr")
local workspace_tabs = require("helpers.workspace")
local workspaces = require("plugins.herdr.workspaces")
local scrollback = require("helpers.herdr_scrollback")

-- Require-stub helpers.markdown_ansi (sibling-owned, read-only here).
local ansi_stub = {
  decode = function(lines)
    local plain = {}
    for i, line in ipairs(lines) do
      plain[i] = line:gsub("\27%[[%d;:]*m", "")
    end
    return plain, {}
  end,
  encode = function(lines)
    local out = {}
    for i, line in ipairs(lines) do
      out[i] = line
    end
    return out
  end,
}
package.loaded["helpers.markdown_ansi"] = ansi_stub

-- Real locals reached through the upvalue graph — never copies.
local snapshot = H.upvalue(workspaces.focus, "snapshot")
local bind_tab = H.upvalue(workspaces.focus, "bind_tab")
local focus_tab = H.upvalue(bind_tab, "focus_tab")
local reconcile = H.upvalue(snapshot, "reconcile")
local close_tabs = H.upvalue(workspaces.agent_closed, "close_tabs")
local cwd_matches_target = H.upvalue(workspaces.agent_closed, "cwd_matches_target")
local resolve_cwd_target = H.upvalue(workspaces.agent_closed, "resolve_cwd_target")
local unbind = H.upvalue(close_tabs, "unbind")
local unbind_tabs = H.upvalue(workspaces.open, "unbind_tabs")
local disposable_unbound_tab = H.upvalue(workspaces.open, "disposable_unbound_tab")
local create_workspace = H.upvalue(workspaces.open, "create_workspace")
local rename_workspace = H.upvalue(workspaces.open, "rename_workspace")
local close_workspace = H.upvalue(workspaces.open, "close_workspace")
local picker_items = H.upvalue(workspaces.open, "picker_items")
local format_item = H.upvalue(workspaces.open, "format_item")

-- ── herdr.call / git_context stubs on the real module table ────────────
local calls, canned = {}, {}
local real_call, real_git_context = herdr.call, herdr.git_context
local function key(args)
  return table.concat(args, "\001")
end
herdr.call = function(args, quiet)
  calls[#calls + 1] = args
  local entry = canned[key(args)]
  if entry == nil then
    return nil, "unexpected command: " .. table.concat(args, " ")
  end
  if entry.err then
    return nil, entry.err
  end
  return entry.result
end
-- Two worktrees share one repository but resolve to different worktrees —
-- exactly the #135 hazard. Non-git fixture dirs resolve to nil context.
local worktree_of = {
  [wt_main] = wt_main,
  [wt_feature] = wt_feature,
  [wt_live] = wt_live,
  [wt_other] = wt_other,
}
herdr.git_context = function(cwd)
  local worktree = worktree_of[herdr.normalize_cwd(cwd)]
  if not worktree then
    return nil
  end
  return {
    repository = base .. "/repo",
    repository_label = "repo",
    worktree = worktree,
    worktree_label = vim.fn.fnamemodify(worktree, ":t"),
    branch = "main",
  }
end

local function reset_herdr()
  calls, canned = {}, {}
  canned["workspace\001list"] = { result = { workspaces = {} } }
  canned["pane\001list"] = { result = { panes = {} } }
  canned["agent\001list"] = { result = { agents = {} } }
end

local function listed(name)
  for _, entry in ipairs(calls) do
    if entry[1] == name[1] and entry[2] == name[2] and entry[3] == name[3] then
      return true
    end
  end
  return false
end

local function clear_tab_vars(tab)
  for _, name in ipairs({
    "herdr_workspace_id",
    "herdr_workspace_label",
    "herdr_workspace_detached",
    "herdr_workspace_warned",
    "workspace_cwd",
    "workspace_label",
    "workspace_buffers",
  }) do
    pcall(vim.api.nvim_tabpage_del_var, tab, name)
  end
end

local function reset_tabs()
  local tabs = vim.api.nvim_list_tabpages()
  for i = #tabs, 2, -1 do
    pcall(vim.cmd, "tabclose " .. vim.api.nvim_tabpage_get_number(tabs[i]))
  end
  local keep = tabs[1]
  if vim.api.nvim_get_current_tabpage() ~= keep then
    vim.api.nvim_set_current_tabpage(keep)
  end
  clear_tab_vars(keep)
end

local function tab_var(tab, name)
  local ok, value = pcall(vim.api.nvim_tabpage_get_var, tab, name)
  if not ok then
    return nil
  end
  return value
end

local function make_tab(id, cwd, label)
  vim.cmd.tabnew()
  local tab = vim.api.nvim_get_current_tabpage()
  vim.api.nvim_tabpage_set_var(tab, "herdr_workspace_id", id)
  vim.api.nvim_tabpage_set_var(tab, "herdr_workspace_label", label)
  workspace_tabs.bind(tab, cwd, label)
  return tab
end

local function ids_of(tablist)
  local out = {}
  for i, tab in ipairs(tablist) do
    out[i] = tab_var(tab, "herdr_workspace_id")
  end
  return out
end

-- ════════════════════════════════════════════════════════════════════════
-- 1. snapshot: ordering, shapes, cwd from first pane (#133/#127)
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_snapshot_order", function()
  reset_herdr()
  reset_tabs()
  canned["workspace\001list"] = { result = { workspaces = {
    { workspace_id = "w-3", label = "Three", number = 3 },
    { workspace_id = "w-1a", label = "One A", number = 1 },
    { workspace_id = "w-none2", label = "None B" },
    { workspace_id = "w-1b", label = "One B", number = 1 },
    { workspace_id = "w-bad", label = 7, number = 2 },
    { workspace_id = 99, label = "Bad id", number = 2 },
    { workspace_id = "w-none1", label = "None A" },
  } } }
  canned["pane\001list"] = { result = { panes = {
    { workspace_id = "w-ghost", cwd = plain_dir },
    { workspace_id = "w-3", cwd = plain_dir .. "/" },
    { workspace_id = "w-1a", cwd = plain_two },
    { workspace_id = "w-1b", cwd = plain_dir },
    { workspace_id = "w-1b", cwd = plain_two },
  } } }

  local list = snapshot()
  H.truthy(list, "snapshot returns the workspace list")
  H.eq(#list, 5, "invalid entries (non-string id or label) are dropped")
  local ids = {}
  for i, ws in ipairs(list) do
    ids[i] = ws.workspace_id
  end
  H.eq(ids, { "w-1a", "w-1b", "w-3", "w-none2", "w-none1" },
    "ordering: tab number first, then list order; missing numbers sort last")
  H.eq(list[1]._order, 2, "the list position is kept in _order")
  H.eq(list[2]._order, 4, "_order breaks the number tie")
  H.eq(list[1].cwd, plain_two, "cwd comes from the first pane of the workspace")
  H.eq(list[2].cwd, plain_dir, "a later pane of the same workspace never wins")
  H.eq(list[3].cwd, herdr.normalize_cwd(plain_dir), "the pane cwd is normalized")
  H.eq(list[4].cwd, nil, "a workspace with no pane has no cwd")

  -- failure modes: both list commands must be valid or snapshot bails
  canned["pane\001list"] = { result = {} }
  local notes, restore_notes = H.capture_notify()
  H.eq(snapshot(), nil, "an invalid pane list fails the snapshot")
  H.truthy(notes[#notes].msg:find("pane list failed", 1, true), "the pane list failure is reported")
  canned["pane\001list"] = { result = { panes = {} } }
  canned["workspace\001list"] = { err = "herdr down" }
  H.eq(snapshot(), nil, "a failing workspace list fails the snapshot")
  H.truthy(notes[#notes].msg:find("workspace list failed", 1, true), "the workspace list failure is reported")
  H.eq(listed({ "agent", "list", nil }), false, "snapshot never calls agent list")
  restore_notes()
end)

-- ════════════════════════════════════════════════════════════════════════
-- 2. reconcile: label refresh and detached/warned transitions (#133)
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_reconcile", function()
  reset_herdr()
  reset_tabs()
  local tab = vim.api.nvim_get_current_tabpage()
  vim.api.nvim_tabpage_set_var(tab, "herdr_workspace_id", "w-live")
  vim.api.nvim_tabpage_set_var(tab, "herdr_workspace_label", "Stale")
  vim.api.nvim_tabpage_set_var(tab, "herdr_workspace_detached", true)
  vim.api.nvim_tabpage_set_var(tab, "herdr_workspace_warned", true)
  workspace_tabs.bind(tab, wt_live, "Stale")

  canned["workspace\001list"] = { result = { workspaces = {
    { workspace_id = "w-live", label = "Fresh", number = 1 },
  } } }
  canned["pane\001list"] = { result = { panes = {
    { workspace_id = "w-live", cwd = wt_live },
  } } }

  snapshot()
  H.eq(tab_var(tab, "herdr_workspace_label"), "Fresh", "reconcile copies the server label")
  H.eq(workspace_tabs.get(tab).label, "Fresh", "reconcile rebinds the tab label")
  H.eq(tab_var(tab, "herdr_workspace_detached"), false, "a live workspace clears detached")
  H.eq(tab_var(tab, "herdr_workspace_warned"), false, "a live workspace clears warned")

  canned["workspace\001list"] = { result = { workspaces = {} } }
  snapshot()
  H.eq(tab_var(tab, "herdr_workspace_detached"), true, "a missing workspace marks the tab detached")
  H.eq(tab_var(tab, "herdr_workspace_id"), "w-live", "a detached tab keeps its workspace id")

  -- focus_tab: a missing workspace warns exactly once; recovery clears flags
  local notes, restore_notes = H.capture_notify()
  canned["workspace\001focus\001w-live"] = { err = "unknown workspace w-live" }
  focus_tab(tab)
  H.eq(tab_var(tab, "herdr_workspace_detached"), true, "a missing focus error marks detached")
  H.eq(tab_var(tab, "herdr_workspace_warned"), true, "the first failure sets warned")
  H.eq(#notes, 1, "the warning fires exactly once")
  H.eq(notes[1].level, vim.log.levels.WARN, "the warning uses WARN level")
  H.truthy(notes[1].msg:find('could not focus "Fresh"', 1, true), "the warning names the workspace label")
  focus_tab(tab)
  H.eq(#notes, 1, "warned suppresses the second warning")
  canned["workspace\001focus\001w-live"] = { result = { type = "ok" } }
  focus_tab(tab)
  H.eq(#notes, 1, "a successful focus stays silent")
  H.eq(tab_var(tab, "herdr_workspace_detached"), false, "a successful focus clears detached")
  H.eq(tab_var(tab, "herdr_workspace_warned"), false, "a successful focus clears warned")
  restore_notes()
end)

-- ════════════════════════════════════════════════════════════════════════
-- 3. bind_tab / unbind: association moves, no dangling vars
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_bind_tab", function()
  reset_herdr()
  reset_tabs()
  canned["workspace\001focus\001w-live"] = { result = { type = "ok" } }
  canned["workspace\001focus\001w-other"] = { result = { type = "ok" } }
  canned["workspace\001focus\001w-nocwd"] = { result = { type = "ok" } }
  local w_live = { workspace_id = "w-live", label = "Live", cwd = wt_live }
  local w_other = { workspace_id = "w-other", label = "Other", cwd = wt_other }

  local tab, is_new = bind_tab(w_live, false)
  H.eq(is_new, true, "the first bind creates a tab")
  H.eq(#vim.api.nvim_list_tabpages(), 2, "bind_tab opened one new tab")
  H.eq(tab_var(tab, "herdr_workspace_id"), "w-live", "the new tab carries the workspace id")
  H.eq(tab_var(tab, "herdr_workspace_label"), "Live", "the new tab carries the label")
  H.eq(tab_var(tab, "herdr_workspace_detached"), false, "a fresh tab is not detached")
  H.eq(workspace_tabs.get(tab).cwd, wt_live, "the tab binds the workspace cwd")
  H.eq(workspace_tabs.get(tab).label, "Live", "the tab binds the workspace label")
  H.eq(vim.api.nvim_get_current_tabpage(), tab, "bind_tab focuses the bound tab")

  canned["workspace\001focus\001w-live"] = { result = { type = "ok" } }
  local again, is_new_again = bind_tab(w_live, false)
  H.eq(again, tab, "a second bind reuses the existing tab")
  H.eq(is_new_again, false, "the reuse reports not-new")
  H.eq(#vim.api.nvim_list_tabpages(), 2, "no extra tab appears")
  H.eq(listed({ "workspace", "focus", "w-live" }), true,
    "rebinding the current tab asks herdr to focus the workspace")

  local other_tab = bind_tab(w_other, false)
  H.ne(other_tab, tab, "a different workspace gets a different tab")
  H.eq(tab_var(tab, "herdr_workspace_id"), "w-live", "the first tab keeps its association")
  H.eq(tab_var(other_tab, "herdr_workspace_id"), "w-other", "the new tab owns the new association")

  -- unbind removes every herdr var from the tab (no dangling state)
  unbind(other_tab)
  H.eq(tab_var(other_tab, "herdr_workspace_id"), nil, "unbind removes the workspace id")
  H.eq(tab_var(other_tab, "herdr_workspace_label"), nil, "unbind removes the label")
  H.eq(tab_var(other_tab, "herdr_workspace_detached"), nil, "unbind removes the detached flag")
  H.eq(tab_var(other_tab, "herdr_workspace_warned"), nil, "unbind removes the warned flag")
  H.eq(workspace_tabs.get(other_tab).herdr_workspace_id, nil,
    "the tab binding no longer reports a herdr id")
  H.eq(vim.api.nvim_tabpage_is_valid(other_tab), true, "unbind alone never closes the tab")

  -- after unbind, the next bind of the same workspace opens a fresh tab
  local rebound = bind_tab(w_other, false)
  H.ne(rebound, other_tab, "a rebound association moves to a new tab")

  -- a workspace with no pane cwd warns and keeps the tab cwd
  local notes, restore_notes = H.capture_notify()
  reset_tabs()
  local w_nocwd = { workspace_id = "w-nocwd", label = "NoCwd", cwd = nil }
  local nocwd_tab = bind_tab(w_nocwd, false)
  H.eq(#notes, 1, "a missing pane cwd warns once")
  H.eq(notes[1].level, vim.log.levels.WARN, "the missing-cwd warning uses WARN level")
  H.truthy(notes[1].msg:find("has no pane cwd", 1, true), "the warning names the missing cwd")
  H.eq(workspace_tabs.get(nocwd_tab).label, "NoCwd", "the label still binds")
  H.eq(workspace_tabs.get(nocwd_tab).cwd,
    vim.fn.getcwd(-1, vim.api.nvim_tabpage_get_number(nocwd_tab)),
    "the tab keeps its current cwd when the workspace has none")
  restore_notes()

  -- reuse_empty: a single disposable unbound tab is reused, not replaced
  reset_tabs()
  H.eq(#vim.api.nvim_list_tabpages(), 1, "the reused-tab case starts from one tab")
  local current = vim.api.nvim_get_current_tabpage()
  H.eq(disposable_unbound_tab(current), true, "the bare headless tab is disposable")
  local reused, reused_new = bind_tab(w_live, true)
  H.eq(reused, current, "reuse_empty claims the disposable tab")
  H.eq(reused_new, true, "claiming the tab still reports new")
  H.eq(#vim.api.nvim_list_tabpages(), 1, "no second tab appears")
  H.eq(tab_var(current, "herdr_workspace_id"), "w-live", "the claimed tab carries the id")
end)

-- ════════════════════════════════════════════════════════════════════════
-- 4. close_tabs cross-worktree safety (#135)
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_close_tabs_cross_worktree", function()
  reset_herdr()
  reset_tabs()

  -- the pure resolution helpers
  H.eq(cwd_matches_target(wt_main, wt_main), true, "a worktree matches itself")
  H.eq(cwd_matches_target(wt_feature, wt_main), false,
    "a different worktree of the SAME repository never matches (#135)")
  H.eq(cwd_matches_target(plain_dir .. "/", plain_dir), true,
    "a non-git cwd matches through normalization alone")
  H.eq(cwd_matches_target(nil, wt_main), false, "no cwd never matches")
  H.eq(cwd_matches_target(plain_dir, nil), false, "no target never matches")
  H.eq(resolve_cwd_target(wt_main), wt_main, "resolve returns the worktree for git cwds")
  H.eq(resolve_cwd_target(plain_dir), herdr.normalize_cwd(plain_dir),
    "resolve falls back to the normalized cwd for non-git dirs")
  H.eq(resolve_cwd_target(nil), nil, "resolve of nil stays nil")

  -- the destructive funnel: only the owning worktree's tabs close
  local tab_main = make_tab("w-shared", wt_main, "Main")
  local tab_feature = make_tab("w-shared", wt_feature, "Feature")
  local tab_keep = make_tab("w-keep", wt_main, "Keep")
  local tab_plain = make_tab("w-shared", plain_dir, "Plain")

  close_tabs("w-shared", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_main), false, "the owning worktree's tab closes")
  H.eq(vim.api.nvim_tabpage_is_valid(tab_feature), true,
    "a sibling worktree tab of the same workspace survives (#135)")
  H.eq(tab_var(tab_feature, "herdr_workspace_id"), "w-shared",
    "the surviving tab keeps its workspace id")
  H.eq(workspace_tabs.get(tab_feature).cwd, wt_feature, "the surviving tab keeps its cwd")
  H.eq(vim.api.nvim_tabpage_is_valid(tab_keep), true, "another workspace's tab is untouched")
  H.eq(vim.api.nvim_tabpage_is_valid(tab_plain), true,
    "a same-id tab in a non-matching non-git dir survives")

  close_tabs("w-shared", wt_feature)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_feature), false,
    "the second call targets the other worktree and closes only its tab")
  H.eq(vim.api.nvim_tabpage_is_valid(tab_plain), true, "the plain tab still stands")

  -- nil cwd: no target is known, so every tab of the workspace closes
  close_tabs("w-shared", nil)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_plain), false, "a nil cwd closes all id tabs")
  H.eq(vim.api.nvim_tabpage_is_valid(tab_keep), true, "other workspaces never close")
  H.eq(tab_var(tab_keep, "herdr_workspace_id"), "w-keep", "the untouched tab keeps its id")

  -- non-git target closes by normalized cwd
  local tab_plain_two = make_tab("w-plain", plain_two, "PlainTwo")
  close_tabs("w-plain", plain_two)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_plain_two), false, "a non-git target closes its tab")
  H.eq(#vim.api.nvim_list_tabpages(), 2, "only the untouched tab and the base tab remain")
  H.eq(tab_var(tab_keep, "herdr_workspace_id"), "w-keep", "the untouched tab keeps its id")
end)

-- ════════════════════════════════════════════════════════════════════════
-- 5. agent_closed: the picker-kill funnel (#135)
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_agent_closed", function()
  local notes, restore_notes = H.capture_notify()

  -- no id: nothing happens at all
  reset_herdr()
  reset_tabs()
  workspaces.agent_closed(nil, wt_main)
  H.eq(#calls, 0, "a nil workspace id runs no herdr command")

  -- unlisted: agent list failed — no tab and no workspace is touched
  local tab_a = make_tab("w-live", wt_main, "Live")
  canned["agent\001list"] = { result = {} }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_a), true, "an unlisted workspace never closes tabs")
  H.eq(listed({ "workspace", "close", "w-live" }), false, "an unlisted workspace is never closed")
  H.truthy(notes[#notes].msg:find("agent list failed", 1, true), "the list failure is reported")
  reset_tabs()

  -- a same-worktree agent still lives: full early return
  tab_a = make_tab("w-live", wt_main, "Live")
  canned["agent\001list"] = { result = { agents = {
    { workspace_id = "w-live", cwd = wt_feature, foreground_cwd = wt_main },
  } } }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_a), true, "a live agent keeps the tab open")
  H.eq(listed({ "workspace", "close", "w-live" }), false, "a live agent keeps the workspace open")
  H.eq(#notes, 1, "the live-agent case stays silent")

  -- foreground_cwd wins over cwd: an agent whose background cwd matches
  -- the target but whose foreground sits elsewhere does NOT shield the tab
  canned["agent\001list"] = { result = { agents = {
    { workspace_id = "w-live", cwd = wt_main, foreground_cwd = wt_feature },
  } } }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_a), false, "only the foreground cwd shields a worktree")
  H.eq(listed({ "workspace", "close", "w-live" }), false,
    "the workspace survives: it still owns the foreground agent")
  reset_tabs()

  -- same workspace, different worktree: the target's tabs close, the
  -- workspace survives (it still owns an agent)
  tab_a = make_tab("w-live", wt_main, "Live")
  local tab_b = make_tab("w-live", wt_feature, "Live")
  canned["agent\001list"] = { result = { agents = {
    { workspace_id = "w-live", cwd = wt_feature },
  } } }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_a), false, "the target worktree's tab closes")
  H.eq(vim.api.nvim_tabpage_is_valid(tab_b), true, "the other worktree's tab survives")
  H.eq(listed({ "workspace", "close", "w-live" }), false,
    "a workspace with a surviving agent is never closed")
  reset_tabs()

  -- empty workspace: tabs close AND the workspace closes
  tab_a = make_tab("w-live", wt_main, "Live")
  canned["agent\001list"] = { result = { agents = {} } }
  canned["workspace\001close\001w-live"] = { result = { type = "ok" } }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_a), false, "an empty workspace loses its tab")
  H.eq(listed({ "workspace", "close", "w-live" }), true, "an empty workspace is closed")

  -- agents of other workspaces do not shield this one
  reset_tabs()
  tab_a = make_tab("w-live", wt_main, "Live")
  canned["agent\001list"] = { result = { agents = {
    { workspace_id = "w-zombie", cwd = wt_main },
  } } }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(vim.api.nvim_tabpage_is_valid(tab_a), false, "foreign agents do not shield the tab")
  H.eq(listed({ "workspace", "close", "w-live" }), true, "the empty workspace still closes")

  -- a missing-workspace close error is quiet; other errors surface
  reset_tabs()
  tab_a = make_tab("w-live", wt_main, "Live")
  local notes_before = #notes
  canned["workspace\001close\001w-live"] = { err = "unknown workspace w-live" }
  workspaces.agent_closed("w-live", wt_main)
  H.eq(#notes, notes_before, "an already-missing workspace closes quietly")
  reset_tabs()
  tab_a = make_tab("w-live", wt_main, "Live")
  canned["workspace\001close\001w-live"] = { err = "permission denied" }
  workspaces.agent_closed("w-live", wt_main)
  H.truthy(notes[#notes].msg:find("empty workspace close failed", 1, true),
    "a real close failure is reported")
  restore_notes()
end)

-- ════════════════════════════════════════════════════════════════════════
-- 6. pickers: argv and state seam only (mocked calls)
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_pickers", function()
  reset_herdr()
  reset_tabs()
  local notes, restore_notes = H.capture_notify()

  local picker = { closed = false }
  function picker:close()
    self.closed = true
  end
  local input_result = nil
  local restore_input = H.replace(vim.ui, "input", function(opts, on_choice)
    on_choice(input_result)
  end)
  local confirm_result = 1
  local restore_confirm = H.replace(vim.fn, "confirm", function()
    return confirm_result
  end)
  local snack_calls = {}
  Snacks = { picker = { pick = function(opts)
    snack_calls[#snack_calls + 1] = opts
  end } }

  -- create: empty and whitespace labels run no command
  input_result = "   "
  create_workspace(picker)
  H.eq(#calls, 0, "a whitespace label creates nothing")
  H.eq(picker.closed, false, "the picker stays open")
  input_result = nil
  create_workspace(picker)
  H.eq(#calls, 0, "a cancelled input creates nothing")

  -- create: the argv seam and the resulting tab state
  local expected_cwd = vim.fn.getcwd(-1, 0)
  input_result = "Fresh Label"
  canned["workspace\001create\001--cwd\001" .. expected_cwd .. "\001--label\001Fresh Label\001--no-focus"] =
    { result = { workspace = { workspace_id = "w-new" } } }
  canned["workspace\001list"] = { result = { workspaces = {
    { workspace_id = "w-new", label = "Fresh Label", number = 1 },
  } } }
  canned["pane\001list"] = { result = { panes = {
    { workspace_id = "w-new", cwd = wt_other },
  } } }
  create_workspace(picker)
  H.eq(calls[1], { "workspace", "create", "--cwd", expected_cwd, "--label", "Fresh Label", "--no-focus" },
    "create sends cwd, label, and --no-focus in order")
  H.eq(picker.closed, true, "create closes the picker on success")
  local bound = tab_var(vim.api.nvim_get_current_tabpage(), "herdr_workspace_id")
  H.eq(bound, "w-new", "create binds the new workspace to a tab")
  H.eq(workspace_tabs.get(vim.api.nvim_get_current_tabpage()).cwd, wt_other,
    "the created tab binds the workspace cwd")

  -- create: an invalid response keeps the picker open
  reset_tabs()
  picker.closed = false
  canned["workspace\001create\001--cwd\001" .. expected_cwd .. "\001--label\001Broken\001--no-focus"] =
    { result = {} }
  input_result = "Broken"
  create_workspace(picker)
  H.truthy(notes[#notes].msg:find("workspace create failed", 1, true), "a failed create is reported")
  H.eq(picker.closed, false, "a failed create keeps the picker open")

  -- rename: no-op labels run no command
  reset_tabs()
  calls = {}
  picker.closed = false
  local rename_tab = make_tab("w-r", wt_live, "Old")
  local item = { label = "Old", workspace_id = "w-r" }
  input_result = "Old"
  rename_workspace(picker, item)
  H.eq(#calls, 0, "an unchanged label renames nothing")
  input_result = "  "
  rename_workspace(picker, item)
  H.eq(#calls, 0, "a whitespace label renames nothing")
  H.eq(picker.closed, false, "the picker stays open for no-op renames")

  -- rename: the authoritative label wins and the picker reopens
  vim.api.nvim_set_current_tabpage(rename_tab)
  input_result = "New Label"
  canned["workspace\001rename\001w-r\001New Label"] = { result = { workspace = { label = "Server Label" } } }
  canned["workspace\001list"] = { result = { workspaces = {
    { workspace_id = "w-r", label = "Server Label", number = 1 },
  } } }
  canned["pane\001list"] = { result = { panes = {
    { workspace_id = "w-r", cwd = wt_live },
  } } }
  rename_workspace(picker, item)
  H.eq(calls[1], { "workspace", "rename", "w-r", "New Label" }, "rename sends id then label")
  H.eq(tab_var(rename_tab, "herdr_workspace_label"), "Server Label",
    "the server echo overrules the typed label")
  H.eq(workspace_tabs.get(rename_tab).label, "Server Label", "the tab binding takes the echo too")
  H.eq(picker.closed, true, "rename closes the old picker")
  vim.cmd("sleep 10m") -- pump the scheduled reopen
  H.eq(#snack_calls, 1, "rename reopens the workspace picker")
  H.eq(snack_calls[1].items[1].label, "Server Label", "the reopened picker shows the new label")

  -- rename: a failure keeps the picker and does not reopen
  picker.closed = false
  snack_calls = {}
  canned["workspace\001rename\001w-r\001Broken"] = { err = "rename refused" }
  input_result = "Broken"
  rename_workspace(picker, item)
  H.truthy(notes[#notes].msg:find("workspace rename failed", 1, true), "a failed rename is reported")
  H.eq(picker.closed, false, "a failed rename keeps the picker open")
  vim.cmd("sleep 10m")
  H.eq(#snack_calls, 0, "a failed rename does not reopen the picker")

  -- close: cancel touches nothing
  reset_tabs()
  picker.closed = false
  local close_tab = make_tab("w-x", wt_live, "Doomed")
  confirm_result = 2
  calls = {}
  close_workspace(picker, { label = "Doomed", workspace_id = "w-x" })
  H.eq(#calls, 0, "a cancelled close runs no command")
  H.eq(picker.closed, false, "a cancelled close keeps the picker open")
  H.eq(tab_var(close_tab, "herdr_workspace_id"), "w-x", "the tab keeps its binding")

  -- close: confirm unbinds every tab and reopens
  confirm_result = 1
  canned["workspace\001close\001w-x"] = { result = { type = "ok" } }
  close_workspace(picker, { label = "Doomed", workspace_id = "w-x" })
  H.eq(calls[1], { "workspace", "close", "w-x" }, "close sends the workspace id")
  H.eq(picker.closed, true, "close closes the picker")
  H.eq(tab_var(close_tab, "herdr_workspace_id"), nil, "close unbinds the workspace tabs")
  H.eq(vim.api.nvim_tabpage_is_valid(close_tab), true, "picker close unbinds but never closes tabs")
  vim.cmd("sleep 10m")
  H.eq(#snack_calls, 1, "close reopens the workspace picker")

  -- close: a failure keeps everything
  reset_tabs()
  picker.closed = false
  local fail_tab = make_tab("w-f", wt_live, "Sticky")
  snack_calls = {}
  canned["workspace\001close\001w-f"] = { err = "close refused" }
  close_workspace(picker, { label = "Sticky", workspace_id = "w-f" })
  H.truthy(notes[#notes].msg:find("workspace close failed", 1, true), "a failed close is reported")
  H.eq(picker.closed, false, "a failed close keeps the picker open")
  H.eq(tab_var(fail_tab, "herdr_workspace_id"), "w-f", "a failed close keeps the binding")
  vim.cmd("sleep 10m")
  H.eq(#snack_calls, 0, "a failed close does not reopen the picker")

  -- picker_items: home abbreviation and status defaults
  local home = herdr.normalize_cwd(vim.fn.expand("~"))
  local items = picker_items({
    { workspace_id = "w-home", label = "Home", cwd = home },
    { workspace_id = "w-under", label = "Under", cwd = home .. "/dev/thing" },
    { workspace_id = "w-out", label = "Out", cwd = plain_dir },
    { workspace_id = "w-focus", label = "Focused", cwd = plain_two, focused = true },
  })
  H.eq(items[1].cwd_display, "~", "the home dir shows as ~")
  H.eq(items[2].cwd_display, "~/dev/thing", "a dir under home shows the ~ prefix")
  H.eq(items[3].cwd_display, plain_dir, "a dir outside home shows the full path")
  H.eq(items[3].status, "unknown", "a missing agent status reads unknown")
  H.eq(items[4].focused, true, "the focused flag passes through")
  H.eq(items[1].text, "Home ~", "the item text joins label and cwd display")

  -- format_item: marker and highlight per status
  local blocked = format_item({ label = "B", cwd_display = "/b", status = "blocked" })
  H.eq(blocked[1], { "● ", "DiagnosticError" }, "a blocked workspace shows the filled marker in red")
  local done = format_item({ label = "D", cwd_display = "/d", status = "done" })
  H.eq(done[1], { "● ", "DiagnosticOk" }, "a done workspace shows the filled marker in green")
  local unknown = format_item({ label = "U", cwd_display = "/u", status = "unknown" })
  H.eq(unknown[1], { "· ", "Comment" }, "an unknown workspace shows the hollow marker as comment")
  H.eq(unknown[2], { "U" }, "the label chunk carries no extra highlight")
  H.eq(unknown[4], { "/u", "Comment" }, "the cwd chunk is comment-colored")
  H.eq(unknown[5].hl_group, "Comment", "the marker extmark uses Comment")
  H.eq(unknown[5].end_col, #"· ", "the marker extmark spans the marker text")
  H.eq(unknown[6].end_col - unknown[6].col, #"/u", "the cwd extmark spans the cwd display")
  H.eq(unknown[6].hl_group, "Comment", "the cwd extmark uses Comment")

  -- M.focus
  reset_tabs()
  H.eq(workspaces.focus("w-gone"), false, "a missing workspace fails focus")
  H.truthy(notes[#notes].msg:find("workspace is no longer available", 1, true),
    "a missing workspace warns the user")
  canned["pane\001list"] = { result = {} }
  local notes_before = #notes
  H.eq(workspaces.focus("w-gone"), false, "a failed snapshot fails focus")
  H.eq(#notes, notes_before + 1, "a failed snapshot reports only the command error")
  H.truthy(notes[#notes].msg:find("pane list failed", 1, true), "the snapshot error is the report")
  canned["pane\001list"] = { result = { panes = {
    { workspace_id = "w-live", cwd = wt_live },
  } } }
  canned["workspace\001list"] = { result = { workspaces = {
    { workspace_id = "w-live", label = "Live", number = 1 },
  } } }
  H.eq(workspaces.focus("w-live"), true, "a listed workspace focuses")
  H.eq(tab_var(vim.api.nvim_get_current_tabpage(), "herdr_workspace_id"), "w-live",
    "focus binds the workspace to the reused tab")

  Snacks = nil
  restore_confirm()
  restore_input()
  restore_notes()
end)

-- ════════════════════════════════════════════════════════════════════════
-- 7. wiring: the herdr-workspaces lazy spec
-- ════════════════════════════════════════════════════════════════════════
H.run("workspaces_wiring", function()
  local spec = require("plugins.herdr-workspaces")
  H.eq(spec[1], "folke/snacks.nvim", "the wiring rides the snacks.nvim spec")
  H.eq(type(spec.init), "function", "the wiring has an init function")
  H.eq(spec.keys[1][1], "<leader>fw", "the picker opens on <leader>fw")
  H.eq(spec.keys[1].desc, "Herdr Workspaces", "the keymap carries its description")

  -- init wires both setups
  local wired = {}
  local saved_ws = package.loaded["helpers.workspace"]
  local saved_hm = package.loaded["plugins.herdr.workspaces"]
  package.loaded["helpers.workspace"] = { setup = function()
    wired.workspace = true
  end }
  package.loaded["plugins.herdr.workspaces"] = { setup = function()
    wired.workspaces = true
  end, open = function(preferred)
    wired.open = preferred
  end }
  spec.init()
  H.eq(wired.workspace, true, "init sets up helpers.workspace")
  H.eq(wired.workspaces, true, "init sets up the workspaces module")

  -- the keymap handler opens the workspaces picker
  spec.keys[1][2]()
  H.eq(wired.open, nil, "the keymap calls open with no argument")
  package.loaded["helpers.workspace"] = saved_ws
  package.loaded["plugins.herdr.workspaces"] = saved_hm

  -- M.setup wires the TabEnter focus hook
  workspaces.setup()
  local autocmds = vim.api.nvim_get_autocmds({ group = "HerdrWorkspaceTabs", event = "TabEnter" })
  H.eq(#autocmds, 1, "setup registers one TabEnter autocommand")
  vim.api.nvim_del_augroup_by_name("HerdrWorkspaceTabs")
end)

-- ════════════════════════════════════════════════════════════════════════
-- 8. scrollback document(): capture format over fixtures
-- ════════════════════════════════════════════════════════════════════════
H.run("scrollback_document", function()
  -- a tree block lands in one ```ansi fence, fenced off from prose
  local tree_text = table.concat({
    "Assistant",
    "│ ├─ read the file",
    "│ └─ write the file",
    "│ 2 steps · 4 min",
    "Result",
    "",
  }, "\n")
  H.eq(scrollback.document(tree_text), {
    "Assistant",
    "",
    "```ansi",
    "│ ├─ read the file",
    "│ └─ write the file",
    "│ 2 steps · 4 min",
    "```",
    "",
    "Result",
  }, "a tree block becomes one ansi fence between prose lines")

  -- the fence grows past any backtick run inside the tree
  H.eq(scrollback.document("Plan\n├─ ```ticks\n└─ done"), {
    "Plan",
    "",
    "````ansi",
    "├─ ```ticks",
    "└─ done",
    "````",
    "",
  }, "a backtick run inside the tree forces a longer fence")

  -- a fence already in the source passes through; tree logic sleeps inside
  local fenced = { "Intro", "```text", "├─ inside a block", "```", "Outro" }
  H.eq(scrollback.document(table.concat(fenced, "\n")), fenced,
    "a source code block passes through unchanged, tree rows included")

  -- trailing padding and stray SGR codes never reach prose
  H.eq(scrollback.document("prose \27[0m\ntabs\t\nclean \27[31mred\27[0m text"), {
    "prose",
    "tabs",
    "clean red text",
  }, "prose lines lose trailing padding and SGR codes")

  -- degenerate inputs
  H.eq(scrollback.document("Hello"), { "Hello" }, "one plain line passes through")
  H.eq(scrollback.document(""), {}, "empty text yields an empty document")

  -- a tree row needs a glyph or a rail; bare prose never joins the tree
  H.eq(scrollback.document("2 steps · 4 min"), { "2 steps · 4 min" },
    "a steps line without a rail stays prose")
  H.eq(scrollback.document("│ 2 steps · 4 min"), {
    "```ansi",
    "│ 2 steps · 4 min",
    "```",
    "",
  }, "a steps line behind a rail starts a tree")
end)

-- ════════════════════════════════════════════════════════════════════════
-- 9. scrollback paths: directory and identity hash
-- ════════════════════════════════════════════════════════════════════════
H.run("scrollback_paths", function()
  local data_base = vim.fn.tempname() .. "-scrollback"
  local restore_xdg = H.replace(vim.env, "XDG_DATA_HOME", data_base)
  local directory = scrollback.directory()
  local resolved_base = vim.fn.resolve(vim.fn.fnamemodify(data_base, ":p")):gsub("/$", "")
  H.eq(directory, resolved_base .. "/herdr/captures", "captures live under the data home")
  restore_xdg()
  local restore_unset = H.replace(vim.env, "XDG_DATA_HOME", nil)
  H.eq(vim.endswith(scrollback.directory(), "/.local/share/herdr/captures"), true,
    "a missing XDG_DATA_HOME falls back to ~/.local/share")
  restore_unset()

  -- a session identity must be a complete table
  local ok, err = pcall(scrollback.path, "not a table")
  H.eq(ok, false, "a non-table session is rejected")
  H.truthy(tostring(err):find("conversation identity", 1, true), "the rejection names the identity")
  ok, err = pcall(scrollback.path, { source = "pi", kind = "", value = "v" })
  H.eq(ok, false, "an empty kind is rejected")
  ok, err = pcall(scrollback.path, { source = "pi", kind = "durable" })
  H.eq(ok, false, "a missing value is rejected")

  -- the path is the identity hash: stable per session, distinct per value
  local session = { source = "pi", kind = "durable", value = "session-7" }
  local first = scrollback.path(session)
  H.eq(first, scrollback.path({ source = "pi", kind = "durable", value = "session-7" }),
    "the same identity always maps to the same path")
  H.ne(first, scrollback.path({ source = "pi", kind = "durable", value = "session-8" }),
    "a different value maps to a different path")
  H.eq(first, scrollback.directory() .. "/conversation-"
      .. vim.fn.sha256(vim.json.encode({ "pi", "durable", "session-7" })) .. ".md",
    "the path is the sha256 of the json identity under the captures dir")
end)

-- ════════════════════════════════════════════════════════════════════════
-- 10. scrollback save/load: round trip and on-disk refusals
-- ════════════════════════════════════════════════════════════════════════
H.run("scrollback_save_load", function()
  local data_base = vim.fn.tempname() .. "-scrollback-io"
  vim.fn.mkdir(data_base, "p")
  local restore_xdg = H.replace(vim.env, "XDG_DATA_HOME", data_base)
  local capture_dir = scrollback.directory()
  vim.fn.mkdir(capture_dir, "p", 448)

  local path = capture_dir .. "/conversation-test.md"
  local buf = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(buf, path)
  local document = { "Line one", "Line two" }
  scrollback.load(buf, document)

  H.eq(vim.api.nvim_buf_get_lines(buf, 0, -1, false), document, "load puts the document in the buffer")
  H.eq(vim.bo[buf].buftype, "acwrite", "a capture buffer is acwrite")
  H.eq(vim.bo[buf].filetype, "markdown", "a capture buffer is markdown")
  H.eq(vim.bo[buf].modified, false, "a freshly loaded buffer is not modified")
  H.eq(vim.b[buf].herdr_capture_path, path, "load records the capture path")
  H.eq(vim.b[buf].herdr_capture_hash, vim.fn.sha256(table.concat(document, "\n")),
    "load records the document digest")
  -- window_options: a displayed capture buffer gets the reading layout
  vim.api.nvim_set_current_buf(buf)
  scrollback.load(buf, document)
  local win = vim.api.nvim_get_current_win()
  H.eq(vim.wo[win].wrap, true, "a capture window wraps")
  H.eq(vim.wo[win].linebreak, true, "a capture window breaks at word bounds")
  H.eq(vim.wo[win].breakindent, true, "a capture window keeps the indent on wrap")
  H.eq(vim.wo[win].showbreak, "↳ ", "a capture window shows the wrap arrow")
  H.eq(vim.wo[win].number, false, "a capture window hides line numbers")
  H.eq(vim.wo[win].signcolumn, "no", "a capture window hides the sign column")
  H.eq(vim.wo[win].list, false, "a capture window hides list chars")
  H.eq(vim.wo[win].conceallevel, 3, "a capture window conceals marks")
  vim.api.nvim_set_current_buf(vim.api.nvim_list_bufs()[1])

  -- :write targets the CURRENT buffer, so drive every write through
  -- nvim_buf_call to aim it at the capture buffer and its BufWriteCmd hook
  local function buf_write(b, command)
    return pcall(vim.api.nvim_buf_call, b, function()
      return vim.cmd(command)
    end)
  end

  -- round trip: :write! persists the buffer through the BufWriteCmd hook
  H.eq(buf_write(buf, "write! " .. vim.fn.fnameescape(path)), true, "write! succeeds")
  H.eq(vim.fn.readfile(path), document, "write! puts the clean buffer text on disk")
  H.eq(vim.bo[buf].modified, false, "write! leaves the buffer unmodified")

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "Line one", "Line two", "Line three" })
  H.eq(buf_write(buf, "write! " .. vim.fn.fnameescape(path)), true, "the second write! succeeds")
  H.eq(vim.fn.readfile(path), { "Line one", "Line two", "Line three" },
    "a second write! persists the edited buffer")

  -- refusal: the disk copy changed behind the buffer
  local tampered = { "tampered" }
  vim.fn.writefile(tampered, path)
  local ok, err = buf_write(buf, "write " .. vim.fn.fnameescape(path))
  H.eq(ok, false, "a changed-on-disk capture refuses :write")
  H.truthy(tostring(err):find("Capture changed on disk", 1, true), "the refusal names the conflict")
  H.eq(vim.fn.readfile(path), tampered, "the refused write never touches the disk file")
  H.eq(buf_write(buf, "write! " .. vim.fn.fnameescape(path)), true, "the bang overwrite succeeds")
  H.eq(vim.fn.readfile(path), { "Line one", "Line two", "Line three" },
    ":write! overwrites the changed-on-disk capture")

  -- refusal: a foreign existing file without a capture identity
  local other = capture_dir .. "/conversation-other.md"
  vim.fn.writefile({ "foreign" }, other)
  ok, err = buf_write(buf, "write " .. vim.fn.fnameescape(other))
  H.eq(ok, false, "writing onto a foreign file refuses without a bang")
  H.truthy(tostring(err):find("File exists", 1, true), "the refusal tells the user to use :write!")
  H.eq(vim.fn.readfile(other), { "foreign" }, "the foreign file stays untouched")

  -- load round trip: a reload of a saved file keeps the same identity
  local reload_path = capture_dir .. "/conversation-reload.md"
  local saved = vim.fn.readfile(path)
  vim.fn.writefile(saved, reload_path)
  local reload_buf = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(reload_buf, reload_path)
  scrollback.load(reload_buf, vim.fn.readfile(reload_path))
  H.eq(vim.b[reload_buf].herdr_capture_hash, vim.fn.sha256(table.concat(saved, "\n")),
    "a reload recomputes the same digest")
  H.eq(buf_write(reload_buf, "write! " .. vim.fn.fnameescape(reload_path)), true,
    "the reload write succeeds")
  H.eq(vim.fn.readfile(reload_path), saved, "the reload round trip is byte-stable")

  -- render guard: no live Herdr environment means a quiet no-op
  local saved_env = vim.env.HERDR_ENV
  vim.env.HERDR_ENV = nil
  H.eq(scrollback.render(buf), false, "render refuses without HERDR_ENV")
  vim.env.HERDR_ENV = saved_env

  -- setup wires the capture-file autocommands
  scrollback.setup()
  local autos = vim.api.nvim_get_autocmds({ group = "HerdrScrollback" })
  local events = {}
  for _, autocmd in ipairs(autos) do
    events[#events + 1] = autocmd.event
  end
  H.eq(#autos, 4, "setup registers both events for both capture patterns")
  H.eq(#vim.tbl_filter(function(event)
    return event == "BufReadPre"
  end, events), 2, "both capture patterns get BufReadPre")
  H.eq(#vim.tbl_filter(function(event)
    return event == "BufReadPost"
  end, events), 2, "both capture patterns get BufReadPost")
  vim.api.nvim_del_augroup_by_name("HerdrScrollback")

  restore_xdg()
end)

-- restore the stubbed module fields (process exits anyway, but stay clean)
herdr.call, herdr.git_context = real_call, real_git_context
package.loaded["helpers.markdown_ansi"] = nil
reset_tabs()
