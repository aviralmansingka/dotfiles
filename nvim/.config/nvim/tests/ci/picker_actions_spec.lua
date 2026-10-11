-- Picker action lifecycle + session-resolution invariants (cluster 1).
--
-- Pins the M.open action closures and the herdr resolution VALUES through
-- the real modules, never copies:
--   * rename_item: `agent rename` argv always carries item.agent_name,
--     never terminal_id (#130 agent_not_found); cancel and unchanged slug
--     are no-ops; a failed rename notifies instead of erroring.
--   * active_item: the workspace-window cursor row drives workspace-selector
--     actions, else the picker's current item (#129 wrong-target kill);
--     headings and _empty rows are no-ops.
--   * kill_item: confirmation funnels to pane close + workspaces.agent_closed;
--     decline and close failure leave state untouched (failure notifies).
--   * activate: records last_session, then toggles; cross-workspace confirm
--     focuses the target workspace first and aborts when focus fails.
--   * workspace_groups: one repository group per git common dir across
--     worktrees; transient agents never join durable grouping (#135/#138).
--   * herdr resolution values (#141): is_durable_agent, workspace_for_
--     repository, agent_for_worktree, ensure_workspace fail-closed, and the
--     main-checkout exact-name reuse rule behind M.start.
--   * last_session record/open pairing round-trips through the toggle seam.
--
-- vim.system is fully stubbed for the herdr-value cases: no live herdr, no
-- git subprocess, no network. Snacks/UI interactions run against the shared
-- cwd_picker_env fakes; the workspace selector is driven through the real
-- on_show/render_workspace wiring (fake win ids are upgraded so the real
-- code path runs).

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()
local env = dofile(vim.fs.dirname(here) .. "/lib/cwd_picker_env.lua")
local cwd_picker = env.require_picker()
local last_session = require("plugins.sidekick.last_session")
local internal = require("plugins.sidekick.internal")

-- ── Fake seam extensions the shared env does not provide ─────────────────
-- The env fake herdr has no focus/close and no rename outcome control.
-- cwd_picker holds this same table reference, so field additions and the
-- call override reach the real closures.
local fake_herdr = package.loaded["plugins.sidekick.herdr"]
fake_herdr.focus = function(target)
  env.action_focus[#env.action_focus + 1] = target
  return env.agent_focus_result ~= false
end
fake_herdr.close = function(pane_id)
  env.action_close[#env.action_close + 1] = pane_id
  return env.pane_close_result ~= false
end
fake_herdr.call = function(args, quiet)
  env.calls[#env.calls + 1] = { args = args, quiet = quiet }
  if args[1] == "workspace" and args[2] == "list" then
    return { workspaces = env.workspaces }
  end
  if args[1] == "agent" and args[2] == "rename" then
    return env.rename_result
  end
  return {}
end

package.loaded["plugins.herdr.workspaces"] = {
  focus = function(workspace_id)
    env.ws_focus[#env.ws_focus + 1] = workspace_id
    return env.ws_focus_result ~= false
  end,
  agent_closed = function(workspace_id, cwd_path)
    env.ws_agent_closed[#env.ws_agent_closed + 1] = { workspace_id, cwd_path }
  end,
}

local original_toggle = internal.toggle_tool_session
internal.toggle_tool_session = function(name, focus, terminal_id)
  env.toggles[#env.toggles + 1] = { name, focus, terminal_id }
end

-- ── Fixtures ──────────────────────────────────────────────────────────────
local fixture = vim.fn.tempname() .. "-picker-actions"
for _, dir in ipairs({ "repo-main", "feature-one", "plain" }) do
  vim.fn.mkdir(fixture .. "/" .. dir, "p")
end
-- The picker resolves locality from the real cwd; scope it to the fixture
-- worktree so the fake git contexts drive every decision.
vim.cmd("tcd " .. vim.fn.fnameescape(fixture .. "/feature-one"))
local repo = "/repos/dotfiles"
local main_ctx = env.git_context(repo, fixture .. "/repo-main", "main")
local feat_ctx = env.git_context(repo, fixture .. "/feature-one", "feat-x", "feat-x-label")

local function action_agents()
  return {
    {
      name = "pi-review",
      agent = "pi",
      agent_status = "idle",
      durable = true,
      cwd = fixture .. "/feature-one",
      pane_id = "wA:p1",
      tab_id = "wA:t1",
      terminal_id = "termA1",
      workspace_id = "wA",
    },
    {
      name = "codex-main-hello",
      agent = "codex",
      agent_status = "idle",
      durable = true,
      cwd = fixture .. "/repo-main",
      pane_id = "wB:p1",
      tab_id = "wB:t1",
      terminal_id = "termB1",
      workspace_id = "wB",
    },
  }
end

env.action_focus = {}
env.action_close = {}
env.ws_focus = {}
env.ws_agent_closed = {}
env.toggles = {}
env.notified = {}
env.on_confirm_calls = {}
env.on_kill_calls = {}
env.ui_opts = nil
env.ui_reply = nil
env.confirm_reply = 1
env.confirm_args = nil
env.picker_current = nil
env.rename_result = {}
env.pane_close_result = true
env.ws_focus_result = true
env.agent_focus_result = true

local function reset_actions()
  env.reset()
  env.git_by_path[fixture .. "/repo-main"] = main_ctx
  env.git_by_path[fixture .. "/feature-one"] = feat_ctx
  env.agents = action_agents()
  env.workspaces = { { workspace_id = "wP", label = "plain-ws" } }
  env.action_focus = {}
  env.action_close = {}
  env.ws_focus = {}
  env.ws_agent_closed = {}
  env.toggles = {}
  env.notified = {}
  env.on_confirm_calls = {}
  env.on_kill_calls = {}
  env.ui_opts = nil
  env.ui_reply = nil
  env.confirm_reply = 1
  env.confirm_args = nil
  env.picker_current = nil
  env.rename_result = {}
  env.pane_close_result = true
  env.ws_focus_result = true
  env.agent_focus_result = true
  vim.t.herdr_workspace_id = nil
  last_session.label = nil
  last_session.terminal_id = nil
end

local function install_ui()
  local restores = {}
  restores[#restores + 1] = H.replace(vim.ui, "input", function(ui_opts, cb)
    env.ui_opts = ui_opts
    cb(env.ui_reply)
  end)
  restores[#restores + 1] = H.replace(vim.fn, "confirm", function(...)
    env.confirm_args = { ... }
    return env.confirm_reply
  end)
  restores[#restores + 1] = H.replace(vim.cmd, "startinsert", function() end)
  restores[#restores + 1] = H.replace(vim, "notify", function(msg, level)
    env.notified[#env.notified + 1] = { msg = msg, level = level }
  end)
  return function()
    for _, restore in ipairs(restores) do
      restore()
    end
  end
end

-- The env fake windows use win = 0 (a number). The real set_active_selector
-- and on_show wiring need win objects, so upgrade the fake picker's win
-- references before driving on_show. This keeps the real render path.
local function open_picker(open_opts)
  env.picker_opts = nil
  local p = cwd_picker.open(open_opts or {})
  local picked = env.picker_opts
  local winobj = {
    win = 0,
    valid = function()
      return true
    end,
    win_valid = function()
      return true
    end,
    on = function() end,
    map = function() end,
    minimal = function() end,
    opts = { wo = {} },
  }
  p.list.win = winobj
  p.input.win = { win = 0, on = function() end }
  p.preview.win = winobj
  p.current = function()
    return env.picker_current
  end
  return p, picked
end

local function show_workspace(p, picked)
  vim.api.nvim_win_set_buf(0, picked.layout.wins.workspace.buf)
  picked.on_show(p)
end

local function workspace_line_count(picked)
  return vim.api.nvim_buf_line_count(picked.layout.wins.workspace.buf)
end

local function rename_calls()
  return vim.tbl_filter(function(record)
    return record.args[1] == "agent" and record.args[2] == "rename"
  end, env.calls)
end

local function closed_delta(before)
  return env.closed_count - before
end

-- ── Case 1: confirm / activate ────────────────────────────────────────────
H.run("picker_actions: confirm and activate", function()
  local restore_ui = install_ui()

  -- nil item: confirm closes the picker and does nothing else.
  reset_actions()
  local p, picked = open_picker()
  local before = env.closed_count
  picked.confirm(p, nil)
  H.eq(closed_delta(before), 1, "confirm with nil item closes once")
  H.eq(env.toggles, {}, "confirm with nil item toggles nothing")
  H.eq(env.ws_focus, {}, "confirm with nil item focuses no workspace")

  -- _empty item: same close-only behavior.
  picked.confirm(p, { text = "(no session)", _empty = true })
  H.eq(closed_delta(before), 2, "confirm with _empty item closes once")
  H.eq(env.toggles, {}, "confirm with _empty item toggles nothing")

  -- _workspace heading item: activate guard is a full no-op (no close).
  picked.confirm(p, { _workspace = true, workspace_id = "wA" })
  H.eq(closed_delta(before), 2, "activate on a _workspace heading never closes")
  H.eq(env.toggles, {}, "activate on a _workspace heading toggles nothing")

  -- Same-workspace activate: records last_session, then toggles.
  reset_actions()
  vim.t.herdr_workspace_id = "wA"
  local action_opts = {
    on_confirm = function(item)
      env.on_confirm_calls[#env.on_confirm_calls + 1] = item
    end,
  }
  p, picked = open_picker(action_opts)
  local item = cwd_picker.list_items({})[1]
  H.truthy(item and item.agent_name == "pi-review", "local item resolves to pi-review")
  before = env.closed_count
  picked.confirm(p, item)
  H.eq(#env.on_confirm_calls, 1, "activate reports the item through on_confirm")
  H.eq(env.on_confirm_calls[1].agent_name, "pi-review", "on_confirm receives the picked agent")
  H.eq(closed_delta(before), 1, "activate closes the picker")
  H.eq(env.ws_focus, {}, "same-workspace activate never focuses a workspace")
  H.eq(env.action_focus, {}, "idle activate never focuses the agent")
  H.eq(env.toggles, { { "pi-review", true, "termA1" } }, "activate toggles the session with its terminal")
  H.eq(last_session.label, "pi-review", "activate records the last session label")
  H.eq(last_session.terminal_id, "termA1", "activate records the last session terminal")

  -- done-status activate: the agent itself is focused before the toggle.
  reset_actions()
  vim.t.herdr_workspace_id = "wA"
  p, picked = open_picker()
  item = cwd_picker.list_items({})[1]
  item.status = "done"
  picked.confirm(p, item)
  H.eq(env.action_focus, { "pi-review" }, "done-status activate focuses the agent by name")
  H.eq(env.toggles, { { "pi-review", true, "termA1" } }, "done-status activate still toggles")

  -- Cross-workspace activate: focus the target workspace first.
  reset_actions()
  vim.t.herdr_workspace_id = "wB"
  p, picked = open_picker()
  item = cwd_picker.list_items({})[1]
  item.workspace_id = "wA"
  picked.confirm(p, item)
  H.eq(env.ws_focus, { "wA" }, "cross-workspace activate focuses the item workspace")
  H.eq(env.toggles, { { "pi-review", true, "termA1" } }, "cross-workspace activate toggles after focus")

  -- Cross-workspace focus failure: abort before record and toggle.
  reset_actions()
  vim.t.herdr_workspace_id = "wB"
  env.ws_focus_result = false
  last_session.label = "sentinel"
  p, picked = open_picker()
  item = cwd_picker.list_items({})[1]
  item.workspace_id = "wA"
  picked.confirm(p, item)
  H.eq(env.ws_focus, { "wA" }, "failed focus still targets the item workspace")
  H.eq(env.toggles, {}, "failed workspace focus aborts the toggle")
  H.eq(last_session.label, "sentinel", "failed workspace focus keeps the last session record")

  restore_ui()
end)

-- ── Case 2: rename_item ───────────────────────────────────────────────────
H.run("picker_actions: rename item", function()
  local restore_ui = install_ui()
  local p, picked, item

  -- Cancelled input is a no-op.
  reset_actions()
  p, picked = open_picker()
  item = cwd_picker.list_items({})[1]
  local before = env.closed_count
  env.ui_reply = nil
  picked.actions.sidekick_rename_session(p, item)
  H.eq(rename_calls(), {}, "cancelled rename never calls herdr")
  H.eq(closed_delta(before), 0, "cancelled rename never closes")
  H.eq(env.notified, {}, "cancelled rename never notifies")

  -- Unchanged slug is a no-op.
  env.ui_reply = "review"
  picked.actions.sidekick_rename_session(p, item)
  H.eq(rename_calls(), {}, "unchanged slug never calls herdr")
  H.eq(env.ui_opts.default, "review", "rename prompt defaults to the current slug")

  -- Missing agent_name: the prompt never opens.
  env.ui_opts = nil
  picked.actions.sidekick_rename_session(p, { label = "pi-x", tool = "pi", slug = "x", terminal_id = "termZ" })
  H.eq(env.ui_opts, nil, "rename never prompts without an agent_name")
  H.eq(rename_calls(), {}, "rename without agent_name never calls herdr")

  -- Successful rename: argv carries agent_name, never terminal_id (#130).
  reset_actions()
  p, picked = open_picker()
  item = cwd_picker.list_items({})[1]
  before = env.closed_count
  env.ui_reply = "Notes  2!"
  picked.actions.sidekick_rename_session(p, item)
  local calls = rename_calls()
  H.eq(#calls, 1, "successful rename issues exactly one herdr call")
  H.eq(calls[1].args, { "agent", "rename", "pi-review", "pi-notes-2" }, "rename argv targets the agent name")
  H.eq(calls[1].quiet, true, "rename runs quiet")
  H.eq(vim.tbl_contains(calls[1].args, "termA1"), false, "rename argv never carries terminal_id")
  H.eq(closed_delta(before), 1, "successful rename closes the picker for reopen")
  H.eq(env.notified, {}, "successful rename never notifies")

  -- Name-taken failure surfaces a notification, not an error.
  reset_actions()
  p, picked = open_picker()
  item = cwd_picker.list_items({})[1]
  before = env.closed_count
  env.rename_result = nil
  env.ui_reply = "taken"
  picked.actions.sidekick_rename_session(p, item)
  H.eq(#env.notified, 1, "failed rename notifies once")
  H.truthy(
    env.notified[1].msg:find("session rename failed", 1, true) ~= nil,
    "failed rename names the failure"
  )
  H.eq(env.notified[1].level, vim.log.levels.ERROR, "failed rename notifies at ERROR")
  H.eq(closed_delta(before), 0, "failed rename never closes the picker")

  -- Rename from the workspace selector: the cursor row is the target.
  reset_actions()
  p, picked = open_picker()
  show_workspace(p, picked)
  env.picker_current = {
    label = "codex-main-hello",
    tool = "codex",
    slug = "main-hello",
    agent_name = "codex-main-hello",
    pane_id = "wB:p1",
    terminal_id = "termB1",
    workspace_id = "wB",
  }
  vim.api.nvim_win_set_cursor(0, { 3, 0 }) -- codex-main-hello row
  env.ui_reply = "fresh"
  picked.win.input.keys["<c-r>"][1]()
  calls = rename_calls()
  H.eq(#calls, 1, "selector rename issues exactly one herdr call")
  H.eq(calls[1].args, { "agent", "rename", "codex-main-hello", "codex-fresh" },
    "selector rename targets the cursor row agent, not the picker current")
  H.eq(vim.tbl_contains(calls[1].args, "termB1"), false, "selector rename argv never carries terminal_id")

  restore_ui()
end)

-- ── Case 3: kill_item + active_item targeting ─────────────────────────────
H.run("picker_actions: kill item and target resolution", function()
  local restore_ui = install_ui()
  local p, picked, before

  -- Heading row: kill is a no-op before any confirmation.
  reset_actions()
  p, picked = open_picker()
  show_workspace(p, picked)
  before = env.closed_count
  vim.api.nvim_win_set_cursor(0, { 1, 0 }) -- repository heading row
  env.workspace_win_opts.keys["<c-x>"]()
  H.eq(env.confirm_args, nil, "heading rows never ask for kill confirmation")
  H.eq(env.action_close, {}, "heading rows never close a pane")
  H.eq(env.ws_agent_closed, {}, "heading rows never report agent_closed")
  H.eq(closed_delta(before), 0, "heading rows never close the picker")

  -- Agent row under the workspace selector: the cursor row is the kill
  -- target even when the picker's current item differs (#129).
  local kill_opts = {
    on_kill = function(item)
      env.on_kill_calls[#env.on_kill_calls + 1] = item
    end,
  }
  reset_actions()
  p, picked = open_picker(kill_opts)
  show_workspace(p, picked)
  env.picker_current = {
    label = "codex-main-hello",
    tool = "codex",
    slug = "main-hello",
    agent_name = "codex-main-hello",
    pane_id = "wB:p1",
    terminal_id = "termB1",
    workspace_id = "wB",
  }
  vim.api.nvim_win_set_cursor(0, { 2, 0 }) -- pi-review row
  before = env.closed_count
  env.workspace_win_opts.keys["<c-x>"]()
  H.eq(env.confirm_args ~= nil, true, "agent rows ask for kill confirmation")
  H.eq(env.action_close, { "wA:p1" }, "kill closes the cursor row pane, not the picker current pane")
  H.eq(env.ws_agent_closed, { { "wA", fixture .. "/feature-one" } },
    "kill reports agent_closed with the row workspace and cwd")
  H.eq(#env.on_kill_calls, 1, "kill reports the item through on_kill")
  H.eq(env.on_kill_calls[1].agent_name, "pi-review", "on_kill receives the cursor row agent")
  H.eq(closed_delta(before), 1, "kill closes the picker for reopen")
  H.eq(env.notified, {}, "successful kill never notifies")

  -- Declined confirmation leaves everything untouched.
  reset_actions()
  p, picked = open_picker(kill_opts)
  show_workspace(p, picked)
  before = env.closed_count
  vim.api.nvim_win_set_cursor(0, { 2, 0 })
  env.confirm_reply = 2
  env.workspace_win_opts.keys["<c-x>"]()
  H.eq(env.action_close, {}, "declined kill never closes a pane")
  H.eq(env.ws_agent_closed, {}, "declined kill never reports agent_closed")
  H.eq(closed_delta(before), 0, "declined kill never closes the picker")
  H.eq(env.notified, {}, "declined kill never notifies")

  -- Close failure notifies and stops before agent_closed.
  reset_actions()
  p, picked = open_picker(kill_opts)
  show_workspace(p, picked)
  before = env.closed_count
  vim.api.nvim_win_set_cursor(0, { 2, 0 })
  env.pane_close_result = false
  env.workspace_win_opts.keys["<c-x>"]()
  H.eq(env.action_close, { "wA:p1" }, "failed close still attempted the right pane")
  H.eq(#env.notified, 1, "failed close notifies once")
  H.truthy(env.notified[1].msg:find("session close failed", 1, true) ~= nil, "failure names the session")
  H.eq(env.notified[1].level, vim.log.levels.ERROR, "failed close notifies at ERROR")
  H.eq(env.ws_agent_closed, {}, "failed close never reports agent_closed")
  H.eq(closed_delta(before), 0, "failed close never closes the picker")

  -- Picker-focused branch: the picker's current item is the target.
  reset_actions()
  p, picked = open_picker(kill_opts)
  env.picker_current = cwd_picker.list_items({})[1]
  before = env.closed_count
  picked.win.input.keys["<c-x>"][1]()
  H.eq(env.action_close, { "wA:p1" }, "picker-focused kill targets the current item pane")
  H.eq(env.ws_agent_closed, { { "wA", fixture .. "/feature-one" } }, "picker-focused kill reports agent_closed")

  -- No current item: kill is a no-op.
  reset_actions()
  p, picked = open_picker(kill_opts)
  env.picker_current = nil
  env.confirm_args = nil
  picked.win.input.keys["<c-x>"][1]()
  H.eq(env.confirm_args, nil, "kill with no current item never confirms")
  H.eq(env.action_close, {}, "kill with no current item never closes a pane")

  -- _empty current item: kill is a no-op.
  env.picker_current = { text = "(no session)", _empty = true }
  picked.win.input.keys["<c-x>"][1]()
  H.eq(env.confirm_args, nil, "kill on an _empty item never confirms")
  H.eq(env.action_close, {}, "kill on an _empty item never closes a pane")

  -- Heading enter collapses the group without activating anything.
  reset_actions()
  p, picked = open_picker(kill_opts)
  show_workspace(p, picked)
  H.eq(workspace_line_count(picked), 3, "expanded group renders heading plus two agents")
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  env.workspace_win_opts.keys["<cr>"]()
  H.eq(workspace_line_count(picked), 1, "heading enter collapses the group to its heading")
  H.eq(env.toggles, {}, "heading enter never toggles a session")
  H.eq(env.ws_focus, {}, "heading enter never focuses a workspace")
  env.workspace_win_opts.keys["<cr>"]()
  H.eq(workspace_line_count(picked), 3, "second heading enter expands the group again")

  -- Agent row enter activates through the workspace selector.
  reset_actions()
  p, picked = open_picker()
  show_workspace(p, picked)
  vim.api.nvim_win_set_cursor(0, { 2, 0 })
  env.workspace_win_opts.keys["<cr>"]()
  H.eq(env.toggles, { { "pi-review", true, "termA1" } }, "agent row enter activates the row session")
  H.eq(env.ws_agent_closed, {}, "agent row enter never reports agent_closed")

  restore_ui()
end)

-- ── Case 4: workspace_groups invariants ───────────────────────────────────
H.run("picker_actions: workspace groups", function()
  reset_actions()
  env.agents = {
    action_agents()[1],
    action_agents()[2],
    { -- transient child agent: never joins durable grouping
      name = "tmp-child",
      agent = "pi",
      agent_status = "idle",
      durable = false,
      cwd = fixture .. "/feature-one",
      pane_id = "wA:p9",
      tab_id = "wA:t9",
      terminal_id = "termA9",
      workspace_id = "wA",
    },
    { -- second repository, own workspace
      name = "pi-elsewhere",
      agent = "pi",
      agent_status = "idle",
      durable = true,
      cwd = "/repos/other/wt",
      pane_id = "wC:p1",
      tab_id = "wC:t1",
      terminal_id = "termC1",
      workspace_id = "wC",
    },
    { -- non-git cwd: grouped by workspace, not repository
      name = "pi-plain",
      agent = "pi",
      agent_status = "idle",
      durable = true,
      cwd = fixture .. "/plain",
      pane_id = "wP:p1",
      tab_id = "wP:t1",
      terminal_id = "termP1",
      workspace_id = "wP",
    },
  }
  env.git_by_path["/repos/other/wt"] = env.git_context("/repos/other", "/repos/other/wt", "feat-z")

  local groups_fn = H.upvalue(cwd_picker.open, "workspace_groups")
  local groups = groups_fn(repo, {})

  H.eq(#groups, 3, "three groups: two repositories plus one plain workspace")

  local first = groups[1]
  H.eq(first.item.group_key, "repository:" .. repo, "the current repository group comes first")
  H.eq(first.item._workspace, true, "group headings are marked _workspace")
  H.eq(first.item.repository, repo, "repository group carries the repository")
  H.eq(first.item.workspace_label, "dotfiles", "repository groups label with the repository label")
  H.eq(first.worktree_count, 2, "one repository group spans both worktrees")
  H.eq(#first.agents, 2, "both durable agents join the repository group")
  H.eq({ first.agents[1].agent_name, first.agents[2].agent_name }, { "pi-review", "codex-main-hello" },
    "group agents sort by tool rank")
  H.eq(first.agents[1].toggle_name, "pi-review", "group agents carry the toggle name")
  H.eq(first.agents[1].pane_id, "wA:p1", "group agents carry the pane id")
  H.eq(first.agents[1].workspace_id, "wA", "group agents carry the workspace id")
  H.eq(first.agents[1].terminal_id, "termA1", "group agents carry the terminal id")

  H.eq(groups[2].item.group_key, "repository:/repos/other", "the second repository forms its own group")
  H.eq(groups[2].item.workspace_label, "other", "second repository labels with its repository label")

  H.eq(groups[3].item.group_key, "workspace:wP", "non-git agents group by workspace id")
  H.eq(groups[3].item.workspace_label, "plain-ws", "non-git groups label from the workspace list")

  local names = {}
  for _, group in ipairs(groups) do
    for _, agent in ipairs(group.agents) do
      names[#names + 1] = agent.agent_name
    end
  end
  H.eq(vim.tbl_contains(names, "tmp-child"), false, "transient agents never join durable grouping")
end)

-- ── Case 5: last_session record/open pairing ──────────────────────────────
H.run("picker_actions: last session pairing", function()
  local restore_ui = install_ui()

  -- record/open round-trip with a terminal id.
  reset_actions()
  last_session.label = nil
  last_session.terminal_id = nil
  last_session.record("pi-review", "termA1")
  H.eq(last_session.label, "pi-review", "record stores the label")
  H.eq(last_session.terminal_id, "termA1", "record stores the terminal id")
  last_session.open()
  H.eq(env.toggles, { { "pi-review", true, "termA1" } }, "open toggles the recorded session and terminal")

  -- record without a terminal id keeps the toggle terminal-free.
  reset_actions()
  last_session.label = nil
  last_session.record("pi-solo")
  last_session.open()
  H.eq(env.toggles, { { "pi-solo", true, nil } }, "open toggles without a terminal filter")

  -- invalid records never overwrite a stored label.
  last_session.record(nil, "termX")
  H.eq(last_session.label, "pi-solo", "record with a nil label keeps the stored label")
  last_session.record("", "termX")
  H.eq(last_session.label, "pi-solo", "record with an empty label keeps the stored label")
  H.ne(last_session.label, "", "record never stores an empty label")

  -- no record yet: open falls back to the cwd picker, not a toggle.
  reset_actions()
  last_session.label = nil
  last_session.terminal_id = nil
  env.picker_opts = nil
  last_session.open()
  H.eq(env.toggles, {}, "fallback open never toggles")
  H.truthy(env.picker_opts, "fallback open launches the cwd picker")

  restore_ui()
end)

-- ── Case 6: herdr resolution VALUES (real module, stubbed vim.system) ─────
H.run("picker_actions: herdr resolution values", function()
  local saved_herdr = package.loaded["plugins.sidekick.herdr"]
  package.loaded["plugins.sidekick.herdr"] = nil
  local herdr = require("plugins.sidekick.herdr")

  local gitfx = {
    ["/wt/main"] = { "/wt/main", "/repos/dotfiles/.git", "main" },
    ["/wt/feature"] = { "/wt/feature", "/repos/dotfiles/.git", "feat-x" },
    ["/wt/otherf"] = { "/wt/otherf", "/repos/dotfiles/.git", "feat-y" },
    ["/repos/other/wt"] = { "/repos/other/wt", "/repos/other/.git", "feat-z" },
  }
  local state = {
    agents = {},
    panes = {},
    workspace_panes = {},
    create_calls = {},
    herdr_calls = {},
    create_fail = false,
    pane_list_fail = false,
    pane_list_invalid = false,
    create_result = {
      workspace = { workspace_id = "wNEW" },
      root_pane = { pane_id = "pNEW", tab_id = "tNEW" },
    },
  }
  local function reset_state()
    state.agents = {}
    state.panes = {}
    state.workspace_panes = {}
    state.create_calls = {}
    state.hdr_calls = {}
    state.create_fail = false
    state.pane_list_fail = false
    state.pane_list_invalid = false
  end

  local restore_system = H.replace(vim, "system", function(cmd)
    local result
    if cmd[1] == "git" then
      if cmd[4] == "diff" then
        result = { code = 0, stdout = "3\t1\tfile.lua" }
      else
        local fx = gitfx[cmd[3]]
        if fx then
          result = { code = 0, stdout = table.concat(fx, "\n") }
        else
          result = { code = 128, stdout = "", stderr = "fatal: not a git repository" }
        end
      end
    elseif cmd[1] == "herdr" then
      local args = {}
      for i = 2, #cmd do
        args[#args + 1] = cmd[i]
      end
      state.hdr_calls[#state.hdr_calls + 1] = args
      if state.pane_list_fail then
        result = { code = 1, stdout = "", stderr = "herdr unavailable" }
      elseif state.pane_list_invalid then
        result = { code = 0, stdout = "not json" }
      elseif args[1] == "agent" and args[2] == "list" then
        result = { code = 0, stdout = vim.json.encode({ result = { agents = state.agents } }) }
      elseif args[1] == "agent" and args[2] == "get" then
        local found = nil
        for _, agent in ipairs(state.agents) do
          if agent.name == args[3] then
            found = agent
          end
        end
        result = { code = 0, stdout = vim.json.encode({ result = { agent = found } }) }
      elseif args[1] == "pane" and args[2] == "list" then
        if args[3] == "--workspace" then
          result = { code = 0, stdout = vim.json.encode({ result = { panes = state.workspace_panes } }) }
        else
          result = { code = 0, stdout = vim.json.encode({ result = { panes = state.panes } }) }
        end
      elseif args[1] == "workspace" and args[2] == "create" then
        state.create_calls[#state.create_calls + 1] = args
        if state.create_fail then
          result = { code = 1, stdout = "", stderr = "workspace create failed" }
        else
          result = { code = 0, stdout = vim.json.encode({ result = state.create_result }) }
        end
      else
        result = { code = 0, stdout = vim.json.encode({ result = {} }) }
      end
    else
      result = { code = 1, stdout = "", stderr = "unexpected command" }
    end
    result.wait = function()
      return result
    end
    return result
  end)
  local notified, restore_notify = H.capture_notify()

  -- is_durable_agent: name-pattern gate on codex/pi kinds.
  H.eq(herdr.is_durable_agent({ agent = "pi", name = "sk-pi-abc" }), true, "sk-pi names are durable")
  H.eq(herdr.is_durable_agent({ agent = "pi", name = "pi-abc" }), true, "bare pi names are durable")
  H.eq(herdr.is_durable_agent({ agent = "codex", name = "sk-codex-x" }), true, "sk-codex names are durable")
  H.eq(herdr.is_durable_agent({ agent = "codex", name = "codex-x" }), true, "bare codex names are durable")
  H.eq(herdr.is_durable_agent({ agent = "zsh", name = "sk-zsh-x" }), false, "non-agent kinds are not durable")
  H.eq(herdr.is_durable_agent({ agent = "pi", name = "tmp-child" }), false, "unprefixed names are transient")
  H.eq(herdr.is_durable_agent({ agent = "pi" }), false, "agents without names are not durable")
  H.eq(herdr.is_durable_agent({}), false, "empty agents are not durable")
  H.eq(herdr.is_durable_agent(nil), false, "nil is not durable")

  -- workspace_for_repository: one workspace per repository via git common dir.
  reset_state()
  state.panes = {
    { workspace_id = "wA", foreground_cwd = "/wt/feature" },
    { workspace_id = "wB", foreground_cwd = "/wt/main" },
  }
  H.eq({ herdr.workspace_for_repository("/repos/dotfiles") }, { "wA", true },
    "both worktrees resolve to the repository's workspace")
  H.eq({ herdr.workspace_for_repository("/repos/other") }, { nil, true },
    "an unlisted repository yields nil but stays verified")
  reset_state()
  state.panes = { { workspace_id = "wP", foreground_cwd = "/repos/dotfiles" } }
  H.eq({ herdr.workspace_for_repository("/repos/dotfiles") }, { "wP", true },
    "a non-git pane at the repository path matches by cwd")
  reset_state()
  state.pane_list_fail = true
  H.eq({ herdr.workspace_for_repository("/repos/dotfiles") }, { nil, false },
    "an unverifiable pane list fails closed")
  state.pane_list_fail = false
  state.pane_list_invalid = true
  H.eq({ herdr.workspace_for_repository("/repos/dotfiles") }, { nil, false },
    "an unparseable pane list fails closed")
  state.pane_list_invalid = false

  -- agent_for_worktree: worktree match, exact-name filter, transient gate.
  reset_state()
  state.agents = {
    { name = "pi-review", agent = "pi", foreground_cwd = "/wt/feature", pane_id = "p1" },
    { name = "codex-other", agent = "codex", foreground_cwd = "/wt/otherf", pane_id = "p2" },
    { name = "tmp-child", agent = "pi", foreground_cwd = "/wt/feature", pane_id = "p3" },
    { name = "pi-elsewhere", agent = "pi", foreground_cwd = "/repos/other/wt", pane_id = "p4" },
  }
  local found, listed = herdr.agent_for_worktree("/wt/feature")
  H.eq({ found and found.name, listed }, { "pi-review", true },
    "without a name the first durable agent in the worktree resolves")
  found, listed = herdr.agent_for_worktree("/wt/feature", "pi-review")
  H.eq({ found and found.name, listed }, { "pi-review", true }, "an exact name resolves in the worktree")
  found, listed = herdr.agent_for_worktree("/wt/feature", "codex-other")
  H.eq({ found, listed }, { nil, true }, "an exact name from another worktree never resolves here")
  found, listed = herdr.agent_for_worktree("/wt/feature", "tmp-child")
  H.eq({ found, listed }, { nil, true }, "a transient name never resolves even on an exact match")
  reset_state()
  state.agents = {
    { name = "pi-review", agent = "pi", foreground_cwd = "/wt/feature", pane_id = "p1" },
  }
  state.pane_list_fail = true
  found, listed = herdr.agent_for_worktree("/wt/feature")
  H.eq({ found, listed }, { nil, false }, "an unverifiable agent list fails closed")
  state.pane_list_fail = false

  -- ensure_workspace: reuse, scoped fallback, create, fail-closed.
  reset_state()
  state.panes = { { workspace_id = "wA", foreground_cwd = "/wt/feature" } }
  H.eq({ herdr.ensure_workspace("/wt/feature") }, { "wA", nil, false, nil },
    "an existing repository workspace is reused, never created")
  H.eq(#state.create_calls, 0, "reuse never issues workspace create")
  reset_state()
  H.eq({ herdr.ensure_workspace("/wt/feature", { workspace_id = "wScoped" }) }, { "wScoped", nil, false, nil },
    "a scoped workspace id fills an unlisted repository without creating")
  H.eq(#state.create_calls, 0, "scoped fallback never issues workspace create")
  reset_state()
  H.eq({ herdr.ensure_workspace("/wt/feature") }, { "wNEW", "pNEW", true, "tNEW" },
    "an unlisted repository creates its workspace and returns its values")
  H.eq(state.create_calls[1], { "workspace", "create", "--cwd", "/repos/dotfiles", "--label", "dotfiles", "--no-focus" },
    "workspace create targets the git repository root with its label")
  reset_state()
  state.create_fail = true
  H.eq({ herdr.ensure_workspace("/wt/feature") }, { nil, nil, false, nil },
    "a failed workspace create returns no workspace")
  state.create_fail = false
  reset_state()
  state.pane_list_fail = true
  H.eq({ herdr.ensure_workspace("/wt/feature") }, { nil, nil, false, nil },
    "ensure_workspace fails closed on an unverifiable inventory")
  H.eq(#state.create_calls, 0, "fail-closed ensure_workspace never creates")
  state.pane_list_fail = false
  reset_state()
  state.panes = { { workspace_id = "wP", foreground_cwd = "/plain/dir" } }
  H.eq({ herdr.ensure_workspace("/plain/dir") }, { "wP", nil, false, nil },
    "a non-git cwd reuses the workspace bound to that cwd")

  -- M.start reuse rule: exact-name reuse on the main checkout only.
  reset_state()
  state.panes = { { workspace_id = "wA", foreground_cwd = "/wt/main" } }
  state.agents = {
    { name = "pi-main", agent = "pi", foreground_cwd = "/wt/main", pane_id = "pm1",
      tab_id = "tm1", workspace_id = "wA", terminal_id = "termM1" },
  }
  local started = herdr.start("pi-main", "/wt/main", { "pi" })
  H.eq(started and started.name, "pi-main", "main reuses the exact-name session")
  H.eq(started, state.agents[1], "reuse returns the listed agent values")
  H.eq(#state.create_calls, 0, "reuse never creates a workspace")
  local workspace_scoped_list = vim.tbl_filter(function(args)
    return args[1] == "pane" and args[2] == "list" and args[3] == "--workspace"
  end, state.hdr_calls)
  H.eq(#workspace_scoped_list, 0, "reuse never splits a workspace pane")

  reset_state()
  state.agents = {
    { name = "pi-review", agent = "pi", foreground_cwd = "/wt/feature", pane_id = "pf1",
      tab_id = "tf1", workspace_id = "wA", terminal_id = "termF1" },
  }
  started = herdr.start("pi-other", "/wt/feature", { "pi" })
  H.eq(started, nil, "a non-main worktree rejects a second durable session")
  H.truthy(
    (notified[#notified] and notified[#notified].msg or ""):find("already owns session pi-review", 1, true) ~= nil,
    "the rejection names the owning session"
  )

  reset_state()
  state.panes = { { workspace_id = "wA", foreground_cwd = "/wt/main" } }
  state.agents = {
    { name = "pi-main", agent = "pi", foreground_cwd = "/wt/main", pane_id = "pm1",
      tab_id = "tm1", workspace_id = "wA", terminal_id = "termM1" },
  }
  for i = #notified, 1, -1 do
    notified[i] = nil
  end
  started = herdr.start("pi-other", "/wt/main", { "pi" })
  H.eq(started, nil, "a second name on main starts no session here (no free panes)")
  local ownership_notified = vim.iter(notified):any(function(entry)
    return entry.msg:find("already owns", 1, true) ~= nil
  end)
  H.eq(ownership_notified, false, "main never rejects a second name as an ownership conflict")
  workspace_scoped_list = vim.tbl_filter(function(args)
    return args[1] == "pane" and args[2] == "list" and args[3] == "--workspace"
  end, state.hdr_calls)
  H.eq(#workspace_scoped_list > 0, true, "a second name on main proceeds past the ownership gate")

  restore_notify()
  restore_system()
  package.loaded["plugins.sidekick.herdr"] = saved_herdr
end)

internal.toggle_tool_session = original_toggle
