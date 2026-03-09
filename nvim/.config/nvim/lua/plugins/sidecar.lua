local sidecar_cmd = vim.fn.executable(vim.fn.expand("/opt/homebrew/bin/sidecar")) == 1
    and vim.fn.expand("/opt/homebrew/bin/sidecar")
  or "sidecar"

return {
  {
    "folke/snacks.nvim",
    keys = {
      {
        "gS",
        function()
          Snacks.terminal.toggle(sidecar_cmd, {
            cwd = vim.fn.getcwd(),
            win = {
              bo = {
                filetype = "sidecar_terminal",
              },
            },
          })
        end,
        desc = "Toggle Sidecar",
        mode = { "n" },
      },
    },
  },
}
