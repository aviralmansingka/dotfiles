local case = os.getenv("VERIFY_NVIM_CASE") or "agent-keymaps"

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
    "<leader>ao",
    "<leader>au",
    "<leader>ar",
    "<localleader>e",
  }
  for _, lhs in ipairs(removed) do
    assert_key_absent(sidekick, lhs)
  end

  local claudecode = load_plugin("claudecode.nvim")
  assert_key_absent(claudecode, "<leader>acs")

  local opencode = load_plugin("opencode.nvim")
  assert_key_absent(opencode, "gO")
  assert_key_absent(opencode, "<c-'>")

  local snacks = load_plugin("snacks.nvim")
  assert_key_desc(snacks, "<C-'>", "Herdr")

  assert_key_desc(sidekick, "<leader>ai", "Pi")
  assert_key_desc(sidekick, "<leader>ag", "Codex")
  assert_key_desc(sidekick, "<leader>al", "Local")
  assert_key_desc(sidekick, "<leader>aL", "Global")
  assert_key_desc(sidekick, "<c-.>", "cwd sessions")
  assert_key_desc(sidekick, "<c-;>", "Switch Local")
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

local function validate_sidekick_pi()
  local sidekick = load_plugin("sidekick.nvim")
  local internal = require("plugins.sidekick.internal")

  assert_sequence(internal.primary_agents(), { "pi", "codex" }, "primary_agents")

  local ordered = internal.ordered_agents()
  if ordered[1] ~= "pi" or ordered[2] ~= "codex" then
    fail("ordered_agents should start with pi,codex; got " .. vim.inspect(ordered))
  end

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

  assert_key_desc(sidekick, "<leader>ai", "Primary Workflow")
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

  session_switch.open()
  if current.open or other.open then
    fail("<c-;> should hide every visible Sidekick session before opening the picker")
  end
  session_switch.open()
  if not toggled or toggled.name ~= "pi-current" or toggled.focus ~= true then
    fail("pressing <c-;> again should cancel and restore the previous session: " .. vim.inspect(toggled))
  end

  toggled = nil
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
    if args[1] == "tab" and args[2] == "create" then
      return { tab = { tab_id = "w-bound:t1" }, root_pane = { pane_id = "w-bound:p0" } }
    elseif args[1] == "agent" and args[2] == "start" then
      return {
        agent = {
          terminal_id = "term-workspace",
          pane_id = "w-bound:p1",
          tab_id = "w-bound:t1",
          workspace_id = "w-bound",
        },
      }
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
  local tab_create, agent_start
  for _, call in ipairs(start_calls) do
    if call[1] == "workspace" or (call[1] == "pane" and call[2] == "list") then
      fail("an exact workspace ID should bypass cwd workspace lookup: " .. vim.inspect(start_calls))
    elseif call[1] == "tab" and call[2] == "create" then
      tab_create = call
    elseif call[1] == "agent" and call[2] == "start" then
      agent_start = call
    end
  end
  if not started
    or not tab_create
    or tab_create[4] ~= "w-bound"
    or not agent_start
    or agent_start[7] ~= "w-bound"
  then
    fail("named session should start in its exact bound workspace: " .. vim.inspect(start_calls))
  end

  local original_list_agents = herdr.list_agents
  local function named_agent(name, status, index, workspace_id, agent_cwd)
    return {
      name = name,
      agent = "pi",
      agent_status = status,
      foreground_cwd = agent_cwd or cwd,
      pane_id = "w1:p" .. index,
      terminal_id = "term-" .. index,
      workspace_id = workspace_id or "w1",
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
      named_agent("pi-workspace-only", "idle", 7, "w1", "/private/tmp"),
    }
  end

  local registry = require("plugins.sidekick.registry")
  local discovered = registry.discover()
  if discovered["sk-codex-deadbeef"] then
    fail("base Herdr sessions must not appear as named sessions")
  end
  local entry = discovered["pi-blocked"]
  if not entry or entry.tool ~= "pi" or entry.status ~= "blocked" then
    fail("named Herdr session discovery mismatch: " .. vim.inspect(discovered))
  end
  if entry.cwd ~= cwd or entry.pane_id ~= "w1:p5" or entry.workspace_id ~= "w1" then
    fail("named Herdr session identifiers mismatch: " .. vim.inspect(entry))
  end

  local cwd_picker = dofile(cwd .. "/nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua")
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_id")
  pcall(vim.api.nvim_tabpage_del_var, current_tab, "herdr_workspace_label")
  local local_items = cwd_picker.list_items()
  local unbound_labels = {}
  local ordered_statuses = {}
  for _, item in ipairs(local_items) do
    unbound_labels[item.label] = true
    ordered_statuses[#ordered_statuses + 1] = item.status
  end
  assert_sequence(ordered_statuses, { "working", "blocked", "done", "idle", "idle" }, "cwd picker Herdr status order")
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
  herdr.call = function(args, quiet)
    if args[1] == "workspace" and args[2] == "list" then
      return {
        workspaces = {
          { workspace_id = "w1", label = "Workspace One" },
          { workspace_id = "w2", label = "Workspace Two" },
        },
      }
    end
    return original_herdr_call(args, quiet)
  end
  local global_picker = require("plugins.sidekick.picker")
  local global_items = global_picker.list_items()
  local global_blocked
  local global_other_workspace
  for _, item in ipairs(global_items) do
    if item.label == "pi-blocked" then
      global_blocked = item
    elseif item.label == "pi-other-workspace" then
      global_other_workspace = item
    end
  end
  if not global_blocked or global_blocked.status ~= "blocked" then
    fail("global picker should expose Herdr status: " .. vim.inspect(global_items))
  end
  if not global_other_workspace or global_other_workspace.workspace_label ~= "Workspace Two" then
    fail("global picker should label every session with its workspace: " .. vim.inspect(global_items))
  end

  local original_pick = Snacks.picker.pick
  local original_spinner = Snacks.util.spinner
  local original_read = herdr.read
  local original_toggle = internal.toggle_tool_session
  local picker_opts
  local read_args
  local read_result = "\27[31mfirst logical line\27[0m\r\nsecond logical line"
  local toggles = {}
  Snacks.picker.pick = function(opts)
    picker_opts = opts
  end
  Snacks.util.spinner = function()
    return "S"
  end
  herdr.read = function(target, source, lines, ansi)
    read_args = { target = target, source = source, lines = lines, ansi = ansi }
    return read_result
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
      or layout[3].win ~= "list"
      or layout[3].height ~= 5
      or layout.width ~= math.max(math.floor(vim.o.columns * config.cli.win.float.width), 80) + 2
      or layout.height ~= math.max(math.floor(vim.o.lines * config.cli.win.float.height), 10) + 2
    then
      fail("cwd picker should match the bordered agent float around its preview, input, and compact session list")
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
      if (item.status == "idle" or item.status == "working") and has_status_text then
        fail("idle and working rows should rely on their symbols: " .. vim.inspect(rendered))
      end
      if item.status ~= "idle" and item.status ~= "working" and not has_status_text then
        fail("blocked and done rows should retain their status text: " .. vim.inspect(rendered))
      end
    end

    if type(picker_opts.on_show) ~= "function" or type(picker_opts.on_close) ~= "function" then
      fail("cwd picker should manage a working-session spinner lifecycle")
    end
    local spinner_updates = 0
    local fake_picker = {
      closed = false,
      list = {
        update = function(_, opts)
          if not opts or not opts.force then
            fail("spinner redraw should force the picker list update")
          end
          spinner_updates = spinner_updates + 1
        end,
      },
    }
    picker_opts.on_show(fake_picker)
    if not vim.wait(500, function() return spinner_updates > 0 end, 10) then
      fail("working sessions should animate their spinner")
    end
    picker_opts.on_close(fake_picker)
    local stopped_updates = spinner_updates
    vim.wait(160)
    if spinner_updates ~= stopped_updates then
      fail("closing the cwd picker should stop spinner redraws")
    end

    local done_item
    for _, item in ipairs(picker_opts.items) do
      if item.status == "done" then
        done_item = item
        break
      end
    end
    local buf = vim.api.nvim_create_buf(false, true)
    picker_opts.preview({
      item = done_item,
      preview = { scratch = function() return buf end },
    })
    if not read_args
      or read_args.target ~= "pi-done"
      or read_args.source ~= "recent-unwrapped"
      or read_args.lines ~= 120
      or read_args.ansi ~= true
    then
      fail("cwd picker should request bounded unwrapped ANSI text: " .. vim.inspect(read_args))
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

    read_result = table.concat({
      "\27[32manswer stays\27[0m",
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
    local codex_buf = vim.api.nvim_create_buf(false, true)
    picker_opts.preview({
      item = codex_item,
      preview = { scratch = function() return codex_buf end },
    })
    vim.wait(1000, function()
      return table.concat(vim.api.nvim_buf_get_lines(codex_buf, 0, -1, false), "\n"):find("answer stays", 1, true)
        ~= nil
    end, 10)
    local codex_preview = table.concat(vim.api.nvim_buf_get_lines(codex_buf, 0, -1, false), "\n")
    if codex_preview:find("Find and fix", 1, true) or codex_preview:find("gpt-5 footer", 1, true) then
      fail("Codex preview should scrub its trailing prompt block: " .. vim.inspect(codex_preview))
    end
    if not codex_preview:find("answer stays", 1, true) then
      fail("Codex prompt scrubbing should preserve prior output: " .. vim.inspect(codex_preview))
    end

    local pi_buf = vim.api.nvim_create_buf(false, true)
    picker_opts.preview({
      item = done_item,
      preview = { scratch = function() return pi_buf end },
    })
    vim.wait(1000, function()
      return table.concat(vim.api.nvim_buf_get_lines(pi_buf, 0, -1, false), "\n"):find("Find and fix", 1, true)
        ~= nil
    end, 10)
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
    local pi_scrub_buf = vim.api.nvim_create_buf(false, true)
    picker_opts.preview({
      item = done_item,
      preview = { scratch = function() return pi_scrub_buf end },
    })
    vim.wait(1000, function()
      return table.concat(vim.api.nvim_buf_get_lines(pi_scrub_buf, 0, -1, false), "\n"):find("Pi answer stays", 1, true)
        ~= nil
    end, 10)
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
    local failed_buf = vim.api.nvim_create_buf(false, true)
    picker_opts.preview({
      item = done_item,
      preview = { scratch = function() return failed_buf end },
    })
    local failed_preview = vim.api.nvim_buf_get_lines(failed_buf, 0, -1, false)
    if failed_preview[1] ~= "(agent read failed)" then
      fail("failed Herdr read should leave a readable preview error: " .. vim.inspect(failed_preview))
    end

    local last_session = require("plugins.sidekick.last_session")
    last_session.label = nil
    picker_opts.confirm({ close = function() end }, done_item)
    if #toggles ~= 1 or toggles[1].name ~= "pi-done" or toggles[1].focus ~= true then
      fail("confirm should focus the selected done session exactly once: " .. vim.inspect(toggles))
    end
    if last_session.label ~= "pi-done" then
      fail("confirm should keep the selected session active for <c-.>; got " .. vim.inspect(last_session.label))
    end
    last_session.open()
    if #toggles ~= 2 or toggles[2].name ~= "pi-done" or toggles[2].focus ~= true then
      fail("<c-.> should reopen the session selected with <leader>al: " .. vim.inspect(toggles))
    end

    global_picker.open()
    if picker_opts.title ~= "Sidekick Sessions in All Workspaces" then
      fail("global picker should use the shared session picker UI: " .. vim.inspect(picker_opts.title))
    end
    local remote_item
    for _, item in ipairs(picker_opts.items) do
      if item.label == "pi-other-workspace" then
        remote_item = item
        break
      end
    end
    local rendered = {}
    for _, chunk in ipairs(picker_opts.format(remote_item)) do
      rendered[#rendered + 1] = chunk[1]
    end
    if not table.concat(rendered):find("[Workspace Two]", 1, true) then
      fail("global picker row should show the session workspace in brackets: " .. vim.inspect(rendered))
    end
    local workspaces_module = "plugins.herdr.workspaces"
    local original_workspaces = package.loaded[workspaces_module]
    local focused_workspace
    package.loaded[workspaces_module] = {
      focus = function(workspace_id)
        focused_workspace = workspace_id
        return true
      end,
    }
    vim.api.nvim_tabpage_set_var(current_tab, "herdr_workspace_id", "w1")
    local toggles_before_global = #toggles
    picker_opts.confirm({ close = function() end }, remote_item)
    package.loaded[workspaces_module] = original_workspaces
    if focused_workspace ~= "w2" then
      fail("global picker should transfer to the selected session workspace: " .. vim.inspect(focused_workspace))
    end
    local global_toggle = toggles[toggles_before_global + 1]
    if
      not global_toggle
      or global_toggle.name ~= "pi-other-workspace"
      or global_toggle.terminal_id ~= "term-6"
    then
      fail("global picker should open the exact selected session after transferring: " .. vim.inspect(toggles))
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
  herdr.call = original_herdr_call
  internal.toggle_tool_session = original_toggle
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

local cases = {
  ["agent-keymaps"] = validate_agent_keymaps,
  ["sidekick-pi"] = validate_sidekick_pi,
  ["sidekick-herdr"] = validate_sidekick_herdr,
  ["herdr-workspaces"] = validate_herdr_workspaces,
  ["sidekick-herdr-live"] = validate_sidekick_herdr_live,
}

local fn = cases[case]
if not fn then
  fail(
    "unknown VERIFY_NVIM_CASE "
      .. vim.inspect(case)
      .. "; expected one of: agent-keymaps, sidekick-pi, sidekick-herdr, herdr-workspaces, sidekick-herdr-live"
  )
end

local ok, err = xpcall(fn, debug.traceback)
if not ok then
  io.stderr:write(err .. "\n")
  vim.cmd("cquit 1")
  return
end
print("PASS verify-nvim " .. case)
