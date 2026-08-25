local config_root = vim.fn.getcwd()
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

local term_send = require("plugins.herdr.term_send")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)), 2)
  end
end

local panes = {
  { pane_id = "w37:p2", tab_id = "w37:t2", agent_status = "unknown" }, -- this nvim pane
  { pane_id = "w37:p3", tab_id = "w37:t2", agent_status = "idle", agent = "pi" }, -- agent pane
  { pane_id = "w37:p4", tab_id = "w37:t2", agent_status = "unknown" }, -- bare shell
  { pane_id = "w20:p1", tab_id = "w20:t1", agent_status = "working", agent = "pi" }, -- other tab
}

assert_eq(
  term_send.find_term_pane(panes, "w37:p2").pane_id,
  "w37:p4",
  "picks the non-agent pane in the same tab, skipping the nvim pane and the agent pane"
)
assert_eq(term_send.find_term_pane(panes, "w20:p1"), nil, "never targets a pane in another tab")
assert_eq(term_send.find_term_pane(panes, "w99:p9"), nil, "unknown current pane resolves to no target")
assert_eq(
  term_send.find_term_pane({
    { pane_id = "a", tab_id = "t", agent_status = "idle", agent = "pi" },
    { pane_id = "b", tab_id = "t", agent_status = "busy", agent = "codex" },
  }, "a"),
  nil,
  "a tab with only agent panes has no terminal target"
)

local tmp = vim.fn.tempname()
vim.fn.mkdir(tmp, "p")
local file = tmp .. "/sample.lua"
vim.fn.writefile({ "line one", "line two", "line three" }, file)
vim.cmd("edit " .. vim.fn.fnameescape(file))
local bufnr = vim.api.nvim_get_current_buf()

local text = term_send.build_payload(bufnr, false)
assert_eq(text, "line one\nline two\nline three", "buffer payload is raw text with no header")

vim.api.nvim_buf_set_mark(bufnr, "<", 2, 0, {})
vim.api.nvim_buf_set_mark(bufnr, ">", 3, 0, {})
local selection = term_send.build_payload(bufnr, true)
assert_eq(selection, "line two\nline three", "selection payload is raw selected text with no header")

print("herdr_term_send_spec: ok")
