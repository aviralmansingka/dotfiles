local config_root = vim.fn.getcwd()
local sidekick_root = vim.fn.expand("~/.local/share/nvim/lazy/sidekick.nvim")
package.path = config_root .. "/lua/?.lua;"
  .. config_root .. "/lua/?/init.lua;"
  .. sidekick_root .. "/lua/?.lua;"
  .. sidekick_root .. "/lua/?/init.lua;"
  .. package.path

local agent_send = require("plugins.herdr.agent_send")
local plugin = dofile(config_root .. "/lua/plugins/herdr-agent.lua")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local function mapping(lhs, mode)
  for _, key in ipairs(plugin.keys) do
    if key[1] == lhs and (key.mode or "n") == mode then
      return key
    end
  end
end

assert_eq(mapping("<leader>tt", "n"), nil, "<leader>tt has no normal-mode mapping")
assert_eq(mapping("<leader>tt", "x") ~= nil, true, "<leader>tt remains available for visual selections")

local visual_at = mapping("<leader>at", "x")
assert_eq(visual_at ~= nil, true, "<leader>at remains available for visual selections")

local saved_prompt_selection = agent_send.prompt_selection
local fallback
agent_send.prompt_selection = function(opts)
  fallback = opts.fallback
end
visual_at[2]()
assert_eq(type(fallback), "function", "visual <leader>at opens the instruction flow with a fallback")

local sent
package.loaded["sidekick.cli"] = {
  send = function(opts)
    sent = opts
  end,
}
local payload = "Explain this\n\n> if value == { answer = 42 } then"
assert_eq(fallback(payload, "selection"), true, "Sidekick fallback accepts a prebuilt prompt")
assert_eq(sent.msg, nil, "Sidekick fallback bypasses template rendering")
assert_eq(require("sidekick.text").to_string(sent.text), payload, "literal braces survive the Sidekick fallback")
assert_eq(sent.submit, true, "Sidekick fallback submits the completed prompt")

agent_send.prompt_selection = saved_prompt_selection
print("herdr_agent_mapping_spec: ok")
