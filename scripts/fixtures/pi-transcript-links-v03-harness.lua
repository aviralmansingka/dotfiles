local out = assert(os.getenv("V03_ATTEMPT"))
local repo = assert(os.getenv("V03_REPO"))
local trace = {}
local assertions = {}
local function record(name, ok, detail)
  assertions[#assertions + 1] = { name = name, ok = ok, detail = detail or "" }
end
local function snap(name)
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  vim.fn.writefile(lines, out .. "/" .. name .. ".screen.txt")
  return lines
end
local function find(lines, needle)
  for row, line in ipairs(lines) do
    local col = line:find(needle, 1, true)
    if col then return row, col end
  end
end
local function wait_for(needle, timeout)
  local lines
  local ok = vim.wait(timeout, function()
    lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
    return find(lines, needle) ~= nil
  end, 25)
  return ok, lines
end
local function send(data) vim.api.nvim_chan_send(vim.bo.channel, data) end
local pi = vim.fn.exepath("pi")
local raw = out .. "/terminal.ansi"
local cmd = { "/usr/bin/script", "-q", raw, pi, "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--offline", "--extension", repo .. "/pi/.pi/agent/extensions/transcript-scroll.ts", "--extension", repo .. "/scripts/fixtures/pi-transcript-links-v03-extension.ts" }
vim.cmd("enew")
vim.fn.termopen(cmd, { cwd = repo, env = { NVIM = vim.v.servername } })
vim.cmd("startinsert")
local ready = wait_for("Type your message", 12000)
record("pi-prompt-visible", ready)
trace[#trace + 1] = { step = "startup", mode = vim.api.nvim_get_mode().mode, buffer = vim.api.nvim_get_current_buf(), window = vim.api.nvim_get_current_win() }
record("neovim-terminal-mode", vim.api.nvim_get_mode().mode == "t")
send("/v03-fixture\r")
local fixture, lines = wait_for("fixture.example", 5000)
record("fixture-rendered-by-real-pi", fixture)
snap("fixture")
local before = table.concat(lines or {}, "\n")
send("\27[<64;2;2M")
vim.wait(250)
local wheel_lines = snap("wheel")
local after = table.concat(wheel_lines, "\n")
record("wheel-changes-transcript-history", before ~= after)
record("wheel-preserves-prompt", after:find("Type your message", 1, true) ~= nil)
record("wheel-preserves-terminal-mode", vim.api.nvim_get_mode().mode == "t")
send("x")
vim.wait(100)
local typed_editor = table.concat(snap("typed-character"), "\n")
record("typed-character-reaches-pi-editor", typed_editor:find("x", 1, true) ~= nil)
send("\21/v03-typed\r")
local typed = wait_for("Typed input reached Pi", 3000)
record("typed-command-reaches-pi", typed)
lines = snap("before-clicks")
local hrow, hcol = find(lines, "fixture.example")
if hrow then send(string.format("\27[<0;%d;%dM", hcol, hrow)) end
local copied = wait_for("Copied fixture.example", 3000)
record("https-click-shows-confirmation", copied)
snap("copied-status")
vim.wait(1700)
local cleared_lines = snap("cleared-status")
record("copy-confirmation-clears", not table.concat(cleared_lines, "\n"):find("Copied fixture.example", 1, true))
local clip = vim.fn.readfile(os.getenv("V03_CLIPBOARD_LOG"))
record("exactly-one-sandboxed-clipboard-write", #clip == 1 and clip[1] == "https://fixture.example/path?q=1#frag", vim.inspect(clip))
lines = snap("wikilink-click-target")
local wrow, wcol = find(lines, "Target heading")
record("wikilink-visible", wrow ~= nil)
if wrow then send(string.format("\27[<0;%d;%dM", wcol, wrow)) end
vim.wait(1000)
local current = vim.api.nvim_get_current_buf()
local opened, cursor
for _, buf in ipairs(vim.api.nvim_list_bufs()) do
  if vim.api.nvim_buf_get_name(buf):match("/notes/Target%.md$") then
    opened = buf
    for _, win in ipairs(vim.fn.win_findbuf(buf)) do cursor = vim.api.nvim_win_get_cursor(win) end
  end
end
record("wikilink-opens-target-buffer-behind-pi", opened ~= nil)
record("wikilink-targets-heading", cursor and cursor[1] == 3 or false, vim.inspect(cursor))
record("pi-terminal-remains-current", vim.api.nvim_get_current_buf() == current and vim.bo.buftype == "terminal")
record("pi-terminal-remains-focused-mode-t", vim.api.nvim_get_mode().mode == "t")
trace[#trace + 1] = { step = "final", mode = vim.api.nvim_get_mode().mode, currentBuffer = vim.api.nvim_get_current_buf(), currentWindow = vim.api.nvim_get_current_win(), openedBuffer = opened, cursor = cursor }
vim.fn.writefile({ vim.json.encode(assertions) }, out .. "/semantic-assertions.json")
vim.fn.writefile({ vim.json.encode(trace) }, out .. "/mode-input-focus-trace.json")
vim.fn.writefile({ vim.json.encode({ openedBuffer = opened, cursor = cursor, currentBuffer = vim.api.nvim_get_current_buf() }) }, out .. "/opened-buffer-cursor-trace.json")
send("\3\3")
vim.wait(500)
local failed = false
for _, a in ipairs(assertions) do if not a.ok then failed = true end end
if failed then vim.cmd("cquit 1") else vim.cmd("qa!") end
