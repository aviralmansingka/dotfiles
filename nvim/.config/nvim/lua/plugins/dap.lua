-- Treesitter-driven "expression under cursor" detection. Walks up from the
-- leaf node and returns the smallest call ancestor whose callee spans the
-- cursor — so on `w.Header().Set(...)` with cursor inside `Header`, we
-- evaluate `w.Header()`, not the whole chain. Falls back to the closest
-- expression-shaped ancestor when no call wraps the cursor.
local CALL_TYPES = {
  call_expression = true,
  call = true,
  function_call = true,
  method_call = true,
}
local EXPRESSION_TYPES = {
  identifier = true,
  field_identifier = true,
  property_identifier = true,
  selector_expression = true,
  member_expression = true,
  attribute = true,
  subscript_expression = true,
  index_expression = true,
  parenthesized_expression = true,
  binary_expression = true,
  interpreted_string_literal = true,
  string_literal = true,
  string = true,
  number_literal = true,
  number = true,
  integer = true,
  float = true,
  true_literal = true,
  false_literal = true,
  nil_literal = true,
  none_literal = true,
}

local function range_contains(node, row, col)
  if not node then
    return false
  end
  local sr, sc, er, ec = node:range()
  if row < sr or row > er then
    return false
  end
  if row == sr and col < sc then
    return false
  end
  if row == er and col > ec then
    return false
  end
  return true
end

local function expression_under_cursor()
  local cur_node = vim.treesitter.get_node()
  if not cur_node then
    return nil
  end
  local cursor_row, cursor_col = unpack(vim.api.nvim_win_get_cursor(0))
  cursor_row = cursor_row - 1

  local n = cur_node
  while n do
    if CALL_TYPES[n:type()] then
      local fn_field = n:field("function")
      local callee = (fn_field and fn_field[1]) or n:named_child(0)
      if range_contains(callee, cursor_row, cursor_col) then
        return n
      end
    end
    n = n:parent()
  end

  n = cur_node
  while n do
    if EXPRESSION_TYPES[n:type()] then
      return n
    end
    n = n:parent()
  end

  -- No call ancestor + no expression ancestor: cursor is on a keyword,
  -- operator, or statement boundary. Bail rather than send a syntax error
  -- to the REPL.
  return nil
end

-- Per-DAP-type stringify wrappers used by <localleader>y to convert the
-- last-evaluated expression into a copy-pasteable string. The REPL window
-- shows the raw evaluation; `<localleader>y` re-evaluates with this wrapper
-- so the string form lands on the clipboard regardless of what the REPL
-- displays. Different languages format values differently, so the wrapper
-- is per DAP session type.
local STRINGIFY = {
  python = function(expr)
    return "str(" .. expr .. ")"
  end,
  go = function(expr)
    return expr
  end,
  delve = function(expr)
    return expr
  end,
  -- Java: java-debug-adapter's evaluator already returns the Object.toString()
  -- form, so identity is the right wrapper.
  java = function(expr)
    return expr
  end,
}

local function find_repl_window()
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    local buf = vim.api.nvim_win_get_buf(win)
    if vim.bo[buf].filetype == "dap-repl" then
      return win
    end
  end
  return nil
end

-- Forward-declare so dap_eval_hover's keymap callback can reference it.
local dap_yank_stringify

-- Module-level state for eval/yank lifecycle. Tracks the persistent hover
-- float (auto/manual <localleader>g) and the last expression so
-- <localleader>y can re-evaluate the stringified form.
local _eval_state = {
  last_expr = nil,
  hover_buf = nil,
  hover_win = nil,
  idle_timer = nil,
}

local function close_hover()
  if _eval_state.hover_win and vim.api.nvim_win_is_valid(_eval_state.hover_win) then
    pcall(vim.api.nvim_win_close, _eval_state.hover_win, true)
  end
  _eval_state.hover_buf = nil
  _eval_state.hover_win = nil
end

