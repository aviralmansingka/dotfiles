-- Shared offline harness for the headless nvim CI cases.
--
-- Every case runs `nvim --headless -u NONE` with NOIM_TEST_CONFIG_ROOT exported
-- by scripts/test-nvim-headless.sh (fallback: walk up from this file). Cases
-- must always load THIS worktree copy of the config, never a stowed
-- ~/.config/nvim copy — stowed resolution made worktree verification
-- misleading before (fix-markdown-line-length, #238).
--
-- nvim exits 0 even when a luafile chunk errors, so failures must call
-- os.exit(1) themselves. H.run wraps each case body for that.

local H = {}

-- Directory of this file (…/nvim/tests/ci).
local function self_dir()
  local src = debug.getinfo(1, "S").source
  src = src:sub(1, 1) == "@" and src:sub(2) or src
  return vim.fs.dirname(src)
end

--- Locate the nvim config root (dir containing lua/ and tests/).
--- Env var first (set by the entry script), then walk up from this file.
function H.config_root()
  local root = os.getenv("NVIM_TEST_CONFIG_ROOT")
  if root and root ~= "" and vim.fn.isdirectory(root .. "/lua") == 1 then
    return root
  end
  local dir = self_dir()
  while dir and dir ~= "/" and dir ~= "." do
    if vim.fn.isdirectory(dir .. "/lua/plugins") == 1 and vim.fn.isdirectory(dir .. "/tests") == 1 then
      return dir
    end
    dir = vim.fs.dirname(dir)
  end
  error("harness: could not locate the nvim config root", 0)
end

--- Prepend this checkout to package.path / runtimepath and return the root.
function H.setup()
  local root = H.config_root()
  H.root = root
  vim.opt.runtimepath:prepend(root)
  package.path = root .. "/lua/?.lua;" .. root .. "/lua/?/init.lua;" .. package.path
  return root
end

local function fail(msg, actual, expected)
  error(
    string.format("%s\nexpected: %s\nactual:   %s", msg, vim.inspect(expected), vim.inspect(actual)),
    2
  )
end

function H.eq(actual, expected, msg)
  if type(actual) ~= type(expected) or not vim.deep_equal(actual, expected) then
    fail(msg, actual, expected)
  end
end

function H.ne(actual, expected, msg)
  if vim.deep_equal(actual, expected) then
    error(string.format("%s: both are %s", msg, vim.inspect(actual)), 2)
  end
end

function H.truthy(value, msg)
  if not value then
    error(msg or ("expected a truthy value, got " .. vim.inspect(value)), 2)
  end
end

--- Run one case; exit 1 with a traceback on failure.
function H.run(name, fn)
  local ok, err = xpcall(fn, debug.traceback)
  if not ok then
    io.stderr:write("FAIL ", name, "\n", tostring(err), "\n")
    os.exit(1)
  end
  print("PASS ", name)
end

--- Depth-first search of a closure's upvalue graph for a named upvalue.
--- Used to reach real local functions (scrub_*, merge fns) that a module
--- keeps private; the real function is exercised, never a copy.
function H.upvalue(fn, name, max_depth)
  local seen = {}
  local function search(f, depth)
    if type(f) ~= "function" or seen[f] or depth > (max_depth or 10) then
      return nil
    end
    seen[f] = true
    local i = 1
    while true do
      local ok, uname, value = pcall(debug.getupvalue, f, i)
      if not ok or uname == nil then
        break
      end
      if uname == name then
        return value
      end
      if type(value) == "function" then
        local found = search(value, depth + 1)
        if found ~= nil then
          return found
        end
      end
      i = i + 1
    end
    return nil
  end
  local found = search(fn, 0)
  if found == nil then
    error("harness: upvalue '" .. name .. "' not reachable (structure changed?)", 2)
  end
  return found
end

--- Replace a field on a table (vim.system, vim.uv, vim.env keys…) and return
--- a restore function. Always restore before the case ends.
function H.replace(table, key, value)
  local saved = table[key]
  table[key] = value
  return function()
    table[key] = saved
  end
end

--- Silence + record vim.notify. Returns the recorder and a restore function.
function H.capture_notify()
  local calls = {}
  local restore = H.replace(vim, "notify", function(msg, level)
    calls[#calls + 1] = { msg = msg, level = level }
  end)
  return calls, restore
end

return H
