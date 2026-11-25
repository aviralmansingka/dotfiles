-- Automatic on-disk reload (config/autocmds.lua, augroup
-- autoread_changed_on_disk). Real temp files, real FocusGained / BufEnter /
-- BufWritePost events, the real :edit! reload path: the logic is exercised
-- through its autocmds, never through a copy of it.
--
-- Deterministic without a sleep: the check compares the file's own timestamp,
-- and the fixture sets that timestamp explicitly with vim.uv.fs_utime, so no
-- case depends on filesystem timestamp granularity or on elapsed wall time.
--
-- Two guards cannot be reached from a headless editor (no UI loop): insert
-- mode and the command-line window. Both are listed as known gaps in
-- docs/ci-tests/nvim-autoread.md.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local dir = vim.fn.tempname()
vim.fn.mkdir(dir, "p")

-- The real config file: registers the augroup and the BufReadPost hook the
-- cases below rely on.
dofile(root .. "/lua/config/autocmds.lua")

local GROUP = "autoread_changed_on_disk"

local function fixture(name, lines)
  local path = dir .. "/" .. name
  vim.fn.writefile(lines, path)
  return path
end

-- An outside write with a timestamp the loaded version cannot have.
local function outside_write(path, lines)
  vim.fn.writefile(lines, path)
  local stamp = os.time() + 10
  vim.uv.fs_utime(path, stamp, stamp)
end

local function open(path)
  vim.cmd("edit " .. vim.fn.fnameescape(path))
  return vim.api.nvim_get_current_buf()
end

local function fire(event, buf)
  vim.api.nvim_exec_autocmds(event, { buf = buf })
end

local function lines_of(buf)
  return vim.api.nvim_buf_get_lines(buf, 0, -1, false)
end

-- ── the group, the option, the events ─────────────────────────────────────
H.run("autoread wiring", function()
  H.eq(vim.o.autoread, true, "autoread is on")
  local events = {}
  for _, au in ipairs(vim.api.nvim_get_autocmds({ group = GROUP })) do
    for _, event in ipairs(au.event:find(",", 1, true) and vim.split(au.event, ",") or { au.event }) do
      events[event] = true
    end
  end
  for _, event in ipairs({
    "FocusGained",
    "BufEnter",
    "CursorHold",
    "CursorHoldI",
    "TermLeave",
    "BufWritePost",
    "BufReadPost",
  }) do
    H.truthy(events[event], "the reload group handles " .. event)
  end
end)

-- ── unmodified buffer picks up an outside change ───────────────────────────
H.run("clean buffer reloads, cursor stays put", function()
  local path = fixture("clean.txt", { "one", "two", "three" })
  local buf = open(path)
  vim.fn.cursor(2, 1)
  local calls, restore = H.capture_notify()
  outside_write(path, { "one", "TWO", "three", "four" })
  fire("FocusGained")
  restore()
  H.eq(lines_of(buf), { "one", "TWO", "three", "four" }, "the reloaded buffer shows the disk copy")
  H.eq(vim.bo[buf].modified, false, "a reload never marks the buffer modified")
  H.eq(vim.fn.line("."), 2, "the cursor stays on the same line")
  H.eq(#calls, 1, "one quiet notification per reload")
  H.truthy(calls[1].msg:find("clean.txt", 1, true), "the message names the file")
  H.eq(calls[1].level, vim.log.levels.INFO, "the message is informational, not an error")
end)

-- ── a second identical check must not reload again ────────────────────────
H.run("unchanged file stays untouched", function()
  local path = fixture("steady.txt", { "as read" })
  local buf = open(path)
  local calls, restore = H.capture_notify()
  fire("FocusGained")
  fire("BufEnter", buf)
  fire("CursorHold", buf)
  restore()
  H.eq(#calls, 0, "no mtime change means no reload and no message")
  H.eq(lines_of(buf), { "as read" }, "the buffer keeps its text")
end)

-- ── modified buffer is left alone ─────────────────────────────────────────
H.run("modified buffer keeps local edits", function()
  local path = fixture("dirty.txt", { "disk" })
  local buf = open(path)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "my unsaved edit" })
  H.eq(vim.bo[buf].modified, true, "precondition: the buffer has local edits")
  local calls, restore = H.capture_notify()
  outside_write(path, { "someone else wrote this" })
  fire("FocusGained")
  fire("CursorHold", buf)
  restore()
  H.eq(lines_of(buf), { "my unsaved edit" }, "local edits win over the disk copy")
  H.eq(vim.bo[buf].modified, true, "the buffer stays modified")
  H.eq(#calls, 0, "a skipped reload sends no message")
end)

-- ── a special buffer is ignored ───────────────────────────────────────────
H.run("nofile buffer is never reloaded", function()
  local path = fixture("special.txt", { "disk" })
  local buf = vim.api.nvim_create_buf(true, true) -- listed, scratch
  vim.api.nvim_buf_set_name(buf, path)
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "plugin content" })
  vim.bo[buf].modified = false
  H.eq(vim.bo[buf].buftype, "nofile", "precondition: a special buffer")
  -- First check records the timestamp a normal buffer would carry; the second
  -- one would reload if the buftype guard were missing.
  fire("FocusGained")
  outside_write(path, { "disk moved on", "again" })
  fire("FocusGained")
  fire("BufEnter", buf)
  H.eq(lines_of(buf), { "plugin content" }, "a buftype ~= '' buffer is never reloaded")
