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
    { "gC", "<cmd>ClaudeCode --resume<CR>", desc = "Claude Code (resume)", mode = { "n", "x" } },
    { toggle_key, "<cmd>ClaudeCodeFocus --continue<CR>", desc = "Claude Code (focus)", mode = { "n", "x" } },
    -- Send selected text to Claude Code in visual mode
    { "<leader>as", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
    {
      "<leader>as",
      "<cmd>ClaudeCodeTreeAdd<cr>",
      desc = "Add file",
      ft = { "NvimTree", "neo-tree", "oil", "minifiles" },
    },
    -- Diff management
    { "<leader>aa", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
    { "<leader>ad", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
  },
}
