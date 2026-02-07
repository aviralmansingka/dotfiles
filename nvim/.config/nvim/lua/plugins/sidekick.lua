local tool_urls = {
  claude = "https://github.com/anthropics/claude-code",
  opencode = "https://github.com/sst/opencode",
}

local claude_bin = vim.fn.executable(vim.fn.expand("~/.local/bin/claude")) == 1 and vim.fn.expand("~/.local/bin/claude")
  or "claude"

local tool_commands = {
  claude = { claude_bin, "--ide" },
  opencode = { "opencode" },
}

local function command_to_shell(cmd)
  if type(cmd) ~= "table" then
    return tostring(cmd)
  end

  local escaped = {}
  for _, part in ipairs(cmd) do
    escaped[#escaped + 1] = vim.fn.shellescape(part)
  end
  return table.concat(escaped, " ")
end

local function is_claude_tool(name)
  return type(name) == "string" and name:match("^claude") ~= nil
end

local function ensure_claude_bridge()
  local ok, claudecode = pcall(require, "claudecode")
  if not ok then
    local lazy_ok, lazy = pcall(require, "lazy")
    if lazy_ok and type(lazy.load) == "function" then
      lazy.load({ plugins = { "claudecode.nvim" } })
      ok, claudecode = pcall(require, "claudecode")
    end
  end

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

local function toggle_tool_session(name, focus)
  if is_claude_tool(name) and not ensure_claude_bridge() then
    return
  end
  require("sidekick.cli").toggle({ name = name, focus = focus ~= false })
end

-- Helper to create a tool with a specific working directory
local function make_tool(cmd, cwd, url)
  if cwd and cwd ~= "" then
    return {
      cmd = { "sh", "-c", string.format("cd %s && exec %s", vim.fn.shellescape(cwd), command_to_shell(cmd)) },
      url = url,
    }
  end

  if type(cmd) == "table" then
    return { cmd = vim.deepcopy(cmd), url = url }
  end

  return { cmd = { cmd }, url = url }
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

local function start_named_session(tool, label, cwd)
  local slug = normalize_label(label)
  if slug == "" then
    vim.notify("Sidekick: session label cannot be empty", vim.log.levels.WARN)
    return
  end

  local name = tool .. "-" .. slug
  local config = require("sidekick.config")
  local command = tool_commands[tool] or { tool }
  config.cli.tools[name] = make_tool(command, normalize_cwd(cwd), tool_urls[tool])
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
        require("sidekick.cli").toggle({ name = "opencode", focus = true })
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
