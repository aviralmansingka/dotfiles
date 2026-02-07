local tool_urls = {
  claude = "https://github.com/anthropics/claude-code",
  opencode = "https://github.com/sst/opencode",
}

local claude_bin = vim.fn.executable(vim.fn.expand("~/.local/bin/claude")) == 1 and vim.fn.expand("~/.local/bin/claude")
  or "claude"

local opencode_bin = vim.fn.executable(vim.fn.expand("~/.opencode/bin/opencode")) == 1
    and vim.fn.expand("~/.opencode/bin/opencode")
  or "opencode"

local tool_commands = {
  claude = { claude_bin, "--ide" },
  opencode = { opencode_bin, "--port" },
}

local toggle_tool_session

local function command_to_list(cmd)
  if type(cmd) == "table" then
    local command = vim.deepcopy(cmd)
    if command[1] then
      command[1] = vim.fn.expand(command[1])
    end
    return command
  end

  local command = vim.split(tostring(cmd), "%s+", { trimempty = true })
  if #command == 0 then
    return { tostring(cmd) }
  end

  command[1] = vim.fn.expand(command[1])
  return command
end

local function command_to_shell(cmd)
  local escaped = {}
  for _, part in ipairs(command_to_list(cmd)) do
    escaped[#escaped + 1] = vim.fn.shellescape(part)
  end
  return table.concat(escaped, " ")
end

local function is_claude_tool(name)
  return type(name) == "string" and name:match("^claude") ~= nil
end

local function is_opencode_tool(name)
  return name == "opencode"
end

local function ensure_plugin_module(module_name, plugin_name)
  local ok, module = pcall(require, module_name)
  if ok then
    return true, module
  end

  local lazy_ok, lazy = pcall(require, "lazy")
  if lazy_ok and type(lazy.load) == "function" then
    lazy.load({ plugins = { plugin_name } })
    return pcall(require, module_name)
  end

  return false, nil
end

local function ensure_claude_bridge()
  local ok, claudecode = ensure_plugin_module("claudecode", "claudecode.nvim")

  if not ok then
    vim.notify("Sidekick: failed to load claudecode.nvim", vim.log.levels.ERROR)
    return false
  end

  if claudecode.state and claudecode.state.server then
    return true
  end

  local started, err = claudecode.start(false)
  if started or err == "Already running" then
    return true
  end

  vim.notify("Sidekick: failed to start Claude IDE bridge: " .. tostring(err), vim.log.levels.ERROR)
  return false
end

-- Helper to create a tool with a specific working directory
local function make_tool(cmd, cwd, url)
  local command = command_to_list(cmd)

  if cwd and cwd ~= "" then
    return {
      cmd = { "sh", "-c", string.format("cd %s && exec %s", vim.fn.shellescape(cwd), command_to_shell(command)) },
      url = url,
    }
  end

  return { cmd = command, url = url }
end

local function normalize_label(label)
  return (label or "")
    :gsub("^%s+", "")
    :gsub("%s+$", "")
    :lower()
    :gsub("[^%w_-]+", "-")
    :gsub("-+", "-")
    :gsub("^-+", "")
    :gsub("-+$", "")
end

local function normalize_cwd(cwd)
  if not cwd or cwd == "" then
    return nil
  end
  local expanded = vim.fs.normalize(vim.fn.fnamemodify(cwd, ":p"))
  local current = vim.fs.normalize(vim.fn.fnamemodify(vim.fn.getcwd(), ":p"))
  if expanded == current then
    return nil
  end
  return expanded
end

local function opencode_has_port_flag(command)
  for _, part in ipairs(command) do
    if part == "--port" or part:match("^%-%-port=.*") then
      return true
    end
  end
  return false
end

local function opencode_with_port(command, port)
  local resolved = {}
  local i = 1
  while i <= #command do
    local part = command[i]
    if part == "--port" then
      local next_part = command[i + 1]
      if next_part and next_part:match("^%d+$") then
        i = i + 2
      else
        i = i + 1
      end
    elseif part:match("^%-%-port=.*") then
      i = i + 1
    else
      resolved[#resolved + 1] = part
      i = i + 1
    end
  end

  resolved[#resolved + 1] = "--port"
  resolved[#resolved + 1] = tostring(port)
  return resolved
end

local function resolve_opencode_command(port)
  local command = vim.deepcopy(tool_commands.opencode)

  local ok, opencode_config = pcall(require, "opencode.config")
  if ok then
    local provider_cmd = opencode_config.provider and opencode_config.provider.cmd
    if not provider_cmd and opencode_config.opts and opencode_config.opts.provider then
      provider_cmd = opencode_config.opts.provider.cmd
    end

    if provider_cmd and provider_cmd ~= "" then
      command = command_to_list(provider_cmd)
    end
  end

  if port then
    command = opencode_with_port(command, port)
  elseif not opencode_has_port_flag(command) then
    command[#command + 1] = "--port"
  end

  return command
end

local function with_opencode_command(opts, cb)
  opts = opts or {}

  local ok = ensure_plugin_module("opencode", "opencode.nvim")
  if not ok then
    vim.notify("Sidekick: failed to load opencode.nvim", vim.log.levels.ERROR)
    cb(vim.deepcopy(tool_commands.opencode))
    return
  end

  if not opts.resolve_port then
    cb(resolve_opencode_command())
    return
  end

  local ok_server, server = pcall(require, "opencode.cli.server")
  if not ok_server or type(server.get_port) ~= "function" then
    cb(resolve_opencode_command())
    return
  end

  local ok_promise, promise = pcall(server.get_port, false)
  if not ok_promise or type(promise) ~= "table" or type(promise.next) ~= "function" then
    cb(resolve_opencode_command())
    return
  end

  promise
    :next(function(port)
      cb(resolve_opencode_command(port))
    end)
    :catch(function()
      cb(resolve_opencode_command())
    end)
end

local function set_opencode_tool_command(name, command, cwd)
  local config = require("sidekick.config")
  local current = config.cli.tools[name] or {}
  config.cli.tools[name] = vim.tbl_deep_extend("force", current, make_tool(command, cwd, tool_urls.opencode))
end

toggle_tool_session = function(name, focus)
  if is_claude_tool(name) and not ensure_claude_bridge() then
    return
  end

  if is_opencode_tool(name) then
    with_opencode_command({ resolve_port = true }, function(command)
      set_opencode_tool_command(name, command)
      require("sidekick.cli").toggle({ name = name, focus = focus ~= false })
    end)
    return
  end

  require("sidekick.cli").toggle({ name = name, focus = focus ~= false })
end

local function start_named_session(tool, label, cwd)
  local slug = normalize_label(label)
  if slug == "" then
    vim.notify("Sidekick: session label cannot be empty", vim.log.levels.WARN)
    return
  end

  local name = tool .. "-" .. slug
  local config = require("sidekick.config")
  local normalized_cwd = normalize_cwd(cwd)

  if tool == "opencode" then
    with_opencode_command({ resolve_port = false }, function(command)
      config.cli.tools[name] = make_tool(command, normalized_cwd, tool_urls[tool])
      toggle_tool_session(name, true)
    end)
    return
  end

  local command = tool_commands[tool] or { tool }
  config.cli.tools[name] = make_tool(command, normalized_cwd, tool_urls[tool])
  toggle_tool_session(name, true)
end

local function prompt_named_session(tool)
  vim.ui.input({ prompt = string.format("%s session label: ", tool) }, function(session_label)
    if not session_label then
      return
    end

    vim.ui.input({
      prompt = "Working directory (leave empty for current): ",
      default = vim.fn.getcwd(),
      completion = "dir",
    }, function(cwd)
      start_named_session(tool, session_label, cwd)
    end)
  end)
end

return {
  "folke/sidekick.nvim",
  dependencies = {
    "coder/claudecode.nvim",
    "NickvanDyke/opencode.nvim",
  },
  opts = {
    cli = {
      mux = {
        backend = "tmux",
        enabled = true,
      },
      tools = {
        -- Default sessions (use current directory)
        claude = make_tool(tool_commands.claude, nil, tool_urls.claude),
        opencode = make_tool(tool_commands.opencode, nil, tool_urls.opencode),
        -- Example named sessions with specific directories:
        -- ["claude-dotfiles"] = make_tool(tool_commands.claude, "~/dotfiles", tool_urls.claude),
        -- ["claude-work"] = make_tool(tool_commands.claude, "~/work/project", tool_urls.claude),
        -- ["opencode-dotfiles"] = make_tool(tool_commands.opencode, "~/dotfiles", tool_urls.opencode),
      },
    },
  },
  keys = {
    {
      "<c-;>",
      function()
        toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
      mode = { "n", "x" },
    },
    {
      "<tab>",
      function()
        -- if there is a next edit, jump to it, otherwise apply it if any
        if not require("sidekick").nes_jump_or_apply() then
          return "<Tab>" -- fallback to normal tab
        end
      end,
      expr = true,
      desc = "Goto/Apply Next Edit Suggestion",
    },
    {
      "<c-.>",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle",
      mode = { "n", "t", "i", "x" },
    },
    {
      "<leader>aa",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle CLI",
    },
    {
      "<leader>as",
      function()
        require("sidekick.cli").select({
          focus = true,
          cb = function(state)
            if not state then
              return
            end

            local tool_name = state.tool and state.tool.name or nil
            if is_claude_tool(tool_name) and not ensure_claude_bridge() then
              return
            end

            if is_opencode_tool(tool_name) then
              with_opencode_command({ resolve_port = true }, function(command)
                set_opencode_tool_command(tool_name, command)
                require("sidekick.cli.state").attach(state, { show = true, focus = true })
              end)
              return
            end

            require("sidekick.cli.state").attach(state, { show = true, focus = true })
          end,
        })
      end,
      -- Or to select only installed tools:
      -- require("sidekick.cli").select({ filter = { installed = true } })
      desc = "Select CLI",
    },
    {
      "<leader>ad",
      function()
        require("sidekick.cli").close()
      end,
      desc = "Detach a CLI Session",
    },
    {
      "<leader>at",
      function()
        require("sidekick.cli").send({ msg = "{this}" })
      end,
      mode = { "x", "n" },
      desc = "Send This",
    },
    {
      "<leader>af",
      function()
        require("sidekick.cli").send({ msg = "{file}" })
      end,
      desc = "Send File",
    },
    {
      "<leader>av",
      function()
        require("sidekick.cli").send({ msg = "{selection}" })
      end,
      mode = { "x" },
      desc = "Send Visual Selection",
    },
    {
      "<leader>ap",
      function()
        require("sidekick.cli").prompt()
      end,
      mode = { "n", "x" },
      desc = "Sidekick Select Prompt",
    },
    -- Toggle Claude directly
    {
      "<leader>ac",
      function()
        toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
    },
    -- Toggle OpenCode directly
    {
      "<leader>ao",
      function()
        toggle_tool_session("opencode", true)
      end,
      desc = "Sidekick Toggle OpenCode",
    },
    -- Create a named session with custom directory
    {
      "<leader>an",
      function()
        local tools = { "claude", "opencode" }
        vim.ui.select(tools, { prompt = "Select CLI tool:" }, function(tool)
          if not tool then
            return
          end
          prompt_named_session(tool)
        end)
      end,
      desc = "Sidekick New Named Session",
    },
    {
      "<leader>aN",
      function()
        prompt_named_session("claude")
      end,
      desc = "Sidekick New Claude Session",
    },
  },
}
