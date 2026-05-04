-- Patch sidekick's tmux session listing so the tool attributed to a pane matches the
-- tmux session name (Sidekick.cli.Session.sid), not whichever tool happens to match
-- is_proc first. Without this, a pane in session "cursor-foo abc123..." is wrongly
-- labeled as tool "cursor" because both tools share the same is_proc pattern.
local M = {}

local applied = false

function M.apply()
  if applied then
    return
  end
  applied = true

  local tmux_mod = require("sidekick.cli.session.tmux")
  local Config = require("sidekick.config")
  local Session = require("sidekick.cli.session")
  local Procs = require("sidekick.cli.procs")

  ---@diagnostic disable-next-line: duplicate-set-field
  function tmux_mod.sessions()
    local panes = tmux_mod.panes()
    local ret = {} ---@type sidekick.cli.session.State[]
    local tools = Config.tools()
    local clients = tmux_mod.clients()
    local procs = Procs.new()
    for _, pane in ipairs(panes) do
      procs:walk(pane.pid, function(proc)
        local raw_cwd = proc.cwd
        if type(raw_cwd) ~= "string" or raw_cwd == "" then
          raw_cwd = pane.cwd
        end
        local sid_cwd = Session.cwd({ cwd = raw_cwd })

        ---@type sidekick.cli.Tool|nil
        local matched = nil
        for _, tool in pairs(tools) do
          if tool:is_proc(proc) then
            if pane.session_name == Session.sid({ tool = tool.name, cwd = sid_cwd }) then
              matched = tool
              break
            end
          end
        end

        if not matched then
          for _, tool in pairs(tools) do
            if tool:is_proc(proc) then
              matched = tool
              break
            end
          end
        end

        if matched then
          local pids = Procs.pids(pane.pid)
          vim.list_extend(pids, clients[pane.session_id] or {})
          ret[#ret + 1] = {
            id = pane.skid,
            cwd = proc.cwd or pane.cwd,
            tool = matched,
            tmux_pane_id = pane.id,
            tmux_pid = pane.pid,
            mux_session = pane.session_name,
            pids = pids,
          }
          return true
        end
      end)
    end
    return ret
  end
end

return M
