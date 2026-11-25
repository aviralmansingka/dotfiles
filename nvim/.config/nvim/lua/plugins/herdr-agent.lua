-- `<leader>at`: send this buffer (or a prompted visual selection) to the agent
-- that runs beside this Neovim, whichever multiplexer carries it — Rex or
-- Herdr, resolved by `plugins.agent.mux`. When no agent sits beside this pane,
-- fall back to the active Sidekick session.
--
-- `<leader>tt`: paste only a visual selection into the floating Snacks terminal
-- (the same singleton float toggled by `<leader>ft`), creating it if needed.
local function sidekick_fallback(payload)
  local opts = { submit = true }
  if payload then
    opts.text = require("sidekick.text").to_text(payload)
  else
    opts.msg = "{this}"
  end
  require("sidekick.cli").send(opts)
  return true
end

local function send_to_agent(visual)
  local agent_send = require("plugins.agent.send")
  if visual then
    agent_send.prompt_selection({ fallback = sidekick_fallback })
  else
    agent_send.send({ visual = false, fallback = sidekick_fallback })
  end
end

return {
  "folke/snacks.nvim",
  keys = {
    {
      "<leader>at",
      function()
        send_to_agent(false)
      end,
      desc = "Send buffer to agent (Rex/Herdr; fallback: Sidekick)",
    },
    {
      "<leader>at",
      function()
        send_to_agent(true)
      end,
      mode = "x",
      desc = "Send selection to agent (Rex/Herdr; fallback: Sidekick)",
    },
    {
      "<leader>tt",
      function()
        require("plugins.herdr.term_send").send({ visual = true })
      end,
      mode = "x",
      desc = "Send selection to floating terminal",
    },
  },
}
