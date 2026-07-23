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
    "<c-;>",
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

  assert_key_desc(sidekick, "<leader>ai", "Pi")
  assert_key_desc(sidekick, "<leader>ag", "Codex")
  assert_key_desc(sidekick, "<leader>al", "Local")
  assert_key_desc(sidekick, "<leader>aL", "Global")
  assert_key_desc(sidekick, "<c-.>", "cwd sessions")
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

  local original_list_agents = herdr.list_agents
  local function named_agent(name, status, index)
    return {
      name = name,
      agent = "pi",
      agent_status = status,
      foreground_cwd = cwd,
      pane_id = "w1:p" .. index,
      terminal_id = "term-" .. index,
      workspace_id = "w1",
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

  local cwd_picker = require("plugins.sidekick.cwd_picker")
  local local_items = cwd_picker.list_items()
  local ordered_statuses = {}
  for _, item in ipairs(local_items) do
    ordered_statuses[#ordered_statuses + 1] = item.status
  end
  assert_sequence(ordered_statuses, { "blocked", "done", "working", "idle" }, "cwd picker Herdr status order")

  local global_items = require("plugins.sidekick.picker").list_items()
  local global_blocked
  for _, item in ipairs(global_items) do
    if item.label == "pi-blocked" then
      global_blocked = item
      break
    end
  end
  if not global_blocked or global_blocked.status ~= "blocked" then
    fail("global picker should expose Herdr status: " .. vim.inspect(global_items))
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
  internal.toggle_tool_session = function(name, focus)
    toggles[#toggles + 1] = { name = name, focus = focus }
  end

  local picker_ok, picker_err = xpcall(function()
    cwd_picker.open()
    if not picker_opts then
      fail("cwd picker did not open Snacks picker")
    end
    local layout = picker_opts.layout.layout
    if layout.box ~= "vertical"
      or layout[1].win ~= "preview"
      or layout[2].win ~= "list"
      or layout[2].height ~= 5
      or layout[3].win ~= "input"
      or layout[3].height ~= 1
    then
      fail("cwd picker should give the preview the full picker width above the compact session list")
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
  end, debug.traceback)

  Snacks.picker.pick = original_pick
  Snacks.util.spinner = original_spinner
  herdr.read = original_read
  internal.toggle_tool_session = original_toggle
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
  assert_sequence(attach.cmd, { "herdr", "agent", "attach", label }, "Herdr attach command")
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
  local echoed = vim.wait(3000, function()
    return (herdr.read(label, "recent-unwrapped", 50) or ""):find("ECHO:" .. sentinel, 1, true) ~= nil
  end, 50)
  if not echoed then
    fail("Herdr send/submit output missing sentinel; dump=" .. vim.inspect(session:dump()))
  end
  local dump = session:dump() or ""
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
  ["sidekick-herdr-live"] = validate_sidekick_herdr_live,
}

local fn = cases[case]
if not fn then
  fail(
    "unknown VERIFY_NVIM_CASE "
      .. vim.inspect(case)
      .. "; expected one of: agent-keymaps, sidekick-pi, sidekick-herdr, sidekick-herdr-live"
  )
end

local ok, err = xpcall(fn, debug.traceback)
if not ok then
  io.stderr:write(err .. "\n")
  vim.cmd("cquit 1")
  return
end
print("PASS verify-nvim " .. case)
