-- `<leader>at`: send this buffer (or the visual selection) to the agent pane in
-- the same Herdr tab. Logic lives in ./herdr/agent_send.lua.
-- This overrides sidekick.nvim's "Send This" binding (see plugins/sidekick.lua).
return {
  "folke/snacks.nvim",
  keys = {
    {
      "<leader>at",
      function()
        require("plugins.herdr.agent_send").send({ visual = false })
      end,
      desc = "Send buffer to Herdr agent pane",
    },
    {
      "<leader>at",
      function()
        require("plugins.herdr.agent_send").send({ visual = true })
      end,
      mode = "x",
      desc = "Send selection to Herdr agent pane",
    },
  },
}
