-- Compatibility shim. The send path moved to `plugins.agent.send`, which picks a
-- Rex or Herdr adapter through `plugins.agent.mux`. Kept so older requires,
-- keymaps, and headless specs keep resolving.
return require("plugins.agent.send")
