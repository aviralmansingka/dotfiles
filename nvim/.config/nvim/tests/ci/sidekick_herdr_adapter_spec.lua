-- sidekick/herdr.lua adapter contract + herdr_backend init (CI row X11,
-- #127/#118/#160):
--   * M.send uses `agent prompt`; M.read returns raw stdout; send_key/run
--     use the pane verbs — argv recorded through a vim.system stub.
--   * the agent-start busy-retry loop is bounded (fake uv clock, no sleeps).
--   * herdr_backend init sets native_scroll and derives its identity
--     idempotently.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

H.run("sidekick_herdr_adapter_spec", function()
  local notify_calls = {}
  local restore_notify = H.replace(vim, "notify", function(msg, level)
    notify_calls[#notify_calls + 1] = msg
  end)

  local herdr = require("plugins.sidekick.herdr")

  -- ── spec-wide spawn boundary ─────────────────────────────────────────────
  -- EVERY vim.system call in this spec must hit a fake, never a real binary.
  -- A spec-level default fake catches branches the per-section stubs do not
  -- cover: backend.sessions() -> Herdr.list_agents() reached the REAL
  -- vim.system on the CI runner (herdr absent: ENOENT) while passing on a
  -- host with herdr on PATH. Restored to the real vim.system at the very end.
  local real_system = vim.system
  local default_calls = {}
  local function default_system(cmd, opts, callback)
    default_calls[#default_calls + 1] = cmd
    local result = { code = 0, stdout = '{"result":{"type":"ok"}}', stderr = "" }
    if callback then
      callback(result)
      return {}
    end
    return {
      wait = function()
        return result
      end,
    }
  end
  vim.system = default_system

  -- ── argv contract with a recording vim.system stub ──────────────────────
  -- H.replace below saves the default fake, so restore_system() falls back
  -- to the spec-wide boundary, never to the real vim.system.
  local system_calls = {}
  local canned = {}
  local restore_system = H.replace(vim, "system", function(cmd, opts, callback)
    local key = table.concat(cmd, " ")
    local result = canned[key] or { code = 0, stdout = '{"result":{"type":"ok"}}', stderr = "" }
    system_calls[#system_calls + 1] = { cmd = cmd, opts = opts, result = result }
    if callback then
      callback(result) -- async consumers (read_async) get their result now
      return {}
    end
    return { wait = function()
      return result
    end }
  end)

  H.eq(herdr.send("pi-example", "hello world"), true, "agent prompt reports success")
  H.eq(system_calls[#system_calls].cmd,
    { "herdr", "agent", "prompt", "pi-example", "hello world" },
    "M.send uses the agent prompt verb")

  canned["herdr agent prompt pi-example hello world"] = { code = 1, stdout = "", stderr = "boom" }
  H.eq(herdr.send("pi-example", "hello world"), false, "a failing prompt reports failure")
  H.truthy(notify_calls[#notify_calls]:find("boom", 1, true) ~= nil, "the error text surfaces via notify")

  H.eq(herdr.send_key("w1:p2", "Enter"), true, "send_key reports success")
  H.eq(system_calls[#system_calls].cmd, { "herdr", "pane", "send-keys", "w1:p2", "Enter" },
    "M.send_key uses the pane send-keys verb")

  H.eq(herdr.run("w1:p2", "make test"), true, "run reports success")
  H.eq(system_calls[#system_calls].cmd, { "herdr", "pane", "run", "w1:p2", "make test" },
    "M.run uses the pane run verb")

  H.eq(herdr.focus("pi-example"), true, "focus reports success")
  H.eq(system_calls[#system_calls].cmd, { "herdr", "agent", "focus", "pi-example" },
    "M.focus uses the agent focus verb")
  H.eq(herdr.close("w1:p9"), true, "close reports success")
  H.eq(system_calls[#system_calls].cmd, { "herdr", "pane", "close", "w1:p9" },
    "M.close uses the pane close verb")

  -- M.read: raw stdout passthrough, flags exactly as documented.
  local raw = "\27[32mHerdr 0.8 terminal output\27[0m\n"
  canned["herdr agent read pi-example --source visible --lines 12 --ansi"] =
    { code = 0, stdout = raw, stderr = "" }
  H.eq(herdr.read("pi-example", "visible", 12, true), raw,
    "M.read returns raw terminal output, never JSON-decoded")
  H.eq(system_calls[#system_calls].cmd,
    { "herdr", "agent", "read", "pi-example", "--source", "visible", "--lines", "12", "--ansi" },
    "M.read passes source, lines, and ansi flags in order")
  canned["herdr agent read pi-example --source recent"] = { code = 0, stdout = raw, stderr = "" }
  H.eq(herdr.read("pi-example", "recent", nil, false), raw, "read without lines/ansi omits the flags")
  H.eq(system_calls[#system_calls].cmd,
    { "herdr", "agent", "read", "pi-example", "--source", "recent" }, "read flag omission is exact")

  -- read_async: the result is deferred through vim.schedule; a 10 ms
  -- :sleep pumps the loop once — no vim.wait polling.
  local async_out
  canned["herdr agent read pi-example --source recent --lines 6"] =
    { code = 0, stdout = raw, stderr = "" }
  herdr.read_async("pi-example", "recent", 6, false, function(output)
    async_out = output
  end)
  vim.cmd("sleep 10m")
  H.eq(async_out, raw, "read_async hands raw stdout to the callback")
  H.eq(system_calls[#system_calls].cmd,
    { "herdr", "agent", "read", "pi-example", "--source", "recent", "--lines", "6" },
    "read_async passes the same flags as read")

  -- M.call decode failures.
  canned["herdr agent get ghost"] = { code = 1, stdout = "", stderr = '{"error":{"code":"agent_not_found"}}' }
  H.eq(herdr.get_agent("ghost"), nil, "agent_not_found resolves to nil, not an error")
  canned["herdr workspace list"] = { code = 0, stdout = "not json", stderr = "" }
  H.eq(herdr.call({ "workspace", "list" }, true), nil, "invalid JSON returns nil")
  canned["herdr workspace list"] = { code = 0, stdout = "", stderr = "" }
  H.eq(herdr.call({ "workspace", "list" }, true), {}, "empty stdout decodes to an empty table")

  -- Pure helpers.
  H.eq(herdr.normalize_cwd("/a/b/"), "/a/b", "normalize_cwd strips the trailing slash")
  H.eq(herdr.normalize_cwd(""), "", "normalize_cwd of empty stays empty")
  H.eq(herdr.agent_name("pi-review", "/anywhere"), "pi-review",
    "a named tool keeps its label as the agent name")
  local base = herdr.agent_name("codex", "/worktrees/feature-one")
  H.truthy(base:match("^sk%-codex%-%x+$") ~= nil and #base <= 32,
    "a base session name is sk-codex-<hash> and fits Herdr's limit")

  local durable = {
    { { agent = "codex", name = "sk-codex-deadbeef" }, true, "sk-codex names are durable" },
    { { agent = "pi", name = "pi-friday-2026-07-24" }, true, "pi-prefixed names are durable" },
    { { agent = "pi", name = "review-child" }, false, "unprefixed names are not durable" },
    { { agent = "shell", name = "sk-shell-1" }, false, "unknown agent kinds are never durable" },
    { nil, false, "nil agents are never durable" },
  }
  for _, case in ipairs(durable) do
    H.eq(herdr.is_durable_agent(case[1]), case[2], case[3])
  end

  restore_system()

  -- ── busy-retry is bounded (#127): fake uv clock, zero real sleeps ──────
  local tmp = vim.fn.tempname() .. "-herdr-start"
  vim.fn.mkdir(tmp, "p")
  local start_attempts = 0
  local sleep_calls = {}
  local real_uv = vim.uv
  local fake_now = 0
  vim.uv = setmetatable({
    sleep = function(ms)
      sleep_calls[#sleep_calls + 1] = ms
      fake_now = fake_now + ms * 1e6
    end,
    hrtime = function()
      return fake_now
    end,
  }, { __index = real_uv })
  restore_system = H.replace(vim, "system", function(cmd, opts)
    system_calls[#system_calls + 1] = { cmd = cmd, opts = opts }
    if cmd[1] == "git" then
      return { wait = function()
        return { code = 1, stdout = "", stderr = "" }
      end }
    end
    if cmd[2] == "agent" and cmd[3] == "list" then
      return { wait = function()
        return { code = 0, stdout = '{"result":{"agents":[]}}', stderr = "" }
      end }
    end
    if cmd[2] == "pane" and cmd[3] == "list" then
      return { wait = function()
        return { code = 0, stdout = '{"result":{"panes":[]}}', stderr = "" }
      end }
    end
    if cmd[2] == "workspace" and cmd[3] == "create" then
      return { wait = function()
        return {
          code = 0,
          stdout = '{"result":{"workspace":{"workspace_id":"w-busy"},"root_pane":{"pane_id":"w-busy:p0","tab_id":"w-busy:t0"}}}',
          stderr = "",
        }
      end }
    end
    if cmd[2] == "agent" and cmd[3] == "start" then
      start_attempts = start_attempts + 1
      return { wait = function()
        return { code = 1, stdout = "", stderr = "herdr: agent_pane_busy: pane not ready" }
      end }
    end
    return { wait = function()
      return { code = 0, stdout = '{"result":{"type":"ok"}}', stderr = "" }
    end }
  end)

  local wall_start = os.clock()
  system_calls = {} -- isolate the busy-retry scenario's herdr traffic
  local agent = herdr.start("pi-busy", tmp, { "pi" })
  local wall = os.clock() - wall_start
  H.eq(agent, nil, "a pane that never becomes ready fails the start")
  H.eq(start_attempts, 51, "busy-retry polls the 10 s readiness window: first attempt + 50 x 200 ms")
  H.eq(#sleep_calls, 50, "the loop sleeps exactly 50 times")
  local slept = 0
  for _, ms in ipairs(sleep_calls) do
    slept = slept + ms
  end
  H.eq(slept, 10000, "the total fake wait equals the 10 s bound")
  H.truthy(wall < 2, "no real sleeping happened (fake clock)")

  -- cleanup ran: the bootstrap pane and the created workspace were closed
  local closed = {}
  for _, call in ipairs(system_calls) do
    if call.cmd[2] == "pane" and call.cmd[3] == "close" then
      closed[#closed + 1] = call.cmd[4]
    end
  end
  H.eq(closed, { "w-busy:p0" }, "the busy pane is closed on failure")
  local ws_closed = vim.tbl_filter(function(call)
    return call.cmd[2] == "workspace" and call.cmd[3] == "close"
  end, system_calls)
  H.eq(#ws_closed, 1, "the workspace created for the attempt is closed again")
  H.eq(ws_closed[1].cmd[4], "w-busy", "the closed workspace is the one that was created")

  restore_system()
  vim.uv = real_uv

  -- ── herdr_backend init: native scroll + idempotent identity (#118) ─────
  package.loaded["sidekick.config"] = {
    cli = {
      win = { float = { width = 0.8, height = 0.8 } },
      mux = { backend = "herdr", dump = 48 },
    },
    tools = function()
      return {}
    end,
  }
  package.loaded["sidekick.cli.session"] = {
    register = function() end,
    backends = {},
  }
  local backend = require("plugins.sidekick.herdr_backend")
  local session = setmetatable({ tool = { name = "codex" }, cwd = tmp }, backend)
  session:init()
  H.eq(session.tool.native_scroll, true, "init forces native scroll for agent TUIs")
  H.eq(session.external, false, "herdr sessions are not external")
  H.eq(session.priority, 50, "herdr sessions take priority 50")
  local first_name = session.herdr_agent_name
  session:init()
  H.eq(session.herdr_agent_name, first_name, "a second init keeps the same agent name")
  H.eq(session.mux_session, first_name, "the mux session mirrors the agent name")

  -- This call previously leaked to the REAL vim.system (runner ENOENT);
  -- it must now go through the spec-wide default fake.
  default_calls = {}
  local sessions = backend.sessions()
  H.eq(sessions, {}, "no configured tools means no sessions")
  local saw_agent_list = false
  for _, cmd in ipairs(default_calls) do
    if vim.deep_equal(cmd, { "herdr", "agent", "list" }) then
      saw_agent_list = true
    end
  end
  H.truthy(saw_agent_list,
    "backend.sessions() lists agents through the spec-wide fake, never a real herdr")
  for _, cmd in ipairs(default_calls) do
    H.eq(cmd[1], "herdr", "only herdr verbs cross the default fake boundary")
  end

  -- attach/dump/send/submit/is_running argv and passthrough contracts.
  local attach_cmd = session:attach()
  H.eq(attach_cmd, { cmd = { "herdr", "agent", "attach", first_name, "--takeover" } },
    "attach hands Herdr the takeover attach command")

  local saved_send, saved_send_key, saved_read, saved_get = herdr.send, herdr.send_key, herdr.read, herdr.get_agent
  local saved_focus = herdr.focus
  local sent, keyed, dumped
  herdr.send = function(name, text)
    sent = { name, text }
    return true
  end
  herdr.send_key = function(pane_id, key)
    keyed = { pane_id, key }
    return true
  end
  herdr.read = function(name, source, lines, ansi)
    dumped = { name, source, lines, ansi }
    return "raw scrollback"
  end
  herdr.get_agent = function(name)
    return { name = name }
  end
  session:send("do the thing")
  H.eq(sent, { first_name, "do the thing" }, "backend send forwards to agent prompt")
  session.herdr_pane_id = "w1:p5"
  session:submit()
  H.eq(keyed, { "w1:p5", "enter" }, "backend submit sends Enter to the pane")
  H.eq(session:dump(), "raw scrollback", "backend dump returns raw agent read output")
  H.eq(dumped, { first_name, "recent", 48, true }, "dump reads recent lines with ansi")
  H.eq(session:is_running(), true, "a live agent reports running")
  herdr.get_agent = function()
    return nil
  end
  H.eq(session:is_running(), false, "a missing agent reports not running")
  herdr.send, herdr.send_key, herdr.read, herdr.get_agent = saved_send, saved_send_key, saved_read, saved_get

  -- mark_seen: done agents get focused, blocked agents keep attention.
  package.loaded["sidekick.cli.terminal"] = {
    terminals = {
      ["terminal:seen"] = { buf = 42, parent = { herdr_agent_name = "pi-done" } },
      ["terminal:blocked"] = { buf = 43, parent = { herdr_agent_name = "pi-blocked" } },
    },
  }
  local focused = {}
  herdr.get_agent = function(name)
    return { name = name, agent_status = name:find("done", 1, true) and "done" or "blocked" }
  end
  herdr.focus = function(name)
    focused[#focused + 1] = name
    return true
  end
  backend.mark_seen(42)
  H.eq(focused, { "pi-done" }, "opening a done session marks it seen")
  backend.mark_seen(43)
  H.eq(#focused, 1, "opening a blocked session keeps its attention state")

  herdr.send, herdr.send_key, herdr.read = saved_send, saved_send_key, saved_read
  herdr.get_agent, herdr.focus = saved_get, saved_focus

  -- close the spec-wide boundary: the real vim.system comes back only here,
  -- after the last assertion that could cross it.
  vim.system = real_system
  restore_notify()
end)
