return {
  "coder/claudecode.nvim",
  opts = {
    auto_start = true,
    terminal = {
      provider = "none",
    },
    diff_opts = {
      open_in_new_tab = true,
      auto_close_on_accept = true,
      keep_terminal_focus = true,
    },
    terminal_cmd = "~/.local/bin/claude",
  },
  config = true,
  keys = {
    -- Send selected text to Claude Code in visual mode
    { "<leader>acs", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
  },
}
