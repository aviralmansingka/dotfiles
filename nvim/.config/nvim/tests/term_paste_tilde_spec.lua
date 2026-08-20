--- Regression coverage for terminal paste behavior. See lua/config/options.lua.

-- Tests are run from the nvim config root (nvim/.config/nvim/).
local config_root = vim.fn.getcwd()
package.path = config_root .. "/lua/?.lua;" .. config_root .. "/lua/?/init.lua;" .. package.path

-- Load options.lua (defines the vim.paste override and terminal-job wrappers)
dofile(config_root .. "/lua/config/options.lua")

local function make_term(cmd)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  local chan = vim.fn.termopen(cmd, { bufnr = buf })
  vim.cmd("startinsert")
  vim.wait(500)
  return buf, chan
end

local function make_builtin_term(cmd)
  vim.cmd("terminal " .. cmd)
  local buf = vim.api.nvim_get_current_buf()
  local chan = vim.b[buf].terminal_job_id
  vim.cmd("startinsert")
  vim.wait(500)
  return buf, chan
end

local function close_term(buf, chan)
  vim.api.nvim_chan_send(chan, "\4") -- Ctrl-D: EOF for cat
  vim.wait(300)
  pcall(vim.fn.chanclose, chan)
  vim.wait(300)
  pcall(vim.cmd, "bdelete! " .. buf)
end

local function buf_has_tilde(buf)
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  for _, line in ipairs(lines) do
    if line:find("~", 1, true) then
      return true
    end
  end
  return false
end

local tests = {}

--- Pasting into a :term running cat (no bracketed paste) must not produce
--- visible tilde characters from bracketed-paste markers.
function tests.test_no_tildes_when_bp_disabled()
  local buf, chan = make_term("cat")
  vim.paste({ "echo hello", "ls -la" }, -1)
  vim.wait(300)
  local has_tilde = buf_has_tilde(buf)
  close_term(buf, chan)
  assert(not has_tilde, "expected no tildes in :term buffer with cat")
  print("PASS: no tildes when bracketed paste is not enabled")
end

--- Vimscript :terminal bypasses tracked callbacks, so paste remains raw.
function tests.test_builtin_terminal_uses_raw_paste()
  local buf, chan = make_builtin_term("cat")
  vim.paste({ "echo hello", "ls -la" }, -1)
  vim.wait(300)
  local has_tilde = buf_has_tilde(buf)
  close_term(buf, chan)
  assert(not has_tilde, "expected no tildes in built-in :terminal buffer with cat")
  print("PASS: built-in :terminal uses raw paste")
end

function tests.test_markers_sent_when_bp_enabled()
  local tmp = vim.fn.tempname()
  local buf, chan = make_term(string.format("bash -c 'printf \"\\x1b[?2004h\"; cat > %s'", vim.fn.shellescape(tmp)))
  vim.wait(800) -- wait for BP enable to be detected via on_stdout
  vim.paste({ "echo " }, 1)
  vim.paste({ "hello" }, 2)
  vim.paste({ "" }, 3)
  vim.wait(300)
  close_term(buf, chan)

  local f = io.open(tmp, "rb")
  assert(f, "output file not created")
  local content = f:read("*a")
  f:close()
  vim.fn.delete(tmp)

  assert(content:find("\27[200~", 1, true), "start marker missing in paste output")
  assert(content:find("\27[201~", 1, true), "end marker missing in paste output")
  assert(content:find("echo hello", 1, true), "paste content missing")
  print("PASS: bracketed-paste markers sent when inner program enables BP")
end

function tests.test_vimscript_stdout_callback_receives_job_options()
  vim.g.term_paste_callback_state = nil
  vim.cmd([[
    function! TermPasteTestCallback(job_id, data, event) dict
      let g:term_paste_callback_state = self.callback_state
    endfunction
  ]])

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  local chan = vim.fn.jobstart({ "sh", "-c", "printf callback" }, {
    term = true,
    callback_state = "preserved",
    on_stdout = "TermPasteTestCallback",
  })
  vim.wait(1000, function()
    return vim.g.term_paste_callback_state ~= nil
  end)

  local state = vim.g.term_paste_callback_state
  pcall(vim.fn.jobstop, chan)
  pcall(vim.cmd, "bdelete! " .. buf)
  vim.cmd("delfunction TermPasteTestCallback")
  vim.g.term_paste_callback_state = nil

  assert(state == "preserved", "Vimscript callback did not receive its job options dictionary")
  print("PASS: Vimscript stdout callback receives job options")
end

function tests.test_jobstart_tracks_ordered_split_bp_output()
  local tmp = vim.fn.tempname()
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  local chan = vim.fn.jobstart({
    "bash",
    "-c",
    string.format(
      "printf '\\033[?2004h\\033[?2004l\\033[?20'; sleep 0.2; printf '04h'; cat > %s",
      vim.fn.shellescape(tmp)
    ),
  }, { term = true })
  vim.cmd("startinsert")
  vim.wait(800)
  vim.paste({ "echo hello" }, -1)
  vim.wait(300)
  close_term(buf, chan)

  local f = io.open(tmp, "rb")
  assert(f, "output file not created")
  local content = f:read("*a")
  f:close()
  vim.fn.delete(tmp)

  assert(content:find("\27[200~", 1, true), "start marker missing after split enable sequence")
  assert(content:find("\27[201~", 1, true), "end marker missing after split enable sequence")
  print("PASS: jobstart tracks ordered split bracketed-paste output")
end

--- Pasting into a regular (non-terminal) buffer should use the default handler.
function tests.test_regular_buffer_uses_default_paste()
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  vim.bo[buf].buftype = ""
  vim.paste({ "hello world" }, -1)
  local line = vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1]
  assert(line == "hello world", "regular buffer paste failed: got " .. tostring(line))
  vim.cmd("bdelete! " .. buf)
  print("PASS: regular buffer paste uses default handler")
end

--- Multi-phase paste (simulates SSH chunked delivery) must reassemble content
--- correctly without tildes when BP is not enabled.
function tests.test_multiphase_no_tildes_when_bp_disabled()
  local tmp = vim.fn.tempname()
  local buf, chan = make_term(string.format("cat > %s", vim.fn.shellescape(tmp)))
  vim.paste({ "ech" }, 1)
  vim.wait(100)
  vim.paste({ "o hello" }, 2)
  vim.wait(100)
  vim.paste({ "" }, 3)
  vim.wait(300)
  close_term(buf, chan)

  local f = io.open(tmp, "r")
  assert(f, "output file not created")
  local content = f:read("*a")
  f:close()
  vim.fn.delete(tmp)

  assert(content:find("echo hello", 1, true), "multi-phase paste content mismatch: " .. vim.inspect(content))
  assert(not content:find("~", 1, true), "tildes found in multi-phase paste output")
  print("PASS: multi-phase paste reassembles correctly without tildes")
end

-- Run all tests
local failures = 0
for name, fn in pairs(tests) do
  local ok, err = pcall(fn)
  if not ok then
    print("FAIL: " .. name .. " — " .. tostring(err))
    failures = failures + 1
  end
end

if failures > 0 then
  print(string.format("\n%d test(s) failed", failures))
  vim.cmd("cquit 1")
else
  print(string.format("\nAll %d tests passed", #vim.tbl_keys(tests)))
end
