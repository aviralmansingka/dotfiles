local Config = require("sidekick.config")
local Herdr = require("plugins.sidekick.herdr")

local M = {}
M.__index = M

function M.apply()
  local Session = require("sidekick.cli.session")
  Session.register("herdr", M)

  -- Sidekick currently hard-codes tmux/zellij validation even though its
  -- session registry supports local backends. Keep the compatibility shim to
  -- this one value so upstream validation remains authoritative otherwise.
  if not Config._sidekick_herdr_validate then
    Config._sidekick_herdr_validate = Config.validate
    Config.validate = function(key, allowed)
      if key == "cli.mux.backend" and Config.cli.mux.backend == "herdr" then
        return true
      end
      return Config._sidekick_herdr_validate(key, allowed)
    end
  end
end

function M:init()
  self.herdr_agent_name = self.herdr_agent_name or Herdr.agent_name(self.tool.name, self.cwd)
  self.mux_session = self.herdr_agent_name
  self.external = false
  self.priority = 50
end

function M.sessions()
  local sessions = {}
  local tools = Config.tools()
  for _, agent in ipairs(Herdr.list_agents()) do
    local tool = (agent.name and tools[agent.name]) or (agent.agent and tools[agent.agent])
    if tool then
      sessions[#sessions + 1] = {
        id = "herdr:" .. agent.terminal_id,
        cwd = agent.foreground_cwd or agent.cwd,
        tool = tool,
        herdr_agent_name = agent.name or agent.pane_id,
        herdr_pane_id = agent.pane_id,
        herdr_tab_id = agent.tab_id,
        herdr_terminal_id = agent.terminal_id,
        herdr_workspace_id = agent.workspace_id,
        agent_status = agent.agent_status,
        mux_session = agent.name or agent.pane_id,
      }
    end
  end
  return sessions
end

function M:start()
  local agent = Herdr.start(self.herdr_agent_name, self.cwd, self.tool.cmd, self.tool.env)
  if not agent then
    error("failed to start Herdr agent " .. self.herdr_agent_name)
  end
  self.id = "herdr:" .. agent.terminal_id
  self.herdr_pane_id = agent.pane_id
  self.herdr_tab_id = agent.tab_id
  self.herdr_terminal_id = agent.terminal_id
  self.herdr_workspace_id = agent.workspace_id
  self.started = true
  return self:attach()
end

function M:attach()
  return { cmd = { "herdr", "agent", "attach", self.herdr_agent_name } }
end

function M:is_running()
  return self.herdr_agent_name ~= nil and Herdr.get_agent(self.herdr_agent_name) ~= nil
end

function M:send(text)
  Herdr.send(self.herdr_agent_name, text)
end

function M:submit()
  if self.herdr_pane_id then
    Herdr.send_key(self.herdr_pane_id, "enter")
  end
end

function M:dump()
  return Herdr.read(self.herdr_agent_name, "recent", Config.cli.mux.dump, true)
end

return M
