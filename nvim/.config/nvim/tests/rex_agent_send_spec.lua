-- plugins/agent: mux seam, Rex adapter, and the shared send path.
--
-- Loads the WORKTREE copy of this config via the shared harness (env
-- NVIM_TEST_CONFIG_ROOT or a walk up from this file), never a stowed
-- ~/.config/nvim copy. Every rex call is stubbed through `rex.run`; no live
-- Rex, no live Herdr, no sleeps.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/ci/harness.lua")
local config_root = H.setup()

vim.opt.runtimepath:prepend(config_root)
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

local mux = require("plugins.agent.mux")
local rex = require("plugins.agent.rex")
local send = require("plugins.agent.send")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local function assert_table(actual, expected, msg)
  if vim.inspect(actual) ~= vim.inspect(expected) then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

H.run("rex_agent_send_spec", function()
  local saved = {
    REX_SESSION = vim.env.REX_SESSION,
    REX_BLOCK = vim.env.REX_BLOCK,
    HERDR_PANE_ID = vim.env.HERDR_PANE_ID,
  }
  local saved_run = rex.run

  -- --- mux seam: the innermost mux owns the blocks ---
  vim.env.REX_SESSION = "session:test"
  vim.env.REX_BLOCK = "block:self"
  vim.env.HERDR_PANE_ID = "w1:p1"
  assert_eq(mux.kind(), "rex", "a Rex block inside a Herdr pane still resolves to Rex")

  vim.env.REX_SESSION = ""
  vim.env.REX_BLOCK = ""
  assert_eq(mux.kind(), "herdr", "HERDR_PANE_ID alone selects the Herdr adapter")

  vim.env.HERDR_PANE_ID = ""
  assert_eq(mux.kind(), nil, "no mux environment selects no adapter")

  -- --- rex.run: argv, decode, and failure ---
  local calls = {}
  rex.run = function(args, quiet)
    table.insert(calls, { args = args, quiet = quiet })
    return {}
  end
  assert_table(rex.run({ "block", "ls", "-s", "s", "--json" }, true).blocks and {} or {}, {}, "stub passthrough")
  assert_table(calls[1].args, { "block", "ls", "-s", "s", "--json" }, "the adapter passes argv through unchanged")

  -- --- resolve: same-window pi wins, session fallback second ---
  vim.env.REX_SESSION = "session:test"
  vim.env.REX_BLOCK = "block:self"
  local function stub(blocks, agents)
    rex.run = function(args)
      if args[1] == "block" and args[2] == "ls" then
        return { blocks = blocks }
      end
      if args[1] == "block" and args[2] == "call" then
        local block = args[6]
        return agents[block] and { foreground = { argv0 = "pi" } } or { foreground = { argv0 = "zsh" } }
      end
      return {}
    end
  end

  stub({
    { block_id = "block:self", window_id = "window:a" },
    { block_id = "block:pi-here", window_id = "window:a" },
    { block_id = "block:pi-other", window_id = "window:b" },
  }, { ["block:pi-here"] = true, ["block:pi-other"] = true })
  local target = rex.resolve()
  assert_eq(target and target.id, "block:pi-here", "a pi block in this window wins")
  assert_eq(target and target.mux, "rex", "the target names its adapter")

  stub({
    { block_id = "block:self", window_id = "window:a" },
    { block_id = "block:shell", window_id = "window:a" },
    { block_id = "block:pi-other", window_id = "window:b" },
  }, { ["block:pi-other"] = true })
  target = rex.resolve()
  assert_eq(target and target.id, "block:pi-other", "with no pi in this window, the session's pi is the fallback")

  stub({ { block_id = "block:self", window_id = "window:a" } }, {})
  local none, err = rex.resolve()
  assert_eq(none, nil, "no pi block resolves no target")
  assert(err:match("No pi block") ~= nil, "the error names the missing agent")

  vim.env.REX_BLOCK = ""
  local outside, outside_err = rex.resolve()
  assert_eq(outside, nil, "outside a Rex block there is no target")
  assert(outside_err:match("Not running inside a Rex block") ~= nil, "the error names the missing block")
  vim.env.REX_BLOCK = "block:self"

  -- --- deliver: send, then Enter; a failed send never presses Enter ---
  calls = {}
  rex.run = function(args)
    table.insert(calls, args)
    return {}
  end
  assert_eq(rex.deliver({ id = "block:pi" }, "hello"), true, "deliver reports success")
  assert_table(calls[1], { "send", "-s", "session:test", "-b", "block:pi", "--", rex.paste("hello") },
    "text reaches the block as one bracketed paste")
  assert_table(calls[2], { "send-key", "-s", "session:test", "-b", "block:pi", "enter" },
    "Enter submits the prompt")

  calls = {}
  rex.run = function(args)
    table.insert(calls, args)
    if args[1] == "send" then
      return nil, "boom"
    end
    return {}
  end
  assert_eq(rex.deliver({ id = "block:pi" }, "hello"), false, "a failed send reports failure")
  assert_eq(#calls, 1, "a failed send never presses Enter")

  -- --- paste: bracketed, and the closing marker cannot leak in ---
  assert_eq(rex.paste("a\nb"), "\27[200~a\nb\27[201~", "multi-line text is one bracketed paste")
  assert_eq(rex.paste("x\27[201~y"), "\27[200~xy\27[201~", "a forged closing marker is stripped")

  -- --- send: resolves through the mux, falls back when no agent ---
  stub({
    { block_id = "block:self", window_id = "window:a" },
    { block_id = "block:pi", window_id = "window:a" },
  }, { ["block:pi"] = true })
  calls = {}
  local saved_deliver_run = rex.run
  rex.run = function(args)
    table.insert(calls, args)
    if args[1] == "block" then
      return saved_deliver_run(args)
    end
    return {}
  end
  assert_eq(send.send({ payload = "from the spec", label = "spec" }), true,
    "send delivers through the Rex adapter")
  assert_table(calls[#calls], { "send-key", "-s", "session:test", "-b", "block:pi", "enter" },
    "the agent gets the payload and Enter")

  local fallback_payload
  rex.run = function()
    return { blocks = { { block_id = "block:self", window_id = "window:a" } } }
  end
  local fell_back = send.send({
    payload = "x",
    label = "spec",
    fallback = function(payload)
      fallback_payload = payload
      return true
    end,
  })
  assert_eq(fell_back, true, "no agent beside this pane delegates to the fallback")
  assert_eq(fallback_payload, "x", "the fallback receives the payload")

  rex.run = saved_run
  for key, value in pairs(saved) do
    vim.env[key] = value
  end
end)
