-- helpers/workspace.lua: tab identity, tab-buffer membership, and the
-- snapshot/restore round trip (pure parts; CI row X11, #133).
--
-- Uses real tabpages and real buffers in a headless instance — no UI needed.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local workspace = require("helpers.workspace")

local tmp = vim.fn.tempname() .. "-workspace-spec"
vim.fn.mkdir(tmp .. "/alpha", "p")
vim.fn.mkdir(tmp .. "/beta", "p")

H.run("workspace_spec", function()
  local first_tab = vim.api.nvim_get_current_tabpage()

  -- ── bind / get: path normalization and label fallbacks ──────────────────
  local bound = workspace.bind(first_tab, tmp .. "/alpha/", "Alpha")
  H.eq(bound.cwd, tmp .. "/alpha", "bind normalizes the cwd")
  H.eq(bound.label, "Alpha", "bind keeps the explicit label")
  H.eq(workspace.get(first_tab).cwd, tmp .. "/alpha", "get reads the bound cwd back")
  H.eq(workspace.get(first_tab).label, "Alpha", "get reads the label back")

  vim.cmd("tabnew")
  local second_tab = vim.api.nvim_get_current_tabpage()
  local second = workspace.bind(second_tab, tmp .. "/beta")
  H.eq(second.label, "beta", "a missing label falls back to the cwd basename")

  -- unbound tabs resolve to nil
  vim.cmd("tabnew")
  local third_tab = vim.api.nvim_get_current_tabpage()
  H.eq(workspace.get(third_tab), nil, "an unbound tab has no workspace")

  -- ── tab-buffer membership ───────────────────────────────────────────────
  local listed = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(listed, tmp .. "/alpha/one.lua")
  local unlisted = vim.api.nvim_create_buf(false, true)
  local nofile = vim.api.nvim_create_buf(true, false)
  vim.bo[nofile].buftype = "nofile"

  workspace.track(listed, first_tab)
  workspace.track(unlisted, first_tab)
  workspace.track(nofile, first_tab)

  H.eq(workspace.contains(listed, first_tab), true, "a tracked listed buffer is a member")
  H.eq(workspace.contains(listed, second_tab), false, "membership is tab-scoped")
  H.eq(workspace.contains(unlisted, first_tab), false, "unlisted buffers never join a tab")
  H.eq(workspace.contains(nofile, first_tab), false, "nofile buffers never join a tab")
  local members = workspace.buffers(first_tab)
  H.truthy(vim.tbl_contains(members, listed), "the buffer list includes the tracked listed buffer")
  H.truthy(not vim.tbl_contains(members, unlisted) and not vim.tbl_contains(members, nofile),
    "the buffer list filters out unlisted and nofile buffers")

  -- ── herdr identity survives bind_herdr ──────────────────────────────────
  workspace.bind_herdr(second_tab, "w-herdr", "Herdr Label")
  local got = workspace.get(second_tab)
  H.eq(got.herdr_workspace_id, "w-herdr", "bind_herdr stores the workspace id")
  H.eq(got.label, "beta", "bind_herdr keeps the tab label as the display label")

  -- ── snapshot / restore round trip ───────────────────────────────────────
  workspace.track(listed, second_tab) -- same buffer in two tabs must survive
  local snap = workspace.snapshot()
  H.eq(#snap, 2, "only bound tabs appear in the snapshot")
  local by_cwd = {}
  for _, entry in ipairs(snap) do
    by_cwd[entry.cwd] = entry
  end
  H.eq(by_cwd[tmp .. "/alpha"].label, "Alpha", "snapshot keeps labels")
  H.eq(by_cwd[tmp .. "/alpha"].buffers, { tmp .. "/alpha/one.lua" }, "snapshot stores buffer names")
  H.eq(by_cwd[tmp .. "/beta"].herdr_workspace_id, "w-herdr", "snapshot keeps the herdr workspace id")
  H.eq(by_cwd[tmp .. "/beta"].herdr_workspace_label, "Herdr Label", "snapshot keeps the herdr label")

  local restored = workspace.restore(snap)
  H.eq(restored, 2, "restore rebinds every snapshot entry")

  local snap2 = workspace.snapshot()
  table.sort(snap, function(a, b)
    return a.cwd < b.cwd
  end)
  table.sort(snap2, function(a, b)
    return a.cwd < b.cwd
  end)
  H.eq(snap2, snap, "restore is a round trip: a second snapshot is identical")
  H.eq(workspace.contains(listed, first_tab), true, "restore restores tab-buffer membership")
  H.eq(workspace.contains(listed, second_tab), true, "restore restores membership in the second tab too")

  -- restore rejects garbage without touching state
  H.eq(workspace.restore(nil), 0, "restore(nil) is a no-op")
  H.eq(workspace.restore({}), 0, "restore of an empty snapshot is a no-op")
  H.eq(workspace.restore({ { tab = 99, cwd = "/nope" } }), 0, "restore skips unknown tab numbers")
  H.eq(workspace.restore({ { tab = 1 } }), 0, "restore skips entries without a cwd")
  H.eq(workspace.get(first_tab).cwd, tmp .. "/alpha", "garbage restore leaves bindings intact")

  -- cycle is guarded but never throws with a single member
  local saved_current = vim.api.nvim_get_current_buf()
  H.eq(workspace.cycle(1), nil, "cycle with one buffer returns quietly")
  H.eq(vim.api.nvim_get_current_buf(), saved_current, "cycle with one buffer does not switch")

  -- ── startup: reuse the tab already bound to a cwd ─────────────────────
  vim.api.nvim_set_current_tabpage(third_tab) -- unbound, empty source tab
  local ok = workspace.startup(tmp .. "/alpha")
  H.eq(ok, true, "startup succeeds for a known workspace")
  H.eq(vim.api.nvim_get_current_tabpage(), first_tab,
    "startup focuses the tab already bound to that cwd instead of creating one")
  H.eq(vim.api.nvim_tabpage_is_valid(third_tab), false,
    "the empty unbound source tab closes after the handoff")
  H.eq(#vim.api.nvim_list_tabpages(), 2, "no extra tab was created")

  -- startup from an unbound tab with an unknown cwd binds that same tab
  vim.cmd("tabnew")
  local fresh_tab = vim.api.nvim_get_current_tabpage()
  vim.fn.mkdir(tmp .. "/gamma", "p")
  H.eq(workspace.startup(tmp .. "/gamma"), true, "startup binds an unbound tab to a new cwd")
  H.eq(workspace.get(fresh_tab).cwd, tmp .. "/gamma", "the unbound tab now owns the new workspace")
  H.eq(vim.api.nvim_get_current_tabpage(), fresh_tab, "the bound tab stays focused")
  H.eq(#vim.api.nvim_list_tabpages(), 3, "binding reused the tab; no tabnew happened")

  -- ── setup registers the workspace autocmd group ────────────────────────
  workspace.setup()
  local group_ids = {}
  for _, au in ipairs(vim.api.nvim_get_autocmds({ group = "NvimWorkspaceTabs" })) do
    group_ids[au.id] = true
  end
  H.truthy(vim.tbl_count(group_ids) >= 5, "setup wires the VimEnter/UIEnter/BufEnter/TabEnter/SessionLoadPost events")
  workspace.setup()
  local ids2 = {}
  for _, au in ipairs(vim.api.nvim_get_autocmds({ group = "NvimWorkspaceTabs" })) do
    ids2[au.id] = true
  end
  H.eq(vim.tbl_count(ids2), vim.tbl_count(group_ids), "re-running setup does not stack autocmds (clear=true)")
end)
