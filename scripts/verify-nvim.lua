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

local function validate_sidekick_pi_tmux()
  load_plugin("sidekick.nvim")

  if vim.fn.executable("tmux") ~= 1 then
    fail("tmux is required for sidekick-pi-tmux")
  end

  local label = os.getenv("VERIFY_NVIM_TMUX_LABEL") or ""
  local branch = os.getenv("VERIFY_NVIM_TMUX_BRANCH") or ""
  local sentinel = os.getenv("VERIFY_NVIM_TMUX_SENTINEL") or ""
  if label == "" or branch == "" or sentinel == "" then
    fail("sidekick-pi-tmux requires VERIFY_NVIM_TMUX_LABEL, VERIFY_NVIM_TMUX_BRANCH, and VERIFY_NVIM_TMUX_SENTINEL")
  end

  local registry = require("plugins.sidekick.registry")
  registry.rehydrate()
  local discovered = registry.discover()
  local entry = discovered[label]
  if not entry then
    fail("tmux Pi session not discovered for label " .. label .. "; discovered=" .. vim.inspect(discovered))
  end
  if entry.tool ~= "pi" then
    fail("expected discovered tool pi; got " .. vim.inspect(entry))
  end
  if not entry.pane_id or entry.pane_id == "" then
    fail("discovered Pi session missing pane_id: " .. vim.inspect(entry))
  end
  if not entry.session_id or entry.session_id == "" then
    fail("discovered Pi session missing session_id: " .. vim.inspect(entry))
  end

  local config = require("sidekick.config")
  if not config.cli.tools[label] then
    fail("registry.rehydrate did not register dynamic tool " .. label)
  end

  local cwd_items = require("plugins.sidekick.cwd_picker").list_items()
  local found_local = false
  for _, item in ipairs(cwd_items) do
    if item.label == label then
      found_local = true
      break
    end
  end
  if not found_local then
    fail("cwd_picker.list_items did not include " .. label .. "; items=" .. vim.inspect(cwd_items))
  end

  local read_branch = require("plugins.sidekick.branch").read_session(entry.session_id)
  if read_branch ~= branch then
    fail("SIDEKICK_BRANCH mismatch: got " .. vim.inspect(read_branch) .. ", expected " .. vim.inspect(branch))
  end

  local dir, count = require("plugins.sidekick.search").snapshot()
  if count < 1 then
    fail("search.snapshot captured no panes")
  end
  local path = dir .. "/" .. label .. ".txt"
  if vim.fn.filereadable(path) ~= 1 then
    fail("search snapshot file missing: " .. path)
  end
  local content = table.concat(vim.fn.readfile(path), "\n")
  if not content:find(sentinel, 1, true) then
    fail("search snapshot for " .. label .. " missing sentinel " .. sentinel)
  end
  require("plugins.sidekick.search").cleanup()
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
  herdr.list_agents = original_list_agents
end

local cases = {
  ["agent-keymaps"] = validate_agent_keymaps,
  ["sidekick-pi"] = validate_sidekick_pi,
  ["sidekick-pi-tmux"] = validate_sidekick_pi_tmux,
  ["sidekick-herdr"] = validate_sidekick_herdr,
}

local fn = cases[case]
if not fn then
  fail("unknown VERIFY_NVIM_CASE " .. vim.inspect(case) .. "; expected one of: agent-keymaps, sidekick-pi, sidekick-herdr")
end

local ok, err = xpcall(fn, debug.traceback)
if not ok then
  io.stderr:write(err .. "\n")
  vim.cmd("cquit 1")
  return
end
print("PASS verify-nvim " .. case)
