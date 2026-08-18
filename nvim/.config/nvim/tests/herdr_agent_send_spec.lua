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

print("herdr_agent_send_spec: ok")
