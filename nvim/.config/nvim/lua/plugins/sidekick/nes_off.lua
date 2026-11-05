-- Remove sidekick's next-edit-suggestion (NES) capability for good.
--
-- `opts.nes.enabled = false` stops setup from wiring the NES triggers, but
-- the plugin still exposes `:Sidekick nes enable|toggle` and the
-- `:Sidekick debug nes ...` helpers. Those call `nes.enable(true)`, which
-- flips the live config flag back on. Drop the command groups too, so no
-- runtime path can re-arm NES.
local M = {}

function M.apply()
  local config = require("sidekick.config")
  config.nes.enabled = false

  local commands = require("sidekick.commands").commands
  commands.nes = nil
  if type(commands.debug) == "table" then
    commands.debug.nes = nil
  end
end

return M