local function get_cursor_expression()
  if vim.bo.filetype == "dap-repl" then
    return nil
  end
  local node = expression_under_cursor()
  if not node then
    return nil
  end
  local text = vim.treesitter.get_node_text(node, 0)
  if not text or text == "" then
    return nil
  end
  return text
end

-- Render the eval result in a hover float at the cursor (rounded border,
-- standard vim-hover dismissal — closes on any cursor move, insert-mode
-- entry, or buffer leave). Re-press <localleader>g after dismissal to
-- re-evaluate at the new cursor position. Auto-trigger silently skips
-- re-eval if the cursor is still on the same expression.
local function dap_eval_hover(opts)
  opts = opts or {}
  local ok_dap, dap = pcall(require, "dap")
  if not ok_dap then
    return
  end
  local session = dap.session()
  if not session or not session.stopped_thread_id then
    if opts.source == "manual" then
      vim.notify("DAP: no paused session", vim.log.levels.WARN)
    end
    return
  end

  if
    opts.source == "manual"
    and _eval_state.hover_win
    and vim.api.nvim_win_is_valid(_eval_state.hover_win)
    and vim.api.nvim_get_current_win() ~= _eval_state.hover_win
  then
    vim.api.nvim_set_current_win(_eval_state.hover_win)
    return
  end

  if _eval_state.hover_buf and vim.api.nvim_get_current_buf() == _eval_state.hover_buf then
    return
  end

  local expression = get_cursor_expression()
  if not expression then
    return
  end

  if
    opts.source == "auto"
    and expression == _eval_state.last_expr
    and _eval_state.hover_win
    and vim.api.nvim_win_is_valid(_eval_state.hover_win)
  then
    return
  end
  _eval_state.last_expr = expression

  local frame_id = session.current_frame and session.current_frame.id
  session:request("evaluate", {
    expression = expression,
    frameId = frame_id,
    context = "repl",
  }, function(err, response)
    vim.schedule(function()
      close_hover()

      local body = {}
      if err then
        body[1] = "Error: " .. (err.message or vim.inspect(err))
      else
        local result = (response and response.result) or "(no result)"
        for line in (result .. "\n"):gmatch("([^\n]*)\n") do
          table.insert(body, line)
        end
        --- Drop trailing blank from the gmatch sentinel.
        while #body > 0 and body[#body] == "" do
          body[#body] = nil
        end
        if #body == 0 then
          body = { "(no result)" }
        end
      end

      local fb, fw = vim.lsp.util.open_floating_preview(body, "", {
        border = "rounded",
        wrap = true,
        max_width = 100,
        max_height = 20,
        focusable = true,
        close_events = { "CursorMoved", "CursorMovedI", "InsertEnter", "BufLeave" },
      })
      _eval_state.hover_buf = fb
      _eval_state.hover_win = fw

      if fb then
        vim.keymap.set("n", "<localleader>y", function()
          dap_yank_stringify()
        end, { buffer = fb, desc = "DAP: Yank stringified value" })
        vim.keymap.set("n", "q", close_hover, { buffer = fb, desc = "DAP: Close eval hover" })
        vim.keymap.set("n", "<Esc>", close_hover, { buffer = fb, desc = "DAP: Close eval hover" })
      end
    end)
  end)
end

-- Run the cursor expression in the bottom REPL split (<localleader>r).
-- Opens the REPL if it isn't already; focus stays on the source window.
local function dap_eval_repl_split()
  local ok_dap, dap = pcall(require, "dap")
  if not ok_dap then
    return
  end
  local session = dap.session()
  if not session or not session.stopped_thread_id then
    vim.notify("DAP: no paused session", vim.log.levels.WARN)
    return
  end

  local expression = get_cursor_expression()
  if not expression then
    return
  end
  _eval_state.last_expr = expression

  local prev_win = vim.api.nvim_get_current_win()
  if not find_repl_window() then
    dap.repl.open({ height = 10 })
  end
  dap.repl.execute(expression)
  if vim.api.nvim_win_is_valid(prev_win) then
    vim.api.nvim_set_current_win(prev_win)
  end
end

-- Yank the stringified value of the last-evaluated expression. Per-language
-- via the STRINGIFY table keyed on the active DAP session's `config.type`.
-- (Assignment, not `local function`, because we forward-declared above.)
dap_yank_stringify = function()
  local ok_dap, dap = pcall(require, "dap")
  if not ok_dap then
    return
  end
  local session = dap.session()
  if not session or not session.stopped_thread_id then
    vim.notify("DAP: no paused session", vim.log.levels.WARN)
    return
  end
  if not _eval_state.last_expr then
    vim.notify("DAP: no expression tracked yet — evaluate one first", vim.log.levels.WARN)
    return
  end

  local typ = session.config and session.config.type
  local stringify = STRINGIFY[typ] or function(e)
    return e
  end
  local wrapped = stringify(_eval_state.last_expr)

  local frame_id = session.current_frame and session.current_frame.id
  session:request("evaluate", {
    expression = wrapped,
    frameId = frame_id,
    context = "clipboard",
  }, function(err, response)
    vim.schedule(function()
      if err then
        vim.notify("DAP yank error: " .. (err.message or vim.inspect(err)), vim.log.levels.ERROR)
        return
      end
      local result = (response and response.result) or ""
      vim.fn.setreg("+", result)
      vim.fn.setreg('"', result)
      local preview = #result > 80 and (result:sub(1, 80) .. "...") or result
      vim.notify("Yanked: " .. preview)
    end)
  end)
end

-- Idle auto-trigger: 2s of cursor stillness in a Python/Go source buffer
-- with an active paused DAP session opens the eval hover. CursorMoved
-- resets the timer.
local AUTO_TRIGGER_FILETYPES = { python = true, go = true, java = true }
local function reset_idle_timer()
  if _eval_state.idle_timer then
    _eval_state.idle_timer:stop()
    _eval_state.idle_timer:close()
    _eval_state.idle_timer = nil
  end
end

local _idle_group = vim.api.nvim_create_augroup("dap_eval_idle", { clear = true })
vim.api.nvim_create_autocmd({ "CursorMoved", "BufEnter", "InsertEnter", "WinEnter" }, {
  group = _idle_group,
  callback = function()
    reset_idle_timer()
    if not AUTO_TRIGGER_FILETYPES[vim.bo.filetype] then
      return
    end
    -- Preserve lazy-loading: don't force-load nvim-dap until something else has.
    if not package.loaded["dap"] then
      return
    end

    _eval_state.idle_timer = vim.uv.new_timer()
    _eval_state.idle_timer:start(
      2000,
      0,
      vim.schedule_wrap(function()
        reset_idle_timer()
        if not AUTO_TRIGGER_FILETYPES[vim.bo.filetype] then
          return
        end
        local sess = require("dap").session()
        if not sess or not sess.stopped_thread_id then
          return
        end
        dap_eval_hover({ source = "auto" })
      end)
    )
  end,
})

-- Buffer-local <localleader>y on REPL buffers to yank the stringified value
-- of the last-evaluated expression.
vim.api.nvim_create_autocmd("FileType", {
  group = _idle_group,
  pattern = "dap-repl",
  callback = function(args)
    vim.keymap.set("n", "<localleader>y", function()
      dap_yank_stringify()
    end, { buffer = args.buf, desc = "DAP: Yank stringified value" })
  end,
})

return {
  --- Contribute custom icons to dap-ui via opts merging. Calling dapui.setup() ourselves
  --- (we used to do this inside nvim-dap's config) trips E565 "Not allowed to change
  --- text or change window" because LazyVim's extras.dap.core spec ALSO calls
  --- dapui.setup, and dapui's second-pass cleanup does nvim_buf_delete which is
  --- textlock-restricted during Lazy's config phase. Letting Lazy merge opts means
  --- dapui.setup runs exactly once with our overrides folded in.
  {
    "rcarriga/nvim-dap-ui",
    optional = true,
    opts = {
      icons = { expanded = "▾", collapsed = "▸", current_frame = "*" },
      controls = {
        icons = {
          pause = "⏸",
          play = "▶",
          step_into = "⏎",
          step_over = "⏭",
          step_out = "⏮",
          step_back = "b",
          run_last = "▶▶",
          terminate = "⏹",
          disconnect = "⏏",
        },
      },
    },
  },

  {
  "mfussenegger/nvim-dap",
  dependencies = {
    "rcarriga/nvim-dap-ui",
    "nvim-neotest/nvim-nio",
    "mason-org/mason.nvim",
    "jay-babu/mason-nvim-dap.nvim",
    "mfussenegger/nvim-dap-python",
    {
      "theHamsta/nvim-dap-virtual-text",
      enabled = false,
    },
  },
  keys = {
    {
      "<localleader>b",
      function()
        require("dap").toggle_breakpoint()
      end,
      desc = "Debug: Toggle Breakpoint",
    },
    {
      "<localleader>c",
      function()
        require("dap").continue({})
      end,
      desc = "Debug: (C)ontinue",
    },
    {
      "<localleader>s",
      function()
        require("dap").step_into()
      end,
      desc = "Debug: (S)tep Into",
    },
    {
      "<localleader>d",
      function()
        require("dap").step_over()
      end,
      desc = "Debug: Step (D)own (Next)",
    },
    {
      "<localleader>b",
      function()
        require("dap").step_back()
      end,
      desc = "Debug: Step (b)ack",
    },
    {
      "<localleader>a",
      function()
        require("dap").step_out()
      end,
      desc = "Debug: Step out",
    },
    {
      "<localleader>q",
      function()
        require("dap").close()
      end,
      desc = "Debug: (Q)uit",
    },
    {
      "<leader>dt",
      function()
        require("dapui").toggle()
      end,
      desc = "Debug: Toggle UI",
    },
    {
      "<localleader>g",
      function()
        dap_eval_hover({ source = "manual" })
      end,
      desc = "Debug: Eval expression in hover (or focus hover if open)",
    },
    {
      "<localleader>r",
      function()
        dap_eval_repl_split()
      end,
      desc = "Debug: Eval expression in REPL split",
    },
    --- Show the debuggee's output. nvim-dap spawns the adapter (dlv) as a server
    --- executable and pipes its stdout/stderr to ~/.cache/nvim/dap-<type>-stdout.log
    --- and -stderr.log (see nvim-dap session.lua:spawn_server_executable). Delve
    --- forks the debuggee under those same fds, so program logs land there — they
    --- are NOT routed through DAP `output` events, so dap-ui's `console` element
    --- stays empty for delve-based sessions. Tailing the files in a terminal
    --- shows them live regardless of adapter behavior. Works equally well for
    --- a binary launch (machine-manager) and a DAP test (<leader>td).
    {
      "<leader>dl",
      function()
        local session = require("dap").session()
        if not session then
          vim.notify("Debug logs: no active DAP session", vim.log.levels.INFO)
          return
        end
        local typ = (session.config and session.config.type) or "go"
        local cache = vim.fn.stdpath("cache")
        local stdout = cache .. "/dap-" .. typ .. "-stdout.log"
        local stderr = cache .. "/dap-" .. typ .. "-stderr.log"

        --- Wipe stale tail buffers from a prior invocation; otherwise pressing
        --- <leader>dl in a long-lived session would stack tail processes.
        for _, b in ipairs(vim.api.nvim_list_bufs()) do
          local name = vim.api.nvim_buf_get_name(b)
          if name:match("dap%-stdout$") or name:match("dap%-stderr$") then
            pcall(vim.api.nvim_buf_delete, b, { force = true })
          end
        end

        --- One bottom split, two listed terminal buffers. We materialize stderr in
        --- a temporary :vsplit so :terminal can attach its job, then :close that
        --- split — the buffer survives in the bufferlist (bufhidden=hide keeps the
        --- tail process alive without a visible window). Result: stdout is shown
        --- in the bottom split; stderr is in the buffer list and reachable via
        --- LazyVim's L/H (next/prev buffer) just like any other buffer.
        vim.cmd("botright 15split")
        vim.cmd("terminal tail -n 200 -F " .. vim.fn.shellescape(stdout))
        vim.bo.bufhidden = "hide"
        vim.cmd("file dap-stdout")

        vim.cmd("vsplit")
        vim.cmd("terminal tail -n 200 -F " .. vim.fn.shellescape(stderr))
        vim.bo.bufhidden = "hide"
        vim.cmd("file dap-stderr")
        vim.cmd("close")

        vim.cmd("startinsert")
      end,
      desc = "Debug: Show Logs (stdout/stderr buffers, switch with L/H)",
    },
  },
  config = function()
    local dap = require("dap")
    local dapui = require("dapui")

    -- Don't auto-open the dap-ui on session start; <leader>dt opens it on demand.
    -- Explicit nil clears LazyVim's extras.dap.core listener (loaded earlier as a
    -- dependency); leaving the auto-close listeners so an open UI cleans up cleanly
    -- when a session ends.
    dap.listeners.after.event_initialized["dapui_config"] = nil
    dap.listeners.before.event_terminated["dapui_config"] = dapui.close
    dap.listeners.before.event_exited["dapui_config"] = dapui.close

    -- nvim-dap-virtual-text is declared with enabled=false in the deps; skip its setup here

    -- Enhanced DAP signs with better debugging visibility
    vim.fn.sign_define(
      "DapBreakpoint",
      { text = "●", texthl = "DapBreakpoint", linehl = "DapBreakpointLine", numhl = "DapBreakpointNum" }
    )
    vim.fn.sign_define(
      "DapBreakpointCondition",
      { text = "◐", texthl = "DapBreakpointCondition", linehl = "DapBreakpointLine", numhl = "DapBreakpointNum" }
    )
    vim.fn.sign_define("DapLogPoint", { text = "◆", texthl = "DapLogPoint", linehl = "", numhl = "" })
    vim.fn.sign_define(
      "DapStopped",
      { text = "→", texthl = "DapStopped", linehl = "DapStoppedLine", numhl = "DapStoppedNum" }
    )
    vim.fn.sign_define(
      "DapBreakpointRejected",
      { text = "○", texthl = "DapBreakpointRejected", linehl = "", numhl = "" }
    )
    vim.fn.sign_define(
      "DapException",
      { text = "❌", texthl = "DapException", linehl = "DapExceptionLine", numhl = "DapExceptionNum" }
    )

    -- Define custom highlight groups for debugging
    vim.api.nvim_set_hl(0, "DapBreakpoint", { fg = "#d8a657" }) -- Gruvbox yellow
    vim.api.nvim_set_hl(0, "DapBreakpointLine", { bg = "#3c3110" }) -- Subtle yellow background
    vim.api.nvim_set_hl(0, "DapBreakpointNum", { fg = "#d8a657" })
    vim.api.nvim_set_hl(0, "DapBreakpointCondition", { fg = "#fabd2f" }) -- Brighter yellow for conditions
    vim.api.nvim_set_hl(0, "DapStopped", { fg = "#7daea3" }) -- Gruvbox blue
    vim.api.nvim_set_hl(0, "DapStoppedLine", { bg = "#1f2c2e" }) -- Blue background for current line
    vim.api.nvim_set_hl(0, "DapStoppedNum", { fg = "#7daea3", bold = true })
    vim.api.nvim_set_hl(0, "DapLogPoint", { fg = "#89b482" }) -- Gruvbox teal
    vim.api.nvim_set_hl(0, "DapBreakpointRejected", { fg = "#928374" }) -- Gruvbox gray
    vim.api.nvim_set_hl(0, "DapException", { fg = "#ea6962" }) -- Gruvbox red
    vim.api.nvim_set_hl(0, "DapExceptionLine", { bg = "#3d1f1f" }) -- Red background for exceptions
    vim.api.nvim_set_hl(0, "DapExceptionNum", { fg = "#ea6962", bold = true })
  end,
  },
}
