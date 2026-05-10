-- Imports LazyVim's lang.java extra. Overrides live in jdtls.lua.
-- Neotest adapter (rcasia/neotest-java) is registered here so Java buffers
-- get the same `<leader>tg` / `<leader>tT` / summary-view experience as Go
-- and Python (see neotest-golang in lang.go and neotest-python in python.lua).
return {
  { import = "lazyvim.plugins.extras.lang.java" },

  {
    "rcasia/neotest-java",
    ft = "java",
    -- Upstream bug (rcasia/neotest-java v0.37.1): build_tool/init.lua's
    -- gradle.get_build_dirname returns Path("bin") (a table) while its
    -- type annotation is `: string`. The wrapper at build_tool.lua:21 then
    -- does Path(...) again, and Path.new at model/path.lua:61 crashes on
    -- `raw_path:sub(1, 1)` because raw_path is a table. Result: every
    -- Gradle test run aborts with "attempt to call method 'sub' (a nil
    -- value)" before the JUnit runner even starts. Maven is unaffected
    -- (its get_build_dirname returns a plain string).
    --
    -- The same root cause hits two distinct call sites in build_tool.lua:
    --   1. line 21 wrapper: Path(config.get_build_dirname(...)) → Path(Path("bin"))
    --      → Path.new crashes on raw_path:sub when raw_path is a table.
    --   2. line 35 spring filepaths: root:append(config.get_build_dirname(...))
    --      → Path:append concatenates self.raw_path .. separator .. other where
    --        other is a Path table and Path has no __concat metamethod
    --        → "attempt to concatenate a table value".
    -- Patch both Path.new AND Path:append to coerce table-shaped path args
    -- back to strings via :to_string(). Drop when upstream lands a fix.
    config = function()
      local Path = require("neotest-java.model.path")

      local original_new = Path.new
      Path.new = function(raw_path, opts)
        if type(raw_path) == "table" and type(raw_path.to_string) == "function" then
          raw_path = raw_path:to_string()
        end
        return original_new(raw_path, opts)
      end

      -- Path:append lives on the metatable's __index. Grab it via a sentinel
      -- instance and wrap its `other` argument the same way.
      local sentinel = original_new("/", { separator = function() return "/" end })
      local mt = getmetatable(sentinel)
      if mt and type(mt.__index) == "table" and type(mt.__index.append) == "function" then
        local original_append = mt.__index.append
        mt.__index.append = function(self, other)
          if type(other) == "table" and type(other.to_string) == "function" then
            other = other:to_string()
          end
          return original_append(self, other)
        end
      end
    end,
  },

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
