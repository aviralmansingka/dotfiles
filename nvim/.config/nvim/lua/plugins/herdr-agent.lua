-- `<leader>at`: send this buffer (or the visual selection) to the agent pane in
-- the same Herdr tab. Logic lives in ./herdr/agent_send.lua.
-- When no agent pane shares the tab, fall back to sidekick's original "Send
-- This" stack so the selection still reaches the active session sidekick CLI.
--
-- `<leader>tt`: send the buffer (or visual selection) to the non-agent terminal
-- pane that shares this Herdr tab. Logic lives in ./herdr/term_send.lua.
--
-- Both override sidekick.nvim bindings (see plugins/sidekick.lua).
local function send_to_agent(visual)
  require("plugins.herdr.agent_send").send({
    visual = visual,
    fallback = function()
      require("sidekick.cli").send({ msg = "{this}" })
      return true
    end,
  })
end

return {
  "folke/snacks.nvim",
  keys = {
    {
      "<leader>at",
      function()
        send_to_agent(false)
      end,
      desc = "Send buffer to Herdr agent (fallback: Sidekick)",
    },
    {
      "<leader>at",
      function()
        send_to_agent(true)
      end,
      mode = "x",
      desc = "Send selection to Herdr agent (fallback: Sidekick)",
    },
    {
      "<leader>tt",
      function()
        require("plugins.herdr.term_send").send({ visual = false })
      end,
      desc = "Send buffer to Herdr terminal pane",
    },
    {
      "<leader>tt",
      function()
        require("plugins.herdr.term_send").send({ visual = true })
      end,
      mode = "x",
      desc = "Send selection to Herdr terminal pane",
    },
  },
}
