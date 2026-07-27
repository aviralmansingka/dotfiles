local case = os.getenv("VERIFY_NVIM_CASE") or "agent-keymaps"
local t04_evidence_dir = os.getenv("T04_EVIDENCE_DIR")
if t04_evidence_dir == "" then
  t04_evidence_dir = nil
end

local function export_t04_evidence(name, buf)
  if not t04_evidence_dir then
    return
  end

  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local captured = table.concat(lines, "\n")
  if not captured:find("\27%[[0-9;]*m") then
    for index, line in ipairs(lines) do
      if line:match("^Run ") or line:match("^T04 V02 ") then
        lines[index] = "\27[1;36m" .. line .. "\27[0m"
      end
    end
  end

  vim.fn.mkdir(t04_evidence_dir, "p")
  local path = t04_evidence_dir .. "/" .. name .. ".ansi"
  local file, err = io.open(path, "wb")
  if not file then
    error("could not write T04 evidence " .. path .. ": " .. err, 0)
  end
  file:write(table.concat(lines, "\n"))
  file:close()
end

local function fail(msg)
  error(msg, 0)
end

local function load_plugin(name)
  require("lazy").load({ plugins = { name } })
  local plugin = require("lazy.core.config").plugins[name]
  if not plugin then
    fail("lazy plugin not found: " .. name)
  end
  return plugin
end

local function key_desc(plugin, lhs)
  for _, key in ipairs(plugin.keys or {}) do
    if key[1] == lhs then
      return key.desc or ""
    end
  end
  return nil
end

local function key_callback(plugin, lhs)
  for _, key in ipairs(plugin.keys or {}) do
    if key[1] == lhs and type(key[2]) == "function" then
      return key[2]
    end
  end
end

local function assert_key_desc(plugin, lhs, needle)
  local desc = key_desc(plugin, lhs)
  if not desc then
    fail(lhs .. " mapping missing")
  end
  if needle and not desc:find(needle, 1, true) then
    fail(lhs .. " desc should contain " .. vim.inspect(needle) .. "; got " .. vim.inspect(desc))
  end
end

local function assert_key_absent(plugin, lhs)
  local desc = key_desc(plugin, lhs)
  if desc ~= nil then
    fail(lhs .. " should be removed, but exists with desc " .. vim.inspect(desc))
  end
end

local function assert_sequence(actual, expected, label)
  if #actual ~= #expected then
    fail(label .. " length mismatch: got " .. vim.inspect(actual) .. ", expected " .. vim.inspect(expected))
  end
  for i, value in ipairs(expected) do
    if actual[i] ~= value then
      fail(label .. " mismatch: got " .. vim.inspect(actual) .. ", expected " .. vim.inspect(expected))
    end
  end
end

local function validate_agent_keymaps()
  local sidekick = load_plugin("sidekick.nvim")
  local removed = {
    "<leader>ai",
    "<leader>ag",
    "<leader>al",
    "<leader>aL",
    "<leader>a/",
    "<leader>as",
    "<leader>ad",
    "<leader>ao",
    "<leader>au",
    "<leader>ar",
    "<leader>af",
    "<leader>aV",
    "<localleader>e",
  }
  for _, lhs in ipairs(removed) do
    assert_key_absent(sidekick, lhs)
  end

  local snacks = load_plugin("snacks.nvim")
  assert_key_absent(snacks, "<C-'>")
  assert_key_absent(sidekick, "<C-'>")

  local obsidian = load_plugin("obsidian.nvim")
  assert_key_desc(obsidian, "<leader>vb", "current weekly backlog")
  local backlog_callback = key_callback(obsidian, "<leader>vb")
  local backlog = require("helpers.obsidian")
  local original_today = backlog.today
  local opened_backlog = false
  backlog.today = function()
    opened_backlog = true
  end
  backlog_callback()
  backlog.today = original_today
  if not opened_backlog then
    fail("<leader>vb should call the current weekly backlog helper")
  end

  assert_key_desc(sidekick, "<c-.>", "cwd sessions")
  assert_key_desc(sidekick, "<c-;>", "Switch Agent")
  assert_key_desc(sidekick, "<leader>an", "Codex")
  assert_key_desc(sidekick, "<leader>aN", "Pi")
  assert_key_desc(sidekick, "<leader>ae", "Codex Spark")
  assert_key_desc(sidekick, "<leader>aA", "apply")
  assert_key_desc(sidekick, "<leader>aR", "reject")

  local seen = {}
  for _, key in ipairs(sidekick.keys or {}) do
    local lhs = key[1]
    if lhs then
      if seen[lhs] then
        fail("duplicate sidekick key: " .. lhs)
      end
      seen[lhs] = true
    end
  end
end

