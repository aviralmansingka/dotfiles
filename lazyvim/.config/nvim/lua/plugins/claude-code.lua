local toggle_key = "<C-;>"
vim.api.nvim_set_hl(0, "ClaudeCodeBorder", {
  fg = "#fe8019", -- Bright orange from gruvbox palette
  bg = "#282828", -- Dark background to match
})
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
      keep_terminal_focus = false,
    },
    terminal_cmd = "~/.claude/local/claude", -- Point to local installation
  },
  config = true,
  keys = {
    { "gC", "<cmd>ClaudeCode --resume<CR>", desc = "Claude Code (resume)", mode = { "n", "x" } },
    { toggle_key, "<cmd>ClaudeCodeFocus --continue<CR>", desc = "Claude Code (focus)", mode = { "n", "x" } },
  },
}
