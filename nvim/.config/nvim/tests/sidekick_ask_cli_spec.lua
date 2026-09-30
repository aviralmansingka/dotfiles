local config_root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(config_root)
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

local cli = require("plugins.sidekick.ask.cli")

local function assert_eq(actual, expected, msg)
  if not vim.deep_equal(actual, expected) then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local real_system = vim.system
local prompt = "Explain the selected code without changing it."

local function spawn_with(process_result)
  local invocation
  local callback_result
  local process = { marker = "system-object" }
  vim.system = function(cmd, opts, callback)
    invocation = { cmd = cmd, opts = opts }
    callback(process_result)
    return process
  end

  local returned = cli.spawn(prompt, function(result)
    callback_result = result
  end)
  assert_eq(returned, process, "spawn returns the process object so callers can cancel it")
  assert(vim.wait(1000, function() return callback_result ~= nil end), "spawn callback did not run")
  vim.system = real_system
  return invocation, callback_result
end

local invocation, result = spawn_with({
  code = 0,
  stdout = "The answer from GLM.\n\n",
  stderr = "pi startup banner\n",
})
assert_eq(invocation.cmd, {
  "pi",
  "--provider",
  "fireworks",
  "--model",
  "accounts/fireworks/routers/glm-5p3-fast",
  "--no-tools",
  "--no-session",
  "--print",
  "--",
  prompt,
}, "inline ask invokes pi with the Fireworks GLM model in ephemeral print mode")
assert_eq(invocation.opts.cwd, config_root, "pi runs from the active Neovim working directory")
assert_eq(invocation.opts.text, true, "pi output is captured as text")
assert_eq(result.ok, true, "stdout produces a successful ask result")
assert_eq(result.result, "The answer from GLM.", "only trimmed stdout becomes the answer")
assert_eq(result.tokens, { input = 0, output = 0 }, "the existing result token shape is preserved")
assert(type(result.duration_ms) == "number", "the existing result duration is preserved")

local _, stderr_failure = spawn_with({ code = 7, stdout = "", stderr = "provider unavailable\n" })
assert_eq(stderr_failure, { ok = false, err = "provider unavailable" }, "stderr explains a failed pi process")

local _, exit_failure = spawn_with({ code = 9, stdout = "", stderr = "" })
assert_eq(exit_failure, { ok = false, err = "pi exited with code 9" }, "exit status is used when stderr is empty")

local _, empty_failure = spawn_with({ code = 0, stdout = "\n", stderr = "banner only\n" })
assert_eq(empty_failure, { ok = false, err = "pi: empty result" }, "stderr banner noise is not mistaken for an answer")

vim.system = real_system
print("sidekick_ask_cli_spec: ok")
