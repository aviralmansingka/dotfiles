-- helpers/mermaid_render.lua beyond the fence walk and width math (those are
-- mermaid_render_spec.lua's surface): the render_float guard and notify
-- paths (TERM env construction, mmdflux failure, empty output, empty fence)
-- and the inline auto-render state machine (setup_inline idempotency, the
-- images.scm query shadow, the missing-engine error cache, the pending-map
-- dedup that acts as the debounce, and warm-cache extmark placement).
--
-- grok-mermaid / node / mmdflux are stubbed through vim.system, vim.fn and
-- _G.Snacks; no live binary, no float display, no colorscheme render.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local mermaid = require("helpers.mermaid_render")

local ns = vim.api.nvim_create_namespace("mermaid-ascii")

local function extmarks(buf)
  return vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })
end

local function virt_text(buf)
  local out = {}
  for _, m in ipairs(extmarks(buf)) do
    for _, line in ipairs(m[4].virt_lines or {}) do
      out[#out + 1] = line[1][1]
    end
  end
  return out
end

---Write a temp .md fixture and open it in the current window (fires the
---real BufWinEnter autocmds registered by setup_inline).
local function open_md(lines)
  local path = vim.fn.tempname() .. ".md"
  vim.fn.writefile(lines, path)
  vim.cmd("edit " .. vim.fn.fnameescape(path))
  return vim.api.nvim_get_current_buf(), path
end

-- Shared mutable state for the render_float section (sync vim.system form).
local mmdflux_result = { code = 0, stdout = "art\n", stderr = "" }
local system_calls, win_calls, termopen_calls, notify_calls = {}, {}, {}, {}

H.run("mermaid_render_state_spec", function()
  -- ── Part A: render_float guard paths (argv/env/exit handling) ───────────
  local restore_notify = H.replace(vim, "notify", function(msg, level)
    notify_calls[#notify_calls + 1] = { msg = msg, level = level }
  end)
  local restore_executable = H.replace(vim.fn, "executable", function(cmd)
    return cmd == "mmdflux" and 1 or 0
  end)

  local function make_doc(cursor_row)
    local buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
      "intro",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "tail",
    })
    vim.bo[buf].filetype = "markdown"
    vim.api.nvim_set_current_buf(buf)
    vim.api.nvim_win_set_cursor(0, { cursor_row, 0 })
    return buf
  end

  local real_system = vim.system
  local restore_system = H.replace(vim, "system", function(cmd, opts)
    system_calls[#system_calls + 1] = { cmd = cmd, opts = opts }
    local result = mmdflux_result
    return { wait = function()
      return result
    end }
  end)
  local restore_snacks = H.replace(_G, "Snacks", {
    win = function(opts)
      win_calls[#win_calls + 1] = opts
      return { buf = vim.api.nvim_create_buf(false, true), close = function() end }
    end,
  })
  local restore_termopen = H.replace(vim.fn, "termopen", function(cmd, opts)
    termopen_calls[#termopen_calls + 1] = { cmd = cmd, opts = opts }
    return #termopen_calls
  end)
  local restore_writefile = H.replace(vim.fn, "writefile", function()
    return 0
  end)

  -- command construction: bare argv, stdin piped, TERM env preserved only
  make_doc(3)
  mermaid.render_float()
  H.eq(#system_calls, 1, "render_float runs mmdflux exactly once")
  H.eq(system_calls[1].cmd, { "mmdflux" }, "the argv stays bare mmdflux")
  H.eq(system_calls[1].opts.env, { TERM = vim.env.TERM or "xterm-256color" },
    "only TERM is passed through the environment")
  H.eq(type(system_calls[1].opts.stdin), "string", "the fence body is piped through stdin")
  H.eq(#win_calls, 1, "the happy path opens one float")

  -- exit != 0: notify, never crash, never open a float
  system_calls, win_calls, termopen_calls = {}, {}, {}
  mmdflux_result = { code = 2, stdout = "", stderr = "boom" }
  notify_calls = {}
  make_doc(3)
  mermaid.render_float()
  H.eq(#win_calls, 0, "no float opens when mmdflux exits non-zero")
  H.eq(#termopen_calls, 0, "no pty replay happens on failure")
  H.eq(notify_calls[1].msg, "mmdflux failed (exit 2): boom",
    "the failure notice names the exit code and stderr")
  H.eq(notify_calls[1].level, vim.log.levels.ERROR, "a binary failure is an ERROR notice")
  H.eq(#notify_calls, 1, "exactly one notice on failure")

  -- exit 0 but empty output: a warning, no float
  system_calls, win_calls, termopen_calls = {}, {}, {}
  mmdflux_result = { code = 0, stdout = "", stderr = "" }
  notify_calls = {}
  make_doc(3)
  mermaid.render_float()
  H.eq(#win_calls, 0, "no float opens for empty output")
  H.eq(notify_calls[1].msg, "mmdflux produced no output", "empty stdout gets its own warning")
  H.eq(notify_calls[1].level, vim.log.levels.WARN, "empty output is a WARN notice")

  -- an empty mermaid fence never spawns the binary
  local empty = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(empty, 0, -1, false, { "```mermaid", "```" })
  vim.bo[empty].filetype = "markdown"
  vim.api.nvim_set_current_buf(empty)
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  system_calls, notify_calls = {}, {}
  mermaid.render_float()
  H.eq(#system_calls, 0, "an empty fence body never runs mmdflux")
  H.eq(notify_calls[1].msg, "mermaid fence is empty", "the empty fence gets an INFO notice")
  H.eq(notify_calls[1].level, vim.log.levels.INFO, "the empty fence notice is INFO")

  restore_writefile()
  restore_termopen()
  restore_snacks()
  restore_system()
  restore_executable()
  restore_notify()

  -- ── Part B: setup_inline — idempotent registration + query shadow ──────
  local query_sets = {}
  local restore_set = H.replace(vim.treesitter.query, "set", function(lang, name, text)
    query_sets[#query_sets + 1] = { lang = lang, name = name, text = text }
  end)
  local restore_notify2 = H.replace(vim, "notify", function() end)

  mermaid.setup_inline()

  local hl_autocmds = vim.api.nvim_get_autocmds({ group = "mermaid_ascii_hl" })
  H.eq(#hl_autocmds, 1, "one colorscheme autocmd re-applies the art palette")
  H.eq(hl_autocmds[1].event, "ColorScheme", "the palette autocmd listens to ColorScheme")

  -- nvim_get_autocmds expands one registration into per-(event, pattern)
  -- rows; normalize back per autocmd id before comparing shapes.
  local function normalized_autocmds(group)
    local by_id = {}
    for _, a in ipairs(vim.api.nvim_get_autocmds({ group = group })) do
      by_id[a.id] = by_id[a.id] or { events = {}, patterns = {} }
      by_id[a.id].events[a.event] = true
      by_id[a.id].patterns[a.pattern] = true
    end
    local out = {}
    for _, e in pairs(by_id) do
      local ev, pat = vim.tbl_keys(e.events), vim.tbl_keys(e.patterns)
      table.sort(ev)
      table.sort(pat)
      out[#out + 1] = { events = ev, patterns = pat }
    end
    table.sort(out, function(x, y)
      return table.concat(x.events) < table.concat(y.events)
    end)
    return out
  end

  H.eq(normalized_autocmds("mermaid_ascii"), {
    { events = { "BufWinEnter" }, patterns = { "*" } },
    { events = { "BufWinEnter", "InsertLeave", "TextChanged" }, patterns = { "*.markdown", "*.md" } },
    { events = { "CursorMoved", "CursorMovedI" }, patterns = { "*.markdown", "*.md" } },
  }, "setup_inline installs exactly three autocmds: render triggers, cursor "
    .. "reveal, and fold-option restore")

  -- idempotency: a second setup_inline changes nothing (clear=true groups)
  mermaid.setup_inline()
  H.eq(#normalized_autocmds("mermaid_ascii"), 3,
    "a second setup_inline adds no autocmds")
  H.eq(#vim.api.nvim_get_autocmds({ group = "mermaid_ascii_hl" }), 1,
    "a second setup_inline adds no palette autocmds")

  -- the art palette exists and a colorscheme switch re-applies it
  local function fg_of(name)
    local fg = vim.api.nvim_get_hl(0, { name = name, link = false }).fg
    return fg and string.format("#%06x", fg) or nil
  end
  H.eq(fg_of("MermaidAsciiEdge"), "#7daea3", "edge spans use the aqua Gruvbox tone")
  H.eq(fg_of("MermaidAsciiTitle"), "#d3869b", "title spans use the pink Gruvbox tone")
  vim.api.nvim_set_hl(0, "MermaidAsciiEdge", {})
  H.eq(fg_of("MermaidAsciiEdge"), nil, "sanity: the group was cleared")
  vim.api.nvim_exec_autocmds("ColorScheme", {})
  H.eq(fg_of("MermaidAsciiEdge"), "#7daea3", "ColorScheme re-applies the art palette")

  -- the query shadow: images.scm is registered as an explicit query so the
  -- snacks `mermaid` pipeline never runs. The file is read from
  -- stdpath("config"), which a CI entry may point anywhere — assert both
  -- arms deterministically by comparing against the worktree shadow.
  local shadow_path = root .. "/queries/markdown/images.scm"
  local f = io.open(shadow_path, "r")
  H.truthy(f, "the worktree images.scm shadow exists")
  local shadow = f:read("*a")
  f:close()
  local std_f = io.open(vim.fn.stdpath("config") .. "/queries/markdown/images.scm", "r")
  if std_f then
    local std = std_f:read("*a")
    std_f:close()
    -- two setup_inline calls above → one registration each
    H.eq(#query_sets, 2, "each setup_inline registers the shadow exactly once")
    for i = 1, 2 do
      H.eq(query_sets[i].lang, "markdown", "the shadow targets the markdown language")
      H.eq(query_sets[i].name, "images", "the shadow overrides the images query")
      H.eq(query_sets[i].text, std, "the registered text is the config-root file verbatim")
    end
    if std == shadow then
      H.eq(std:find('"mermaid"', 1, true) ~= nil, false, "the shadow removes the mermaid pattern")
      H.eq(std:find('"math"', 1, true) ~= nil, true, "the shadow keeps the math pattern")
    end
  else
    H.eq(#query_sets, 0, "a missing shadow file is a silent no-op, not a crash")
  end
  restore_set()
  restore_notify2()

  -- ── Part C: inline render with the engine missing ───────────────────────
  -- npm fails and no pi bundled install exists → the fence renders an error
  -- line, cached per fence body.
  local systemlist_calls = 0
  local restore_systemlist = H.replace(vim.fn, "systemlist", function()
    systemlist_calls = systemlist_calls + 1
    error("npm: offline in CI")
  end)
  local restore_glob = H.replace(vim.fn, "glob", function()
    return {}
  end)

  local buf1, _ = open_md({ "intro", "```mermaid", "A-->B", "```", "tail" })
  H.eq(vim.b[buf1].mermaid_fences, { { 1, 3 } },
    "the fence walk records the exact 0-based inclusive fence range")
  local marks = extmarks(buf1)
  H.eq(#marks, 1, "the missing engine places exactly one extmark")
  local lines1 = virt_text(buf1)
  H.eq(lines1[2], "⚠ mermaid: grok-mermaid not found (npm i -g grok-mermaid)",
    "the extmark shows the install hint")

  -- re-entering the buffer re-renders from the cache: still one extmark
  vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = buf1 })
  H.eq(#extmarks(buf1), 1, "a cached error re-renders as a single extmark")
  H.eq(virt_text(buf1)[2], "⚠ mermaid: grok-mermaid not found (npm i -g grok-mermaid)",
    "the cached error text is stable")

  -- ── Part D: inline render with a stubbed engine ─────────────────────────
  -- A fake grok-mermaid dist exists; vim.system is captured so the async
  -- callback is delivered by hand — no node process ever runs.
  local fake_root = vim.fn.tempname() .. "-npmroot"
  local fake_dist = fake_root .. "/grok-mermaid"
  restore_systemlist()
  local restore_systemlist2 = H.replace(vim.fn, "systemlist", function()
    systemlist_calls = systemlist_calls + 1
    return { fake_root }
  end)
  local restore_isdirectory = H.replace(vim.fn, "isdirectory", function(path)
    if path == fake_dist then
      return 1
    end
    return 0
  end)

  local async_calls = {}
  local restore_system2 = H.replace(vim, "system", function(cmd, opts, cb)
    async_calls[#async_calls + 1] = { cmd = cmd, opts = opts, cb = cb }
    return {}
  end)

  local buf2, _ = open_md({ "```mermaid", "X-->Y", "```" })
  H.eq(#async_calls, 1, "a fresh fence body spawns exactly one node render")
  H.eq(async_calls[1].cmd[1], "node", "the engine runs through node")
  H.eq(async_calls[1].cmd[2], "--input-type=module", "the engine runs as an ES module")
  H.eq(async_calls[1].cmd[3], "-e", "the engine script is passed inline")
  H.truthy(async_calls[1].cmd[4]:find("GROK_DIST", 1, true),
    "the inline script reads the dist from GROK_DIST")
  H.eq(async_calls[1].opts.env.GROK_DIST, fake_dist, "the dist path is the env contract")
  H.eq(async_calls[1].opts.stdin, "X-->Y", "the fence body is the engine's stdin")

  -- while a render is pending, re-rendering must not spawn again (the
  -- pending map is the debounce state machine)
  vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = buf2 })
  vim.api.nvim_exec_autocmds("TextChanged", { buffer = buf2 })
  H.eq(#async_calls, 1, "a pending render absorbs re-render triggers (dedup)")

  -- deliver the art: the callback schedules onto the real loop
  async_calls[1].cb({
    code = 0,
    stdout = vim.json.encode({ styled = {
      { { text = "┌─┐", cls = "border" }, { text = "X", cls = "text" } },
      { { text = "└─┘", cls = "border" } },
    }, warnings = {} }),
    stderr = "",
  })
  local warm = vim.wait(100, function()
    local m = extmarks(buf2)
    return #m == 1 and (m[1][4].virt_lines or {})[2] ~= nil
  end)
  H.truthy(warm, "the scheduled callback places the art within the event loop")

  local art = extmarks(buf2)[1][4].virt_lines
  H.eq(art[1][1][2], "Comment", "a spacing line separates art and source")
  H.eq(art[2][1][1], "┌─┐", "the first art row is the styled span text")
  H.eq(art[2][1][2], "MermaidAsciiBorder", "border spans map to the border group")
  H.eq(art[2][2][2], "MermaidAsciiText", "label spans map to the text group")
  H.eq(extmarks(buf2)[1][2], 0,
    "the art anchors to the line above the fence (outside the fold)")

  -- warm cache: re-rendering spawns nothing new
  vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = buf2 })
  H.eq(#async_calls, 1, "a warm cache never re-spawns the engine")

  -- a render that fails delivers the generic error line
  local buf3, _ = open_md({ "```mermaid", "bad", "```" })
  H.eq(#async_calls, 2, "a different fence body is a fresh cache key")
  async_calls[2].cb({ code = 1, stdout = "", stderr = "nope" })
  local failed = vim.wait(100, function()
    for _, t in ipairs(virt_text(buf3)) do
      if t:find("render failed", 1, true) then
        return true
      end
    end
    return false
  end)
  H.truthy(failed, "a failed render shows the error line, never a crash")

  restore_system2()
  restore_isdirectory()
  restore_systemlist2()
  restore_glob()

  -- ── Part E: fold reveal and fold text through the real fold engine ─────
  vim.cmd("new")
  local fbuf = vim.api.nvim_get_current_buf()
  vim.api.nvim_buf_set_name(fbuf, vim.fn.tempname() .. "-fold.md")
  vim.api.nvim_buf_set_lines(fbuf, 0, -1, false, { "a", "```mermaid", "x", "y", "```", "c" })
  vim.b[fbuf].mermaid_fences = { { 1, 4 } }
  local fwin = vim.api.nvim_get_current_win()
  vim.wo[fwin].foldmethod = "expr"
  vim.wo[fwin].foldexpr = "v:lua.require('helpers.mermaid_render').foldexpr()"
  vim.wo[fwin].foldtext = "v:lua.require('helpers.mermaid_render').foldtext()"
  vim.wo[fwin].foldenable = true
  H.eq(vim.fn.foldclosed(2), 2, "the fence starts folded")

  -- the CursorMoved autocmd opens the fold while the cursor is inside
  vim.api.nvim_win_set_cursor(fwin, { 3, 0 })
  vim.api.nvim_exec_autocmds("CursorMoved", { buffer = fbuf })
  H.eq(vim.fn.foldclosed(2), -1, "the cursor inside the fence opens the fold")

  -- and closes it again on leave
  vim.api.nvim_win_set_cursor(fwin, { 6, 0 })
  vim.api.nvim_exec_autocmds("CursorMoved", { buffer = fbuf })
  H.eq(vim.fn.foldclosed(2), 2, "the cursor leaving the fence closes the fold")

  -- the closed fold shows the dim summary, not the raw fence lines
  H.eq(vim.fn.foldtextresult(2), "  ▸ mermaid source (4 lines) — cursor here to edit",
    "foldtext renders the one-line dim source summary")
  vim.cmd("close!")
end)
