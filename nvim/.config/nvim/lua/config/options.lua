vim.opt.termguicolors = true
vim.opt.number = true

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

-- Re-wrap pastes into :term buffers with bracketed-paste markers, so nested
-- terminal programs (tmux + claude/vim inside :term) see a paste, not raw
-- keystrokes (\n = Ctrl-J = vim normal-mode `j`). Buffers chunked phases
-- (which happen over SSH when bytes arrive split across reads) into a single
-- write — splitting the bracketed-paste sequence across two writes lets some
-- inner programs (notably Claude Code) bail out before the end marker
-- arrives and fall back to interpreting the content as keystrokes.
local paste_buf = {}
local default_paste = vim.paste
vim.paste = function(lines, phase)
  if vim.bo.buftype == "terminal" and vim.b.terminal_job_id then
    local chan = vim.b.terminal_job_id
    local START, END = "\27[200~", "\27[201~"
    if phase == -1 then
      vim.api.nvim_chan_send(chan, START .. table.concat(lines, "\n") .. END)
      return true
    end
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
      vim.api.nvim_chan_send(chan, START .. table.concat(paste_buf, "\n") .. END)
      paste_buf = {}
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
