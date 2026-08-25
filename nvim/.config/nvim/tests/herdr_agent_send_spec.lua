local config_root = vim.fn.getcwd()
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

local agent_send = require("plugins.herdr.agent_send")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local panes = {
  { pane_id = "w37:p2", tab_id = "w37:t2", agent_status = "unknown" }, -- this nvim pane
  { pane_id = "w37:p3", tab_id = "w37:t2", agent_status = "idle", agent = "pi" },
  { pane_id = "w37:p4", tab_id = "w37:t2", agent_status = "unknown" }, -- bare shell
  { pane_id = "w20:p1", tab_id = "w20:t1", agent_status = "working", agent = "pi" }, -- other tab
}

assert_eq(agent_send.find_agent_pane(panes, "w37:p2").pane_id, "w37:p3", "picks the agent pane in the same tab")
assert_eq(agent_send.find_agent_pane(panes, "w20:p1"), nil, "never targets a pane in another tab")
assert_eq(agent_send.find_agent_pane(panes, "w99:p9"), nil, "unknown current pane resolves to no target")
assert_eq(
  agent_send.find_agent_pane({
    { pane_id = "a", tab_id = "t", agent_status = "unknown" },
    { pane_id = "b", tab_id = "t", agent_status = "unknown" },
  }, "a"),
  nil,
  "bare shells are not agent panes"
)
assert_eq(
  agent_send.find_agent_pane({
    { pane_id = "a", tab_id = "t", agent_status = "unknown" },
    { pane_id = "b", tab_id = "t", agent_status = "done" },
    { pane_id = "c", tab_id = "t", agent_status = "busy", agent = "codex" },
  }, "a").pane_id,
  "c",
  "prefers a pane that advertises an agent kind"
)

local tmp = vim.fn.tempname()
vim.fn.mkdir(tmp, "p")
local file = tmp .. "/sample.lua"
vim.fn.writefile({ "line one", "line two", "line three" }, file)
vim.cmd("edit " .. vim.fn.fnameescape(file))
local bufnr = vim.api.nvim_get_current_buf()

local text = agent_send.build_payload(bufnr, false)
assert_eq(text:match("^From neovim buffer [^\n]*sample%.lua:") ~= nil, true, "buffer payload carries a context line")
assert_eq(text:find("line one\nline two\nline three", 1, true) ~= nil, true, "buffer payload carries all lines")

vim.api.nvim_buf_set_mark(bufnr, "<", 2, 0, {})
vim.api.nvim_buf_set_mark(bufnr, ">", 3, 0, {})
local selection = agent_send.build_payload(bufnr, true)
assert_eq(selection:match("%(lines 2%-3%):") ~= nil, true, "selection payload notes the line range")
assert_eq(selection:find("line two\nline three", 1, true) ~= nil, true, "selection payload carries selected lines")
assert_eq(selection:find("line one", 1, true), nil, "selection payload excludes unselected lines")

local saved_max = agent_send.max_bytes
agent_send.max_bytes = 10
local truncated = agent_send.build_payload(bufnr, false)
assert_eq(truncated:find("[truncated", 1, true) ~= nil, true, "large payloads are truncated with a note")
agent_send.max_bytes = saved_max

assert_eq(
  agent_send.format_prompt("Explain these lines", "if value == { answer = 42 } then\n  return value\nend"),
  "Explain these lines\n\n> if value == { answer = 42 } then\n>   return value\n> end",
  "visual prompts put the instruction first and quote every selected line"
)

local herdr = require("plugins.sidekick.herdr")
local saved_resolve_target = agent_send.resolve_target
local saved_call = herdr.call
local saved_send_key = herdr.send_key
local delivered = {}
agent_send.resolve_target = function()
  return { pane_id = "w37:p3", agent = "pi" }
end
herdr.call = function(args)
  delivered[#delivered + 1] = args
  return {}
end
herdr.send_key = function(pane_id, key)
  delivered[#delivered + 1] = { pane_id, key }
  return true
end
local literal_payload = "Explain this\n\n> if value == { answer = 42 } then"
assert_eq(
  agent_send.send({ payload = literal_payload, label = "selection" }),
  true,
  "prebuilt visual prompt is delivered"
)
assert_eq(delivered[1][4], literal_payload, "prebuilt payload is delivered literally")
assert_eq(delivered[2][2], "Enter", "delivery submits only after sending the payload")

local saved_input = vim.ui.input
local saved_exit_visual_mode = agent_send.exit_visual_mode
local input_callback
local exited_visual = 0
vim.ui.input = function(_, callback)
  input_callback = callback
end
agent_send.exit_visual_mode = function()
  exited_visual = exited_visual + 1
end

delivered = {}
agent_send.prompt_selection({ bufnr = bufnr })
assert_eq(#delivered, 0, "opening the instruction input does not send or submit")
input_callback(nil)
assert_eq(#delivered, 0, "cancelling the instruction input sends nothing")
assert_eq(exited_visual, 0, "cancelling keeps the visual selection")

agent_send.prompt_selection({ bufnr = bufnr })
assert_eq(#delivered, 0, "a second instruction input still waits for submission")
input_callback("Explain these lines")
assert_eq(exited_visual, 1, "submitting exits visual mode")
assert_eq(
  delivered[1][4],
  "Explain these lines\n\n> line two\n> line three",
  "input submission sends the instruction and quoted selection"
)
assert_eq(delivered[2][2], "Enter", "input submission triggers agent completion")

vim.ui.input = saved_input
agent_send.exit_visual_mode = saved_exit_visual_mode
agent_send.resolve_target = saved_resolve_target
herdr.call = saved_call
herdr.send_key = saved_send_key

print("herdr_agent_send_spec: ok")
