return {
  "coder/claudecode.nvim",
  opts = {
    terminal_cmd = "~/.claude/local/claude", -- Point to local installation
  },
  config = true,
  keys = {
    {
      "gC",
      ":ClaudeCode<CR>",
      desc = "Debug: Start/Continue",
    },
  },
}
