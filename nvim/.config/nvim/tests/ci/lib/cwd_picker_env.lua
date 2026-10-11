-- Offline stub environment for plugins.sidekick.cwd_picker.
--
-- House pattern (CI plan rule A7): every fake is installed BEFORE
-- plugins.sidekick.cwd_picker is required, so the module binds to the fake
-- herdr adapter, fake sidekick.config, fake snacks matcher, and a global
-- Snacks that records picker options instead of opening windows.
--
-- Fixtures drive behavior through the mutable `env` tables:
--   env.agents          -- herdr.list_agents() result
--   env.git_by_path     -- normalized path -> SidekickGitContext (or nil)
--   env.diff_by_worktree-- worktree -> { added, removed } (or nil)
--   env.read_output     -- agent name -> string (or nil) for herdr.read
--   env.workspaces      -- workspace list result
--   env.picker_opts     -- captured Snacks.picker.pick options (after open)

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(vim.fs.dirname(here)) .. "/harness.lua")

local env = {
  agents = {},
  git_by_path = {},
  diff_by_worktree = {},
  read_output = {},
  workspaces = {},
  reads = {},
  calls = {},
  picker_opts = nil,
  picker_win_opts = nil,
  workspace_win_opts = nil,
  preview_bufs = {},
  closed_count = 0,
}

local function normalize(path)
  if not path or path == "" then
    return ""
  end
  local n = vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
  return n == "/" and n or n:gsub("/$", "")
end

local function fake_win()
  return {
    buf = vim.api.nvim_create_buf(false, true),
    win = 0,
    opts = { wo = {} },
    valid = function()
      return true
    end,
    win_valid = function()
      return true
    end,
    on = function() end,
    map = function() end,
    minimal = function() end,
  }
end

local fake_picker

local function install()
  package.loaded["plugins.sidekick.herdr"] = {
    call = function(args, quiet)
      env.calls[#env.calls + 1] = { args = args, quiet = quiet }
      if args[1] == "workspace" and args[2] == "list" then
        return { workspaces = env.workspaces }
      end
      return {}
    end,
    list_agents = function()
      return env.agents
    end,
    is_durable_agent = function(agent)
      return agent ~= nil and agent.durable ~= false
    end,
    git_context = function(path)
      return env.git_by_path[normalize(path)]
    end,
    git_diff_stats = function(worktree, baseline)
      return env.diff_by_worktree[worktree]
    end,
    read = function(name, source, lines, ansi)
      env.reads[#env.reads + 1] = { name = name, source = source, lines = lines, ansi = ansi }
      return env.read_output[name]
    end,
    read_async = function(name, source, lines, ansi, callback)
      env.reads[#env.reads + 1] = { name = name, source = source, lines = lines, ansi = ansi }
      callback(env.read_output[name])
    end,
  }
  package.loaded["sidekick.config"] = {
    cli = {
      win = { float = { width = 0.8, height = 0.8 } },
      mux = { backend = "herdr", dump = 48 },
    },
  }
  -- registry.rehydrate() merges base tool config through sidekick.cli.tool.
  package.loaded["sidekick.cli.tool"] = {
    get = function(_name)
      return { config = {} }
    end,
  }
  package.loaded["snacks.picker.core.matcher"] = {
    new = function()
      return {
        init = function() end,
        match = function()
          return 1
        end,
      }
    end,
  }
  fake_picker = {
    closed = false,
    input = vim.tbl_extend("force", fake_win(), {
      get = function()
        return ""
      end,
      set = function() end,
    }),
    list = vim.tbl_extend("force", fake_win(), {
      move = function() end,
      update = function() end,
    }),
    preview = vim.tbl_extend("force", fake_win(), {
      set_buf = function(_, buf)
        env.preview_bufs[#env.preview_bufs + 1] = buf
      end,
    }),
    current = function()
      return nil
    end,
    focus = function() end,
    action = function() end,
    close = function()
      env.closed_count = env.closed_count + 1
    end,
  }
  _G.Snacks = {
    win = function(opts)
      env.workspace_win_opts = opts
      return fake_win()
    end,
    picker = {
      pick = function(opts)
        env.picker_opts = opts
        return fake_picker
      end,
    },
    util = {
      debounce = function(fn)
        return fn
      end,
      spinner = function()
        return "S"
      end,
    },
  }
end

--- Require the real cwd_picker against the installed stubs.
local function require_picker()
  install()
  return require("plugins.sidekick.cwd_picker")
end

--- Reset fixture tables between scenarios (module state persists per process).
local function reset()
  env.agents = {}
  env.git_by_path = {}
  env.diff_by_worktree = {}
  env.read_output = {}
  env.workspaces = {}
  env.picker_opts = nil
  env.picker_win_opts = nil
  env.workspace_win_opts = nil
  env.calls = {}
  env.reads = {}
  env.preview_bufs = {}
end

--- Point the picker's cwd at `dir` (must exist) and return the git context
--- fixture to register for it.
local function git_context(repository, worktree, branch, label)
  return {
    repository = repository,
    repository_label = vim.fs.basename(repository),
    worktree = worktree,
    worktree_label = label or branch,
    branch = branch,
  }
end

env.install = install
env.require_picker = require_picker
env.reset = reset
env.git_context = git_context
env.normalize = normalize
env.H = H

return env
