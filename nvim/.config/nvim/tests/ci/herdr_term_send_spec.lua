-- herdr/term_send.lua contract spec (send cluster).
--
-- Migrated from nvim/tests/herdr_term_send_spec.lua, which built
-- package.path from vim.fn.getcwd(): if the cwd assumption ever drifted, the
-- case silently loaded the stowed ~/.config/nvim copy instead of the worktree
-- (the #220 wrong-copy class). This copy loads the worktree config through
-- the shared offline harness (NVIM_TEST_CONFIG_ROOT or a walk up from this
-- file) and exits non-zero on failure.
--
-- Coverage: raw payloads (no header), byte cap, float-terminal targeting
-- through a fake Snacks singleton, and the chan_send delivery path with a
-- stubbed channel. No network, no live terminal.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

H.run("herdr_term_send_spec", function()
  local notify_calls, restore_notify = H.capture_notify()
  local term_send = require("plugins.herdr.term_send")

  -- ── raw payloads: no header, no agent formatting ───────────────────────
  local tmp = vim.fn.tempname()
  vim.fn.mkdir(tmp, "p")
  local file = tmp .. "/sample.lua"
  vim.fn.writefile({ "line one", "line two", "line three" }, file)
  vim.cmd("edit " .. vim.fn.fnameescape(file))
  local bufnr = vim.api.nvim_get_current_buf()

  H.eq(term_send.build_payload(bufnr, false), "line one\nline two\nline three",
    "buffer payload is raw text with no header")

  vim.api.nvim_buf_set_mark(bufnr, "<", 2, 0, {})
  vim.api.nvim_buf_set_mark(bufnr, ">", 3, 0, {})
  H.eq(term_send.build_payload(bufnr, true), "line two\nline three",
    "selection payload is raw selected text with no header")

  local saved_max = term_send.max_bytes
  term_send.max_bytes = 10
  local truncated = term_send.build_payload(bufnr, false)
  H.truthy(#truncated <= 10, "raw payload respects the byte cap")
  H.eq(truncated:find("[truncated", 1, true), nil, "truncation adds no header note")
  term_send.max_bytes = saved_max

  H.eq(type(term_send.resolve_target), "function",
    "resolve_target is exposed for the Snacks terminal")

  -- ── float-terminal targeting through a fake Snacks singleton ──────────
  -- term_cwd mirrors LazyVim.root so <leader>tt targets the same terminal
  -- as <leader>ft.
  local fake_buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_var(fake_buf, "terminal_job_id", 4242)
  local gets, shown, focused = {}, 0, 0
  local fake_term = {
    buf = fake_buf,
    show = function() shown = shown + 1 end,
    focus = function() focused = focused + 1 end,
  }
  local Snacks = {
    terminal = {
      get = function(_, opts)
        gets[#gets + 1] = opts
        return fake_term, false
      end,
    },
  }
  package.loaded["snacks"] = Snacks

  H.eq(type(term_send.resolve_target()), "number",
    "resolve_target returns the pty job id of the float")
  H.eq(gets[#gets].cwd, vim.fn.getcwd(),
    "without LazyVim the float targets the current working directory")

  _G.LazyVim = { root = function() return "/from/lazyvim" end }
  term_send.resolve_target()
  H.eq(gets[#gets].cwd, "/from/lazyvim", "LazyVim.root drives the float cwd")
  _G.LazyVim = nil

  H.eq(shown, 2, "an already-created float is shown before delivery")
  H.eq(focused, 2, "the float is focused when it advertises focus")

  -- A freshly created float must not be shown twice.
  Snacks.terminal.get = function(_, opts)
    gets[#gets + 1] = opts
    return fake_term, true
  end
  shown = 0
  term_send.resolve_target()
  H.eq(shown, 0, "a freshly created float is not shown again")

  -- Failure paths report and never deliver.
  package.loaded["snacks"] = nil
  _G.Snacks = nil
  H.eq(term_send.send({ bufnr = bufnr }), false,
    "no Snacks terminal available reports failure")
  H.eq(notify_calls[#notify_calls].msg, "Snacks terminal not available",
    "the missing-Snacks error is surfaced")

  Snacks.terminal.get = function() return { buf = vim.api.nvim_create_buf(false, true) } end
  package.loaded["snacks"] = Snacks
  H.eq(term_send.send({ bufnr = bufnr }), false, "a float without a pty job fails")
  H.eq(notify_calls[#notify_calls].msg, "Floating terminal has no pty job",
    "the missing-pty error is surfaced")

  -- ── chan_send delivery with a stubbed channel ─────────────────────────
  local chan = {}
  local restore_chan = H.replace(vim.api, "nvim_chan_send", function(job, data)
    chan[#chan + 1] = { job = job, data = data }
  end)
  Snacks.terminal.get = function() return fake_term, false end
  local warned = #notify_calls

  H.eq(term_send.send({ bufnr = bufnr }), true, "chan delivery reports success")
  H.eq(#chan, 1, "exactly one channel write happens")
  H.eq(chan[1].job, 4242, "the write goes to the float pty job")
  H.eq(chan[1].data, "line one\nline two\nline three\n",
    "the payload bytes carry a trailing newline so a single line runs")

  H.eq(term_send.send({ bufnr = bufnr, visual = true }), true,
    "a visual send also delivers")
  H.eq(chan[#chan].data, "line two\nline three\n",
    "the selection bytes end with one newline, never two")

  H.eq(#chan, 2, "no extra channel writes happen")
  H.truthy(#notify_calls > warned, "a successful send reports where the payload went")
  local last = notify_calls[#notify_calls]
  H.truthy(last.msg:find("Sent .- to floating terminal", 1) ~= nil,
    "the notice names the float terminal")
  H.eq(last.level, vim.log.levels.INFO,
    "the success notice is informational, not a warning")

  restore_chan()
  restore_notify()
end)

print("herdr_term_send_spec: ok")
