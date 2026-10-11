-- herdr/agent_send.lua send sequencing + fallback spec, and the
-- herdr-agent.lua mapping table shape (send cluster).
--
-- The sequencing cases run through the REAL plugins.sidekick.herdr adapter
-- with a vim.system argv recorder, so the exact pane verbs reach the fake
-- process boundary: resolve -> `pane send-text <id> <text>` ->
-- `pane send-keys <id> Enter`, never a cross-tab pane. The no-target path
-- must hand off to opts.fallback and return the fallback's boolean.
--
-- The allow-list and build_payload belong to herdr_agent_send_spec; this
-- case always passes a prebuilt payload and stays off those surfaces.
-- No network, no live herdr.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

H.run("send_orchestration_spec", function()
  local notify_calls, restore_notify = H.capture_notify()

  local saved_pane_env = vim.env.HERDR_PANE_ID
  vim.env.HERDR_PANE_ID = "w37:p2"

  -- ── argv recorder over the real herdr adapter ─────────────────────────
  local argv = {}
  local canned = {}
  local function canned_key(cmd)
    return table.concat(cmd, "\0")
  end
  local restore_system = H.replace(vim, "system", function(cmd, opts, callback)
    local result = canned[canned_key(cmd)]
      or { code = 0, stdout = '{"result":{"type":"ok"}}', stderr = "" }
    argv[#argv + 1] = { cmd = cmd, result = result }
    if callback then
      callback(result)
      return {}
    end
    return { wait = function() return result end }
  end)

  local function pane_list(panes)
    canned[canned_key({ "herdr", "pane", "list" })] = {
      code = 0,
      stdout = vim.json.encode({ result = { panes = panes } }),
      stderr = "",
    }
  end

  local panes = {
    { pane_id = "w37:p2", tab_id = "w37:t2", agent_status = "unknown" }, -- this nvim pane
    { pane_id = "w37:p3", tab_id = "w37:t2", agent_status = "blocked", agent = "pi" },
    { pane_id = "w37:p4", tab_id = "w37:t2", agent_status = "unknown" }, -- bare shell
    { pane_id = "w20:p1", tab_id = "w20:t1", agent_status = "working", agent = "pi" },
  }
  pane_list(panes)

  local agent_send = require("plugins.herdr.agent_send")

  -- ── exact sequencing: send-text then Enter, same tab only ─────────────
  local ok = agent_send.send({ payload = "hello world", label = "sample.lua" })
  H.eq(ok, true, "a pane delivery reports success")
  H.eq(#argv, 3, "exactly one list, one send-text, one send-keys")
  H.eq(argv[1].cmd, { "herdr", "pane", "list" }, "resolution lists panes first")
  H.eq(argv[2].cmd, { "herdr", "pane", "send-text", "w37:p3", "hello world" },
    "the payload goes to the same-tab agent pane (#220: blocked panes stay targets)")
  H.eq(argv[3].cmd, { "herdr", "pane", "send-keys", "w37:p3", "Enter" },
    "Enter is pressed only after the payload text")
  local last_notify = notify_calls[#notify_calls]
  H.truthy(last_notify and last_notify.msg:find("Sent sample%.lua to pi %(w37:p3%)", 1) ~= nil,
    "the success notice names the label, agent, and pane")
  H.eq(last_notify.level, vim.log.levels.INFO, "a pane delivery is informational")

  -- ── abort cleanly when send-text fails: no Enter, failure reported ────
  argv = {}
  canned[canned_key({ "herdr", "pane", "send-text", "w37:p3", "hello world" })] =
    { code = 1, stdout = "", stderr = "boom" }
  H.eq(agent_send.send({ payload = "hello world", label = "sample.lua" }), false,
    "a failed send-text reports failure")
  H.eq(#argv, 2, "resolution plus the failed send-text only")
  H.eq(argv[2].cmd[4], "w37:p3", "the failing send-text targeted the resolved pane")
  H.truthy(notify_calls[#notify_calls].msg:find("boom", 1, true) ~= nil,
    "the send-text error text surfaces")

  -- ── send-text succeeds but Enter fails: still a failure ───────────────
  argv = {}
  canned[canned_key({ "herdr", "pane", "send-text", "w37:p3", "hello world" })] =
    { code = 0, stdout = '{"result":{"type":"ok"}}', stderr = "" }
  canned[canned_key({ "herdr", "pane", "send-keys", "w37:p3", "Enter" })] =
    { code = 1, stdout = "", stderr = "keys denied" }
  H.eq(agent_send.send({ payload = "hello world", label = "sample.lua" }), false,
    "a failed Enter reports failure")
  H.eq(#argv, 3, "Enter was attempted exactly once")
  H.truthy(notify_calls[#notify_calls].msg:find("keys denied", 1, true) ~= nil,
    "the Enter error text surfaces")

  -- ── no same-tab target: delegate to opts.fallback, return its boolean ─
  argv = {}
  canned = {}
  pane_list({
    { pane_id = "w37:p2", tab_id = "w37:t2", agent_status = "unknown" },
    { pane_id = "w20:p1", tab_id = "w20:t1", agent_status = "working", agent = "pi" },
  })
  local seen
  H.eq(agent_send.send({
    payload = "hand off",
    label = "selection",
    fallback = function(payload, label)
      seen = { payload = payload, label = label }
      return true
    end,
  }), true, "the no-target path returns the fallback's true")
  H.eq(seen, { payload = "hand off", label = "selection" },
    "the fallback receives the payload and label")
  H.eq(#argv, 1, "no pane verbs run when no target shares the tab")
  H.eq(argv[1].cmd, { "herdr", "pane", "list" }, "only resolution ran")

  H.eq(agent_send.send({
    payload = "hand off",
    fallback = function() return false end,
  }), false, "the no-target path returns the fallback's false")

  H.eq(agent_send.send({ payload = "warn me" }), false,
    "send without a target or fallback reports failure")
  H.eq(notify_calls[#notify_calls].msg, "No agent pane found in this tab",
    "the resolution error is surfaced to the user")

  -- Not inside a Herdr pane at all: same delegation.
  vim.env.HERDR_PANE_ID = ""
  argv = {}
  H.eq(agent_send.send({
    payload = "outside",
    fallback = function() return false end,
  }), false, "outside a Herdr pane the fallback decides the result")
  H.eq(#argv, 1, "only the current-pane lookup runs outside a pane")
  H.eq(argv[1].cmd, { "herdr", "pane", "current" }, "the lookup is the pane current verb")

  restore_system()
  if saved_pane_env == nil then
    vim.env.HERDR_PANE_ID = nil
  else
    vim.env.HERDR_PANE_ID = saved_pane_env
  end

  -- ── herdr-agent.lua mapping table shape (no plugin clone needed) ──────
  local plugin = dofile(root .. "/lua/plugins/herdr-agent.lua")
  local function mapping(lhs, mode)
    for _, key in ipairs(plugin.keys) do
      if key[1] == lhs and (key.mode or "n") == mode then
        return key
      end
    end
    return nil
  end

  H.eq(plugin[1], "folke/snacks.nvim", "the mapping rides the snacks spec")
  H.truthy(mapping("<leader>at", "n") ~= nil, "normal-mode <leader>at is mapped")
  H.truthy(mapping("<leader>at", "x") ~= nil, "visual-mode <leader>at is mapped")
  H.truthy(mapping("<leader>tt", "x") ~= nil, "visual-mode <leader>tt is mapped")
  H.eq(mapping("<leader>tt", "n"), nil, "<leader>tt has no normal-mode mapping")
  for _, key in ipairs(plugin.keys) do
    H.truthy(type(key[2]) == "function" and type(key.desc) == "string" and #key.desc > 0,
      "every mapping has a callable handler and a description")
  end

  -- The handlers wire to the right modules (fakes, invoked directly).
  local saved_agent = package.loaded["plugins.herdr.agent_send"]
  local saved_term = package.loaded["plugins.herdr.term_send"]

  local term_opts
  package.loaded["plugins.herdr.term_send"] = {
    send = function(opts) term_opts = opts end,
  }
  mapping("<leader>tt", "x")[2]()
  H.eq(term_opts, { visual = true }, "<leader>tt sends the visual selection to the float")

  local agent_opts, prompt_opts
  package.loaded["plugins.herdr.agent_send"] = {
    send = function(opts) agent_opts = opts end,
    prompt_selection = function(opts) prompt_opts = opts end,
  }
  mapping("<leader>at", "n")[2]()
  H.eq(agent_opts.visual, false, "normal <leader>at sends the whole buffer")
  H.truthy(type(agent_opts.fallback) == "function",
    "normal <leader>at hands the sidekick fallback down")
  mapping("<leader>at", "x")[2]()
  H.truthy(prompt_opts ~= nil and type(prompt_opts.fallback) == "function",
    "visual <leader>at opens the instruction flow with the fallback")

  package.loaded["plugins.herdr.agent_send"] = saved_agent
  package.loaded["plugins.herdr.term_send"] = saved_term
  restore_notify()
end)

print("send_orchestration_spec: ok")
