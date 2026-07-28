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
local function find_last(lines, needle)
  for row = #lines, 1, -1 do
    local col = lines[row]:find(needle, 1, true)
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
local function count(lines, needle)
  local total = 0
  for _, line in ipairs(lines) do if line:find(needle, 1, true) then total = total + 1 end end
  return total
end
local function render_fresh_fixture()
  local before = count(vim.api.nvim_buf_get_lines(0, 0, -1, false), "HTTPS path")
  -- Setup uses Pi's documented terminal channel path and clears pending editor text first.
  vim.api.nvim_chan_send(vim.bo.channel, "\21/v03-fixture\r")
  local lines
  local ok = vim.wait(5000, function()
    lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
    return count(lines, "HTTPS path") > before
  end, 25)
  return ok, lines
end
local function input(data)
  vim.api.nvim_feedkeys(data, "t", false)
end
local function mouse(button, action, row, col)
  vim.api.nvim_input_mouse(button, action, "", 1, row - 1, col - 1)
end
local function target_cell(row, col)
  local origin = vim.fn.win_screenpos(0)
  local top = vim.fn.line("w0")
  local height, width = vim.api.nvim_win_get_height(0), vim.api.nvim_win_get_width(0)
  local screen_row, screen_col = origin[1] + row - top, origin[2] + col - 1
  local visible = row >= top and row < top + height and col >= 1 and col <= width
  return screen_row, screen_col, visible
end
local pi = vim.fn.exepath("pi")
local raw = out .. "/terminal.ansi"
vim.o.mouse = "a"
local cmd = { "/usr/bin/script", "-q", raw, pi, "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--offline", "--extension", repo .. "/pi/.pi/agent/extensions/transcript-scroll.ts", "--extension", repo .. "/scripts/fixtures/pi-transcript-links-v03-extension.ts" }
vim.cmd("enew")
vim.fn.termopen(cmd, { cwd = repo, env = { NVIM = vim.v.servername } })
vim.schedule(function() vim.cmd.startinsert() end)
vim.defer_fn(function()
local co
co = coroutine.create(function()
local function pause(ms)
  vim.defer_fn(function() assert(coroutine.resume(co)) end, ms)
  coroutine.yield()
end
local entered = vim.wait(1000, function() return vim.api.nvim_get_mode().mode == "t" end, 10)
local ready = wait_for("[Extensions]", 12000)
record("pi-prompt-visible", ready and vim.bo.buftype == "terminal")
trace[#trace + 1] = { step = "startup", mode = vim.api.nvim_get_mode().mode, buffer = vim.api.nvim_get_current_buf(), window = vim.api.nvim_get_current_win() }
record("neovim-terminal-mode", entered and vim.api.nvim_get_mode().mode == "t")
pause(500)
-- Deterministic fixture setup only; interaction evidence below uses Neovim input APIs.
local fixture, lines = render_fresh_fixture()
record("fixture-rendered-by-real-pi", fixture)
snap("fixture")
local before = table.concat(lines or {}, "\n")
local origin = vim.fn.win_screenpos(0)
mouse("wheel", "up", origin[1] + math.floor(vim.api.nvim_win_get_height(0) / 2), origin[2] + math.floor(vim.api.nvim_win_get_width(0) / 2))
pause(250)
local wheel_lines = snap("wheel")
local after = table.concat(wheel_lines, "\n")
record("wheel-changes-transcript-history", before ~= after)
record("wheel-preserves-prompt", after:find("gpt%-5%.6%-sol") ~= nil)
record("wheel-preserves-terminal-mode", vim.api.nvim_get_mode().mode == "t")
input("x")
pause(100)
local typed_editor = table.concat(snap("typed-character"), "\n")
record("typed-character-reaches-pi-editor", typed_editor:find("x", 1, true) ~= nil)
fixture, lines = render_fresh_fixture()
record("fresh-bottom-fixture-before-https", fixture)
lines = snap("before-clicks")
local hrow, hcol = find_last(lines, "HTTPS path")
local hscreen_row, hscreen_col, hvisible
if hrow then hscreen_row, hscreen_col, hvisible = target_cell(hrow, hcol + 6) end
record("https-target-cell-visible", hvisible == true, vim.inspect({ row = hscreen_row, col = hscreen_col }))
if hvisible then mouse("left", "press", hscreen_row, hscreen_col) end
pause(100)
local copied = wait_for("Copied fixture.example", 3000)
record("https-click-shows-confirmation", copied)
snap("copied-status")
vim.wait(1700)
local cleared_lines = snap("cleared-status")
record("copy-confirmation-clears", not table.concat(cleared_lines, "\n"):find("Copied fixture.example", 1, true))
local clip = vim.fn.readfile(os.getenv("V03_CLIPBOARD_LOG"))
record("exactly-one-sandboxed-clipboard-write", #clip == 1 and clip[1] == "https://fixture.example/path?q=1#frag", vim.inspect(clip))
fixture, lines = render_fresh_fixture()
record("fresh-bottom-fixture-before-wikilink", fixture)
lines = snap("wikilink-click-target")
local wrow, wcol = find_last(lines, "Target heading")
record("wikilink-visible", wrow ~= nil)
local wscreen_row, wscreen_col, wvisible
if wrow then wscreen_row, wscreen_col, wvisible = target_cell(wrow, wcol) end
record("wikilink-target-cell-visible", wvisible == true, vim.inspect({ row = wscreen_row, col = wscreen_col }))
if wvisible then mouse("left", "press", wscreen_row, wscreen_col) end
pause(1000)
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
input("\3\3")
vim.wait(500)
local failed = false
for _, a in ipairs(assertions) do if not a.ok then failed = true end end
if failed then vim.cmd("cquit 1") else vim.cmd("qa!") end
end)
assert(coroutine.resume(co))
end, 50)
