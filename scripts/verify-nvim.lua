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
      {
        name = "pi-review",
        agent = "pi",
        agent_status = "blocked",
        foreground_cwd = cwd,
        pane_id = "w1:p2",
        terminal_id = "term-named",
        workspace_id = "w1",
      },
    }
  end

  local registry = require("plugins.sidekick.registry")
  local discovered = registry.discover()
  if discovered["sk-codex-deadbeef"] then
    fail("base Herdr sessions must not appear as named sessions")
  end
  local entry = discovered["pi-review"]
  if not entry or entry.tool ~= "pi" or entry.status ~= "blocked" then
    fail("named Herdr session discovery mismatch: " .. vim.inspect(discovered))
  end
  if entry.cwd ~= cwd or entry.pane_id ~= "w1:p2" or entry.workspace_id ~= "w1" then
    fail("named Herdr session identifiers mismatch: " .. vim.inspect(entry))
  end

  local local_items = require("plugins.sidekick.cwd_picker").list_items()
  if #local_items ~= 1 or local_items[1].label ~= "pi-review" or local_items[1].status ~= "blocked" then
    fail("cwd picker should expose Herdr status: " .. vim.inspect(local_items))
  end
  local global_items = require("plugins.sidekick.picker").list_items()
  if #global_items ~= 1 or global_items[1].label ~= "pi-review" or global_items[1].status ~= "blocked" then
    fail("global picker should expose Herdr status: " .. vim.inspect(global_items))
  end

  local starship = require("plugins.sidekick.starship")
  if starship.cwd_for_terminal({ cwd = cwd }) ~= cwd then
    fail("Sidekick starship should use the terminal cwd with Herdr")
  end
  if starship.cwd_for_terminal({ session = { parent = { cwd = cwd } } }) ~= cwd then
    fail("Sidekick starship should fall back to the Herdr parent session cwd")
  end

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
  if not session.herdr_pane_id or not session.herdr_workspace_id then
    fail("started Herdr session missing pane/workspace identifiers: " .. vim.inspect(session))
  end

  session:send(sentinel)
  session:submit()
  local herdr = require("plugins.sidekick.herdr")
  local echoed = vim.wait(3000, function()
    return (herdr.read(label, "recent", 50) or ""):find("ECHO:" .. sentinel, 1, true) ~= nil
  end, 50)
  if not echoed then
    fail("Herdr send/submit output missing sentinel; dump=" .. vim.inspect(session:dump()))
  end
  local dump = session:dump() or ""
  if not dump:find("ECHO:" .. sentinel, 1, true) then
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
  if snapshot_count < 1 or not snapshot:find(sentinel, 1, true) then
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
  local settled_agent = herdr.get_agent(label)
  if not settled_agent or (settled_agent.agent_status ~= "idle" and settled_agent.agent_status ~= "done") then
    fail("Herdr did not settle the live agent after working: " .. vim.inspect(settled_agent))
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