local function validate_weekly_backlog()
  local root = vim.fn.tempname() .. "-weekly-backlog"
  local original_expand = vim.fn.expand
  local original_time = os.time
  local fixed_now

  vim.fn.mkdir(root, "p")
  vim.fn.expand = function(path, ...)
    if path:sub(1, 7) == "~/vault" then
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
  local backlog = dofile("nvim/.config/nvim/lua/helpers/obsidian.lua")

  local function read(path)
    return vim.fn.readfile(path)
  end

  local function assert_lines(actual, expected, label)
    assert_sequence(actual, expected, label)
  end

  local function open_at(date, offset)
    fixed_now = original_time(vim.tbl_extend("force", {
      hour = 12,
      min = 0,
      sec = 0,
    }, date))
    vim.cmd("enew!")
    backlog.open_weekly_backlog(offset or 0)
  end

  local function assert_exists(path)
    if vim.fn.filereadable(path) ~= 1 then
      fail("expected backlog file: " .. path)
    end
  end

  local ok, err = xpcall(function()
    open_at({ year = 2026, month = 7, day = 25 })
    local ordinary = root .. "/3_logs/2026-W30/backlog.md"
    assert_exists(ordinary)
    assert_lines(read(ordinary), {
      "---",
      "id: backlog",
      "aliases: []",
      "tags: []",
      "---",
      "",
      "# 2026-W30: Backlog",
      "",
      "## Log",
      "",
      "### Saturday, 2026-07-25",
      "",
    }, "canonical weekly backlog")

    open_at({ year = 2027, month = 1, day = 1 })
    assert_exists(root .. "/3_logs/2026-W53/backlog.md")

    fixed_now = original_time({ year = 2026, month = 3, day = 9, hour = 0, min = 30, sec = 0 })
    vim.cmd("enew!")
    backlog.yesterday()
    assert_exists(root .. "/3_logs/2026-W10/backlog.md")
    if vim.fn.expand("%:t") ~= "backlog.md"
      or vim.fn.search("^### Sunday, 2026-03-08$", "nw") == 0
    then
      fail("yesterday should select the adjacent local date across spring DST")
    end

    fixed_now = original_time({ year = 2026, month = 11, day = 1, hour = 0, min = 30, sec = 0 })
    vim.cmd("enew!")
    backlog.tomorrow()
    assert_exists(root .. "/3_logs/2026-W45/backlog.md")
    if vim.fn.search("^### Monday, 2026-11-02$", "nw") == 0 then
      fail("tomorrow should select the adjacent local date across fall DST")
    end

    local missing_log = root .. "/3_logs/2026-W06/backlog.md"
    vim.fn.mkdir(vim.fn.fnamemodify(missing_log, ":h"), "p")
    vim.fn.writefile({
      "# Existing",
      "",
      "## Backlog",
      "",
      "- keep",
    }, missing_log)
    open_at({ year = 2026, month = 2, day = 2 })
    assert_lines(read(missing_log), {
      "# Existing",
      "",
      "## Backlog",
      "",
      "- keep",
      "",
      "## Log",
      "",
      "### Monday, 2026-02-02",
      "",
    }, "missing log repair")

    local scoped_heading = root .. "/3_logs/2026-W15/backlog.md"
    vim.fn.mkdir(vim.fn.fnamemodify(scoped_heading, ":h"), "p")
    vim.fn.writefile({
      "# Existing",
      "",
      "### Monday, 2026-04-06",
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
    }, scoped_heading)
    open_at({ year = 2026, month = 4, day = 6 })
    local scoped_lines = read(scoped_heading)
    local heading_count = 0
    local log_idx
    local backlog_idx
    local heading_in_log
    for i, line in ipairs(scoped_lines) do
      if line == "## Log" then
        log_idx = i
      elseif line == "## Backlog" then
        backlog_idx = i
      elseif line == "### Monday, 2026-04-06" then
        heading_count = heading_count + 1
        if log_idx and not backlog_idx then
          heading_in_log = i
        end
      end
    end
    if heading_count ~= 2 or not heading_in_log or heading_in_log <= log_idx or heading_in_log >= backlog_idx then
      fail("a dated heading outside Log must not prevent insertion inside Log")
    end
    if scoped_lines[5] ~= "outside log" or scoped_lines[#scoped_lines] ~= "- keep" then
      fail("existing weekly backlog content or section order changed")
    end

    open_at({ year = 2026, month = 4, day = 6 })
    local reused_count = 0
    for _, line in ipairs(read(scoped_heading)) do
      if line == "### Monday, 2026-04-06" then
        reused_count = reused_count + 1
      end
    end
    if reused_count ~= 2 then
      fail("an exact dated heading inside Log should be reused")
    end

    local dirty = root .. "/3_logs/2026-W19/backlog.md"
    vim.fn.mkdir(vim.fn.fnamemodify(dirty, ":h"), "p")
    vim.fn.writefile({ "# Existing", "", "## Log", "" }, dirty)
    vim.cmd("edit " .. vim.fn.fnameescape(dirty))
    vim.api.nvim_buf_set_lines(0, -1, -1, false, { "unsaved user text" })
    local disk_before = read(dirty)
    fixed_now = original_time({ year = 2026, month = 5, day = 4, hour = 12, min = 0, sec = 0 })
    local opened, open_err = pcall(backlog.today)
    if not opened then
      fail("dirty target buffer should remain open without a save prompt: " .. open_err)
    end
    assert_lines(read(dirty), disk_before, "dirty buffer disk content")
    if vim.fn.search("^unsaved user text$", "nw") == 0 then
      fail("pre-existing unsaved buffer changes were overwritten")
    end

    for _, legacy in ipairs({ "/journal", "/3_log", "/5_modal/logs" }) do
      if vim.fn.isdirectory(root .. legacy) == 1 then
        fail("weekly backlog helper wrote a legacy path: " .. legacy)
      end
    end
  end, debug.traceback)

  os.time = original_time
  vim.fn.expand = original_expand
  vim.cmd("enew!")
  for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_get_name(buffer):find(root, 1, true) then
      vim.api.nvim_buf_delete(buffer, { force = true })
    end
  end
  vim.fn.delete(root, "rf")
  if not ok then
    fail(err)
  end
end

local function validate_sidekick_pi()
  local sidekick = load_plugin("sidekick.nvim")
  local internal = require("plugins.sidekick.internal")

  assert_sequence(internal.primary_agents(), { "pi", "codex" }, "primary_agents")

  assert_sequence(internal.ordered_agents(), { "pi", "codex" }, "ordered_agents")

  if not internal.tool_commands.pi then
    fail("internal.tool_commands.pi missing")
  end
  if internal.tool_commands.pi[1] ~= "pi" then
    fail("internal.tool_commands.pi should launch pi; got " .. vim.inspect(internal.tool_commands.pi))
  end

  local config = require("sidekick.config")
  if not config.cli or not config.cli.tools or not config.cli.tools.pi then
    fail("sidekick.config.cli.tools.pi missing")
  end
  for tool in pairs(config.cli.tools) do
    if tool ~= "codex" and tool ~= "pi" and not tool:match("^codex%-") and not tool:match("^pi%-") then
      fail("unexpected Sidekick tool configured: " .. tool)
    end
  end

  assert_key_desc(sidekick, "<leader>aN", "Pi")

  local named = internal.tool_command_for_named_session("pi", "test-session")
  local has_name, has_slug = false, false
  for _, part in ipairs(named) do
    if part == "--name" then
      has_name = true
    end
    if part == "test-session" then
      has_slug = true
    end
  end
  if not has_name or not has_slug then
    fail("named Pi command should include --name test-session; got " .. vim.inspect(named))
  end

  local original_toggle = internal.toggle_tool_session
  local toggled
  internal.toggle_tool_session = function(name, focus)
    toggled = { name = name, focus = focus }
  end
  local last_session = require("plugins.sidekick.last_session")
  last_session.label = nil
  internal.start_named_session("codex", "new session", vim.fn.getcwd())
  if not toggled or toggled.name ~= "codex-new-session" or toggled.focus ~= true then
    fail("new named session should open immediately: " .. vim.inspect(toggled))
  end
  if last_session.label ~= "codex-new-session" then
    fail("new named session should become the last active session; got " .. vim.inspect(last_session.label))
  end
  toggled = nil
  last_session.open()
  internal.toggle_tool_session = original_toggle
  if not toggled or toggled.name ~= "codex-new-session" or toggled.focus ~= true then
    fail("<c-.> should reopen the newly created named session: " .. vim.inspect(toggled))
  end

  local registry = require("plugins.sidekick.registry")
  local parsed = registry.parse_session_name("pi-test-session abc123")
  if not parsed or parsed.tool ~= "pi" or parsed.slug ~= "test-session" then
    fail("registry should parse named Pi sessions; got " .. vim.inspect(parsed))
  end

  local branding = require("plugins.sidekick.branding")
  if not branding.colors.pi then
    fail("branding.colors.pi missing")
  end
  if branding.tool_of("pi-test-session") ~= "pi" then
    fail("branding.tool_of should recognize named Pi sessions")
  end

  local last_session_src = table.concat(vim.fn.readfile("nvim/.config/nvim/lua/plugins/sidekick/last_session.lua"), "\n")
  if not last_session_src:find("cwd_picker", 1, true) then
    fail("<c-.> fallback should use cwd_picker")
  end

  local Terminal = require("sidekick.cli.terminal")
  local cwd_picker = require("plugins.sidekick.cwd_picker")
  local session_switch = require("plugins.sidekick.session_switch")
  local original_sessions = Terminal.sessions
  local original_picker_open = cwd_picker.open
  local current = {
    tool = { name = "pi-current" },
    open = true,
    is_open = function(self) return self.open end,
    hide = function(self) self.open = false end,
  }
  local other = {
    tool = { name = "codex-other" },
    open = true,
    is_open = function(self) return self.open end,
    hide = function(self) self.open = false end,
  }
  local picker_opts
  local fake_picker = {}
  Terminal.sessions = function() return { current, other } end
  cwd_picker.open = function(opts)
    picker_opts = opts
    fake_picker.close = function()
      picker_opts.on_close()
    end
    return fake_picker
  end
  internal.toggle_tool_session = function(name, focus)
    toggled = { name = name, focus = focus }
  end

  toggled = nil
  session_switch.open()
  if current.open or other.open then
    fail("<c-;> should hide every visible Sidekick session before opening the picker")
  end
  session_switch.open()
  if toggled or current.open or other.open then
    fail("pressing <c-;> again should close the picker and leave all sessions minimized")
  end

  current.open = true
  session_switch.open()
  picker_opts.on_confirm({ label = "codex-other" })
  picker_opts.on_close()
  if toggled then
    fail("selecting a new session should not restore the minimized session")
  end

  current.open = false
  other.open = false
  session_switch.open()
  picker_opts.on_close()
  if toggled then
    fail("canceling with no visible session should leave all sessions minimized")
  end

  Terminal.sessions = original_sessions
  cwd_picker.open = original_picker_open
  internal.toggle_tool_session = original_toggle
end

local function validate_sidekick_herdr()
  load_plugin("sidekick.nvim")

  local config = require("sidekick.config")
  local internal = require("plugins.sidekick.internal")
  if config.cli.mux.backend ~= "herdr" then
    fail("Sidekick mux backend should be herdr; got " .. vim.inspect(config.cli.mux.backend))
  end

  local herdr = require("plugins.sidekick.herdr")
  local backend = require("plugins.sidekick.herdr_backend")
  local cwd = vim.fn.getcwd()
  local base_name = herdr.agent_name("codex", cwd)
  if not base_name:match("^sk%-codex%-%x+$") or #base_name > 32 then
    fail("base Herdr agent name should be stable and valid; got " .. vim.inspect(base_name))
  end
  if herdr.agent_name("codex-review", cwd) ~= "codex-review" then
    fail("named Sidekick tools should keep their label as the Herdr agent name")
  end

  local expected_methods = { "sessions", "start", "attach", "send", "submit", "dump", "is_running" }
  for _, method in ipairs(expected_methods) do
    if type(backend[method]) ~= "function" then
      fail("Herdr backend missing method " .. method)
    end
  end

  local Session = require("sidekick.cli.session")
  Session.setup()
  if Session.backends.herdr ~= backend then
    fail("Herdr backend was not registered with Sidekick")
  end

  local source_root = vim.fn.getcwd() .. "/nvim/.config/nvim/lua/plugins/sidekick/"
  local source_internal = dofile(source_root .. "internal.lua")
  local source_herdr = dofile(source_root .. "herdr.lua")
  local loaded_herdr = package.loaded["plugins.sidekick.herdr"]
  package.loaded["plugins.sidekick.herdr"] = source_herdr
  local source_backend = dofile(source_root .. "herdr_backend.lua")
  package.loaded["plugins.sidekick.herdr"] = loaded_herdr

  local current_tab = vim.api.nvim_get_current_tabpage()
  vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_id", "w-bound")
  local original_toggle_named = source_internal.toggle_tool_session
  source_internal.toggle_tool_session = function() end
  source_internal.start_named_session("codex", "workspace session", cwd)
  source_internal.toggle_tool_session = original_toggle_named
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_id")
  local workspace_tool = config.cli.tools["codex-workspace-session"]
  if not workspace_tool or workspace_tool.herdr_workspace_id ~= "w-bound" then
    fail("named sessions should retain the bound tab workspace ID: " .. vim.inspect(workspace_tool))
  end

  source_internal.toggle_tool_session = function() end
  source_internal.start_named_session("codex", "cwd session", cwd)
  source_internal.toggle_tool_session = original_toggle_named
  local cwd_tool = config.cli.tools["codex-cwd-session"]
  if not cwd_tool or cwd_tool.herdr_workspace_id ~= nil then
    fail("unbound named sessions should retain cwd workspace fallback: " .. vim.inspect(cwd_tool))
  end

  local original_start = source_herdr.start
  local forwarded_workspace_id
  local forwarded_starts = 0
  source_herdr.start = function(_, _, _, _, scope)
    forwarded_starts = forwarded_starts + 1
    forwarded_workspace_id = scope and scope.workspace_id
    return {
      terminal_id = "term-workspace",
      pane_id = "w-bound:p1",
      tab_id = "w-bound:t1",
      workspace_id = "w-bound",
    }
  end
  source_backend.start({
    herdr_agent_name = "codex-workspace-session",
    cwd = cwd,
    tool = require("sidekick.cli.tool").get("codex-workspace-session"),
    attach = function()
      return {}
    end,
  })
  if forwarded_workspace_id ~= "w-bound" then
    fail("Herdr backend should forward the named session workspace ID")
  end

  source_backend.start({
    herdr_agent_name = "codex-cwd-session",
    cwd = cwd,
    tool = require("sidekick.cli.tool").get("codex-cwd-session"),
    attach = function()
      return {}
    end,
  })
  source_herdr.start = original_start
  if forwarded_starts ~= 2 or forwarded_workspace_id ~= nil then
    fail("unbound named sessions should not override cwd workspace resolution")
  end

  local original_workspace_for_cwd = source_herdr.workspace_for_cwd
  local fallback_cwd
  source_herdr.workspace_for_cwd = function(path)
    fallback_cwd = path
    return "w-cwd"
  end
  local fallback_workspace_id = source_herdr.ensure_workspace(cwd)
  source_herdr.workspace_for_cwd = original_workspace_for_cwd
  if fallback_workspace_id ~= "w-cwd" or fallback_cwd ~= cwd then
    fail("unbound named sessions should resolve their workspace from cwd")
  end

  local original_call = source_herdr.call
  local start_calls = {}
  source_herdr.call = function(args)
    start_calls[#start_calls + 1] = args
    if args[1] == "agent" and args[2] == "start" then
      return {
        agent = {
          name = "codex-workspace-session",
          cwd = cwd,
          foreground_cwd = cwd,
          terminal_id = "term-workspace",
          pane_id = "w-bound:p1",
          tab_id = "w-bound:t1",
          workspace_id = "w-bound",
        },
      }
    elseif args[1] == "tab" and args[2] == "list" then
      return { tabs = { { tab_id = "w-bound:t1", workspace_id = "w-bound", pane_count = 1 } } }
    end
    return {}
  end
  local started = source_herdr.start(
    "codex-workspace-session",
    cwd,
    { "codex" },
    {},
    { workspace_id = "w-bound" }
  )
  source_herdr.call = original_call
  local agent_start
  local tab_rename
  for _, call in ipairs(start_calls) do
    if call[1] == "workspace" or (call[1] == "pane" and call[2] == "list") then
      fail("an exact workspace ID should bypass cwd workspace lookup: " .. vim.inspect(start_calls))
    elseif call[1] == "tab" and call[2] == "create" then
      fail("worker start must not precreate a blank root tab: " .. vim.inspect(start_calls))
    elseif call[1] == "pane" and call[2] == "move" and vim.fn.index(call, "--split") >= 0 then
      fail("worker start must not use a split: " .. vim.inspect(start_calls))
    elseif call[1] == "agent" and call[2] == "start" then
      agent_start = call
    elseif call[1] == "tab" and call[2] == "rename" then
      tab_rename = call
    end
  end
  if not started
    or not agent_start
    or agent_start[7] ~= "w-bound"
    or vim.fn.index(agent_start, "--tab") >= 0
    or not tab_rename
    or tab_rename[3] ~= "w-bound:t1"
    or started.terminal_id ~= "term-workspace"
  then
    fail("named session should attach before Codex reports its session identity: " .. vim.inspect(start_calls))
  end

  local routing_calls = {}
  source_herdr.call = function(args)
    routing_calls[#routing_calls + 1] = args
    if args[1] == "worktree" and args[2] == "list" then
      return { worktrees = {} }
    elseif args[1] == "worktree" and args[2] == "create" and args[6] == "feature/example" then
      return {
        workspace = { workspace_id = "w-feature" },
        worktree = { branch = "feature/example", path = "/worktrees/feature-example" },
      }
    end
    return {}
  end
  local feature_scope = source_herdr.ensure_feature_scope(cwd, "Neovim · Example", "feature/example")
  if
    not feature_scope
    or feature_scope.workspace_id ~= "w-feature"
    or feature_scope.cwd ~= "/worktrees/feature-example"
  then
    fail("feature scope should use the feature workspace and worktree: " .. vim.inspect(feature_scope))
  end
  local renamed_workspace = false
  local created_branches = {}
  for _, call in ipairs(routing_calls) do
    renamed_workspace = renamed_workspace
      or (call[1] == "workspace" and call[2] == "rename" and call[3] == "w-feature")
    if call[1] == "worktree" and call[2] == "create" then
      created_branches[#created_branches + 1] = call[6]
    end
  end
  if not renamed_workspace then
    fail("feature routing should name the feature workspace")
  end
  assert_sequence(created_branches, { "feature/example" }, "feature routing branches")

  routing_calls = {}
  source_herdr.call = function(args)
    routing_calls[#routing_calls + 1] = args
    if args[1] == "worktree" and args[2] == "list" then
      return {
        worktrees = {
          { branch = "feature/example", path = "/worktrees/feature-example" },
        },
      }
    elseif args[1] == "worktree" and args[2] == "create" and args[6] == "task/example-t01" then
      return {
        workspace = { workspace_id = "w-task" },
        worktree = { branch = "task/example-t01", path = "/worktrees/task-example-t01" },
      }
    end
    return {}
  end
  local task_scope = source_herdr.ensure_task_scope(
    cwd,
    "T01 Example task",
    "feature/example",
    "task/example-t01"
  )
  if
    not task_scope
    or task_scope.workspace_id ~= "w-task"
    or task_scope.cwd ~= "/worktrees/task-example-t01"
  then
    fail("task scope should use its own workspace and worktree: " .. vim.inspect(task_scope))
  end
  local task_workspace_renamed = false
  for _, call in ipairs(routing_calls) do
    task_workspace_renamed = task_workspace_renamed
      or (call[1] == "workspace" and call[2] == "rename" and call[3] == "w-task")
  end
  if not task_workspace_renamed then
    fail("task routing should name its dedicated workspace")
  end

  routing_calls = {}
  source_herdr.call = function(args)
    routing_calls[#routing_calls + 1] = args
    if args[1] == "tab" and args[2] == "list" then
      return {
        tabs = {
          { tab_id = "w-old:t1", workspace_id = "w-old", pane_count = 1 },
          { tab_id = "w-feature:t2", workspace_id = "w-feature", pane_count = 1 },
        },
      }
    elseif args[1] == "pane" and args[2] == "move" then
      return { pane = { pane_id = "w-feature:p1", tab_id = "w-feature:t2" } }
    elseif args[1] == "agent" and args[2] == "get" then
      return {
        agent = {
          name = "codex-example",
          terminal_id = "term-example",
          pane_id = "w-feature:p1",
          tab_id = "w-feature:t2",
          workspace_id = "w-feature",
          foreground_cwd = "/worktrees/feature-example",
          agent_session = {
            source = "herdr:codex",
            kind = "id",
            value = "session-example",
          },
        },
      }
    end
    return {}
  end
  local placed_agent = source_herdr.place_agent({
    name = "codex-example",
    terminal_id = "term-example",
    pane_id = "w-old:p1",
    tab_id = "w-old:t1",
    workspace_id = "w-old",
    foreground_cwd = "/worktrees/feature-example",
    agent_session = {
      source = "herdr:codex",
      kind = "id",
      value = "session-example",
    },
  }, feature_scope, "T01 Example task")
  if
    not placed_agent
    or placed_agent.tab_id ~= "w-feature:t2"
    or placed_agent.agent_session.value ~= "session-example"
  then
    fail("existing task agent should move to its feature-worktree tab: " .. vim.inspect(placed_agent))
  end
  local task_pane_move
  for _, call in ipairs(routing_calls) do
    if call[1] == "tab" and call[2] == "create" then
      fail("worker placement must not create a blank root pane: " .. vim.inspect(routing_calls))
    elseif call[1] == "pane" and call[2] == "move" then
      task_pane_move = call
    end
  end
  if
    not task_pane_move
    or vim.fn.index(task_pane_move, "--new-tab") < 0
    or vim.fn.index(task_pane_move, "--split") >= 0
    or task_pane_move[6] ~= "w-feature"
    or task_pane_move[8] ~= "T01 Example task"
  then
    fail("task agent should move directly into its named one-pane tab: " .. vim.inspect(routing_calls))
  end

  routing_calls = {}
  source_herdr.call = function(args)
    routing_calls[#routing_calls + 1] = args
    if args[1] == "tab" and args[2] == "list" then
      return {
        tabs = {
          { tab_id = "w-feature:shared", workspace_id = "w-feature", pane_count = 2 },
          { tab_id = "w-feature:worker", workspace_id = "w-feature", pane_count = 1 },
        },
      }
    elseif args[1] == "pane" and args[2] == "move" then
      return { pane = { pane_id = "w-feature:p2", tab_id = "w-feature:worker" } }
    elseif args[1] == "agent" and args[2] == "get" then
      return {
        agent = {
          name = "codex-shared",
          terminal_id = "term-shared",
          pane_id = "w-feature:p2",
          tab_id = "w-feature:worker",
          workspace_id = "w-feature",
          foreground_cwd = "/worktrees/feature-example",
          agent_session = {
            source = "herdr:codex",
            kind = "id",
            value = "session-shared",
          },
        },
      }
    end
    return {}
  end
  local restored_agent = source_herdr.place_agent({
    name = "codex-shared",
    terminal_id = "term-shared",
    pane_id = "w-feature:p2",
    tab_id = "w-feature:shared",
    workspace_id = "w-feature",
    foreground_cwd = "/worktrees/feature-example",
    agent_session = {
      source = "herdr:codex",
      kind = "id",
      value = "session-shared",
    },
  }, feature_scope, "T01 Restored worker")
  if not restored_agent or restored_agent.tab_id ~= "w-feature:worker" then
    fail("same-workspace reuse should restore a one-pane worker tab: " .. vim.inspect(restored_agent))
  end
  for _, call in ipairs(routing_calls) do
    if call[1] == "pane" and call[2] == "close" then
      fail("one-pane restoration must preserve unrelated shared panes: " .. vim.inspect(routing_calls))
    end
  end

  local calls_before_invalid = #routing_calls
  local original_notify = vim.notify
  vim.notify = function() end
  local invalid_agent = source_herdr.place_agent({
    name = "codex-background",
    pane_id = "background",
    tab_id = "inherited",
    workspace_id = "w-feature",
    foreground_cwd = "/worktrees/feature-example",
  }, feature_scope, "invalid")
  vim.notify = original_notify
  source_herdr.call = original_call
  if invalid_agent or #routing_calls ~= calls_before_invalid then
    fail("background or inherited-pane agents without full session identity must be rejected")
  end

  local original_list_agents = herdr.list_agents
  local function named_agent(name, status, index, workspace_id, agent_cwd)
    return {
      name = name,
      agent = "pi",
      agent_status = status,
      foreground_cwd = agent_cwd or cwd,
      pane_id = "w1:p" .. index,
      tab_id = "w1:t" .. index,
      terminal_id = "term-" .. index,
      workspace_id = workspace_id or "w1",
      agent_session = index == 5 and {
        source = "herdr:codex",
        kind = "id",
        value = "session-5",
      } or nil,
    }
  end
  herdr.list_agents = function()
    return {
      {
        name = "sk-codex-deadbeef",
        agent = "codex",
        agent_status = "working",
        cwd = cwd,
        pane_id = "w1:p1",
        terminal_id = "term-base",
        workspace_id = "w1",
      },
      named_agent("pi-idle", "idle", 2),
      named_agent("pi-working", "working", 3),
      named_agent("pi-done", "done", 4),
      named_agent("pi-blocked", "blocked", 5),
      named_agent("pi-other-workspace", "idle", 6, "w2"),
      named_agent("pi-workspace-only", "idle", 7, "w1", cwd .. "-unrelated"),
    }
  end

  local source_registry = dofile(source_root .. "registry.lua")
  local discovered = source_registry.discover()
  if discovered["sk-codex-deadbeef"] then
    fail("base Herdr sessions must not appear as named sessions")
  end
  local entry = discovered["pi-blocked"]
  if not entry or entry.tool ~= "pi" or entry.status ~= "blocked" then
    fail("named Herdr session discovery mismatch: " .. vim.inspect(discovered))
  end
  if
    entry.cwd ~= cwd
    or entry.pane_id ~= "w1:p5"
    or entry.workspace_id ~= "w1"
    or not entry.agent_session
    or entry.agent_session.value ~= "session-5"
  then
    fail("named Herdr session identifiers mismatch: " .. vim.inspect(entry))
  end

  local loaded_registry = package.loaded["plugins.sidekick.registry"]
  package.loaded["plugins.sidekick.registry"] = source_registry
  local cwd_picker = dofile(source_root .. "cwd_picker.lua")
  package.loaded["plugins.sidekick.registry"] = loaded_registry
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_id")
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_label")
  local local_items = cwd_picker.list_items()
  local unbound_labels = {}
  local ordered_statuses = {}
  for _, item in ipairs(local_items) do
    unbound_labels[item.label] = true
    ordered_statuses[#ordered_statuses + 1] = item.status
    if item.label == "pi-blocked" and (not item.agent_session or item.agent_session.value ~= "session-5") then
      fail("cwd picker dropped the stable agent session identity: " .. vim.inspect(item))
    end
  end
  local picker_status_rank = { working = 1, blocked = 2, done = 3, idle = 4 }
  for index = 2, #ordered_statuses do
    if (picker_status_rank[ordered_statuses[index - 1]] or math.huge)
      > (picker_status_rank[ordered_statuses[index]] or math.huge)
    then
      fail("cwd picker Herdr status order mismatch: " .. vim.inspect(ordered_statuses))
    end
  end
  if not unbound_labels["pi-other-workspace"] or unbound_labels["pi-workspace-only"] then
    fail("unbound cwd picker should retain cwd/repository filtering: " .. vim.inspect(local_items))
  end

  vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_id", "w1")
  vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_label", "Workspace One")
  local bound_items = cwd_picker.list_items()
  local bound_labels = {}
  for _, item in ipairs(bound_items) do
    bound_labels[item.label] = true
    if item.workspace_id ~= "w1" then
      fail("bound cwd picker must use exact workspace ID: " .. vim.inspect(bound_items))
    end
  end
  if bound_labels["pi-other-workspace"] or not bound_labels["pi-workspace-only"] then
    fail("bound cwd picker should ignore cwd and match only workspace ID: " .. vim.inspect(bound_items))
  end
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_id")
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_label")

  local original_herdr_call = herdr.call
  local rename_args
  herdr.call = function(args, quiet)
    if args[1] == "workspace" and args[2] == "list" then
      return {
        workspaces = {
          { workspace_id = "w1", label = "Workspace One" },
          { workspace_id = "w2", label = "Workspace Two" },
        },
      }
    end
    if args[1] == "agent" and args[2] == "rename" then
      rename_args = args
      return { agent = { name = args[4] } }
    end
    return original_herdr_call(args, quiet)
  end
  local original_pick = Snacks.picker.pick
  local original_spinner = Snacks.util.spinner
  local original_read = herdr.read
  local original_read_async = herdr.read_async
  local original_focus = herdr.focus
  local original_close = herdr.close
  local original_toggle = internal.toggle_tool_session
  local original_ui_input = vim.ui.input
  local original_confirm = vim.fn.confirm
  local picker_opts
  local read_args
  local read_result = "\27[31mfirst logical line\27[0m"
    .. string.rep(" ", 200)
    .. "\r\n\r\nsecond logical line"
    .. string.rep(" ", 200)
    .. "\27[0m"
  local async_reads = 0
  local async_inflight = 0
  local max_async_inflight = 0
  local async_read_args = {}
  local focused = {}
  local toggles = {}
  local closed_panes = {}
  Snacks.picker.pick = function(opts)
    picker_opts = opts
  end
  Snacks.util.spinner = function()
    return "S"
  end
  herdr.read = function(target, source, lines, ansi)
    if source == "visible" then
      if ansi then
        read_args = { target = target, source = source, lines = lines, ansi = ansi }
        return read_result
      end
      if target == "pi-working" then
        return "42.5%/272k\n• Working (5s • esc to interrupt)\n51% context left"
      end
      if target == "pi-done" then
        return "─ Worked for 12s ─\n42.5%/272k"
      end
      return "42.5%/272k"
    end
    read_args = { target = target, source = source, lines = lines, ansi = ansi }
    return read_result
  end
  herdr.read_async = function(target, source, lines, ansi, callback)
    async_reads = async_reads + 1
    async_read_args[#async_read_args + 1] = {
      target = target,
      source = source,
      lines = lines,
      ansi = ansi,
    }
    async_inflight = async_inflight + 1
    max_async_inflight = math.max(max_async_inflight, async_inflight)
    vim.defer_fn(function()
      async_inflight = async_inflight - 1
      callback(read_result)
    end, 120)
  end
  herdr.focus = function(name)
    focused[#focused + 1] = name
    return true
  end
  herdr.close = function(pane_id)
    closed_panes[#closed_panes + 1] = pane_id
    return true
  end
  internal.toggle_tool_session = function(name, focus, terminal_id)
    toggles[#toggles + 1] = { name = name, focus = focus, terminal_id = terminal_id }
  end

  local picker_ok, picker_err = xpcall(function()
    cwd_picker.open()
    if not picker_opts then
      fail("cwd picker did not open Snacks picker")
    end
    if picker_opts.title ~= "Sidekick Sessions in Cwd" then
      fail("unbound cwd picker title should retain cwd scope: " .. vim.inspect(picker_opts.title))
    end
    local layout = picker_opts.layout.layout
    if layout.box ~= "vertical"
      or layout[1].win ~= "preview"
      or layout[2].win ~= "input"
      or layout[2].height ~= 1
      or layout[3].box ~= "horizontal"
      or layout[3].height ~= 14
      or layout[3][1].win ~= "workspace"
      or layout[3][1].height ~= 12
      or layout[3][2].win ~= "list"
      or layout[3][2].height ~= 12
      or not picker_opts.layout.wins.workspace
      or layout.width ~= math.max(math.floor(vim.o.columns * config.cli.win.float.width), 80) + 2
      or layout.height ~= math.max(math.floor(vim.o.lines * config.cli.win.float.height), 10) + 2
    then
      fail("agent picker should place the workspace pane left of the local-session pane")
    end
    if not picker_opts.win.preview.wo.wrap or not picker_opts.win.preview.wo.linebreak then
      fail("cwd picker preview should wrap unwrapped logical lines")
    end

    local markers = { blocked = "!", done = "●", working = "S", idle = "·" }
    for _, item in ipairs(picker_opts.items) do
      local chunks = picker_opts.format(item)
      local parts = {}
      for _, chunk in ipairs(chunks) do
        parts[#parts + 1] = chunk[1]
      end
      local rendered = table.concat(parts)
      if not rendered:find(markers[item.status], 1, true) then
        fail("cwd picker row should expose its Herdr status marker: " .. vim.inspect(rendered))
      end
      local has_status_text = rendered:find("[" .. item.status .. "]", 1, true) ~= nil
      if has_status_text then
        fail("session rows should rely on their symbols: " .. vim.inspect(rendered))
      end
      if rendered:find(item.cwd, 1, true) or item.text:find(item.cwd, 1, true) then
        fail("cwd picker rows should not show the session working directory: " .. vim.inspect(rendered))
      end
      local expected_context = item.label == "pi-working" and "49%" or "42.5%"
      if not rendered:find(" · " .. expected_context, 1, true) then
        fail("cwd picker rows should show context used after a floating-dot divider: " .. vim.inspect(rendered))
      end
      if item.label == "pi-working" and not rendered:match(" · %d+s · 49%%") then
        fail("working rows should show current run time before context usage: " .. vim.inspect(rendered))
      end
      if item.label == "pi-done" and not rendered:find(" · 12s · 42.5%", 1, true) then
        fail("done rows should retain their completed run time: " .. vim.inspect(rendered))
      end
    end
    if
      picker_opts.win.input.keys["<c-r>"][1] ~= "sidekick_rename_session"
      or picker_opts.win.list.keys["<c-r>"][1] ~= "sidekick_rename_session"
    then
      fail("cwd picker should map <c-r> to session rename in its input and list")
    end
    if
      not picker_opts.win.input.keys["<c-w>"]
      or not picker_opts.win.input.keys["<c-j>"]
      or not picker_opts.win.input.keys["<c-k>"]
      or not picker_opts.win.input.keys["<c-n>"]
      or not picker_opts.win.input.keys["<c-p>"]
      or not picker_opts.win.input.keys["<Down>"]
      or not picker_opts.win.input.keys["<Up>"]
      or not picker_opts.win.input.keys["<CR>"]
      or not picker_opts.win.list.keys["<c-w>"]
      or picker_opts.win.list.focusable ~= false
      or not picker_opts.win.input.keys["<c-u>"]
      or not picker_opts.win.list.keys["<c-u>"]
      or not picker_opts.layout.wins.workspace.opts.keys["<c-w>"]
      or not picker_opts.layout.wins.workspace.opts.keys["<c-u>"]
      or not picker_opts.layout.wins.workspace.opts.keys["<c-x>"]
      or not picker_opts.layout.wins.workspace.opts.keys["<c-b>"]
      or not picker_opts.layout.wins.workspace.opts.keys["<c-f>"]
      or picker_opts.layout.wins.workspace.opts.focusable ~= false
      or picker_opts.win.input.keys["<c-b>"][1] ~= "sidekick_preview_scroll_up"
      or picker_opts.win.input.keys["<c-f>"][1] ~= "sidekick_preview_scroll_down"
      or picker_opts.win.list.keys["<c-b>"] ~= "sidekick_preview_scroll_up"
      or picker_opts.win.list.keys["<c-f>"] ~= "sidekick_preview_scroll_down"
      or picker_opts.win.preview.keys["<c-b>"] ~= "sidekick_preview_scroll_up"
      or picker_opts.win.preview.keys["<c-f>"] ~= "sidekick_preview_scroll_down"
    then
      fail("cwd picker should expose pane, input, active-selector navigation, delete, and preview-scroll mappings")
    end

    local rename_picker_opts = picker_opts
    local rename_item = picker_opts.items[1]
    local rename_closed = false
    vim.ui.input = function(input_opts, callback)
      if input_opts.default ~= rename_item.slug then
        fail("session rename should default to the current session label")
      end
      callback("Renamed Session")
    end
    picker_opts.actions.sidekick_rename_session({ close = function() rename_closed = true end }, rename_item)
    vim.ui.input = original_ui_input
    vim.wait(100, function() return picker_opts ~= rename_picker_opts end, 5)
    if
      not rename_closed
      or not vim.deep_equal(
        rename_args,
        { "agent", "rename", rename_item.terminal_id, rename_item.tool .. "-renamed-session" }
      )
      or picker_opts == rename_picker_opts
    then
      fail("session rename should rename the selected Herdr agent and reopen the picker")
    end

    local kill_item
    for _, item in ipairs(picker_opts.items) do
      if item.label == "pi-done" then
        kill_item = item
        break
      end
    end
    local kill_input = picker_opts.win.input.keys["<c-x>"]
    local kill_list = picker_opts.win.list.keys["<c-x>"]
    local kill_action = type(kill_input) == "table" and kill_input[1] or kill_input
    local kill_list_action = type(kill_list) == "table" and kill_list[1] or kill_list
    if not kill_item
      or type(kill_action) ~= "string"
      or kill_list_action ~= kill_action
      or type(picker_opts.actions[kill_action]) ~= "function"
    then
      fail("cwd picker should expose one agent-kill action from input and list")
    end
    local kill_prompt
    vim.fn.confirm = function(prompt)
      kill_prompt = prompt
      return 1
    end
    picker_opts.actions[kill_action]({ close = function() end }, kill_item)
    vim.fn.confirm = original_confirm
    if not kill_prompt
      or not kill_prompt:find(kill_item.label, 1, true)
      or #closed_panes ~= 1
      or closed_panes[1] ~= kill_item.pane_id
    then
      fail("agent kill should confirm the selected agent and close its pane exactly once")
    end

    if type(picker_opts.on_show) ~= "function" or type(picker_opts.on_close) ~= "function" then
      fail("cwd picker should manage a working-session spinner lifecycle")
    end
    local spinner_updates = 0
    local preview_swaps = 0
    local input_pattern = ""
    local input_changed
    local input_win = vim.api.nvim_get_current_win()
    local focused_target
    local local_moves = 0
    local confirmed_action
    local live_preview_buf = vim.api.nvim_create_buf(false, true)
    local current_fake_item = picker_opts.items[1]
    local fake_picker = {
      closed = false,
      current = function()
        return current_fake_item
      end,
      input = {
        get = function()
          return input_pattern
        end,
        win = {
          win = input_win,
          on = function(_, events, callback)
            if type(events) == "table" and vim.tbl_contains(events, "TextChanged") then
              input_changed = callback
            end
          end,
        },
      },
      preview = {
        win = {
          buf = live_preview_buf,
          win = vim.api.nvim_get_current_win(),
          map = function() end,
          on = function() end,
          win_valid = function() return true end,
        },
        set_buf = function(self, buf)
          local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
          if lines[1] == "first logical line" and (lines[2] ~= "" or lines[3] ~= "second logical line") then
            fail(
              "working-session preview should trim terminal padding without removing intentional blank lines: "
                .. vim.inspect(lines)
            )
          end
          preview_swaps = preview_swaps + 1
          vim.bo[buf].bufhidden = "hide"
          self.win.buf = buf
        end,
        minimal = function() end,
      },
      list = {
        win = {
          valid = function() return false end,
          on = function() end,
        },
        move = function(_, step)
          local_moves = local_moves + step
        end,
        update = function(_, opts)
          if not opts or not opts.force then
            fail("spinner redraw should force the picker list update")
          end
          spinner_updates = spinner_updates + 1
        end,
      },
      focus = function(_, target)
        focused_target = target
        if target == "input" then
          vim.api.nvim_set_current_win(input_win)
        end
      end,
      action = function(_, action)
        confirmed_action = action
      end,
    }
    local global_win = picker_opts.layout.wins.workspace
    global_win:show()
    picker_opts.on_show(fake_picker)
    local global_lines = vim.api.nvim_buf_get_lines(global_win.buf, 0, -1, false)
    if focused_target ~= "input" or vim.api.nvim_get_current_win() ~= input_win then
      fail("agent picker should keep keyboard focus in its input")
    end
    local workspace_two_row = vim.fn.index(global_lines, "▾ Workspace Two · ● 0")
    if not vim.startswith(global_lines[1], "▾ Workspace One · ")
      or workspace_two_row < 1
      or global_lines[workspace_two_row + 2] ~= "  └─ · pi-other-workspace · 42.5%"
    then
      fail(
        "workspace rows should start with the local workspace, preserve metric order, and start expanded: "
          .. vim.inspect(global_lines)
      )
    end
    if type(input_changed) ~= "function" then
      fail("agent picker input should update workspace fuzzy results")
    end
    input_pattern = "notfound"
    input_changed()
    global_lines = vim.api.nvim_buf_get_lines(global_win.buf, 0, -1, false)
    if not vim.deep_equal(global_lines, { "(no matching workspace agents)" }) then
      fail("workspace fuzzy search should hide non-matches: " .. vim.inspect(global_lines))
    end
    input_pattern = "pother"
    input_changed()
    global_lines = vim.api.nvim_buf_get_lines(global_win.buf, 0, -1, false)
    if global_lines[1] ~= "▾ Workspace Two · ● 0"
      or global_lines[2] ~= "  └─ · pi-other-workspace · 42.5%"
      or vim.api.nvim_win_get_cursor(global_win.win)[1] ~= 2
    then
      fail("workspace fuzzy search should select the agent while retaining its workspace parent: " .. vim.inspect(global_lines))
    end
    input_pattern = ""
    input_changed()
    local confirm_active = picker_opts.win.input.keys["<CR>"]
    local move_up = picker_opts.win.input.keys["<Up>"]
    move_up[1]()
    if vim.api.nvim_get_current_win() ~= input_win or vim.api.nvim_win_get_cursor(global_win.win)[1] ~= 1 then
      fail("<Up> should move from an agent to its workspace heading without leaving the input")
    end
    confirm_active[1]()
    global_lines = vim.api.nvim_buf_get_lines(global_win.buf, 0, -1, false)
    if not vim.startswith(global_lines[1], "▸ Workspace One · ") then
      fail("<Enter> should act on the global selector while the input keeps focus")
    end
    confirm_active[1]()
    local move_down = picker_opts.win.input.keys["<Down>"]
    move_down[1]()
    if vim.api.nvim_get_current_win() ~= input_win or vim.api.nvim_win_get_cursor(global_win.win)[1] ~= 2 then
      fail("<Down> should move the global-agent selection without leaving the input")
    end
    local toggle_selector = picker_opts.win.input.keys["<c-w>"]
    toggle_selector[1]()
    move_down[1]()
    move_up[1]()
    picker_opts.win.input.keys["<c-j>"][1]()
    picker_opts.win.input.keys["<c-k>"][1]()
    confirm_active[1]()
    if vim.api.nvim_get_current_win() ~= input_win or local_moves ~= 0 or confirmed_action ~= "confirm" then
      fail("local-session navigation should move logically without leaving the input")
    end
    toggle_selector[1]()
    global_win:close()
    vim.wait(450)
    if spinner_updates == 0 then
      fail("working-session spinners should redraw at 80ms")
    end
    if async_reads < 2 or max_async_inflight ~= 1 then
      fail("working-session preview should poll at 80ms with only one read in flight")
    end
    if
      not async_read_args[1]
      or async_read_args[1].source ~= "recent-unwrapped"
      or async_read_args[1].lines ~= vim.api.nvim_win_get_height(fake_picker.preview.win.win) * 2
    then
      fail("working-session preview should request twice the visible preview height: " .. vim.inspect(async_read_args))
    end
    if preview_swaps ~= 1 then
      fail("unchanged working-session content should swap the prepared preview only once")
    end
    toggle_selector[1]()
    current_fake_item = vim.tbl_extend("force", {}, current_fake_item, {
      agent_name = "codex-full-preview",
      tool = "codex",
    })
    picker_opts.actions.sidekick_preview_scroll_down()
    vim.wait(500, function()
      local last_read = async_read_args[#async_read_args]
      return last_read and last_read.lines == 2147483647
    end, 10)
    local full_read = async_read_args[#async_read_args]
    if not full_read
      or full_read.target ~= "codex-full-preview"
      or full_read.source ~= "recent-unwrapped"
      or full_read.lines ~= 2147483647
      or full_read.ansi ~= true
    then
      fail("<c-f> should load all available Codex scrollback before scrolling: " .. vim.inspect(async_read_args))
    end
    local reads_after_expansion = async_reads
    picker_opts.actions.sidekick_preview_scroll_up()
    if async_reads ~= reads_after_expansion then
      fail("<c-b> should reuse the loaded full Codex preview")
    end
    fake_picker.closed = true
    picker_opts.on_close(fake_picker)
    local stopped_updates = spinner_updates
    local stopped_reads = async_reads
    local stopped_preview_swaps = preview_swaps
    vim.wait(250)
    if
      spinner_updates ~= stopped_updates
      or async_reads ~= stopped_reads
      or preview_swaps ~= stopped_preview_swaps
    then
      fail("closing the cwd picker should stop spinner and preview redraws")
    end

    local done_item
    for _, item in ipairs(picker_opts.items) do
      if item.status == "done" then
        done_item = item
        break
      end
    end
    fake_picker.closed = false
    local function render_preview(item, preview)
      current_fake_item = item
      local previous_buf = fake_picker.preview.win.buf
      local previous_swaps = preview_swaps
      picker_opts.preview({ item = item, preview = preview or fake_picker.preview })
      if fake_picker.preview.win.buf ~= previous_buf then
        fail("hover preview should keep the current buffer visible while its replacement renders")
      end
      vim.wait(1000, function() return preview_swaps > previous_swaps end, 10)
      if preview_swaps ~= previous_swaps + 1 then
        fail("hover preview should swap its completed staging buffer exactly once")
      end
      return fake_picker.preview.win.buf
    end

    local buf = render_preview(done_item)
    if not read_args
      or read_args.target ~= "pi-done"
      or read_args.source ~= "recent-unwrapped"
      or read_args.lines ~= vim.api.nvim_win_get_height(fake_picker.preview.win.win) * 2
      or read_args.ansi ~= true
    then
      fail("cwd picker hover should request twice the visible ANSI preview height: " .. vim.inspect(read_args))
    end
    if vim.bo[buf].buftype ~= "terminal" then
      fail("cwd picker should render Herdr ANSI through a native terminal buffer")
    end
    vim.wait(1000, function()
      return table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n"):find("first logical line", 1, true)
        ~= nil
    end, 10)
    local rendered_preview = table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n")
    if rendered_preview:find("\27", 1, true) or not rendered_preview:find("first logical line", 1, true) then
      fail("native preview should interpret ANSI instead of showing escape codes: " .. vim.inspect(rendered_preview))
    end
    if #toggles ~= 0 then
      fail("previewing a done session must not focus it")
    end

    local current_width = vim.api.nvim_win_get_width(fake_picker.preview.win.win)
    local sized_width = math.max(current_width - 7, 10)
    local sized_win = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), false, {
      relative = "editor",
      row = 0,
      col = 0,
      width = sized_width,
      height = 10,
      style = "minimal",
      hide = true,
    })
    read_result = "\27[32m" .. string.rep("x", sized_width + 3) .. "\27[0m"
    local sized_item = vim.tbl_extend("force", {}, done_item, { agent_name = "pi-sized-preview" })
    local sized_buf = render_preview(sized_item, {
      win = {
        win = sized_win,
        win_valid = function() return true end,
      },
    })
    local sized_lines = vim.api.nvim_buf_get_lines(sized_buf, 0, 2, false)
    vim.api.nvim_win_close(sized_win, true)
    if sized_lines[1] ~= string.rep("x", sized_width) or sized_lines[2] ~= "xxx" then
      fail("ANSI staging buffer should use the preview's actual width: " .. vim.inspect(sized_lines))
    end

    read_result = table.concat({
      "\27[32manswer stays\27[0m",
      "\27[38;2;128;128;128m• Working (46s · esc to interrupt)\27[0m",
      "",
      "\27[48;2;30;30;30m        \27[0m",
      "\27[48;2;30;30;30m› Find and fix a bug in @filename\27[0m",
      "\27[48;2;30;30;30m        \27[0m",
      "  gpt-5 footer",
    }, "\r\n")
    local codex_item = vim.tbl_extend("force", {}, done_item, {
      tool = "codex",
      agent_name = "codex-preview",
    })
    local codex_buf = render_preview(codex_item)
    local codex_preview = table.concat(vim.api.nvim_buf_get_lines(codex_buf, 0, -1, false), "\n")
    if
      codex_preview:find("Working", 1, true)
      or codex_preview:find("Find and fix", 1, true)
      or codex_preview:find("gpt-5 footer", 1, true)
    then
      fail("Codex preview should scrub its trailing prompt block: " .. vim.inspect(codex_preview))
    end
    if not codex_preview:find("answer stays", 1, true) then
      fail("Codex prompt scrubbing should preserve prior output: " .. vim.inspect(codex_preview))
    end

    local pi_buf = render_preview(done_item)
    local pi_preview = table.concat(vim.api.nvim_buf_get_lines(pi_buf, 0, -1, false), "\n")
    if not pi_preview:find("Find and fix", 1, true) or not pi_preview:find("gpt-5 footer", 1, true) then
      fail("non-Codex previews should retain identical output: " .. vim.inspect(pi_preview))
    end

    read_result = table.concat({
      "\27[32mPi answer stays\27[0m",
      "",
      " \27[38;2;138;190;183m⠴\27[0m \27[38;2;128;128;128mWorking...\27[0m",
      "",
      "\27[38;2;178;148;187m────────────────────────────────\27[0m",
      "i\27[0m\27[7m \27[0m",
      "\27[38;2;178;148;187m────────────────────────────────\27[0m",
      "\27[38;2;102;102;102m~/vault (main) • preview\27[0m",
      "\27[38;2;102;102;102m$0.000 (sub) 0.0%/272k (auto)  (openai-codex) gpt-5.5 • high\27[0m",
      "\27[38;2;138;190;183mMCP: 0/3 servers\27[0m",
    }, "\r\n")
    local pi_scrub_buf = render_preview(done_item)
    local pi_scrubbed = table.concat(vim.api.nvim_buf_get_lines(pi_scrub_buf, 0, -1, false), "\n")
    if pi_scrubbed:find("Working", 1, true)
      or pi_scrubbed:find("~/vault", 1, true)
      or pi_scrubbed:find("MCP:", 1, true)
    then
      fail("Pi preview should scrub its trailing prompt and status block: " .. vim.inspect(pi_scrubbed))
    end
    if not pi_scrubbed:find("Pi answer stays", 1, true) then
      fail("Pi prompt scrubbing should preserve prior output: " .. vim.inspect(pi_scrubbed))
    end

    read_result = nil
    local failed_buf = render_preview(done_item)
    local failed_preview = vim.api.nvim_buf_get_lines(failed_buf, 0, -1, false)
    if failed_preview[1] ~= "(agent read failed)" then
      fail("failed Herdr read should leave a readable preview error: " .. vim.inspect(failed_preview))
    end

    local original_columns, original_lines = vim.o.columns, vim.o.lines
    local function verify_atlas_preview(host_width, host_height)
      vim.o.columns = host_width
      vim.o.lines = host_height
      local preview_width = host_width - 4
      local preview_height = math.max(host_height - 20, 2)
      local preview_win = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), false, {
        relative = "editor",
        row = 0,
        col = 0,
        width = preview_width,
        height = preview_height,
        style = "minimal",
        hide = true,
      })
      local previous_win = fake_picker.preview.win.win
      fake_picker.preview.win.win = preview_win
      read_result = "\27[32mT10 V01 ordinary Herdr preview\27[0m\r\nunchanged second line"
      local expected_preview
      local frame = table.concat({
        "Run atlas-rich-run · Goal 3/5 T10.V01",
        "Participant driver · Role verifier-steward",
        "Lifecycle verify · active",
      }, "\r\n")
      local lookup_calls = {}
      cwd_picker.open({
        atlas_lookup = function(item, width, height, callback)
          lookup_calls[#lookup_calls + 1] = { item = item, width = width, height = height }
          vim.defer_fn(function()
            callback({
              outcome = "matched",
              run_id = "atlas-rich-run",
              participant_id = "driver",
              frame = frame,
            })
          end, 20)
        end,
      })
      local atlas_picker_opts = picker_opts
      local size = string.format("%dx%d", host_width, host_height)
      local layout = atlas_picker_opts.layout.layout
      local bottom = layout[3]
      local atlas_layout = bottom and bottom[3]
      local atlas_preview = atlas_layout
        and atlas_layout.win
        and atlas_picker_opts.layout.wins[atlas_layout.win]
      if layout.box ~= "vertical"
        or layout[1].win ~= "preview"
        or layout[1].title ~= " Preview "
        or layout[1].width ~= nil
        or layout[2].win ~= "input"
        or layout[2].height ~= 1
        or not bottom
        or bottom.box ~= "horizontal"
        or #bottom ~= 3
        or bottom[1].win ~= "workspace"
        or bottom[1].title ~= " Workspaces "
        or bottom[2].win ~= "list"
        or bottom[2].title ~= " Agents "
        or not atlas_layout
        or atlas_layout.title ~= " Atlas Preview "
        or not atlas_preview
      then
        fail(
          "T10 V01 picker layout at "
            .. size
            .. " should be full-width Preview, input, then Workspaces | Agents | Atlas Preview: "
            .. vim.inspect(layout)
        )
      end
      local atlas_item
      for _, item in ipairs(atlas_picker_opts.items) do
        if item.label == "pi-blocked" then
          atlas_item = item
          break
        end
      end
      if not atlas_item then
        fail("T04 V01 exact participant fixture is missing")
      end
      atlas_item.status = "working"

      fake_picker.closed = false
      current_fake_item = done_item
      local workspace = atlas_picker_opts.layout.wins.workspace
      workspace:show()
      atlas_preview:show()
      vim.api.nvim_win_set_width(atlas_preview.win, math.max(math.floor(preview_width / 3) - 2, 1))
      vim.api.nvim_win_set_height(atlas_preview.win, math.min(12, host_height - 2))
      atlas_picker_opts.on_show(fake_picker)
      local expected_preview_buf = render_preview(done_item)
      expected_preview = table.concat(
        vim.api.nvim_buf_get_lines(expected_preview_buf, 0, -1, false),
        "\n"
      )
      current_fake_item = atlas_item
      input_pattern = "pblocked"
      input_changed()
      if vim.api.nvim_win_get_cursor(workspace.win)[1] ~= 2 then
        fail("T04 V01 workspace filter should select the exact participant")
      end
      local move_up = atlas_picker_opts.win.input.keys["<Up>"]
      local move_down = atlas_picker_opts.win.input.keys["<Down>"]
      local heading_setup_swaps = preview_swaps
      move_up[1]()
      vim.wait(1000, function() return preview_swaps > heading_setup_swaps end, 10)
      if preview_swaps ~= heading_setup_swaps + 1
        or table.concat(vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false), "\n") ~= "(no session)"
      then
        fail("T04 V01 workspace heading should render its empty default preview")
      end
      local swaps_before = preview_swaps
      move_down[1]()
      vim.wait(1000, function()
        return #lookup_calls > 0
          and preview_swaps > swaps_before
          and table.concat(vim.api.nvim_buf_get_lines(atlas_preview.buf, 0, -1, false), "\n")
            :find("Run atlas-rich-run", 1, true) ~= nil
      end, 10)

      if #lookup_calls ~= 1 then
        fail(
          "T10 V01 exact participant at "
            .. size
            .. " should invoke Atlas lookup exactly once; got "
            .. #lookup_calls
        )
      end
      local lookup = lookup_calls[1]
      if lookup.item.workspace_id ~= "w1"
        or lookup.item.tab_id ~= "w1:t5"
        or lookup.item.pane_id ~= "w1:p5"
        or lookup.item.terminal_id ~= "term-5"
        or not vim.deep_equal(lookup.item.agent_session, {
          source = "herdr:codex",
          kind = "id",
          value = "session-5",
        })
        or lookup.width ~= vim.api.nvim_win_get_width(atlas_preview.win)
        or lookup.height ~= vim.api.nvim_win_get_height(atlas_preview.win)
      then
        fail("T10 V01 exact Atlas lookup identity/inner-dimensions mismatch at " .. size .. ": " .. vim.inspect(lookup))
      end
      if preview_swaps ~= swaps_before + 1 then
        fail("T10 V01 matched selection should stage the ordinary top preview exactly once at " .. size)
      end
      local top_buf = fake_picker.preview.win.buf
      local top_rendered = table.concat(vim.api.nvim_buf_get_lines(top_buf, 0, -1, false), "\n")
      local atlas_buf = atlas_preview.buf
      local rendered = table.concat(vim.api.nvim_buf_get_lines(atlas_buf, 0, -1, false), "\n")
      local rendered_fields = rendered:gsub("\n", "")
      if vim.bo[atlas_buf].buftype ~= "terminal"
        or not rendered_fields:find("Run atlas-rich-run", 1, true)
        or not rendered_fields:find("Goal 3/5", 1, true)
        or not rendered_fields:find("T10.V01", 1, true)
        or not rendered_fields:find("Participant driver", 1, true)
        or not rendered_fields:find("Role verifier-steward", 1, true)
        or not rendered_fields:find("Lifecycle verify", 1, true)
        or not rendered_fields:find("active", 1, true)
      then
        fail("T10 V01 bottom-right Atlas preview is incomplete at " .. size .. ": " .. vim.inspect(rendered))
      end
      if top_rendered ~= expected_preview
        or top_rendered:find("atlas-rich-run", 1, true)
        or top_rendered:find("T10.V01", 1, true)
        or top_rendered:find("verifier-steward", 1, true)
        or top_rendered:find("Lifecycle verify", 1, true)
      then
        fail(
          "T10 V01 matched Atlas changed or leaked into the ordinary top preview at "
            .. size
            .. ": "
            .. vim.inspect(top_rendered)
        )
      end
      export_t04_evidence("matched-" .. size, atlas_buf)

      local blank_layout_buf = vim.api.nvim_create_buf(false, true)
      atlas_preview.buf = blank_layout_buf
      vim.api.nvim_win_set_buf(atlas_preview.win, blank_layout_buf)
      local layout_swaps = preview_swaps
      atlas_picker_opts.preview({ item = lookup.item, preview = fake_picker.preview })
      vim.wait(1000, function()
        return table.concat(vim.api.nvim_buf_get_lines(atlas_preview.buf, 0, -1, false), "\n")
          :find("Run atlas-rich-run", 1, true) ~= nil
      end, 10)
      local layout_rendered = table.concat(
        vim.api.nvim_buf_get_lines(atlas_preview.buf, 0, -1, false),
        "\n"
      )
      local layout_fields = layout_rendered:gsub("\n", "")
      if preview_swaps ~= layout_swaps
        or fake_picker.preview.win.buf ~= top_buf
        or atlas_preview.buf == blank_layout_buf
        or not layout_fields:find("Run atlas-rich-run", 1, true)
        or not layout_fields:find("Goal 3/5", 1, true)
        or not layout_fields:find("T10.V01", 1, true)
        or #lookup_calls ~= 1
      then
        fail("T04 V01 same-selection layout callback should re-stage only active Atlas at " .. size)
      end
      if vim.api.nvim_buf_is_valid(blank_layout_buf) then
        vim.api.nvim_buf_delete(blank_layout_buf, { force = true })
      end

      local active_atlas_buf = atlas_preview.buf
      local active_atlas_bytes = table.concat(
        vim.api.nvim_buf_get_lines(active_atlas_buf, 0, -1, false),
        "\n"
      )
      local active_poll_swaps = preview_swaps
      read_result = "\27[32mT10 V03 active poll refresh\27[0m"
      vim.wait(1000, function()
        return preview_swaps > active_poll_swaps
          and table.concat(vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false), "\n")
            :find("T10 V03 active poll refresh", 1, true) ~= nil
      end, 10)
      if preview_swaps <= active_poll_swaps
        or atlas_preview.buf ~= active_atlas_buf
        or table.concat(vim.api.nvim_buf_get_lines(active_atlas_buf, 0, -1, false), "\n")
          ~= active_atlas_bytes
      then
        fail("T10 V03 active Atlas should allow top Preview polling without changing its frame at " .. size)
      end

      local active_full_reads = async_reads
      local active_full_swaps = preview_swaps
      read_result = "\27[32mT10 V03 active full preview\27[0m"
      atlas_picker_opts.actions.sidekick_preview_scroll_down()
      vim.wait(1000, function()
        local last_read = async_read_args[#async_read_args]
        return last_read
          and last_read.lines == 2147483647
          and preview_swaps > active_full_swaps
          and table.concat(vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false), "\n")
            :find("T10 V03 active full preview", 1, true) ~= nil
      end, 10)
      atlas_picker_opts.actions.sidekick_preview_scroll_up()
      if async_reads <= active_full_reads
        or preview_swaps <= active_full_swaps
        or atlas_preview.buf ~= active_atlas_buf
        or table.concat(vim.api.nvim_buf_get_lines(active_atlas_buf, 0, -1, false), "\n")
          ~= active_atlas_bytes
        or #lookup_calls ~= 1
      then
        fail("T10 V03 active full Preview should change without changing or repeating Atlas at " .. size)
      end

      local heading_swaps = preview_swaps
      move_up[1]()
      vim.wait(1000, function()
        return preview_swaps > heading_swaps
          and table.concat(vim.api.nvim_buf_get_lines(atlas_preview.buf, 0, -1, false), "\n") == ""
      end, 10)
      local heading_bytes = table.concat(
        vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false),
        "\n"
      )
      if preview_swaps ~= heading_swaps + 1
        or heading_bytes ~= "(no session)"
        or table.concat(vim.api.nvim_buf_get_lines(atlas_preview.buf, 0, -1, false), "\n") ~= ""
        or #lookup_calls ~= 1
      then
        fail("T04 V01 real workspace-heading navigation did not clear Atlas at " .. size)
      end

      input_pattern = ""
      fake_picker.closed = true
      atlas_picker_opts.on_close(fake_picker)
      workspace:close()
      atlas_preview:close()
      fake_picker.preview.win.win = previous_win
      vim.api.nvim_win_close(preview_win, true)
    end

    verify_atlas_preview(100, 30)
    verify_atlas_preview(80, 24)
    vim.o.columns, vim.o.lines = original_columns, original_lines

    local protected_paths = {
      "nvim/.config/nvim/lua/plugins/sidekick/registry.lua",
    }
    vim.list_extend(
      protected_paths,
      vim.fn.glob("scripts/fixtures/vault-hunter-atlas*/runs/*.json", false, true)
    )
    vim.list_extend(
      protected_paths,
      vim.fn.glob("scripts/fixtures/vault-hunter-atlas*/vault/**/*.md", false, true)
    )
    local protected_bytes = {}
    for _, path in ipairs(protected_paths) do
      protected_bytes[path] = table.concat(vim.fn.readfile(path, "b"), "\n")
    end
    local registered_tools = vim.deepcopy(config.cli.tools)
    local fallback_calls = {}
    local fallback_results = {
      unregistered = { outcome = "unregistered" },
      ineligible = { outcome = "ineligible" },
      stale = { outcome = "stale" },
      contradictory = { outcome = "contradictory" },
      ambiguous = { outcome = "ambiguous" },
      malformed = { outcome = "malformed" },
      unsupported = { outcome = "unsupported" },
      process_error = nil,
      missing_executable = nil,
      invalid_output = "not-json",
    }
    cwd_picker.open({
      atlas_lookup = function(item, _, _, callback)
        local fallback_case = item._atlas_fallback_case
        fallback_calls[fallback_case] = (fallback_calls[fallback_case] or 0) + 1
        if fallback_case == "timeout" then
          return function() end
        end
        vim.schedule(function()
          callback(fallback_results[fallback_case])
        end)
      end,
    })
    local fallback_picker_opts = picker_opts
    local fallback_item
    for _, item in ipairs(fallback_picker_opts.items) do
      if item.label == "pi-blocked" then
        fallback_item = item
        break
      end
    end
    if not fallback_item then
      fail("T04 V02 fallback participant fixture is missing")
    end
    fallback_item.status = "done"
    read_result = "\27[32mT04 V02 default preview bytes\27[0m\r\nsecond unchanged line"
    local baseline_item = vim.deepcopy(fallback_item)
    baseline_item.agent_session = nil
    current_fake_item = baseline_item
    fake_picker.closed = false
    local fallback_workspace = fallback_picker_opts.layout.wins.workspace
    local fallback_atlas = fallback_picker_opts.layout.wins.atlas
    local baseline_swaps = preview_swaps
    fallback_workspace:show()
    fallback_atlas:show()
    fallback_picker_opts.on_show(fake_picker)
    fallback_picker_opts.win.input.keys["<c-w>"][1]()
    vim.wait(1000, function() return preview_swaps > baseline_swaps end, 10)
    if preview_swaps ~= baseline_swaps + 1 then
      fail("T04 V02 could not capture the unchanged default preview")
    end
    local default_preview_bytes = table.concat(
      vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false),
      "\n"
    )

    local fallback_cases = {
      "unregistered",
      "ineligible",
      "stale",
      "contradictory",
      "ambiguous",
      "malformed",
      "unsupported",
      "timeout",
      "process_error",
      "missing_executable",
      "invalid_output",
    }
    local fallback_failures = {}
    for _, fallback_case in ipairs(fallback_cases) do
      local candidate = vim.deepcopy(fallback_item)
      candidate._atlas_fallback_case = fallback_case
      current_fake_item = candidate
      local swaps_before = preview_swaps
      fallback_picker_opts.preview({ item = candidate, preview = fake_picker.preview })
      vim.wait(fallback_case == "timeout" and 1500 or 1000, function()
        return preview_swaps > swaps_before
      end, 10)
      if fallback_calls[fallback_case] ~= 1 then
        fallback_failures[#fallback_failures + 1] = string.format(
          "%s invoked Atlas %d times",
          fallback_case,
          fallback_calls[fallback_case] or 0
        )
      end
      if preview_swaps ~= swaps_before + 1 then
        fallback_failures[#fallback_failures + 1] = string.format(
          "%s swapped the default preview %d times",
          fallback_case,
          preview_swaps - swaps_before
        )
      else
        local actual = table.concat(
          vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false),
          "\n"
        )
        if actual ~= default_preview_bytes then
          fallback_failures[#fallback_failures + 1] = fallback_case .. " changed the default preview bytes"
        end
      end
      local fallback_atlas_buf = vim.api.nvim_win_get_buf(fallback_atlas.win)
      if table.concat(vim.api.nvim_buf_get_lines(fallback_atlas_buf, 0, -1, false), "\n") ~= "" then
        fallback_failures[#fallback_failures + 1] = fallback_case .. " populated the Atlas pane"
      end
    end
    local fallback_layout_item = vim.deepcopy(fallback_item)
    fallback_layout_item._atlas_fallback_case = "unregistered"
    current_fake_item = fallback_layout_item
    local fallback_layout_calls = fallback_calls.unregistered
    local fallback_layout_swaps = preview_swaps
    fallback_picker_opts.preview({ item = fallback_layout_item, preview = fake_picker.preview })
    vim.wait(1000, function() return preview_swaps > fallback_layout_swaps end, 10)
    fallback_picker_opts.preview({ item = fallback_layout_item, preview = fake_picker.preview })
    vim.wait(1000, function() return preview_swaps > fallback_layout_swaps + 1 end, 10)
    local fallback_layout_bytes = table.concat(
      vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false),
      "\n"
    )
    if fallback_calls.unregistered ~= fallback_layout_calls + 1
      or preview_swaps ~= fallback_layout_swaps + 2
      or fallback_layout_bytes ~= default_preview_bytes
    then
      fallback_failures[#fallback_failures + 1] = "same-selection layout callback did not re-stage fallback"
    end

    if not vim.deep_equal(config.cli.tools, registered_tools) then
      fallback_failures[#fallback_failures + 1] = "changed the Sidekick Registry"
    end
    for _, path in ipairs(protected_paths) do
      if table.concat(vim.fn.readfile(path, "b"), "\n") ~= protected_bytes[path] then
        fallback_failures[#fallback_failures + 1] = "changed protected manifest " .. path
      end
    end
    if #fallback_failures == 0 then
      export_t04_evidence("fallback-restored", fake_picker.preview.win.buf)
    end
    fake_picker.closed = true
    fallback_picker_opts.on_close(fake_picker)
    fallback_workspace:close()
    fallback_atlas:close()
    if #fallback_failures > 0 then
      fail("T04 V02 Atlas fallback regressions: " .. table.concat(fallback_failures, "; "))
    end

    local function v03_frame(label)
      return table.concat({
        "Run atlas-v03-" .. label .. " · Goal T04.V03",
        "Role verifier · " .. label,
      }, "\r\n")
    end

    local function v03_result(label)
      return {
        outcome = "matched",
        run_id = "atlas-v03-" .. label,
        participant_id = "verifier-" .. label,
        frame = v03_frame(label),
      }
    end

    local function open_v03_picker(lookup)
      cwd_picker.open({ atlas_lookup = lookup })
      local opts = picker_opts
      local workspace = opts.layout.wins.workspace
      local atlas = opts.layout.wins.atlas
      fake_picker.closed = false
      workspace:show()
      atlas:show()
      opts.on_show(fake_picker)
      opts.win.input.keys["<c-w>"][1]()
      return opts, workspace
    end

    local function close_v03_picker(opts, workspace)
      fake_picker.closed = true
      opts.on_close(fake_picker)
      workspace:close()
      opts.layout.wins.atlas:close()
    end

    local function preview_bytes()
      return table.concat(vim.api.nvim_buf_get_lines(fake_picker.preview.win.buf, 0, -1, false), "\n")
    end

    local function valid_buffer_set()
      local buffers = {}
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(buf) then
          buffers[buf] = true
        end
      end
      return buffers
    end

    local function new_valid_buffers(before)
      local buffers = {}
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_valid(buf) and not before[buf] then
          buffers[#buffers + 1] = buf
        end
      end
      return buffers
    end

    read_result = "\27[36mT04 V03 unchanged default preview\27[0m\r\ndefault second line"
    local identity_calls = {}
    local identity_callbacks = {}
    local identity_picker_opts, identity_workspace = open_v03_picker(function(item, _, _, callback)
      local label = item._atlas_v03_case or "unexpected"
      identity_calls[label] = (identity_calls[label] or 0) + 1
      identity_callbacks[label] = callback
      vim.schedule(function()
        callback(label == "complete" and v03_result(label) or { outcome = "unregistered" })
      end)
      return function() end
    end)
    local complete_identity = vim.deepcopy(fallback_item)
    complete_identity.status = "done"
    complete_identity._atlas_fallback_case = nil
    local default_control = vim.deepcopy(complete_identity)
    default_control.agent_session = nil
    default_control._atlas_v03_case = "default-control"
    current_fake_item = default_control
    local default_control_swaps = preview_swaps
    identity_picker_opts.preview({ item = default_control, preview = fake_picker.preview })
    vim.wait(1000, function() return preview_swaps > default_control_swaps end, 10)
    if (identity_calls["default-control"] or 0) ~= 0 or preview_swaps ~= default_control_swaps + 1 then
      fail("T04 V03 default control should render once without an Atlas lookup")
    end
    local v03_default_preview_bytes = preview_bytes()

    local identity_cases = {
      {
        label = "empty",
        mutate = function(item) item._empty = true end,
        expected = "(no session)",
      },
      {
        label = "workspace",
        mutate = function(item) item._workspace = true end,
      },
      {
        label = "missing-workspace-id",
        mutate = function(item) item.workspace_id = nil end,
      },
      {
        label = "missing-tab-id",
        mutate = function(item) item.tab_id = nil end,
      },
      {
        label = "missing-pane-id",
        mutate = function(item) item.pane_id = nil end,
      },
      {
        label = "missing-terminal-id",
        mutate = function(item) item.terminal_id = nil end,
      },
      {
        label = "missing-session",
        mutate = function(item) item.agent_session = nil end,
      },
      {
        label = "missing-session-source",
        mutate = function(item) item.agent_session.source = nil end,
      },
      {
        label = "missing-session-kind",
        mutate = function(item) item.agent_session.kind = nil end,
      },
      {
        label = "missing-session-value",
        mutate = function(item) item.agent_session.value = nil end,
      },
    }
    for _, identity_case in ipairs(identity_cases) do
      local item = vim.deepcopy(complete_identity)
      item._atlas_v03_case = identity_case.label
      identity_case.mutate(item)
      current_fake_item = item
      local swaps_before = preview_swaps
      identity_picker_opts.preview({ item = item, preview = fake_picker.preview })
      vim.wait(1000, function() return preview_swaps > swaps_before end, 10)
      if (identity_calls[identity_case.label] or 0) ~= 0 then
        fail("T04 V03 " .. identity_case.label .. " identity should perform zero Atlas lookups")
      end
      if preview_swaps ~= swaps_before + 1 then
        fail("T04 V03 " .. identity_case.label .. " identity should render the default preview exactly once")
      end
      local expected = identity_case.expected or v03_default_preview_bytes
      if preview_bytes() ~= expected then
        fail(
          "T04 V03 "
            .. identity_case.label
            .. " identity changed the default preview: "
            .. vim.inspect(preview_bytes())
        )
      end
    end

    local control = vim.deepcopy(complete_identity)
    control._atlas_v03_case = "complete"
    current_fake_item = control
    local control_swaps = preview_swaps
    local control_atlas = identity_picker_opts.layout.wins.atlas
    local control_atlas_buf = control_atlas.buf
    identity_picker_opts.preview({ item = control, preview = fake_picker.preview })
    identity_picker_opts.preview({ item = control, preview = fake_picker.preview })
    vim.wait(1000, function()
      return preview_swaps > control_swaps
        and control_atlas.buf ~= control_atlas_buf
        and table.concat(vim.api.nvim_buf_get_lines(control_atlas.buf, 0, -1, false), "\n")
          :find("Run atlas-v03-complete", 1, true) ~= nil
    end, 10)
    if (identity_calls.complete or 0) ~= 1 or not identity_callbacks.complete then
      fail("T04 V03 complete identity control should perform exactly one Atlas lookup")
    end
    if preview_swaps ~= control_swaps + 1
      or preview_bytes() ~= v03_default_preview_bytes
      or control_atlas.buf == control_atlas_buf
      or not table.concat(vim.api.nvim_buf_get_lines(control_atlas.buf, 0, -1, false), "\n")
        :find("Run atlas-v03-complete", 1, true)
    then
      fail("T04 V03 complete identity control should swap one matched dedicated Atlas preview")
    end
    local ordinary = vim.deepcopy(complete_identity)
    ordinary.agent_session = nil
    ordinary._atlas_v03_case = "matched-to-ordinary"
    current_fake_item = ordinary
    local ordinary_swaps = preview_swaps
    identity_picker_opts.preview({ item = ordinary, preview = fake_picker.preview })
    local ordinary_atlas_buf = vim.api.nvim_win_get_buf(control_atlas.win)
    if table.concat(vim.api.nvim_buf_get_lines(ordinary_atlas_buf, 0, -1, false), "\n") ~= "" then
      fail("T10 V02 matched-to-ordinary selection should clear Atlas immediately")
    end
    vim.wait(1000, function() return preview_swaps > ordinary_swaps end, 10)
    if (identity_calls["matched-to-ordinary"] or 0) ~= 0
      or preview_swaps ~= ordinary_swaps + 1
      or preview_bytes() ~= v03_default_preview_bytes
      or table.concat(
        vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(control_atlas.win), 0, -1, false),
        "\n"
      ) ~= ""
    then
      fail("T10 V02 matched-to-ordinary selection should preserve ordinary top preview and empty Atlas")
    end
    close_v03_picker(identity_picker_opts, identity_workspace)

    local function complete_v03_item(label)
      local item = vim.deepcopy(complete_identity)
      item._atlas_v03_case = label
      return item
    end

    local selection_callbacks = {}
    local selection_cancels = {}
    local late_selection = complete_v03_item("selection-late")
    late_selection.status = "working"
    current_fake_item = late_selection
    local selection_picker_opts, selection_workspace = open_v03_picker(function(item, _, _, callback)
      local label = item._atlas_v03_case
      selection_callbacks[label] = callback
      return function()
        selection_cancels[label] = (selection_cancels[label] or 0) + 1
      end
    end)
    selection_picker_opts.preview({ item = late_selection, preview = fake_picker.preview })
    if not selection_callbacks["selection-late"] then
      fail("T04 V03 selection-change fixture did not start its Atlas lookup")
    end
    local selection_atlas = selection_picker_opts.layout.wins.atlas
    local pending_atlas_buf = vim.api.nvim_win_get_buf(selection_atlas.win)
    local pending_atlas_bytes = table.concat(
      vim.api.nvim_buf_get_lines(pending_atlas_buf, 0, -1, false),
      "\n"
    )
    local pending_poll_swaps = preview_swaps
    read_result = "\27[36mT10 V03 pending poll refresh\27[0m"
    vim.wait(1000, function()
      return preview_swaps > pending_poll_swaps
        and preview_bytes():find("T10 V03 pending poll refresh", 1, true) ~= nil
    end, 10)
    if preview_swaps <= pending_poll_swaps
      or pending_atlas_bytes ~= ""
      or vim.api.nvim_win_get_buf(selection_atlas.win) ~= pending_atlas_buf
      or table.concat(vim.api.nvim_buf_get_lines(pending_atlas_buf, 0, -1, false), "\n")
        ~= pending_atlas_bytes
    then
      fail("T10 V03 pending Atlas should allow top Preview polling while staying empty")
    end

    local pending_full_reads = async_reads
    local pending_full_swaps = preview_swaps
    read_result = "\27[36mT10 V03 pending full preview\27[0m"
    selection_picker_opts.actions.sidekick_preview_scroll_down()
    vim.wait(1000, function()
      local last_read = async_read_args[#async_read_args]
      return last_read
        and last_read.lines == 2147483647
        and preview_swaps > pending_full_swaps
        and preview_bytes():find("T10 V03 pending full preview", 1, true) ~= nil
    end, 10)
    selection_picker_opts.actions.sidekick_preview_scroll_up()
    if async_reads <= pending_full_reads
      or preview_swaps <= pending_full_swaps
      or vim.api.nvim_win_get_buf(selection_atlas.win) ~= pending_atlas_buf
      or table.concat(vim.api.nvim_buf_get_lines(pending_atlas_buf, 0, -1, false), "\n")
        ~= pending_atlas_bytes
    then
      fail("T10 V03 pending full Preview should change while displayed Atlas stays empty")
    end

    local selection_default = vim.deepcopy(complete_identity)
    selection_default.agent_session = nil
    selection_default._atlas_v03_case = "selection-default"
    current_fake_item = selection_default
    local selection_swaps = preview_swaps
    selection_picker_opts.preview({ item = selection_default, preview = fake_picker.preview })
    vim.wait(1000, function() return preview_swaps > selection_swaps end, 10)
    local selected_bytes = preview_bytes()
    local selected_atlas_buf = vim.api.nvim_win_get_buf(selection_atlas.win)
    local selected_buffers = valid_buffer_set()
    local selected_swaps = preview_swaps
    selection_callbacks["selection-late"](v03_result("selection-late"))
    vim.wait(100)
    if (selection_cancels["selection-late"] or 0) ~= 1
      or preview_swaps ~= selected_swaps
      or preview_bytes() ~= selected_bytes
      or vim.api.nvim_win_get_buf(selection_atlas.win) ~= selected_atlas_buf
      or table.concat(vim.api.nvim_buf_get_lines(selected_atlas_buf, 0, -1, false), "\n") ~= ""
      or #new_valid_buffers(selected_buffers) ~= 0
    then
      fail("T04 V03 selection change should discard a late Atlas result")
    end

    local staged_selection = complete_v03_item("selection-staging")
    current_fake_item = staged_selection
    selection_picker_opts.preview({ item = staged_selection, preview = fake_picker.preview })
    local before_selection_stage = valid_buffer_set()
    selection_callbacks["selection-staging"](v03_result("selection-staging"))
    local selection_staging_buffers = new_valid_buffers(before_selection_stage)
    if #selection_staging_buffers == 0 then
      fail("T04 V03 selection-change staging fixture did not create a staging buffer")
    end
    local after_stage_default = vim.deepcopy(selection_default)
    after_stage_default._atlas_v03_case = "selection-after-staging"
    current_fake_item = after_stage_default
    selection_swaps = preview_swaps
    selection_picker_opts.preview({ item = after_stage_default, preview = fake_picker.preview })
    vim.wait(1000, function() return preview_swaps > selection_swaps end, 10)
    for _, buf in ipairs(selection_staging_buffers) do
      if vim.api.nvim_buf_is_valid(buf) then
        fail("T04 V03 selection change should delete an obsolete Atlas staging buffer")
      end
    end
    if preview_swaps ~= selection_swaps + 1 or preview_bytes():find("selection%-staging") then
      fail("T04 V03 selection change should not swap an obsolete Atlas staging buffer")
    end
    local selection_displayed_atlas_buf = vim.api.nvim_win_get_buf(selection_atlas.win)
    if table.concat(vim.api.nvim_buf_get_lines(selection_displayed_atlas_buf, 0, -1, false), "\n") ~= "" then
      fail("T10 V02 selection change should not repopulate Atlas from obsolete staging")
    end
    close_v03_picker(selection_picker_opts, selection_workspace)

    local close_callbacks = {}
    local close_cancels = {}
    local close_picker_opts, close_workspace = open_v03_picker(function(item, _, _, callback)
      local label = item._atlas_v03_case
      close_callbacks[label] = callback
      return function()
        close_cancels[label] = (close_cancels[label] or 0) + 1
      end
    end)
    local late_close = complete_v03_item("close-late")
    current_fake_item = late_close
    close_picker_opts.preview({ item = late_close, preview = fake_picker.preview })
    local close_swaps = preview_swaps
    local close_bytes = preview_bytes()
    local close_buffers = valid_buffer_set()
    local close_atlas = close_picker_opts.layout.wins.atlas
    close_v03_picker(close_picker_opts, close_workspace)
    close_callbacks["close-late"](v03_result("close-late"))
    vim.wait(100)
    if (close_cancels["close-late"] or 0) ~= 1
      or preview_swaps ~= close_swaps
      or preview_bytes() ~= close_bytes
      or close_atlas:valid()
      or #new_valid_buffers(close_buffers) ~= 0
    then
      fail("T04 V03 picker close should discard a late Atlas result")
    end

    local staged_close_callbacks = {}
    local staged_close_picker_opts, staged_close_workspace = open_v03_picker(function(item, _, _, callback)
      staged_close_callbacks[item._atlas_v03_case] = callback
      return function() end
    end)
    local staged_close = complete_v03_item("close-staging")
    current_fake_item = staged_close
    staged_close_picker_opts.preview({ item = staged_close, preview = fake_picker.preview })
    local before_close_stage = valid_buffer_set()
    staged_close_callbacks["close-staging"](v03_result("close-staging"))
    local close_staging_buffers = new_valid_buffers(before_close_stage)
    if #close_staging_buffers == 0 then
      fail("T04 V03 picker-close staging fixture did not create a staging buffer")
    end
    close_swaps = preview_swaps
    close_bytes = preview_bytes()
    local staged_close_atlas = staged_close_picker_opts.layout.wins.atlas
    close_v03_picker(staged_close_picker_opts, staged_close_workspace)
    vim.wait(100)
    for _, buf in ipairs(close_staging_buffers) do
      if vim.api.nvim_buf_is_valid(buf) then
        fail("T04 V03 picker close should delete an obsolete Atlas staging buffer")
      end
    end
    if preview_swaps ~= close_swaps
      or preview_bytes() ~= close_bytes
      or staged_close_atlas:valid()
    then
      fail("T04 V03 picker close should not swap an obsolete Atlas staging buffer")
    end

    if not vim.deep_equal(config.cli.tools, registered_tools) then
      fail("T04 V03 deterministic preview checks changed the Sidekick Registry")
    end
    for _, path in ipairs(protected_paths) do
      if table.concat(vim.fn.readfile(path, "b"), "\n") ~= protected_bytes[path] then
        fail("T04 V03 deterministic preview checks changed protected manifest " .. path)
      end
    end

    local last_session = require("plugins.sidekick.last_session")
    last_session.label = nil
    picker_opts.confirm({ close = function() end }, done_item)
    if #toggles ~= 1 or toggles[1].name ~= "pi-done" or toggles[1].focus ~= true then
      fail("confirm should focus the selected done session exactly once: " .. vim.inspect(toggles))
    end
    if #focused ~= 1 or focused[1] ~= "pi-done" then
      fail("confirm should clear the selected session's done state: " .. vim.inspect(focused))
    end
    if last_session.label ~= "pi-done" then
      fail("confirm should keep the selected session active for <c-.>; got " .. vim.inspect(last_session.label))
    end
    last_session.open()
    if #toggles ~= 2 or toggles[2].name ~= "pi-done" or toggles[2].focus ~= true then
      fail("<c-.> should reopen the session selected from the local picker: " .. vim.inspect(toggles))
    end

    vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_id", "w1")
    vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_label", "Workspace One")
    cwd_picker.open()
    if picker_opts.title ~= "Sidekick Sessions in Workspace: Workspace One" then
      fail("bound cwd picker title should name its workspace: " .. vim.inspect(picker_opts.title))
    end
    for _, item in ipairs(picker_opts.items) do
      if item.workspace_id ~= "w1" then
        fail("automatically opened bound picker must use exact workspace ID: " .. vim.inspect(picker_opts.items))
      end
    end

    vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_id", "missing")
    vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_label", "Empty Workspace")
    cwd_picker.open()
    if picker_opts.title ~= "Sidekick Sessions in Workspace: Empty Workspace"
      or not picker_opts.items[1]
      or picker_opts.items[1].text ~= "(no named sessions in workspace)"
    then
      fail("empty bound picker should retain workspace scope: " .. vim.inspect(picker_opts))
    end
    pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_id")
    pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_label")
  end, debug.traceback)

  Snacks.picker.pick = original_pick
  Snacks.util.spinner = original_spinner
  herdr.read = original_read
  herdr.read_async = original_read_async
  herdr.focus = original_focus
  herdr.close = original_close
  herdr.call = original_herdr_call
  internal.toggle_tool_session = original_toggle
  vim.ui.input = original_ui_input
  vim.fn.confirm = original_confirm
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_id")
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_label")
  if not picker_ok then
    error(picker_err, 0)
  end

  local starship = require("plugins.sidekick.starship")
  if starship.cwd_for_terminal({ cwd = cwd }) ~= cwd then
    fail("Sidekick starship should use the terminal cwd with Herdr")
  end
  if starship.cwd_for_terminal({ session = { parent = { cwd = cwd } } }) ~= cwd then
    fail("Sidekick starship should fall back to the Herdr parent session cwd")
  end

  local Terminal = require("sidekick.cli.terminal")
  local backend = require("plugins.sidekick.herdr_backend")
  local original_terminals = Terminal.terminals
  local original_get_agent = herdr.get_agent
  local original_focus = herdr.focus
  local focused
  Terminal.terminals = {
    ["terminal:test"] = {
      buf = 42,
      parent = { herdr_agent_name = "pi-done" },
    },
  }
  herdr.get_agent = function(name)
    return { name = name, agent_status = "done" }
  end
  herdr.focus = function(name)
    focused = name
    return true
  end
  backend.mark_seen(42)
  if focused ~= "pi-done" then
    fail("opening a done Herdr session in Neovim should mark it seen")
  end
  focused = nil
  herdr.get_agent = function(name)
    return { name = name, agent_status = "blocked" }
  end
  backend.mark_seen(42)
  if focused then
    fail("opening a blocked Herdr session must not clear its attention state")
  end
  Terminal.terminals = original_terminals
  herdr.get_agent = original_get_agent
  herdr.focus = original_focus

  local branch = require("plugins.sidekick.branch").current(cwd)
  local terminal = { tool = { name = "pi-review" }, cwd = cwd, opts = { layout = "float", float = {} } }
  require("plugins.sidekick.branding").apply(terminal)
  local title = vim.inspect(terminal.opts.float.title)
  if branch and not title:find(branch, 1, true) then
    fail("Sidekick branding should derive the branch from the Herdr terminal cwd: " .. title)
  end
  herdr.list_agents = original_list_agents
end

local function validate_herdr_workspaces()
  load_plugin("snacks.nvim")
  local mapping = vim.fn.maparg("<leader>fw", "n", false, true)
  if type(mapping) ~= "table" or not (mapping.desc or ""):find("Workspace", 1, true) then
    fail("<leader>fw live mapping missing or mislabeled: " .. vim.inspect(mapping))
  end

  local herdr = require("plugins.sidekick.herdr")
  local original_call = herdr.call
  local original_pick = Snacks.picker.pick
  local original_input = vim.ui.input
  local original_select = vim.ui.select
  local original_confirm = vim.fn.confirm
  local original_notify = vim.notify
  local original_schedule = vim.schedule
  local original_cwd_picker = package.loaded["plugins.sidekick.cwd_picker"]
  local calls, picker_opts, picker_count, notifications = {}, nil, 0, {}
  local agent_picker_opens = {}
  local failures = {}
  local root = vim.fn.getcwd()
  local workspaces = {
    { workspace_id = "w-idle", number = 2, label = "Zebra", agent_status = "idle" },
    { workspace_id = "w-focused", number = 7, label = "Duplicate", agent_status = "blocked", focused = true },
    { workspace_id = "w-working", number = 11, label = "Alpha", agent_status = "working" },
    { workspace_id = "w-done", number = 19, label = "Duplicate", agent_status = "done" },
    { workspace_id = "w-unknown", number = 23, label = "Omega", agent_status = "future-state" },
  }
  local panes = {
    { pane_id = "p-idle", workspace_id = "w-idle", cwd = root .. "/nvim", foreground_cwd = root .. "/scripts" },
    { pane_id = "p-focused", workspace_id = "w-focused", cwd = root },
    { pane_id = "p-working", workspace_id = "w-working", cwd = root .. "/scripts" },
    { pane_id = "p-done", workspace_id = "w-done", cwd = root },
    { pane_id = "p-unknown", workspace_id = "w-unknown", cwd = root },
  }

  local function eq(actual, expected, label)
    if not vim.deep_equal(actual, expected) then
      fail(label .. ": got " .. vim.inspect(actual) .. ", expected " .. vim.inspect(expected))
    end
  end

  local function count_calls(family, action)
    local count = 0
    for _, command in ipairs(calls) do
      if command[1] == family and command[2] == action then
        count = count + 1
      end
    end
    return count
  end

  local function last_call(family, action)
    for i = #calls, 1, -1 do
      if calls[i][1] == family and calls[i][2] == action then
        return calls[i]
      end
    end
  end

  local function workspace(id)
    for _, item in ipairs(workspaces) do
      if item.workspace_id == id then
        return item
      end
    end
  end

  local function remove_workspace(id)
    workspaces = vim.tbl_filter(function(item) return item.workspace_id ~= id end, workspaces)
    panes = vim.tbl_filter(function(item) return item.workspace_id ~= id end, panes)
  end

  herdr.call = function(args)
    calls[#calls + 1] = vim.deepcopy(args)
    local family, action = args[1], args[2]
    if family == "workspace" and action == "list" then
      if failures.workspace_list then
        return nil, "workspace list failed"
      end
      return { workspaces = vim.deepcopy(workspaces) }
    end
    if family == "pane" and action == "list" then
      if failures.pane_list then
        return nil, "pane list failed"
      end
      return { panes = vim.deepcopy(panes) }
    end
    if family == "workspace" and action == "focus" then
      if failures.focus == args[3] then
        return nil, "workspace missing"
      end
      for _, item in ipairs(workspaces) do
        item.focused = item.workspace_id == args[3]
      end
      return { workspace = vim.deepcopy(workspace(args[3])) }
    end
    if family == "workspace" and action == "create" then
      if failures.create then
        return nil, "create failed"
      end
      local created = {
        workspace_id = "w-created",
        number = 29,
        label = args[6],
        agent_status = "idle",
      }
      workspaces[#workspaces + 1] = created
      panes[#panes + 1] = { pane_id = "p-created", workspace_id = created.workspace_id, cwd = args[4] }
      return { workspace = vim.deepcopy(created) }
    end
    if family == "workspace" and action == "rename" then
      if failures.rename then
        return nil, "rename failed"
      end
      local item = workspace(args[3])
      if item then
        item.label = args[4]
      end
      return { workspace = vim.deepcopy(item) }
    end
    if family == "workspace" and action == "close" then
      if failures.close then
        return nil, "close failed"
      end
      remove_workspace(args[3])
      return {}
    end
    fail("unexpected Herdr command: " .. vim.inspect(args))
  end

  Snacks.picker.pick = function(opts)
    picker_opts = opts
    picker_count = picker_count + 1
    return opts
  end
  vim.notify = function(message, level)
    notifications[#notifications + 1] = { message = message, level = level }
  end
  package.loaded["plugins.sidekick.cwd_picker"] = {
    open = function()
      agent_picker_opens[#agent_picker_opens + 1] = {
        tab = vim.api.nvim_get_current_tabpage(),
        cwd = vim.fn.getcwd(),
      }
    end,
  }

  local ok, err = xpcall(function()
    local loaded, workspace_tabs =
      pcall(dofile, root .. "/nvim/.config/nvim/lua/plugins/herdr/workspaces.lua")
    if not loaded then
      fail("plugins.herdr.workspaces module missing: " .. tostring(workspace_tabs))
    end
    if type(workspace_tabs.open) ~= "function" then
      fail("plugins.herdr.workspaces.open missing")
    end

    vim.cmd("silent! tabonly")
    vim.cmd("silent! only")
    vim.cmd("enew")
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { "" })
    vim.bo.modified = false
    vim.cmd("tcd " .. vim.fn.fnameescape(root))

    local function open_picker()
      local before = picker_count
      workspace_tabs.open()
      vim.wait(100, function() return picker_count > before end, 5)
      if picker_count ~= before + 1 then
        fail("workspace open should create exactly one fresh picker")
      end
      return picker_opts
    end

    local function item_by_id(opts, id)
      for _, item in ipairs(opts.items or {}) do
        if item.workspace_id == id then
          return item
        end
      end
      fail("picker item missing for " .. id .. ": " .. vim.inspect(opts.items))
    end

    local function fake_picker(item)
      local picker = { closed = false, selected_target = nil, list = {} }
      function picker:close()
        self.closed = true
      end
      function picker:current()
        return item
      end
      function picker.list:set_target(target)
        picker.selected_target = target
      end
      function picker.list:view(target)
        picker.selected_target = target
      end
      return picker
    end

    local function action_for(opts, lhs)
      for _, win in pairs(opts.win or {}) do
        for key, binding in pairs(win.keys or {}) do
          if key:lower() == lhs:lower() then
            local action = type(binding) == "table" and binding[1] or binding
            return type(action) == "function" and action or (opts.actions or {})[action]
          end
        end
      end
      fail("picker action key missing: " .. lhs)
    end

    local function run_action(opts, lhs, item)
      local action = action_for(opts, lhs)
      if type(action) ~= "function" then
        fail("picker action missing for " .. lhs)
      end
      local picker = fake_picker(item)
      action(picker, item)
      return picker
    end

    local function tab_var(tab, name)
      local var_ok, value = pcall(vim.api.nvim_tabpage_get_var, tab, name)
      return var_ok and value or nil
    end

    local function tab_for(id)
      for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
        if tab_var(tab, "herdr_workspace_id") == id then
          return tab
        end
      end
    end

    local function tab_cwd(tab)
      return vim.fn.getcwd(-1, vim.api.nvim_tabpage_get_number(tab))
    end

    local function confirm_workspace(opts, id, source, close_source)
      local item = item_by_id(opts, id)
      local picker = fake_picker(item)
      local before = #agent_picker_opens
      local scheduled = {}
      vim.schedule = function(callback)
        scheduled[#scheduled + 1] = callback
      end
      local confirm_ok, confirm_err = pcall(opts.confirm, picker, item)
      vim.schedule = original_schedule
      if not confirm_ok then
        error(confirm_err, 0)
      end
      eq(#agent_picker_opens, before, "agent picker should be scheduled after workspace selection")
      eq(#scheduled, 1, "workspace selection should schedule one agent picker")
      local tab = tab_for(id)
      if not picker.closed or not tab or vim.api.nvim_get_current_tabpage() ~= tab then
        fail("workspace selection must close its picker and enter the exact workspace tab")
      end
      if source and vim.api.nvim_tabpage_is_valid(source) == close_source then
        fail(
          string.format(
            "%s source tab should be %s before the agent picker opens",
            close_source and "empty" or "meaningful",
            close_source and "closed" or "preserved"
          )
        )
      end
      scheduled[1]()
      eq(#agent_picker_opens, before + 1, "CR workspace selection should open one agent picker")
      local opened = agent_picker_opens[#agent_picker_opens]
      eq(opened.tab, tab, "agent picker should open after the selected tab is current")
      eq(opened.cwd, tab_cwd(tab), "agent picker should expose the selected tab-local cwd")
      return tab
    end

    local initial_list_calls = count_calls("workspace", "list")
    local initial_pane_calls = count_calls("pane", "list")
    local first = open_picker()
    local second = open_picker()
    eq(#agent_picker_opens, 0, "opening a workspace picker must not open the agent picker")
    local cancelled = fake_picker()
    cancelled:close()
    vim.wait(10)
    eq(#agent_picker_opens, 0, "cancelling a workspace picker must not open the agent picker")
    eq(count_calls("workspace", "list") - initial_list_calls, 2, "every open should freshly list workspaces")
    eq(count_calls("pane", "list") - initial_pane_calls, 2, "every open should freshly list panes")

    local ids, numbers = {}, {}
    for _, item in ipairs(second.items or {}) do
      ids[#ids + 1] = item.workspace_id
      numbers[#numbers + 1] = item.number
    end
    eq(ids, { "w-idle", "w-focused", "w-working", "w-done", "w-unknown" }, "Herdr workspace order")
    eq(numbers, { 2, 7, 11, 19, 23 }, "Herdr workspace number order")

    local markers = {
      ["w-idle"] = "·",
      ["w-focused"] = "●",
      ["w-working"] = "●",
      ["w-done"] = "●",
      ["w-unknown"] = "·",
    }
    local marker_highlights = {}
    for id, marker in pairs(markers) do
      local chunks = second.format(item_by_id(second, id), {})
      local rendered = {}
      for _, chunk in ipairs(chunks) do
        if type(chunk[1]) == "string" then
          rendered[#rendered + 1] = chunk[1]
          if chunk[1]:find(marker, 1, true) then
            marker_highlights[id] = chunk[2]
          end
        end
      end
      if not table.concat(rendered):find(marker, 1, true) then
        fail(id .. " row should use marker " .. marker .. ": " .. vim.inspect(chunks))
      end
    end
    if not marker_highlights["w-focused"]
      or marker_highlights["w-focused"] == marker_highlights["w-working"]
      or marker_highlights["w-focused"] == marker_highlights["w-done"]
      or marker_highlights["w-working"] == marker_highlights["w-done"]
      or marker_highlights["w-idle"] ~= marker_highlights["w-unknown"]
    then
      fail("workspace markers should retain Herdr semantic status colors: " .. vim.inspect(marker_highlights))
    end
    local selected_chunks = second.format(item_by_id(second, "w-done"), {})
    local priority_marker, priority_cwd = false, false
    for _, chunk in ipairs(selected_chunks) do
      if chunk.hl_group == marker_highlights["w-done"] and chunk.priority == 200 then
        priority_marker = true
      elseif chunk.hl_group == "Comment" and chunk.priority == 200 then
        priority_cwd = true
      end
    end
    if not priority_marker or not priority_cwd then
      fail("selected rows should preserve state and cwd colors: " .. vim.inspect(selected_chunks))
    end

    if type(second.on_show) ~= "function" then
      fail("workspace picker should select Herdr's focused workspace on show")
    end
    local shown = fake_picker()
    second.on_show(shown)
    vim.wait(100, function()
      return shown.selected_target ~= nil
    end, 5)
    eq(shown.selected_target, 2, "Herdr focused workspace initial selection")
    if second.title ~= "spaces" or second.preview ~= false or type(second.on_close) ~= "function" then
      fail("workspace picker should be titled spaces, have no preview, and restore picker highlights: " .. vim.inspect(second))
    end
    if second.layout.reverse ~= false or second.layout.layout.height < #second.items + 2 then
      fail("workspace picker should render Herdr order top-down without clipping rows: " .. vim.inspect(second.layout))
    end
    local initial_tab = vim.api.nvim_get_current_tabpage()
    local initial_tab_count = #vim.api.nvim_list_tabpages()
    local picker_float = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), false, {
      relative = "editor",
      row = 0,
      col = 0,
      width = 1,
      height = 1,
      style = "minimal",
    })
    local idle_tab = confirm_workspace(first, "w-idle", initial_tab, true)
    if idle_tab == initial_tab
      or vim.api.nvim_tabpage_is_valid(initial_tab)
      or vim.api.nvim_win_is_valid(picker_float)
      or #vim.api.nvim_list_tabpages() ~= initial_tab_count
    then
      fail("first workspace should replace the empty source tab despite picker floats")
    end
    eq(tab_cwd(idle_tab), root .. "/nvim", "stable pane cwd should initialize the tab")
    if tab_cwd(idle_tab) == root .. "/scripts" then
      fail("foreground_cwd must not initialize a workspace tab")
    end

    local preserved_cwd = root .. "/scripts"
    vim.cmd("tcd " .. vim.fn.fnameescape(preserved_cwd))
    vim.cmd("tabnew")
    local empty_source = vim.api.nvim_get_current_tabpage()
    local before_reselect = #vim.api.nvim_list_tabpages()
    local reselect = open_picker()
    eq(confirm_workspace(reselect, "w-idle", empty_source, true), idle_tab, "reselected workspace tab")
    eq(#vim.api.nvim_list_tabpages(), before_reselect - 1, "reselect should remove its empty source tab")
    eq(agent_picker_opens[#agent_picker_opens].cwd, preserved_cwd, "reused workspace picker cwd")

    vim.cmd("tabnew")
    local dashboard_source = vim.api.nvim_get_current_tabpage()
    vim.bo.buftype = "nofile"
    vim.bo.filetype = "snacks_dashboard"
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { "dashboard" })
    vim.bo.modified = false
    local before_dashboard = #vim.api.nvim_list_tabpages()
    local dashboard_select = open_picker()
    eq(
      confirm_workspace(dashboard_select, "w-idle", dashboard_source, true),
      idle_tab,
      "dashboard source target"
    )
    eq(
      #vim.api.nvim_list_tabpages(),
      before_dashboard - 1,
      "workspace selection should remove its dashboard launch tab"
    )

    local function assert_meaningful_source(label, setup)
      vim.cmd("tabnew")
      local source = vim.api.nvim_get_current_tabpage()
      local source_buffer = vim.api.nvim_get_current_buf()
      setup()
      local tab_count = #vim.api.nvim_list_tabpages()
      local opts = open_picker()
      eq(confirm_workspace(opts, "w-idle", source, false), idle_tab, label .. " target")
      eq(#vim.api.nvim_list_tabpages(), tab_count, label .. " source tab count")
      vim.cmd("tabclose! " .. vim.api.nvim_tabpage_get_number(source))
      vim.api.nvim_set_current_tabpage(idle_tab)
      if vim.api.nvim_buf_is_valid(source_buffer) then
        vim.api.nvim_buf_delete(source_buffer, { force = true })
      end
    end

    assert_meaningful_source("named-buffer", function()
      vim.api.nvim_buf_set_name(0, root .. "/named-workspace-source")
    end)
    assert_meaningful_source("modified-buffer", function()
      vim.bo.modified = true
    end)
    assert_meaningful_source("non-empty-buffer", function()
      vim.api.nvim_buf_set_lines(0, 0, -1, false, { "keep this source" })
      vim.bo.modified = false
    end)
    assert_meaningful_source("special-buftype", function()
      vim.bo.buftype = "nofile"
    end)
    assert_meaningful_source("multi-window", function()
      vim.cmd.vsplit()
    end)

    local duplicate = open_picker()
    local focused_tab = confirm_workspace(duplicate, "w-focused", idle_tab, false)
    if not focused_tab or focused_tab == idle_tab then
      fail("duplicate labels must still create distinct ID-bound tabs")
    end
    eq(tab_var(idle_tab, "herdr_workspace_label"), "Zebra", "first workspace tab label")
    eq(tab_var(focused_tab, "herdr_workspace_label"), "Duplicate", "duplicate workspace tab label")
    local bound_source_opts = open_picker()
    eq(
      confirm_workspace(bound_source_opts, "w-idle", focused_tab, false),
      idle_tab,
      "workspace-bound source target"
    )
    if not vim.api.nvim_tabpage_is_valid(focused_tab) then
      fail("workspace-bound source tab must be preserved")
    end

    local lifecycle_picker_count = #agent_picker_opens
    local focus_calls = count_calls("workspace", "focus")
    vim.cmd("tabnew")
    local unbound_tab = vim.api.nvim_get_current_tabpage()
    eq(count_calls("workspace", "focus"), focus_calls, "entering an unbound tab must not focus Herdr")
    vim.api.nvim_set_current_tabpage(idle_tab)
    eq(count_calls("workspace", "focus"), focus_calls + 1, "TabEnter on a bound tab should focus Herdr")
    eq(last_call("workspace", "focus")[3], "w-idle", "bound TabEnter focus target")
    eq(#agent_picker_opens, lifecycle_picker_count, "manual tab changes must not open the agent picker")

    vim.api.nvim_set_current_tabpage(unbound_tab)
    vim.api.nvim_set_current_tabpage(idle_tab)
    eq(tab_cwd(idle_tab), preserved_cwd, "existing tab-local cwd should survive switching")

    vim.api.nvim_set_current_tabpage(unbound_tab)
    vim.cmd("enew")
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { "keep this unbound tab" })
    vim.bo.modified = false
    local create_cwd = root .. "/scripts"
    vim.cmd("tcd " .. vim.fn.fnameescape(create_cwd))
    local create_opts = open_picker()
    vim.ui.input = function(_, callback) callback("Created") end
    local create_picker = run_action(create_opts, "<c-n>", item_by_id(create_opts, "w-idle"))
    vim.wait(100, function() return tab_for("w-created") ~= nil end, 5)
    eq(
      last_call("workspace", "create"),
      { "workspace", "create", "--cwd", create_cwd, "--label", "Created", "--no-focus" },
      "workspace create command"
    )
    if not create_picker.closed or vim.api.nvim_get_current_tabpage() ~= tab_for("w-created") then
      fail("successful create should close the picker and open the returned workspace")
    end
    if not vim.api.nvim_tabpage_is_valid(unbound_tab) then
      fail("workspace create must preserve a non-empty active tab")
    end
    eq(#agent_picker_opens, lifecycle_picker_count, "workspace create must not open the agent picker")

    local rename_opts = open_picker()
    local rename_item = item_by_id(rename_opts, "w-focused")
    failures.rename = true
    vim.ui.input = function(_, callback) callback("Rejected rename") end
    run_action(rename_opts, "<c-r>", rename_item)
    eq(tab_var(focused_tab, "herdr_workspace_label"), "Duplicate", "failed rename must preserve mapped tab label")
    failures.rename = nil
    vim.ui.input = function(_, callback) callback("Renamed") end
    run_action(rename_opts, "<c-r>", rename_item)
    vim.wait(100, function() return tab_var(focused_tab, "herdr_workspace_label") == "Renamed" end, 5)
    eq(last_call("workspace", "rename"), { "workspace", "rename", "w-focused", "Renamed" }, "workspace rename command")
    eq(tab_var(focused_tab, "herdr_workspace_label"), "Renamed", "successful rename should update mapped tab")
    eq(#agent_picker_opens, lifecycle_picker_count, "workspace rename must not open the agent picker")

    local close_opts = open_picker()
    local close_item = item_by_id(close_opts, "w-focused")
    local confirmations, confirm_close = 0, false
    vim.fn.confirm = function()
      confirmations = confirmations + 1
      return confirm_close and 1 or 2
    end
    vim.ui.select = function(items, _, callback)
      confirmations = confirmations + 1
      callback(confirm_close and items[1] or nil)
    end
    local close_calls = count_calls("workspace", "close")
    run_action(close_opts, "<c-x>", close_item)
    if confirmations ~= 1 or count_calls("workspace", "close") ~= close_calls or not vim.api.nvim_tabpage_is_valid(focused_tab) then
      fail("workspace close should require confirmation before changing Herdr or Neovim")
    end

    local order = {}
    local close_group = vim.api.nvim_create_augroup("VerifyHerdrWorkspaceClose", { clear = true })
    vim.api.nvim_create_autocmd("TabClosed", {
      group = close_group,
      once = true,
      callback = function()
        order[#order + 1] = "tab-close"
      end,
    })
    confirm_close = true
    failures.close = true
    run_action(close_opts, "<c-x>", close_item)
    if not vim.api.nvim_tabpage_is_valid(focused_tab) then
      fail("failed Herdr close must preserve the mapped Neovim tab")
    end
    failures.close = nil
    local before_close_call = #calls
    local original_mock_call = herdr.call
    herdr.call = function(args, quiet)
      if args[1] == "workspace" and args[2] == "close" then
        order[#order + 1] = "herdr-close"
      end
      return original_mock_call(args, quiet)
    end
    run_action(close_opts, "<c-x>", close_item)
    vim.wait(100, function() return not vim.api.nvim_tabpage_is_valid(focused_tab) end, 5)
    eq(order, { "herdr-close", "tab-close" }, "confirmed close ordering")
    eq(calls[before_close_call + 1], { "workspace", "close", "w-focused" }, "workspace close command")
    herdr.call = original_mock_call
    vim.api.nvim_del_augroup_by_id(close_group)
    eq(#agent_picker_opens, lifecycle_picker_count, "workspace close must not open the agent picker")

    local manual_opts = open_picker()
    local manual_source = vim.api.nvim_get_current_tabpage()
    local done_tab = confirm_workspace(manual_opts, "w-done", manual_source, false)
    local after_done_selection = #agent_picker_opens
    local closes_before_manual = count_calls("workspace", "close")
    vim.api.nvim_set_current_tabpage(done_tab)
    vim.cmd("tabclose")
    eq(count_calls("workspace", "close"), closes_before_manual, "manual tabclose must not call Herdr")
    eq(#agent_picker_opens, after_done_selection, "manual tab close must not open the agent picker")

    local detached_opts = open_picker()
    local detached_source = vim.api.nvim_get_current_tabpage()
    local detached_tab = confirm_workspace(detached_opts, "w-working", detached_source, false)
    local after_detached_selection = #agent_picker_opens
    vim.api.nvim_set_current_tabpage(detached_tab)
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { "detached contents survive" })
    vim.bo.modified = false
    local detached_cwd = tab_cwd(detached_tab)
    remove_workspace("w-working")
    open_picker()
    if not vim.api.nvim_tabpage_is_valid(detached_tab)
      or tab_var(detached_tab, "herdr_workspace_detached") ~= true
      or tab_cwd(detached_tab) ~= detached_cwd
    then
      fail("missing Herdr workspaces should leave their tabs locally usable and detached")
    end
    failures.focus = "w-working"
    vim.api.nvim_set_current_tabpage(unbound_tab)
    vim.api.nvim_set_current_tabpage(detached_tab)
    if not vim.api.nvim_tabpage_is_valid(detached_tab) then
      fail("failed focus of a detached workspace must not close its local tab")
    end
    eq(#agent_picker_opens, after_detached_selection, "manual detached-tab changes must not open the agent picker")

    local pickers_before_failure = picker_count
    local notifications_before_failure = #notifications
    failures.workspace_list = true
    workspace_tabs.open()
    vim.wait(50)
    eq(picker_count, pickers_before_failure, "workspace-list failure must not open stale picker")
    failures.workspace_list = nil
    failures.pane_list = true
    workspace_tabs.open()
    vim.wait(50)
    eq(picker_count, pickers_before_failure, "pane-list failure must not open stale picker")
    failures.pane_list = nil
    if #notifications <= notifications_before_failure then
      fail("Herdr query failure should show a clear error")
    end
    eq(#agent_picker_opens, after_detached_selection, "workspace query failures must not open the agent picker")

    local project_spec = dofile(root .. "/nvim/.config/nvim/lua/plugins/project.lua")
    local project_config
    local original_project = package.loaded.project_nvim
    package.loaded.project_nvim = { setup = function(opts) project_config = opts end }
    project_spec.config()
    package.loaded.project_nvim = original_project
    eq(project_config and project_config.scope_chdir, "tab", "project.nvim scope_chdir")

    local dashboard_spec = dofile(root .. "/nvim/.config/nvim/lua/plugins/dashboard.lua")
    local dashboard_workspace
    for _, key in ipairs(dashboard_spec.opts.dashboard.preset.keys) do
      if key.key == "w" then
        dashboard_workspace = key
        break
      end
    end
    if not dashboard_workspace
      or dashboard_workspace.desc ~= "Workspaces"
      or type(dashboard_workspace.action) ~= "function"
    then
      fail("dashboard should expose direct Workspaces key w")
    end
    local original_workspace_module = package.loaded["plugins.herdr.workspaces"]
    local dashboard_opens = 0
    package.loaded["plugins.herdr.workspaces"] = {
      open = function()
        dashboard_opens = dashboard_opens + 1
      end,
    }
    local dashboard_ok, dashboard_err = pcall(dashboard_workspace.action)
    package.loaded["plugins.herdr.workspaces"] = original_workspace_module
    if not dashboard_ok then
      error(dashboard_err, 0)
    end
    eq(dashboard_opens, 1, "dashboard Workspaces action")

    local lualine_spec = dofile(root .. "/nvim/.config/nvim/lua/plugins/lualine.lua")
    local original_lualine = package.loaded.lualine
    local lualine_config
    package.loaded.lualine = {
      setup = function(opts)
        lualine_config = opts
      end,
    }
    local lualine_ok, lualine_err = pcall(lualine_spec.config)
    package.loaded.lualine = original_lualine
    if not lualine_ok then
      error(lualine_err, 0)
    end
    local workspace_component
    for _, component in ipairs(lualine_config.sections.lualine_b) do
      if type(component) == "table" and type(component[1]) == "function" then
        workspace_component = component
        break
      end
    end
    if not workspace_component or type(workspace_component.cond) ~= "function" then
      fail("lualine workspace component missing")
    end
    vim.api.nvim_set_current_tabpage(unbound_tab)
    pcall(vim.api.nvim_tabpage_del_var, unbound_tab, "herdr_workspace_id")
    pcall(vim.api.nvim_tabpage_del_var, unbound_tab, "herdr_workspace_label")
    eq(workspace_component[1](), "", "unbound statusline workspace label")
    eq(workspace_component.cond(), false, "unbound statusline workspace visibility")
    vim.api.nvim_tabpage_set_var(unbound_tab, "herdr_workspace_id", "w-status")
    vim.api.nvim_tabpage_set_var(unbound_tab, "herdr_workspace_label", "Status Workspace")
    eq(workspace_component[1](), "Status Workspace", "bound statusline workspace label")
    eq(workspace_component.cond(), true, "bound statusline workspace visibility")
    pcall(vim.api.nvim_tabpage_del_var, unbound_tab, "herdr_workspace_id")
    pcall(vim.api.nvim_tabpage_del_var, unbound_tab, "herdr_workspace_label")
    local lualine_source =
      table.concat(vim.fn.readfile(root .. "/nvim/.config/nvim/lua/plugins/lualine.lua"), "\n")
    if lualine_source:find("plugins.sidekick.herdr", 1, true) or lualine_source:find("herdr.call", 1, true) then
      fail("lualine workspace component must use tab variables without querying Herdr")
    end

    for _, command in ipairs(calls) do
      if command[1] == "git" or command[1] == "worktree" then
        fail("Herdr workspace feature must not issue git/worktree commands: " .. vim.inspect(command))
      end
    end
    local source = table.concat(vim.fn.readfile(root .. "/nvim/.config/nvim/lua/plugins/herdr/workspaces.lua"), "\n")
    if source:match('call%s*%(%s*{%s*["\']worktree')
      or source:match('vim%.system%s*%(%s*{%s*["\']git')
    then
      fail("Herdr workspace module must not contain git/worktree commands")
    end
    if source:find("nvim_tabpage_close", 1, true) then
      fail("Herdr workspace tabs must close through the supported :tabclose command")
    end
  end, debug.traceback)

  herdr.call = original_call
  Snacks.picker.pick = original_pick
  vim.ui.input = original_input
  vim.ui.select = original_select
  vim.fn.confirm = original_confirm
  vim.notify = original_notify
  vim.schedule = original_schedule
  package.loaded["plugins.sidekick.cwd_picker"] = original_cwd_picker
  if not ok then
    error(err, 0)
  end
end

local function validate_sidekick_herdr_live()
  load_plugin("sidekick.nvim")

  local label = os.getenv("VERIFY_NVIM_HERDR_LABEL") or ""
  local sentinel = os.getenv("VERIFY_NVIM_HERDR_SENTINEL") or ""
  if label == "" or sentinel == "" then
    fail("sidekick-herdr-live requires VERIFY_NVIM_HERDR_LABEL and VERIFY_NVIM_HERDR_SENTINEL")
  end

  local internal = require("plugins.sidekick.internal")
  local config = require("sidekick.config")
  local command = {
    "sh",
    "-c",
    string.format(
      "printf '%s\\n'; while IFS= read -r line; do printf 'ECHO:%%s\\n' \"$line\"; done",
      sentinel
    ),
  }
  config.cli.tools[label] = internal.merged_tool_config("pi", {
    cmd = command,
    url = internal.tool_urls.pi,
  })

  local Session = require("sidekick.cli.session")
  local session = Session.new({ tool = label, cwd = vim.fn.getcwd(), backend = "herdr" })
  local attach = session:start()
  assert_sequence(attach.cmd, { "herdr", "agent", "attach", label, "--takeover" }, "Herdr attach command")
  if not session.herdr_pane_id or not session.herdr_tab_id or not session.herdr_workspace_id then
    fail("started Herdr session missing pane/tab/workspace identifiers: " .. vim.inspect(session))
  end

  session:send(sentinel)
  session:submit()
  local herdr = require("plugins.sidekick.herdr")
  local live_agent = herdr.get_agent(label)
  local tab_result = herdr.call({ "tab", "get", session.herdr_tab_id })
  local tab = tab_result and tab_result.tab
  if not live_agent or live_agent.tab_id ~= session.herdr_tab_id then
    fail("started Herdr agent should live in its own tab: " .. vim.inspect(live_agent))
  end
  if not tab or tab.label ~= label or tab.pane_count ~= 1 then
    fail("started Herdr tab should be named for the session and contain one pane: " .. vim.inspect(tab))
  end
  local dump = ""
  local echoed = vim.wait(3000, function()
    dump = session:dump() or ""
    return dump:gsub("%s", ""):find("ECHO:" .. sentinel, 1, true) ~= nil
  end, 50)
  if not echoed then
    fail("Herdr send/submit output missing sentinel; dump=" .. vim.inspect(dump))
  end
  if not dump:gsub("%s", ""):find("ECHO:" .. sentinel, 1, true) then
    fail("Sidekick Herdr dump missing sentinel: " .. vim.inspect(dump))
  end
  if herdr.workspace_for_cwd(vim.fn.getcwd()) ~= session.herdr_workspace_id then
    fail("Herdr project cwd did not resolve to the started workspace")
  end

  local registry = require("plugins.sidekick.registry")
  local entry = registry.discover()[label]
  if not entry or entry.pane_id ~= session.herdr_pane_id or entry.workspace_id ~= session.herdr_workspace_id then
    fail("live registry discovery mismatch: " .. vim.inspect(entry))
  end
  local local_items = require("plugins.sidekick.cwd_picker").list_items()
  local found = false
  for _, item in ipairs(local_items) do
    if item.label == label and item.status == "unknown" then
      found = true
    end
  end
  if not found then
    fail("cwd picker did not expose the live Herdr agent: " .. vim.inspect(local_items))
  end

  local search = require("plugins.sidekick.search")
  local snapshot_dir, snapshot_count = search.snapshot()
  local snapshot_path = snapshot_dir .. "/" .. label .. ".txt"
  local snapshot = vim.fn.filereadable(snapshot_path) == 1 and table.concat(vim.fn.readfile(snapshot_path), "\n") or ""
  search.cleanup()
  if snapshot_count < 1 or not snapshot:gsub("%s", ""):find(sentinel, 1, true) then
    fail("Herdr transcript search snapshot missing sentinel: " .. vim.inspect(snapshot))
  end

  local working = herdr.call({
    "pane",
    "report-agent",
    session.herdr_pane_id,
    "--source",
    "sidekick-verify",
    "--agent",
    "pi",
    "--state",
    "working",
    "--seq",
    "1",
  })
  local working_agent = herdr.get_agent(label)
  if not working or not working_agent or working_agent.agent_status ~= "working" then
    fail("Herdr did not report the live agent as working: " .. vim.inspect(working_agent))
  end

  herdr.call({
    "pane",
    "report-agent",
    session.herdr_pane_id,
    "--source",
    "sidekick-verify",
    "--agent",
    "pi",
    "--state",
    "idle",
    "--seq",
    "2",
  })
  local done = vim.wait(3000, function()
    local agent = herdr.get_agent(label)
    return agent and agent.agent_status == "done"
  end, 50)
  if not done then
    fail("Herdr did not report the unfocused completed agent as done: " .. vim.inspect(herdr.get_agent(label)))
  end

  herdr.read(label, "recent-unwrapped", 120, true)
  local previewed_agent = herdr.get_agent(label)
  if not previewed_agent or previewed_agent.agent_status ~= "done" then
    fail("reading a done agent preview should not mark it seen: " .. vim.inspect(previewed_agent))
  end

  local Terminal = require("sidekick.cli.terminal")
  Terminal.terminals["terminal:live-seen"] = {
    buf = 42,
    parent = session,
  }
  require("plugins.sidekick.herdr_backend").mark_seen(42)
  Terminal.terminals["terminal:live-seen"] = nil
  local seen = vim.wait(3000, function()
    local agent = herdr.get_agent(label)
    return agent and agent.agent_status == "idle"
  end, 50)
  if not seen then
    fail("opening a done agent in Neovim did not mark it seen: " .. vim.inspect(herdr.get_agent(label)))
  end

  if not herdr.close(session.herdr_pane_id) then
    fail("Herdr pane close failed")
  end
  if herdr.get_agent(label) ~= nil then
    fail("closed Herdr agent is still discoverable")
  end
end

local function validate_vault_work_items()
  local root = vim.fn.tempname() .. "-vault-work-items"
  vim.fn.mkdir(root .. "/0_inbox/nested", "p")
  vim.fn.mkdir(root .. "/3_logs/2026-W30", "p")
  vim.fn.mkdir(root .. "/projects", "p")

  vim.fn.writefile({
    "# Inbox",
    "## To process",
    "- [ ] inbox todo",
    "- [-] inbox doing",
    "- [x] inbox done",
  }, root .. "/0_inbox/0.inbox.md")
  vim.fn.writefile({
    "# Backlog",
    "## Log",
    "### Friday, 2026-07-24",
    "* [ ] backlog todo",
    "- [-] backlog doing",
    "- [x] backlog done",
    "- [!] backlog urgent",
    "- [~] backlog deferred",
    "#### Nested context",
    "- [ ] nested backlog todo",
    "### Complete",
    "- [ ] checkbox under a non-date H3",
    "### Friday 2026-07-24",
    "- [ ] checkbox under a malformed date H3",
    "### Thursday, 2026-07-23",
    "- [ ] older backlog todo",
    "## Reading List",
    "- [ ] checkbox outside a dated H3",
  }, root .. "/3_logs/2026-W30/backlog.md")
  vim.fn.writefile({ "- [ ] wrong log file" }, root .. "/3_logs/2026-W30/notes.md")
  vim.fn.writefile({ "- [ ] wrong directory" }, root .. "/projects/project.md")

  local ok, err = xpcall(function()
    local work_items = require("helpers.vault_work_items")
    local items = work_items.collect(root)
    if #items ~= 3 then
      fail("expected three unchecked items under exact date H3 headings; got " .. vim.inspect(items))
    end

    assert_sequence(
      vim.tbl_map(function(item)
        return item.date
      end, items),
      { "2026-07-24", "2026-07-24", "2026-07-23" },
      "backlog item dates"
    )
    if items[1].task ~= "backlog todo" or items[1].pos[1] ~= 4 then
      fail("backlog item should retain task and line context: " .. vim.inspect(items[1]))
    end
    if items[1].day ~= "Friday, 2026-07-24" then
      fail("backlog item should retain its exact dated heading: " .. vim.inspect(items[1]))
    end
    if items[2].task ~= "nested backlog todo" or items[2].pos[1] ~= 10 then
      fail("an H4 should remain nested under its dated H3: " .. vim.inspect(items[2]))
    end
    for _, item in ipairs(items) do
      if item.text ~= string.format("%s │ %s", item.date, item.task) then
        fail("picker text should contain only the inferred date and task: " .. vim.inspect(item))
      end
      if
        item.text:find("wrong ", 1, true)
        or item.text:find("doing", 1, true)
        or item.text:find("done", 1, true)
        or item.text:find("checkbox", 1, true)
        or item.text:find("3_logs/", 1, true)
      then
        fail("excluded item leaked into results: " .. vim.inspect(item))
      end
    end

    local herdr = require("plugins.sidekick.herdr")
    local internal = require("plugins.sidekick.internal")
    local original_workspace_call = herdr.call
    local workspace_calls = {}
    herdr.call = function(args)
      workspace_calls[#workspace_calls + 1] = args
      if args[1] == "workspace" and args[2] == "list" then
        return { workspaces = { { label = "Backlog", workspace_id = "backlog-workspace" } } }
      elseif args[1] == "agent" and args[2] == "start" then
        return {
          agent = {
            name = "pi-friday-2026-07-24",
            pane_id = "backlog-agent",
            tab_id = "backlog-tab",
            terminal_id = "backlog-terminal",
            workspace_id = "backlog-workspace",
            cwd = root,
            foreground_cwd = root,
          },
        }
      elseif args[1] == "tab" and args[2] == "list" then
        return {
          tabs = {
            { tab_id = "backlog-tab", workspace_id = "backlog-workspace", pane_count = 1 },
          },
        }
      elseif args[1] == "tab" and args[2] == "rename" then
        return {}
      end
    end
    local workspace_ok, workspace_err = xpcall(function()
      local agent = herdr.start("pi-friday-2026-07-24", root, { "pi" }, {}, "backlog")
      if not agent or agent.workspace_id ~= "backlog-workspace" then
        fail("named workspace start should use the matching backlog workspace")
      end
      assert_sequence(workspace_calls[1], { "workspace", "list" }, "backlog workspace lookup")
      if
        workspace_calls[2][1] ~= "agent"
        or workspace_calls[2][2] ~= "start"
        or workspace_calls[2][7] ~= "backlog-workspace"
      then
        fail("daily agent should start in the backlog workspace: " .. vim.inspect(workspace_calls[2]))
      end
      if
        workspace_calls[3][1] ~= "tab"
        or workspace_calls[3][2] ~= "list"
        or workspace_calls[4][1] ~= "tab"
        or workspace_calls[4][2] ~= "rename"
        or workspace_calls[4][3] ~= "backlog-tab"
      then
        fail("daily agent should keep its own named tab: " .. vim.inspect(workspace_calls))
      end
    end, debug.traceback)
    herdr.call = original_workspace_call
    if not workspace_ok then
      fail(workspace_err)
    end

    local original_get_agent = herdr.get_agent
    local original_start = herdr.start
    local original_call = herdr.call
    local original_send = herdr.send
    local started
    local renamed
    local sent
    herdr.get_agent = function()
      return nil
    end
    herdr.start = function(name, cwd, command, env, workspace_label)
      started = {
        name = name,
        cwd = cwd,
        command = command,
        env = env,
        workspace_label = workspace_label,
      }
      return { name = name, tab_id = "backlog-tab" }
    end
    herdr.call = function(args)
      renamed = args
      return {}
    end
    herdr.send = function(target, text)
      sent = { target = target, text = text }
      return true
    end

    local agent_ok, agent_err = xpcall(function()
      if not work_items.send_to_backlog_agent(items[1], root) then
        fail("dated backlog item should be sent to its daily agent")
      end
      if
        not started
        or started.name ~= "pi-friday-2026-07-24"
        or started.cwd ~= root
        or started.workspace_label ~= "backlog"
        or started.env[internal.named_env_var] ~= "friday-2026-07-24"
      then
        fail("daily backlog agent start arguments are wrong: " .. vim.inspect(started))
      end
      assert_sequence(started.command, { "pi", "--name", "friday-2026-07-24" }, "daily backlog agent command")
      assert_sequence(
        renamed,
        { "tab", "rename", "backlog-tab", "Friday, 2026-07-24" },
        "daily backlog tab title"
      )
      if
        not sent
        or sent.target ~= "pi-friday-2026-07-24"
        or sent.text ~= root .. "/3_logs/2026-W30/backlog.md:4"
      then
        fail("daily backlog agent should receive the exact source link: " .. vim.inspect(sent))
      end

      started = nil
      renamed = nil
      herdr.get_agent = function(name)
        return { name = name, tab_id = "backlog-tab" }
      end
      if not work_items.send_to_backlog_agent(items[1], root) or started or renamed then
        fail("a second item from the same day should reuse its existing agent")
      end
    end, debug.traceback)

    herdr.get_agent = original_get_agent
    herdr.start = original_start
    herdr.call = original_call
    herdr.send = original_send
    if not agent_ok then
      fail(agent_err)
    end

    local lazy = require("lazy")
    local registry = require("plugins.sidekick.registry")
    local last_session = require("plugins.sidekick.last_session")
    local original_lazy_load = lazy.load
    local original_rehydrate = registry.rehydrate
    local original_record = last_session.record
    local original_toggle = internal.toggle_tool_session
    local activation_events = {}
    lazy.load = function()
      activation_events[#activation_events + 1] = "load"
    end
    registry.rehydrate = function()
      activation_events[#activation_events + 1] = "rehydrate"
    end
    last_session.record = function(name, terminal_id)
      activation_events[#activation_events + 1] = "record:" .. name .. ":" .. terminal_id
    end
    internal.toggle_tool_session = function(name, focus, terminal_id)
      activation_events[#activation_events + 1] =
        string.format("toggle:%s:%s:%s", name, tostring(focus), terminal_id)
    end
    local activation_ok, activation_err = xpcall(function()
      work_items.activate_backlog_agent({
        name = "pi-friday-2026-07-24",
        terminal_id = "backlog-terminal",
      })
      assert_sequence(activation_events, {
        "load",
        "rehydrate",
        "record:pi-friday-2026-07-24:backlog-terminal",
        "toggle:pi-friday-2026-07-24:true:backlog-terminal",
      }, "daily backlog agent activation")
    end, debug.traceback)
    lazy.load = original_lazy_load
    registry.rehydrate = original_rehydrate
    last_session.record = original_record
    internal.toggle_tool_session = original_toggle
    if not activation_ok then
      fail(activation_err)
    end

    local render_markdown = load_plugin("render-markdown.nvim")
    assert_key_desc(render_markdown, "<leader>vt", "unchecked backlog")

    local callback = key_callback(render_markdown, "<leader>vt")
    if not callback then
      fail("<leader>vt callback missing")
    end

    local original_collect = work_items.collect
    local original_send_to_agent = work_items.send_to_backlog_agent
    local original_activate_agent = work_items.activate_backlog_agent
    local original_pick = Snacks.picker.pick
    local picker_opts
    local action_item
    local action_events = {}
    work_items.collect = function()
      return items
    end
    work_items.send_to_backlog_agent = function(item)
      action_item = item
      action_events[#action_events + 1] = "send"
      return { name = "pi-friday-2026-07-24", terminal_id = "backlog-terminal" }
    end
    work_items.activate_backlog_agent = function()
      action_events[#action_events + 1] = "activate"
    end
    Snacks.picker.pick = function(opts)
      picker_opts = opts
    end
    local callback_ok, callback_err = xpcall(callback, debug.traceback)
    if callback_ok and picker_opts and picker_opts.actions and picker_opts.actions.backlog_agent then
      picker_opts.actions.backlog_agent({
        close = function()
          action_events[#action_events + 1] = "close"
        end,
      }, items[1])
    end
    work_items.collect = original_collect
    work_items.send_to_backlog_agent = original_send_to_agent
    work_items.activate_backlog_agent = original_activate_agent
    Snacks.picker.pick = original_pick
    if not callback_ok then
      fail(callback_err)
    end
    if
      not picker_opts
      or picker_opts.source ~= "unchecked-backlog-items"
      or picker_opts.title ~= "Unchecked Backlog Items (3)"
      or picker_opts.format ~= "text"
      or picker_opts.preview ~= "file"
    then
      fail("unchecked backlog picker options are wrong: " .. vim.inspect(picker_opts))
    end
    if
      picker_opts.win.input.keys["<c-a>"][1] ~= "backlog_agent"
      or picker_opts.win.list.keys["<c-a>"] ~= "backlog_agent"
      or action_item ~= items[1]
    then
      fail("vault picker <C-a> should send the selected item to its backlog agent")
    end
    assert_sequence(action_events, { "send", "close", "activate" }, "vault picker backlog agent action")
  end, debug.traceback)

  vim.fn.delete(root, "rf")
  if not ok then
    fail(err)
  end
end

local function validate_inline_ask_edit()
  local fixture = "testdata/neovim-workflows/inline-ask-edit/sample.lua"
  local original_lines = vim.fn.readfile(fixture)
  local original_system = vim.system
  local original_lsp_hover = vim.lsp.buf_request_sync
  local original_package_path = package.path
  local ask_modules = {
    "plugins.sidekick.ask",
    "plugins.sidekick.ask.cli",
    "plugins.sidekick.ask.context",
    "plugins.sidekick.ask.diff",
    "plugins.sidekick.ask.signs",
    "plugins.sidekick.ask.state",
    "plugins.sidekick.ask.ui",
  }
  local original_modules = {}
  for _, name in ipairs(ask_modules) do
    original_modules[name] = package.loaded[name] or false
  end

  local function assert_equal(actual, expected, label)
    if not vim.deep_equal(actual, expected) then
      fail(label .. " mismatch: got " .. vim.inspect(actual) .. ", expected " .. vim.inspect(expected))
    end
  end

  local function assert_contains(value, needle, label)
    if not value or not value:find(needle, 1, true) then
      fail(label .. " should contain " .. vim.inspect(needle) .. "; got " .. vim.inspect(value))
    end
  end

  local ok, err = xpcall(function()
    local config_lua = vim.fn.getcwd() .. "/nvim/.config/nvim/lua"
    package.path = config_lua .. "/?.lua;" .. config_lua .. "/?/init.lua;" .. package.path
    for _, name in ipairs(ask_modules) do
      package.loaded[name] = nil
    end

    local real_cli = require("plugins.sidekick.ask.cli")
    local system_call
    local cli_result
    vim.system = function(cmd, opts, on_exit)
      system_call = { cmd = vim.deepcopy(cmd), opts = vim.deepcopy(opts) }
      vim.fn.writefile({ "controlled answer" }, cmd[10])
      on_exit({ code = 0, stdout = "", stderr = "" })
      return { kill = function() end }
    end
    real_cli.spawn("controlled prompt", function(result) cli_result = result end, { mode = "ask" })
    if not vim.wait(1000, function() return cli_result ~= nil end, 10) then
      fail("Codex adapter callback did not run")
    end
    vim.system = original_system

    assert_sequence(system_call.cmd, {
      "codex",
      "--model",
      "gpt-5.3-codex-spark",
      "--sandbox",
      "read-only",
      "-a",
      "never",
      "exec",
      "--output-last-message",
      system_call.cmd[10],
      "controlled prompt",
    }, "inline ask/edit Codex command")
    if system_call.cmd[10] == "" then
      fail("Codex adapter output path should not be empty")
    end
    assert_equal(system_call.opts, { cwd = vim.fn.getcwd(), text = true }, "Codex adapter options")
    assert_equal(cli_result.result, "controlled answer", "Codex adapter result")

    local prompts = {}
    local cli_calls = {}
    local diff_clears = 0
    local ui = {
      open_prompt = function(opts) prompts[#prompts + 1] = opts end,
      clear_diff_inline = function() diff_clears = diff_clears + 1 end,
      close_hover = function() end,
      open_hover = function() end,
      render_diff_inline = function() end,
    }
    local cli = {
      spawn = function(prompt, on_done, opts)
        cli_calls[#cli_calls + 1] = { prompt = prompt, on_done = on_done, opts = opts }
        return { kill = function() end }
      end,
    }
    package.loaded["plugins.sidekick.ask"] = nil
    package.loaded["plugins.sidekick.ask.ui"] = ui
    package.loaded["plugins.sidekick.ask.cli"] = cli

    load_plugin("nvim-treesitter-textobjects")
    local ask = require("plugins.sidekick.ask")
    local context = require("plugins.sidekick.ask.context")
    local signs = require("plugins.sidekick.ask.signs")
    local state = require("plugins.sidekick.ask.state")

    vim.lsp.buf_request_sync = function()
      return { { result = { contents = { value = "mocked LSP hover" } } } }
    end

    vim.cmd.edit(vim.fn.fnameescape(fixture))
    local bufnr = vim.api.nvim_get_current_buf()
    vim.bo[bufnr].filetype = "lua"

    local function reset_buffer()
      signs.stop_spinner()
      state.cleanup_all()
      vim.api.nvim_buf_clear_namespace(bufnr, signs.ns, 0, -1)
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, original_lines)
      vim.bo[bufnr].modified = false
      vim.api.nvim_win_set_cursor(0, { 1, 0 })
    end

    local function only_entry(label)
      local found_id
      local found_entry
      local count = 0
      for id, entry in pairs(state.entries(bufnr)) do
        count = count + 1
        found_id = id
        found_entry = entry
      end
      if count ~= 1 then
        fail(label .. " should have one state entry; got " .. tostring(count))
      end
      return found_id, found_entry
    end

    local spinner = {
      ["⠋"] = true,
      ["⠙"] = true,
      ["⠹"] = true,
      ["⠸"] = true,
      ["⠼"] = true,
      ["⠴"] = true,
      ["⠦"] = true,
      ["⠧"] = true,
      ["⠇"] = true,
      ["⠏"] = true,
    }

    local function extmark_details(id, label)
      local mark = vim.api.nvim_buf_get_extmark_by_id(bufnr, signs.ns, id, { details = true })
      if not mark or not mark[1] or not mark[3] then
        fail(label .. " extmark missing")
      end
      return mark[3]
    end

    local function assert_anchor(entry, mode, status, label)
      local details = extmark_details(entry.extmark_id, label)
      local text = (details.sign_text or ""):gsub("%s+$", "")
      local expected_hl = mode == "ask" and "SidekickAskSign" or "SidekickEditSign"
      if status == "pending" then
        if not spinner[text] then
          fail(label .. " should use a spinner; got " .. vim.inspect(text))
        end
      else
        assert_equal(text, mode == "ask" and "?" or "±", label .. " completed sign")
      end
      assert_equal(details.sign_hl_group, expected_hl, label .. " sign highlight")
    end

    local function assert_range(entry, mode, expected_count, label)
      assert_equal(#(entry.range_extmarks or {}), expected_count, label .. " range mark count")
      local expected_hl = mode == "ask" and "SidekickAskRange" or "SidekickEditRange"
      for _, id in ipairs(entry.range_extmarks or {}) do
        local details = extmark_details(id, label .. " range")
        assert_equal((details.sign_text or ""):gsub("%s+$", ""), "│", label .. " range sign")
        assert_equal(details.sign_hl_group, expected_hl, label .. " range highlight")
      end
    end

    local function assert_cleared(label)
      if next(state.entries(bufnr)) ~= nil then
        fail(label .. " should clear state")
      end
      local marks = vim.api.nvim_buf_get_extmarks(bufnr, signs.ns, 0, -1, {})
      assert_equal(marks, {}, label .. " extmarks")
    end

    local function submit(mode, text)
      local prompt = prompts[#prompts]
      if not prompt then
        fail(mode .. " prompt did not open")
      end
      assert_equal(prompt.mode, mode, mode .. " prompt mode")
      assert_equal(prompt.title, mode, mode .. " prompt title")
      prompt.on_submit(text)
      local call = cli_calls[#cli_calls]
      if not call then
        fail(mode .. " did not invoke Codex adapter")
      end
      return call
    end

    reset_buffer()
    vim.api.nvim_win_set_cursor(0, { 2, 8 })
    local normal_ask_context = context.build({ mode = "normal", bufnr = bufnr })
    assert_equal(normal_ask_context.scope_kind, "function", "normal ask scope")
    assert_equal(normal_ask_context.start_line, 0, "normal ask start line")
    assert_equal(normal_ask_context.end_line, 3, "normal ask end line")
    assert_equal(normal_ask_context.code, table.concat(vim.list_slice(original_lines, 1, 4), "\n"), "normal ask code")
    assert_sequence(vim.tbl_map(function(symbol) return symbol.name end, normal_ask_context.symbols), {
      "greeting",
      "name",
      "message",
    }, "normal ask symbols")
    for _, symbol in ipairs(normal_ask_context.symbols) do
      assert_equal(symbol.hover, "mocked LSP hover", "normal ask symbol hover")
    end

    local ask_question = "What string does this function return when called with `Neovim`?"
    ask.ask()
    local normal_ask_call = submit("ask", ask_question)
    assert_equal(
      normal_ask_call.prompt,
      context.render_prompt(ask_question, normal_ask_context),
      "normal ask generated prompt"
    )
    assert_equal(normal_ask_call.opts, { mode = "ask" }, "normal ask adapter options")
    local _, normal_ask_entry = only_entry("normal ask pending")
    assert_equal(normal_ask_entry.status, "pending", "normal ask pending status")
    assert_anchor(normal_ask_entry, "ask", "pending", "normal ask")
    assert_range(normal_ask_entry, "ask", 0, "normal ask")
    normal_ask_call.on_done({
      ok = true,
      result = "The function returns Hello, Neovim.",
      duration_ms = 10,
      tokens = { input = 1, output = 2 },
    })
    signs.stop_spinner()
    assert_equal(normal_ask_entry.status, "done", "normal ask completed status")
    assert_anchor(normal_ask_entry, "ask", "done", "normal ask")
    ask.yank_line()
    assert_equal(vim.fn.getreg("+"), "The function returns Hello, Neovim.", "normal ask yank")
    ask.clear_line()
    assert_cleared("normal ask clear")

    reset_buffer()
    vim.cmd("normal! 2GVj")
    ask.ask()
    local visual_ask_question = "Explain this selection."
    local visual_ask_call = submit("ask", visual_ask_question)
    local visual_ask_context = context.build({
      mode = "visual",
      bufnr = bufnr,
      range = { start_line = 1, end_line = 2 },
    })
    assert_equal(visual_ask_context.scope_kind, "selection", "visual ask scope")
    assert_equal(
      visual_ask_context.code,
      '  local message = "Hello, " .. name\n  return message',
      "visual ask code"
    )
    assert_equal(
      visual_ask_call.prompt,
      context.render_prompt(visual_ask_question, visual_ask_context),
      "visual ask generated prompt"
    )
    local _, visual_ask_entry = only_entry("visual ask pending")
    assert_equal(visual_ask_entry.kind, "range", "visual ask entry kind")
    assert_anchor(visual_ask_entry, "ask", "pending", "visual ask")
    assert_range(visual_ask_entry, "ask", 1, "visual ask")
    visual_ask_call.on_done({
      ok = true,
      result = "The selection builds and returns a greeting.",
      duration_ms = 10,
      tokens = { input = 1, output = 2 },
    })
    signs.stop_spinner()
    assert_anchor(visual_ask_entry, "ask", "done", "visual ask")
    ask.clear_line()
    assert_cleared("visual ask clear")

    local relative_fixture = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(bufnr), ":.")
    reset_buffer()
    vim.api.nvim_win_set_cursor(0, { 2, 8 })
    ask.edit()
    local normal_edit_call = submit("edit", "Rename the local variable.")
    local normal_edit_context = context.build({ mode = "normal", bufnr = bufnr })
    assert_equal(
      normal_edit_call.prompt,
      context.render_edit_prompt("Rename the local variable.", normal_edit_context, relative_fixture),
      "normal edit generated prompt"
    )
    assert_contains(normal_edit_call.prompt, "lines to edit: 1-4  (4 lines", "normal edit line bounds")
    local _, normal_edit_entry = only_entry("normal edit pending")
    assert_equal(normal_edit_entry.status, "pending", "normal edit pending status")
    assert_anchor(normal_edit_entry, "edit", "pending", "normal edit")
    assert_range(normal_edit_entry, "edit", 3, "normal edit")
    normal_edit_call.on_done({
      ok = true,
      result = table.concat({
        "--- a/" .. relative_fixture,
        "+++ b/" .. relative_fixture,
        "@@ -1,4 +1,4 @@",
        "-local function greeting(name)",
        '-  local message = "Hello, " .. name',
        "-  return message",
        "-end",
        "+local function greeting(name)",
        '+  local greeting = "Hello, " .. name',
        "+  return greeting",
        "+end",
      }, "\n"),
      duration_ms = 10,
      tokens = { input = 1, output = 2 },
    })
    signs.stop_spinner()
    assert_equal(normal_edit_entry.status, "done", "normal edit completed status")
    assert_sequence(normal_edit_entry.added, {
      "local function greeting(name)",
      '  local greeting = "Hello, " .. name',
      "  return greeting",
      "end",
    }, "normal edit parsed diff")
    assert_anchor(normal_edit_entry, "edit", "done", "normal edit")
    local clears_before_apply = diff_clears
    ask.apply_line()
    assert_equal(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false), {
      "local function greeting(name)",
      '  local greeting = "Hello, " .. name',
      "  return greeting",
      "end",
      "",
      'return greeting("Neovim")',
    }, "normal edit applied buffer")
    if diff_clears <= clears_before_apply then
      fail("normal edit apply should clear the diff preview")
    end
    assert_cleared("normal edit apply")

    reset_buffer()
    local before_reject = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
    vim.cmd("normal! 2GVj")
    ask.edit()
    local visual_edit_instruction = "Rename the local variable `message` to `greeting` without changing behavior."
    local visual_edit_call = submit("edit", visual_edit_instruction)
    local visual_edit_context = context.build({
      mode = "visual",
      bufnr = bufnr,
      range = { start_line = 1, end_line = 2 },
    })
    assert_equal(
      visual_edit_call.prompt,
      context.render_edit_prompt(visual_edit_instruction, visual_edit_context, relative_fixture),
      "visual edit generated prompt"
    )
    assert_contains(visual_edit_call.prompt, "lines to edit: 2-3  (2 lines", "visual edit line bounds")
    assert_contains(
      visual_edit_call.prompt,
      ' 2 │  local message = "Hello, " .. name\n 3 │  return message',
      "visual edit numbered selection"
    )
    if visual_edit_call.prompt:find("local function greeting", 1, true) then
      fail("visual edit should not include the surrounding function")
    end
    local _, visual_edit_entry = only_entry("visual edit pending")
    assert_equal(visual_edit_entry.kind, "range", "visual edit entry kind")
    assert_anchor(visual_edit_entry, "edit", "pending", "visual edit")
    assert_range(visual_edit_entry, "edit", 1, "visual edit")
    visual_edit_call.on_done({
      ok = true,
      result = table.concat({
        "--- a/" .. relative_fixture,
        "+++ b/" .. relative_fixture,
        "@@ -2,2 +2,2 @@",
        '-  local message = "Hello, " .. name',
        "-  return message",
        '+  local greeting = "Hello, " .. name',
        "+  return greeting",
      }, "\n"),
      duration_ms = 10,
      tokens = { input = 1, output = 2 },
    })
    signs.stop_spinner()
    assert_sequence(visual_edit_entry.added, {
      '  local greeting = "Hello, " .. name',
      "  return greeting",
    }, "visual edit parsed diff")
    assert_anchor(visual_edit_entry, "edit", "done", "visual edit")
    ask.reject_line()
    assert_equal(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false), before_reject, "visual edit rejected buffer")
    assert_cleared("visual edit reject")

    assert_equal(vim.fn.readfile(fixture), original_lines, "tracked inline ask/edit fixture")
    reset_buffer()
  end, debug.traceback)

  vim.system = original_system
  vim.lsp.buf_request_sync = original_lsp_hover
  package.path = original_package_path
  for _, name in ipairs(ask_modules) do
    package.loaded[name] = original_modules[name] or nil
  end

  if not ok then
    fail(err)
  end
end

local function validate_vault_features()
  local root = vim.fn.tempname() .. "-vault-features"
  local neovim = root .. "/1_projects/neovim"
  local pi = root .. "/1_projects/pi-agent"
  local notes = neovim .. "/themes/notetaking-support"
  local agents = pi .. "/themes/pi-customization"
  local vault_feature = notes .. "/features/vault-feature-picker"
  local weekly_feature = notes .. "/features/weekly-backlog-helpers"
  local onboarding_feature = agents .. "/features/user-onboarding"
  vim.fn.mkdir(vault_feature .. "/tasks", "p")
  vim.fn.mkdir(weekly_feature, "p")
  vim.fn.mkdir(notes .. "/features/completed-feature", "p")
  vim.fn.mkdir(notes .. "/features/invalid-feature", "p")
  vim.fn.mkdir(onboarding_feature, "p")
  vim.fn.mkdir(agents .. "/features/maintained-feature", "p")

  local neovim_repository = root .. "/repos/neovim"
  local pi_repository = root .. "/repos/pi-agent"
  vim.fn.writefile({
    "---",
    "repository: " .. neovim_repository,
    "---",
    "",
    "# Neovim",
  }, neovim .. "/README.md")
  vim.fn.writefile({ "# Notetaking Support" }, notes .. "/theme.md")
  vim.fn.writefile({
    "---",
    "repository: " .. pi_repository,
    "---",
    "",
    "# Pi Agent",
  }, pi .. "/README.md")
  vim.fn.writefile({ "# Pi Customization" }, agents .. "/theme.md")
  vim.fn.writefile({
    "---",
    "status: pending-work",
    "---",
    "",
    "# Vault Feature Picker",
    "",
    "## Tasks",
    "",
    "- [-] [[tasks/01-build-tree|T01 Build tree picker.]]",
  }, vault_feature .. "/feature.md")
  vim.fn.writefile({
    "---",
    "status: in-progress",
    "---",
    "",
    "# T01: Build Tree Picker",
  }, vault_feature .. "/tasks/01-build-tree.md")
  vim.fn.writefile({
    "---",
    "status: in-progress",
    "---",
    "",
    "# Weekly Backlog Helpers",
    "",
    "## Tasks",
    "",
    "- [x] T01 Finish canonical paths.",
    "- [ ] T02 Verify date navigation.",
  }, weekly_feature .. "/feature.md")
  vim.fn.writefile({
    "---",
    "status: done",
    "---",
    "",
    "# Completed Feature",
  }, notes .. "/features/completed-feature/feature.md")
  vim.fn.writefile({
    "---",
    "status: active",
    "---",
    "",
    "# Invalid Feature",
  }, notes .. "/features/invalid-feature/feature.md")
  vim.fn.writefile({
    "---",
    "status: in-progress",
    "---",
    "",
    "# User Onboarding",
    "",
    "## Tasks",
    "",
    "- [ ] T01 Complete onboarding.",
  }, onboarding_feature .. "/feature.md")
  vim.fn.writefile({
    "---",
    "status: maintained",
    "---",
    "",
    "# Maintained Feature",
  }, agents .. "/features/maintained-feature/feature.md")

  local original_features = package.loaded["helpers.vault_features"]
  local features = dofile("nvim/.config/nvim/lua/helpers/vault_features.lua")
  package.loaded["helpers.vault_features"] = features
  local ok, err = xpcall(function()
    local items = features.collect(root)
    if #items ~= 10 then
      fail("expected project, theme, active feature, and task tree rows; got " .. vim.inspect(items))
    end
    assert_sequence(
      vim.tbl_map(function(item)
        return item.kind
      end, items),
      { "project", "theme", "feature", "task", "feature", "task", "project", "theme", "feature", "task" },
      "vault feature tree row kinds"
    )
    assert_sequence(
      vim.tbl_map(function(item)
        return item.label
      end, items),
      {
        "Neovim",
        "Notetaking Support",
        "Weekly Backlog Helpers",
        "T02 Verify date navigation.",
        "Vault Feature Picker",
        "T01 Build tree picker.",
        "Pi Agent",
        "Pi Customization",
        "User Onboarding",
        "T01 Complete onboarding.",
      },
      "vault feature tree labels"
    )
    if
      items[3].status ~= "in-progress"
      or items[5].status ~= "pending-work"
      or items[3].parent ~= items[2]
      or items[2].parent ~= items[1]
      or not items[1].parent.root
    then
      fail("active features should be status-ordered under retained hierarchy parents: " .. vim.inspect(items))
    end

    local linked_task = items[6]
    if
      linked_task.file ~= vault_feature .. "/tasks/01-build-tree.md"
      or linked_task.pos[1] ~= 5
      or linked_task.parent ~= items[5]
      or linked_task.repository ~= neovim_repository
      or linked_task.state ~= "-"
      or linked_task.linked ~= true
    then
      fail("linked task should resolve its task note, source heading, repository, and feature parent")
    end
    local inline_task = items[4]
    if
      inline_task.file ~= weekly_feature .. "/feature.md"
      or inline_task.pos[1] ~= 10
      or inline_task.linked ~= false
    then
      fail("inline task should retain its exact feature checklist location: " .. vim.inspect(items[4]))
    end

    local Matcher = require("snacks.picker.core.matcher")
    local matcher = Matcher.new({ keep_parents = true, sort = false })
    matcher:init("build tree")
    local retained = {}
    local matched = matcher:update({
      list = {
        add = function(_, item)
          retained[#retained + 1] = item.kind
        end,
      },
      opts = { matcher = { sort_empty = false } },
    }, linked_task)
    if not matched then
      fail("task fuzzy query should match its task row")
    end
    assert_sequence(retained, { "feature", "theme", "project" }, "fuzzy task parent retention")

    local herdr = require("plugins.sidekick.herdr")
    local internal = require("plugins.sidekick.internal")
    local original_get_agent = herdr.get_agent
    local original_start = herdr.start
    local original_run = herdr.run
    local original_ensure_feature_scope = herdr.ensure_feature_scope
    local original_ensure_task_scope = herdr.ensure_task_scope
    local original_place_agent = herdr.place_agent
    local started
    local ran
    local routed
    local placed
    herdr.get_agent = function()
      return nil
    end
    herdr.ensure_feature_scope = function(repository, workspace_label, feature_branch)
      routed = {
        repository = repository,
        workspace_label = workspace_label,
        feature_branch = feature_branch,
      }
      return { workspace_id = "w-feature", cwd = neovim_repository .. "/feature-worktree" }
    end
    herdr.ensure_task_scope = function(repository, workspace_label, feature_branch, task_branch)
      routed = {
        repository = repository,
        workspace_label = workspace_label,
        feature_branch = feature_branch,
        task_branch = task_branch,
      }
      return { workspace_id = "w-task", cwd = neovim_repository .. "/task-worktree" }
    end
    herdr.start = function(name, cwd, command, env, scope, tab_label)
      started = {
        name = name,
        cwd = cwd,
        command = command,
        env = env,
        scope = scope,
        tab_label = tab_label,
      }
      return { name = name, pane_id = "feature-pane", terminal_id = "feature-terminal" }
    end
    herdr.place_agent = function(agent, scope, tab_label)
      placed = { agent = agent, scope = scope, tab_label = tab_label }
      return agent
    end
    herdr.run = function(pane_id, text)
      ran = { pane_id = pane_id, text = text }
      return true
    end

    local agent_ok, agent_err = xpcall(function()
      local linked_prompt = "$vault-hunter " .. vault_feature .. "/tasks/01-build-tree.md:5"
      if features.agent_prompt(linked_task) ~= linked_prompt then
        fail("linked task Vault Hunter prompt is wrong: " .. vim.inspect(features.agent_prompt(linked_task)))
      end
      if not features.send_to_agent(linked_task) then
        fail("linked feature task should be sent to its project agent")
      end
      if
        not started
        or started.name ~= "pi-neovim-vault-feature-picker-t01"
        or started.cwd ~= neovim_repository .. "/task-worktree"
        or started.scope.workspace_id ~= "w-task"
        or started.tab_label ~= "T01 Build tree picker."
        or started.env[internal.named_env_var] ~= "neovim-vault-feature-picker-t01"
      then
        fail("feature task agent start arguments are wrong: " .. vim.inspect(started))
      end
      if
        not routed
        or routed.repository ~= neovim_repository
        or routed.workspace_label ~= "T01 Build tree picker."
        or routed.feature_branch ~= "feature/vault-feature-picker"
        or routed.task_branch ~= "task/01-build-tree"
      then
        fail("linked task workspace/worktree routing arguments are wrong: " .. vim.inspect(routed))
      end
      assert_sequence(
        started.command,
        { "pi", "--name", "neovim-vault-feature-picker-t01", linked_prompt },
        "feature task agent command"
      )
      if ran then
        fail("a new Pi agent should receive its prompt as a launch argument")
      end

      started = nil
      placed = nil
      herdr.get_agent = function(name)
        return {
          name = name,
          pane_id = "feature-pane",
          terminal_id = "feature-terminal",
          workspace_id = "w-old",
        }
      end
      if not features.send_to_agent(linked_task) or started then
        fail("the same feature task should reuse its existing named agent")
      end
      if
        not placed
        or placed.scope.workspace_id ~= "w-task"
        or placed.tab_label ~= "T01 Build tree picker."
      then
        fail("reused feature task agent should move into its named task tab: " .. vim.inspect(placed))
      end
      if not ran or ran.pane_id ~= "feature-pane" or ran.text ~= linked_prompt then
        fail("reused linked feature task agent should atomically run its direct-work prompt: " .. vim.inspect(ran))
      end

      started = nil
      ran = nil
      routed = nil
      placed = nil
      herdr.get_agent = function()
        return nil
      end
      local inline_prompt = "$vault-hunter " .. weekly_feature .. "/feature.md:10"
      if not features.send_to_agent(inline_task) then
        fail("inline feature task should start a project agent")
      end
      if
        not started
        or started.name ~= "pi-neovim-weekly-backlog-helpers-t02"
        or started.cwd ~= neovim_repository .. "/task-worktree"
        or started.scope.workspace_id ~= "w-task"
        or started.tab_label ~= "T02 Verify date navigation."
        or started.env[internal.named_env_var] ~= "neovim-weekly-backlog-helpers-t02"
      then
        fail("inline feature task agent start arguments are wrong: " .. vim.inspect(started))
      end
      if
        not routed
        or routed.workspace_label ~= "T02 Verify date navigation."
        or routed.feature_branch ~= "feature/weekly-backlog-helpers"
        or routed.task_branch ~= "task/weekly-backlog-helpers-t02"
      then
        fail("inline task workspace/worktree routing arguments are wrong: " .. vim.inspect(routed))
      end
      assert_sequence(
        started.command,
        { "pi", "--name", "neovim-weekly-backlog-helpers-t02", inline_prompt },
        "inline feature task agent command"
      )
      if ran then
        fail("a new inline Pi agent should receive vault-hunter as a launch argument")
      end

      started = nil
      ran = nil
      routed = nil
      placed = nil
      herdr.get_agent = function()
        return nil
      end
      local feature_item = items[5]
      local feature_prompt = "$vault-hunter " .. vault_feature .. "/feature.md:5"
      if not features.send_to_agent(feature_item) then
        fail("feature row should start a Vault Hunter agent")
      end
      if
        not started
        or started.name ~= "pi-neovim-vault-feature-picker"
        or started.cwd ~= neovim_repository .. "/feature-worktree"
        or started.scope.workspace_id ~= "w-feature"
        or started.tab_label ~= "Vault Feature Picker"
        or started.env[internal.named_env_var] ~= "neovim-vault-feature-picker"
      then
        fail("feature Vault Hunter agent start arguments are wrong: " .. vim.inspect(started))
      end
      if
        not routed
        or routed.repository ~= neovim_repository
        or routed.workspace_label ~= "Neovim · Vault Feature Picker"
        or routed.feature_branch ~= "feature/vault-feature-picker"
      then
        fail("feature Vault Hunter action should reuse its feature workspace and worktree")
      end
      assert_sequence(
        started.command,
        { "pi", "--name", "neovim-vault-feature-picker", feature_prompt },
        "feature Vault Hunter command"
      )
    end, debug.traceback)
    herdr.get_agent = original_get_agent
    herdr.start = original_start
    herdr.run = original_run
    herdr.ensure_feature_scope = original_ensure_feature_scope
    herdr.ensure_task_scope = original_ensure_task_scope
    herdr.place_agent = original_place_agent
    if not agent_ok then
      fail(agent_err)
    end

    local lazy = require("lazy")
    local registry = require("plugins.sidekick.registry")
    local last_session = require("plugins.sidekick.last_session")
    local original_lazy_load = lazy.load
    local original_rehydrate = registry.rehydrate
    local original_record = last_session.record
    local original_toggle = internal.toggle_tool_session
    local activation_events = {}
    lazy.load = function()
      activation_events[#activation_events + 1] = "load"
    end
    registry.rehydrate = function()
      activation_events[#activation_events + 1] = "rehydrate"
    end
    last_session.record = function(name, terminal_id)
      activation_events[#activation_events + 1] = "record:" .. name .. ":" .. terminal_id
    end
    internal.toggle_tool_session = function(name, focus, terminal_id)
      activation_events[#activation_events + 1] =
        string.format("toggle:%s:%s:%s", name, tostring(focus), terminal_id)
    end
    local activation_ok, activation_err = xpcall(function()
      features.activate_agent({
        name = "pi-neovim-vault-feature-picker-t01",
        terminal_id = "feature-terminal",
      })
      assert_sequence(activation_events, {
        "load",
        "rehydrate",
        "record:pi-neovim-vault-feature-picker-t01:feature-terminal",
        "toggle:pi-neovim-vault-feature-picker-t01:true:feature-terminal",
      }, "feature task agent activation")
    end, debug.traceback)
    lazy.load = original_lazy_load
    registry.rehydrate = original_rehydrate
    last_session.record = original_record
    internal.toggle_tool_session = original_toggle
    if not activation_ok then
      fail(activation_err)
    end

    local render_markdown = load_plugin("render-markdown.nvim")
    assert_key_desc(render_markdown, "<leader>vf", "active vault features")
    local callback = key_callback(render_markdown, "<leader>vf")
    if not callback then
      fail("<leader>vf callback missing")
    end

    local original_collect = features.collect
    local original_send_to_agent = features.send_to_agent
    local original_activate_agent = features.activate_agent
    local original_pick = Snacks.picker.pick
    local picker_opts
    local action_item
    local action_events = {}
    features.collect = function()
      return items
    end
    features.send_to_agent = function(item)
      action_item = item
      action_events[#action_events + 1] = "send"
      return { name = "pi-neovim-vault-feature-picker-t01", terminal_id = "feature-terminal" }
    end
    features.activate_agent = function()
      action_events[#action_events + 1] = "activate"
    end
    Snacks.picker.pick = function(opts)
      picker_opts = opts
    end
    local callback_ok, callback_err = xpcall(features.open, debug.traceback)
    if callback_ok and picker_opts and picker_opts.actions and picker_opts.actions.vault_hunter then
      picker_opts.actions.vault_hunter.action({
        close = function()
          action_events[#action_events + 1] = "close"
        end,
      }, items[5])
    end
    features.collect = original_collect
    features.send_to_agent = original_send_to_agent
    features.activate_agent = original_activate_agent
    Snacks.picker.pick = original_pick
    if not callback_ok then
      fail(callback_err)
    end
    if
      not picker_opts
      or picker_opts.source ~= "active-vault-features"
      or picker_opts.title ~= "Active Vault Feature Tree (3)"
      or picker_opts.format ~= features.format
      or picker_opts.preview ~= "file"
      or picker_opts.matcher.keep_parents ~= true
      or picker_opts.sort.fields[1] ~= "idx"
      or picker_opts.layout.preset ~= "telescope"
      or picker_opts.layout.reverse ~= false
      or picker_opts.confirm ~= nil
    then
      fail("active vault feature picker options are wrong: " .. vim.inspect(picker_opts))
    end
    if
      picker_opts.win.input.keys["<c-a>"][1] ~= "vault_hunter"
      or picker_opts.win.list.keys["<c-a>"] ~= "vault_hunter"
      or picker_opts.actions.vault_hunter.desc ~= "(Vault hunter) Action"
      or action_item ~= items[5]
    then
      fail("vault feature picker <C-a> should expose (Vault hunter) Action for the selected feature or task")
    end
    assert_sequence(action_events, { "send", "close", "activate" }, "vault feature picker agent action")
  end, debug.traceback)

  vim.fn.delete(root, "rf")
  package.loaded["helpers.vault_features"] = original_features
  if not ok then
    fail(err)
  end
end

local function validate_markdown_formatting()
  load_plugin("vim-pencil")
  load_plugin("conform.nvim")
  load_plugin("nvim-lint")

  local buf = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_name(buf, vim.fn.tempname() .. ".md")
  vim.cmd("setfiletype markdown")

  if vim.bo[buf].textwidth ~= 0 then
    fail("markdown should leave hard wrapping to Conform; got textwidth=" .. vim.bo[buf].textwidth)
  end
  if vim.bo[buf].formatexpr ~= "v:lua.require'conform'.formatexpr()" then
    fail("markdown gq should use Conform; got formatexpr=" .. vim.inspect(vim.bo[buf].formatexpr))
  end
  if not vim.wo.wrap then
    fail("markdown should use soft display wrapping")
  end
  if vim.b[buf].pencil_wrap_mode ~= 2 then
    fail("markdown should use PencilSoft; got pencil_wrap_mode=" .. vim.inspect(vim.b[buf].pencil_wrap_mode))
  end

  local conform = require("conform")
  local formatter_names = vim.tbl_map(function(formatter)
    return formatter.name
  end, conform.list_formatters(buf))
  assert_sequence(formatter_names, { "prettier", "markdownlint-cli2" }, "markdown formatter chain")

  local tick = string.char(96)
  local within_limit = vim.trim(string.rep("word ", 21))
  local long_code = "command " .. string.rep("argument ", 16)
  local long_heading = "## " .. vim.trim(string.rep("heading ", 18))
  local long_table = "| " .. vim.trim(string.rep("column content ", 10)) .. " |"
  local long_url = "https://example.com/" .. string.rep("path-segment/", 12)
  local lines = {
    "# Alignment fixture",
    "",
    "1. Store the paths here:",
    "",
    "   " .. tick .. tick .. tick .. "text",
    "   <feature>/issues/<effort>/map.md",
    "   <feature>/issues/<effort>/01-<decision>.md",
    "   " .. tick .. tick .. tick,
    "",
    "2. Continue the ordered list.",
    "",
    within_limit,
    "",
    "This ordinary prose paragraph contains enough repeated words to exceed the configured width and should be wrapped cleanly by Prettier before Markdownlint checks it.",
    "",
    "Read the [long documentation link](" .. long_url .. ") before continuing with the remaining prose.",
    "",
    long_heading,
    "",
    tick .. tick .. tick .. "sh",
    long_code,
    tick .. tick .. tick,
    "",
    long_table,
  }
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  conform.format({ bufnr = buf, async = false, timeout_ms = 10000 })
  local formatted = vim.api.nvim_buf_get_lines(buf, 0, -1, false)

  if vim.fn.index(formatted, "   " .. tick .. tick .. tick .. "text") < 0 then
    fail("Markdown formatters should preserve an indented fenced block inside a list: " .. vim.inspect(formatted))
  end
  if vim.fn.index(formatted, within_limit) < 0 then
    fail("Markdown formatters should preserve prose between 80 and 120 characters: " .. vim.inspect(formatted))
  end
  local link_line
  for _, line in ipairs(formatted) do
    if line:find("[long documentation link]", 1, true) then
      link_line = line
      break
    end
  end
  if
    not link_line
    or not link_line:find("Read the [long documentation link]", 1, true)
    or not link_line:find("before continuing", 1, true)
  then
    fail("long link destination should not force a prose break: " .. vim.inspect(formatted))
  end
  conform.format({ bufnr = buf, async = false, timeout_ms = 10000 })
  local formatted_again = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  if not vim.deep_equal(formatted, formatted_again) then
    fail("Markdown formatter chain should be idempotent: " .. vim.inspect(formatted_again))
  end

  local linter = require("lint").linters["markdownlint-cli2"]
  assert_sequence(
    linter.args,
    { "--config", vim.fn.expand("~/.markdownlint-cli2.yaml"), "-" },
    "markdownlint arguments"
  )
  local lint = vim.system(
    vim.list_extend({ vim.fn.exepath(linter.cmd) }, linter.args),
    { stdin = table.concat(formatted, "\n") .. "\n", text = true }
  ):wait()
  if lint.code ~= 0 then
    fail("formatted Markdown should pass Markdownlint:\n" .. (lint.stderr or "") .. (lint.stdout or ""))
  end
  local short_visible = vim.system(
    vim.list_extend({ vim.fn.exepath(linter.cmd) }, linter.args),
    { stdin = "Read the [guide](" .. long_url .. ") next.\n", text = true }
  ):wait()
  if short_visible.code ~= 0 then
    fail("a long link destination should not count toward line length:\n" .. (short_visible.stderr or ""))
  end
  local long_visible = vim.system(
    vim.list_extend({ vim.fn.exepath(linter.cmd) }, linter.args),
    { stdin = vim.trim(string.rep("visible words ", 12)) .. "\n", text = true }
  ):wait()
  if long_visible.code == 0 or not (long_visible.stderr or ""):find("AV001", 1, true) then
    fail("overlong visible prose should report AV001:\n" .. (long_visible.stderr or ""))
  end

  vim.api.nvim_buf_delete(buf, { force = true })
end

local function validate_markdown_ansi()
  local config_lua = vim.fn.getcwd() .. "/nvim/.config/nvim/lua"
  package.path = config_lua .. "/?.lua;" .. config_lua .. "/?/init.lua;" .. package.path
  package.loaded["helpers.markdown_ansi"] = nil

  local ansi = require("helpers.markdown_ansi")
  ansi.setup()
  local esc = "\27"
  local lines = {
    "```ansi",
    esc .. "[1;38;2;146;131;116mtruecolor",
    "carried " .. esc .. "[0mplain",
    esc .. "[91;44mclassic" .. esc .. "[39;49m defaults",
    esc .. "[38;5;196;48;5;17mindexed " .. esc .. "[2munsupported",
    "```",
    "```text",
    esc .. "[31mnot ansi" .. esc .. "[0m",
    "```",
  }

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = "markdown"
  local parser = vim.treesitter.get_parser(buf, "markdown")
  local marks = ansi.parse({ buf = buf, root = parser:parse()[1]:root(), last = true })

  local concealed = 0
  local highlighted = {}
  for _, mark in ipairs(marks) do
    if mark.conceal ~= false then
      fail("ANSI marks must remain rendered under the cursor and in visual mode")
    end
    if mark.opts.conceal == "" then
      concealed = concealed + 1
    elseif mark.opts.hl_group then
      highlighted[#highlighted + 1] = {
        row = mark.start_row,
        start_col = mark.start_col,
        end_col = mark.opts.end_col,
        group = mark.opts.hl_group,
        attrs = vim.api.nvim_get_hl(0, { name = mark.opts.hl_group, link = false }),
      }
    end
  end

  if concealed ~= 5 then
    fail("expected five supported SGR sequences to be concealed, got " .. concealed)
  end
  if not vim.deep_equal(vim.api.nvim_buf_get_lines(buf, 0, -1, false), lines) then
    fail("ANSI rendering must not alter the Markdown source bytes")
  end
  vim.api.nvim_win_set_buf(0, buf)
  vim.api.nvim_win_set_cursor(0, { 2, 0 })
  vim.cmd("normal! yy")
  if vim.fn.getreg('"') ~= lines[2] .. "\n" then
    fail("linewise yank should copy the complete underlying ANSI bytes")
  end

  local function has_highlight(row, predicate)
    for _, item in ipairs(highlighted) do
      if item.row == row and predicate(item) then
        return true
      end
    end
    return false
  end

  if
    not has_highlight(1, function(item)
      return item.attrs.bold and item.attrs.fg == 0x928374
    end)
  then
    fail("truecolor foreground and bold should render")
  end
  if
    not has_highlight(2, function(item)
      return item.start_col == 0 and item.attrs.bold and item.attrs.fg == 0x928374
    end)
  then
    fail("SGR style should carry across lines until reset")
  end
  if
    not has_highlight(3, function(item)
      local fg = tonumber(vim.g.terminal_color_9:sub(2), 16)
      local bg = tonumber(vim.g.terminal_color_4:sub(2), 16)
      return item.attrs.fg == fg and item.attrs.bg == bg
    end)
  then
    fail("classic 16-color foreground and background should render")
  end
  local classic_group
  for _, item in ipairs(highlighted) do
    if item.row == 3 then
      classic_group = item.group
      break
    end
  end
  local original_red = vim.g.terminal_color_9
  vim.g.terminal_color_9 = "#123456"
  vim.api.nvim_exec_autocmds("ColorScheme", { pattern = "verify-markdown-ansi" })
  local reloaded = vim.api.nvim_get_hl(0, { name = classic_group, link = false })
  vim.g.terminal_color_9 = original_red
  vim.api.nvim_exec_autocmds("ColorScheme", { pattern = "verify-markdown-ansi" })
  if reloaded.fg ~= 0x123456 then
    fail("classic ANSI colors should refresh from the active terminal palette")
  end
  if
    not has_highlight(4, function(item)
      return item.attrs.fg == 0xff0000 and item.attrs.bg == 0x00005f
    end)
  then
    fail("indexed 256-color foreground and background should render")
  end

  local unsupported = lines[5]:find(esc .. "[2m", 1, true) - 1
  for _, mark in ipairs(marks) do
    if mark.start_row == 4 and mark.opts.conceal == "" and mark.start_col == unsupported then
      fail("unsupported SGR should remain visible")
    end
    if mark.start_row == 7 then
      fail("ANSI outside an ansi fence should not render")
    end
  end

  local specs = dofile("nvim/.config/nvim/lua/plugins/markdown.lua")
  local configured = false
  for _, spec in ipairs(specs) do
    if spec[1] == "MeanderingProgrammer/render-markdown.nvim" then
      configured = spec.opts.custom_handlers.markdown.extends
        and spec.opts.custom_handlers.markdown.parse == ansi.parse
        and spec.opts.render_modes == true
    end
  end
  if not configured then
    fail("render-markdown should install the ANSI handler in every mode")
  end

  vim.api.nvim_buf_delete(buf, { force = true })
end

local cases = {
  ["agent-keymaps"] = validate_agent_keymaps,
  ["weekly-backlog"] = validate_weekly_backlog,
  ["markdown-formatting"] = validate_markdown_formatting,
  ["markdown-ansi"] = validate_markdown_ansi,
  ["inline-ask-edit"] = validate_inline_ask_edit,
  ["sidekick-pi"] = validate_sidekick_pi,
  ["sidekick-herdr"] = validate_sidekick_herdr,
  ["herdr-workspaces"] = validate_herdr_workspaces,
  ["sidekick-herdr-live"] = validate_sidekick_herdr_live,
  ["vault-features"] = validate_vault_features,
  ["vault-work-items"] = validate_vault_work_items,
}

local fn = cases[case]
if not fn then
  fail(
    "unknown VERIFY_NVIM_CASE "
      .. vim.inspect(case)
      .. "; expected one of: agent-keymaps, weekly-backlog, markdown-formatting, markdown-ansi, inline-ask-edit, sidekick-pi, sidekick-herdr, herdr-workspaces, sidekick-herdr-live, vault-features, vault-work-items"
  )
end

local ok, err = xpcall(fn, debug.traceback)
if not ok then
  io.stderr:write(err .. "\n")
  vim.cmd("cquit 1")
  return
end
print("PASS verify-nvim " .. case)
