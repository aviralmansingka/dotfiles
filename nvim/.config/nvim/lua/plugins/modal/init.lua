-- Aggregates Modal-specific plugin specs into a single module so Lazy's lsmod walk
-- (`{ import = "plugins" }` in lua/config/lazy.lua) descends into this subdirectory.
return {
  require("plugins.modal.dap"),
  require("plugins.modal.build"),
}
