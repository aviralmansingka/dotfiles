vim.opt.termguicolors = true
vim.opt.number = true

-- Fully disable swap files and the "swap file found" recovery prompt.
vim.opt.swapfile = false
vim.opt.shortmess:append("A")

-- OSC52 Clipboard Configuration
-- Supports both local and remote (SSH) development
-- Copy works over SSH via OSC52, paste uses local Neovim buffer to avoid timeouts
vim.o.clipboard = "unnamedplus"

local function paste()
  return {
    vim.split(vim.fn.getreg(""), "\n"),
    vim.fn.getregtype(""),
  }
end

if vim.env.SSH_TTY then
  -- SSH session: Use OSC52 for copy, local buffer for paste (no timeouts)
  vim.g.clipboard = {
    name = "OSC 52",
    copy = {
      ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
      ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
    },
    paste = {
      ["+"] = paste,
      ["*"] = paste,
    },
  }
end

-- Send pastes into :term buffers to the inner program's PTY.  Neovim's
-- default vim.paste uses nvim_put() for terminal buffers, which does forward
-- text to the PTY but does NOT wrap it in bracketed-paste markers.  Without
-- markers, nested programs in normal mode (e.g. vim) interpret pasted \n as
-- Ctrl-J = `j` motion.  Wrapping with \27[200~…\27[201~ tells such programs to
-- treat the content as a paste.
--
-- However, only wrap when the inner program has actually ENABLED bracketed-
-- paste mode (sent \27[?2004h).  When the inner program has not opted in (e.g.
-- cat, a REPL, a shell running a foreground process), the markers are
-- meaningless and cause visible tilde artifacts: the :term PTY has echo +
-- echoctl enabled by default, so the kernel echoes the ESC byte as literal
-- "^[" (caret notation), preventing libvterm from recognising the CSI
-- sequence.  The "~" in \27[200~ / \27[201~ then appears as a literal tilde.
-- Programs that enable bracketed paste (vim, zsh ZLE, pi-agent) set the PTY
-- to raw mode (disabling echo), so the markers are never echoed and no
-- tildes appear.
--
-- We track bracketed-paste mode by wrapping terminal job callbacks and scanning
-- the program's raw output for \27[?2004h / \27[?2004l.
local BP_ENABLE = "\27[?2004h"
local BP_DISABLE = "\27[?2004l"
local term_bp_mode = {} -- chan → boolean (inner program has BP enabled)
local paste_buf = {}
local default_paste = vim.paste

do
  local original_termopen = vim.fn.termopen
  local original_jobstart = vim.fn.jobstart

  local function tracked_opts(opts)
    opts = vim.tbl_extend("force", {}, opts or {})
    local user_on_stdout = opts.on_stdout
    local tail = ""
    opts.on_stdout = function(job_id, data, event)
      if type(data) == "table" then
        local output = tail .. table.concat(data, "\n")
        local offset = 1
        while true do
          local enabled_at = output:find(BP_ENABLE, offset, true)
          local disabled_at = output:find(BP_DISABLE, offset, true)
          if enabled_at and (not disabled_at or enabled_at < disabled_at) then
            term_bp_mode[job_id] = true
            offset = enabled_at + #BP_ENABLE
          elseif disabled_at then
            term_bp_mode[job_id] = false
            offset = disabled_at + #BP_DISABLE
          else
            break
          end
        end

        tail = ""
        for length = math.min(#output, #BP_ENABLE - 1), 1, -1 do
          local suffix = output:sub(-length)
          if BP_ENABLE:sub(1, length) == suffix or BP_DISABLE:sub(1, length) == suffix then
            tail = suffix
            break
          end
        end
      end
      if user_on_stdout then
        user_on_stdout(job_id, data, event)
      end
    end
    return opts
  end

  local function tracked_start(start, cmd, opts)
    local chan = start(cmd, tracked_opts(opts))
    if chan and chan ~= 0 then
      term_bp_mode[chan] = false
    end
    return chan
  end

  if original_termopen then
    vim.fn.termopen = function(cmd, opts)
      return tracked_start(original_termopen, cmd, opts)
    end
  end

  vim.fn.jobstart = function(cmd, opts)
    if type(opts) == "table" and opts.term == true then
      return tracked_start(original_jobstart, cmd, opts)
    end
    return original_jobstart(cmd, opts)
  end
end

vim.api.nvim_create_autocmd("TermOpen", {
  callback = function(args)
    local chan = vim.b[args.buf].terminal_job_id
    if chan then
      -- Vimscript :terminal bypasses tracked callbacks, so its BP mode cannot be tracked and paste stays raw.
      term_bp_mode[chan] = false
    end
  end,
})

vim.paste = function(lines, phase)
  if vim.bo.buftype == "terminal" and vim.b.terminal_job_id then
    local chan = vim.b.terminal_job_id
    local content
    if phase == -1 then
      content = table.concat(lines, "\n")
    else
      if phase == 1 then
        paste_buf = vim.deepcopy(lines)
      elseif #paste_buf > 0 and #lines > 0 then
        -- Continuation: last line of buf concatenates with first line of new
        -- chunk (nvim splits at byte boundaries, so a line can span phases).
        paste_buf[#paste_buf] = paste_buf[#paste_buf] .. lines[1]
        for i = 2, #lines do
          table.insert(paste_buf, lines[i])
        end
      else
        vim.list_extend(paste_buf, lines)
      end
      if phase == 3 then
        content = table.concat(paste_buf, "\n")
        paste_buf = {}
      end
    end

    if content then
      if term_bp_mode[chan] == true then
        content = "\27[200~" .. content .. "\27[201~"
      end
      vim.api.nvim_chan_send(chan, content)
    end
    return true
  end
  return default_paste(lines, phase)
end

-- Stack jumplist configuration
vim.opt.jumpoptions = "stack" -- Use stack-based jumplist behavior

-- Configure LazyVim to use Snacks picker for LSP operations
vim.g.lazyvim_picker = "snacks"
vim.g.root_spec = { "cwd" }

-- Python: use basedpyright (stricter pyright fork) via lazyvim.plugins.extras.lang.python
vim.g.lazyvim_python_lsp = "basedpyright"

-- LazyVim's import-order check is a false positive here (lua/config/lazy.lua
-- has lazyvim.plugins → extras → plugins in the correct order).
vim.g.lazyvim_check_order = false
