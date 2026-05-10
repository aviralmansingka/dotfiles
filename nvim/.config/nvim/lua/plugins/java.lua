-- Imports LazyVim's lang.java extra. Overrides live in jdtls.lua.
-- Neotest adapter (rcasia/neotest-java) is registered here so Java buffers
-- get the same `<leader>tg` / `<leader>tT` / summary-view experience as Go
-- and Python (see neotest-golang in lang.go and neotest-python in python.lua).
return {
  { import = "lazyvim.plugins.extras.lang.java" },

  { "rcasia/neotest-java", ft = "java" },

  {
    "nvim-neotest/neotest",
    optional = true,
    opts = {
      adapters = {
        -- Defaults are sane: junit_jar auto-downloads on first run,
        -- jvm_args = {}, incremental_build = true,
        -- test_classname_patterns = {"^.*Tests?$", "^.*IT$", "^.*Spec$"}.
        -- Override here if a project needs a pinned junit version or JVM
        -- flags (e.g. -Dspring.profiles.active=test).
        ["neotest-java"] = {},
      },
    },
  },
}
