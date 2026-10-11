-- helpers/mermaid_render.lua fence walk + width math (CI row X11, #182).
--
-- The REAL mermaid_fence_at / fence_body walk runs against the bundled
-- markdown treesitter parser, and the REAL width formula in M.render_float
-- sizes the float — never a copied formula (the usage.test.mjs anti-pattern).
-- mmdflux is faked by stubbing vim.fn.executable + vim.system before the
-- render call; Snacks and termopen are stubbed so no UI or pty is touched.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local mermaid = require("helpers.mermaid_render")

local ESC = "\27["

-- Fake mmdflux output: two styled rows plus padding; the widest visible
-- line is 40 columns.
local FAKE_ART = ESC .. "31m+--[ diagram: wide title ]----------+\27[0m   \n"
  .. ESC .. "32m| node A                     |\27[0m\n"

H.run("mermaid_render_spec", function()
  local mmdflux_present = true
  local snacks_buf = vim.api.nvim_create_buf(false, true)
  local notify_calls = {}
  local restore_notify = H.replace(vim, "notify", function(msg, level)
    notify_calls[#notify_calls + 1] = msg
  end)
  local real_executable = vim.fn.executable
  local restore_executable = H.replace(vim.fn, "executable", function(cmd)
    if cmd == "mmdflux" then
      return mmdflux_present and 1 or 0
    end
    return real_executable(cmd)
  end)
  local real_system = vim.system
  local system_calls = {}
  local restore_system = H.replace(vim, "system", function(cmd, opts)
    system_calls[#system_calls + 1] = { cmd = cmd, opts = opts }
    local result = { code = 0, stdout = FAKE_ART, stderr = "" }
    return { wait = function()
      return result
    end }
  end)
  local real_termopen = vim.fn.termopen
  local termopen_calls = {}
  local restore_termopen = H.replace(vim.fn, "termopen", function(cmd, opts)
    termopen_calls[#termopen_calls + 1] = { cmd = cmd, opts = opts }
    return #termopen_calls
  end)
  local real_writefile = vim.fn.writefile
  local writefile_calls = {}
  local restore_writefile = H.replace(vim.fn, "writefile", function(lines, path, flags)
    writefile_calls[#writefile_calls + 1] = { lines = lines, path = path }
    return 0
  end)
  local win_calls = {}
  local restore_snacks = H.replace(_G, "Snacks", {
    win = function(opts)
      win_calls[#win_calls + 1] = opts
      return { buf = snacks_buf, close = function() end }
    end,
  })

  local function make_doc(lines, cursor_row)
    local buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
    vim.bo[buf].filetype = "markdown"
    vim.api.nvim_set_current_buf(buf)
    vim.api.nvim_win_set_cursor(0, { cursor_row, 0 })
    return buf
  end

  local doc = {
    "intro line",
    "```mermaid",
    "graph TD",
    "  A --> B",
    "```",
    "```ansi",
    "not mermaid",
    "```",
    "tail",
  }

  -- ── happy path: real fence walk feeds the real stdin pipe ───────────────
  win_calls = {}
  system_calls = {}
  make_doc(doc, 3) -- cursor inside the mermaid fence

  vim.o.columns = 50
  mermaid.render_float()

  H.eq(#system_calls, 1, "render_float runs mmdflux exactly once")
  H.eq(system_calls[1].cmd, { "mmdflux" }, "mmdflux is invoked bare (no width flags)")
  H.eq(system_calls[1].opts.stdin, "graph TD\n  A --> B",
    "the REAL fence_body extracts only the mermaid fence between the fences")
  H.eq(#win_calls, 1, "one Snacks float opens")
  H.eq(win_calls[1].width, 40, "width = the widest visible art line (40) under the cap")
  H.eq(win_calls[1].wo.wrap, false, "the float never wraps; wide art scrolls")
  H.eq(#termopen_calls, 1, "the ANSI is replayed through a pty (`cat`)")
  H.eq(termopen_calls[1].cmd[1], "cat", "termopen runs cat on the captured output file")
  H.eq(writefile_calls[#writefile_calls].lines, vim.split(FAKE_ART, "\n", { plain = true }),
    "the captured output is written for the pty replay")
  H.eq(win_calls[1].bo.bufhidden, "wipe", "the float buffer wipes on close")

  -- ── width cap: narrow editor clamps to columns - 2 ──────────────────────
  vim.o.columns = 20
  win_calls = {}
  mermaid.render_float()
  H.eq(win_calls[1].width, 18, "a 20-column editor caps the float at 18 columns")

  -- ── cursor outside any mermaid fence ────────────────────────────────────
  notify_calls = {}
  win_calls = {}
  make_doc(doc, 1) -- intro line
  mermaid.render_float()
  H.eq(#win_calls, 0, "no float opens outside a mermaid fence")
  H.eq(notify_calls[1], "cursor is not inside a ```mermaid fence",
    "the user learns the cursor is outside a fence")

  -- ── an ansi fence is not a mermaid fence ────────────────────────────────
  make_doc(doc, 7) -- inside the ansi fence
  mermaid.render_float()
  H.eq(#win_calls, 0, "the fence walk matches only mermaid info strings")
  H.eq(#notify_calls, 2, "the second miss also notifies")

  -- ── mmdflux missing ─────────────────────────────────────────────────────
  mmdflux_present = false
  notify_calls = {}
  win_calls = {}
  make_doc(doc, 3)
  mermaid.render_float()
  H.eq(#win_calls, 0, "no float opens when mmdflux is absent")
  H.eq(notify_calls[1], "mmdflux not installed — see docs/neovim-mermaid-render.md",
    "the mmdflux-absent notice points at the runbook")

  -- ── non-markdown buffer ─────────────────────────────────────────────────
  mmdflux_present = true
  local buf = make_doc(doc, 3)
  vim.bo[buf].filetype = "lua"
  notify_calls = {}
  mermaid.render_float()
  H.eq(notify_calls[1], "mermaid render: not a markdown buffer", "non-markdown buffers are refused")

  -- ── foldexpr contract: one fold per recorded fence ──────────────────────
  -- foldexpr reads vim.v.lnum, which only the fold engine sets; the
  -- assertions below drive it through the real fold machinery.
  vim.cmd("new")
  local foldbuf = vim.api.nvim_get_current_buf()
  vim.api.nvim_buf_set_lines(foldbuf, 0, -1, false, {
    "a",
    "b",
    "```mermaid",
    "x",
    "```",
    "c",
  })
  vim.b[foldbuf].mermaid_fences = { { 2, 4 } }
  local foldwin = vim.api.nvim_get_current_win()
  vim.wo[foldwin].foldmethod = "expr"
  vim.wo[foldwin].foldexpr = "v:lua.require('helpers.mermaid_render').foldexpr()"
  H.eq(vim.fn.foldlevel(2), 0, "the line above the fence is unfolded")
  H.eq(vim.fn.foldlevel(3), 1, "the opening fence line starts the fold")
  H.eq(vim.fn.foldlevel(4), 1, "the fence body is inside the fold")
  H.eq(vim.fn.foldlevel(5), 1, "the closing fence line is inside the fold")
  H.eq(vim.fn.foldlevel(6), 0, "the line after the fence is unfolded")
  vim.cmd("close!")

  restore_snacks()
  restore_writefile()
  restore_termopen()
  restore_system()
  restore_executable()
  restore_notify()
end)
