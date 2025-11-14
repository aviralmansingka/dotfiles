local toggle_key = "<C-;>"

return {
  "coder/claudecode.nvim",
  opts = {
    terminal = {
      ---@module "snacks"
      ---@type snacks.win.Config|{}
      snacks_win_opts = {
        position = "float",
        width = 0.9,
        height = 0.9,
        border = "rounded",
        wo = {
          winhighlight = "FloatBorder:ClaudeCodeBorder",
        },
        keys = {
          claude_hide = {
            toggle_key,
            function(self)
              self:hide()
            end,
            mode = "t",
            desc = "Hide",
          },
        },
      },
    },
    diff_opts = {
      keep_terminal_focus = true,
    },
    terminal_cmd = "~/.claude/local/claude", -- Point to local installation
  },
  config = true,
  keys = {
    -- Uncomment for primary mapping
    -- { toggle_key, "<cmd>ClaudeCodeFocus --continue<CR>", desc = "Claude Code (focus)", mode = { "n", "x" } },
    { "gC", "<cmd>ClaudeCode --resume<CR>", desc = "Claude Code (resume)", mode = { "n", "x" } },
    -- Send selected text to Claude Code in visual mode
    { "<leader>acs", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
  },
}