end)

-- ── nofile is not the only special case: unnamed buffers too ──────────────
H.run("unnamed buffer is skipped", function()
  local buf = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_set_current_buf(buf)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "scratch" })
  vim.bo[buf].modified = false
  H.eq(vim.bo[buf].modified, false, "precondition: unmodified, so only the name guard applies")
  H.eq(vim.bo[buf].buftype, "", "precondition: an ordinary buftype")
  fire("FocusGained")
  fire("CursorHold", buf)
  H.eq(lines_of(buf), { "scratch" }, "a nameless buffer is left alone")
end)

-- ── a file deleted outside Neovim must not raise ──────────────────────────
H.run("deleted file keeps its text and its cool", function()
  local path = fixture("gone.txt", { "still here" })
  local buf = open(path)
  vim.fn.delete(path)
  fire("FocusGained")
  fire("CursorHold", buf)
  fire("BufEnter", buf)
  H.eq(lines_of(buf), { "still here" }, "the last known text stays in the buffer")
  H.eq(vim.bo[buf].modified, false, "a missing file alone does not dirty the buffer")
end)

-- ── a :write elsewhere checks the other buffers ───────────────────────────
H.run("write of one buffer refreshes another", function()
  local other = fixture("other.txt", { "old" })
  local other_buf = open(other)
  local current = fixture("current.txt", { "mine" })
  local cur_buf = open(current)
  H.ne(cur_buf, other_buf, "precondition: two different buffers")
  outside_write(other, { "new", "on disk" })
  vim.cmd("silent write") -- BufWritePost for current.txt
  H.eq(lines_of(other_buf), { "new", "on disk" }, "the unwritten buffer picks up its change")
  H.eq(vim.api.nvim_get_current_buf(), cur_buf, "the write keeps the current buffer")
  H.eq(lines_of(cur_buf), { "mine" }, "the written buffer keeps its text")
end)

-- ── one reload, one buffer: a sibling with edits is untouched ─────────────
H.run("focus reload never touches a dirty sibling", function()
  local clean = fixture("sibling-clean.txt", { "clean v1" })
  local dirty = fixture("sibling-dirty.txt", { "dirty v1" })
  local clean_buf = open(clean)
  local dirty_buf = open(dirty)
  vim.api.nvim_buf_set_lines(dirty_buf, 0, -1, false, { "dirty local" })
  outside_write(clean, { "clean v2" })
  outside_write(dirty, { "dirty v2" })
  fire("FocusGained")
  H.eq(lines_of(clean_buf), { "clean v2" }, "the clean sibling reloads")
  H.eq(lines_of(dirty_buf), { "dirty local" }, "the modified sibling keeps its edits")
end)

-- The runner quits with :qa, so no fixture buffer may stay modified.
for _, buf in ipairs(vim.api.nvim_list_bufs()) do
  vim.bo[buf].modified = false
end
vim.fn.delete(dir, "rf")
