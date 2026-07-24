local M = {}

local function source_files(root)
  local files = vim.fn.glob(root .. "/3_logs/*/backlog.md", false, true)
  table.sort(files, function(a, b)
    return a > b
  end)
  return files
end

local weekdays = {
  Monday = true,
  Tuesday = true,
  Wednesday = true,
  Thursday = true,
  Friday = true,
  Saturday = true,
  Sunday = true,
}

local function date_from_heading(line)
  local weekday, date = line:match("^### ([A-Za-z]+), (%d%d%d%d%-%d%d%-%d%d)$")
  if weekdays[weekday] then
    return date, string.format("%s, %s", weekday, date)
  end
end

function M.collect(root)
  root = vim.fs.normalize(root or vim.fn.expand("~/vault"))
  local items = {}

  for _, file in ipairs(source_files(root)) do
    local date
    local day

    for line_number, line in ipairs(vim.fn.readfile(file)) do
      if line:match("^### ") then
        date, day = date_from_heading(line)
      elseif line:match("^# ") or line:match("^## ") then
        date = nil
        day = nil
      end

      local task = date and line:match("^%s*[-*]%s+%[ %]%s+(.+)$")
      if task then
        table.insert(items, {
          text = string.format("%s │ %s", date, task),
          file = file,
          pos = { line_number, 0 },
          date = date,
          day = day,
          task = task,
        })
      end
    end
  end

  return items
end

---@param item { file: string, pos: integer[], date: string, day: string }
---@param root? string
---@return table|nil agent
function M.send_to_backlog_agent(item, root)
  if not item or not item.file or not item.pos or not item.pos[1] or not item.day then
    vim.notify("Backlog item has no source location or dated heading", vim.log.levels.WARN)
    return nil
  end

  local herdr = require("plugins.sidekick.herdr")
  local internal = require("plugins.sidekick.internal")
  local slug = internal.normalize_label(item.day)
  local name = "pi-" .. slug
  local agent = herdr.get_agent(name)

  if not agent then
    agent = herdr.start(
      name,
      root or vim.fn.expand("~/vault"),
      internal.tool_command_for_named_session("pi", slug),
      { [internal.named_env_var] = slug },
      "backlog"
    )
    if not agent then
      return nil
    end
    if agent.tab_id then
      herdr.call({ "tab", "rename", agent.tab_id, item.day })
    end
  end

  if not herdr.send(agent.name or name, string.format("%s:%d", item.file, item.pos[1])) then
    return nil
  end
  return agent
end

---@param agent { name: string, terminal_id?: string }
function M.activate_backlog_agent(agent)
  require("lazy").load({ plugins = { "sidekick.nvim" } })
  require("plugins.sidekick.registry").rehydrate()
  require("plugins.sidekick.last_session").record(agent.name, agent.terminal_id)
  require("plugins.sidekick.internal").toggle_tool_session(agent.name, true, agent.terminal_id)
end

return M
