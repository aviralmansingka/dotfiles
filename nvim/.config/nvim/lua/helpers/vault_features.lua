local M = {}

local status_order = {
  ["in-progress"] = 1,
  ["pending-work"] = 2,
}

local function read_page(file)
  local page = {
    fields = {},
    file = file,
    lines = vim.fn.readfile(file),
  }
  local in_frontmatter = false

  for line_number, line in ipairs(page.lines) do
    if line_number == 1 and line == "---" then
      in_frontmatter = true
    elseif in_frontmatter and line == "---" then
      in_frontmatter = false
    elseif in_frontmatter then
      local key, value = line:match("^([%w_-]+):%s*(.-)%s*$")
      if key then
        page.fields[key] = value
      end
    elseif not page.title then
      page.title = line:match("^#%s+(.+)$")
      page.title_line = page.title and line_number or nil
    end
  end

  return page
end

local function page_title(page, fallback)
  return page.title or fallback:gsub("-", " ")
end

local function linked_task_file(root, feature_dir, link)
  local file
  if link:sub(1, 1) == "/" then
    file = link
  elseif vim.startswith(link, "1_projects/") then
    file = vim.fs.joinpath(root, link)
  else
    file = vim.fs.joinpath(feature_dir, link)
  end
  if not file:match("%.md$") then
    file = file .. ".md"
  end
  return vim.fn.filereadable(file) == 1 and file or nil
end

local function tasks(root, feature_dir, feature_page)
  local items = {}
  local in_tasks = false

  for line_number, line in ipairs(feature_page.lines) do
    if line == "## Tasks" then
      in_tasks = true
    elseif in_tasks and line:match("^## ") then
      break
    elseif in_tasks then
      local state, body = line:match("^%s*[-*]%s+%[([ x~%-])%]%s+(.+)$")
      local task_id = body and body:match("(T%d%d)")
      if state and state ~= "x" and task_id then
        local link, alias = body:match("%[%[([^]|]+)|([^]]+)%]%]")
        local title = alias or body
        title = title:gsub("^.*|", ""):gsub("%]%].*$", ""):gsub("^T%d%d%s*", "")

        local file = feature_page.file
        local pos = { line_number, 0 }
        local linked = link and linked_task_file(root, feature_dir, link) or nil
        if linked then
          local task_page = read_page(linked)
          file = linked
          pos = { task_page.title_line or 1, 0 }
        end

        items[#items + 1] = {
          file = file,
          linked = linked ~= nil,
          pos = pos,
          state = state,
          task = title,
          task_id = task_id,
        }
      end
    end
  end

  return items
end

local function group_records(records)
  local projects = {}

  for _, record in ipairs(records) do
    local project = projects[record.project]
    if not project then
      project = {
        name = record.project,
        page = record.project_page,
        rank = status_order[record.status],
        repository = record.repository,
        themes = {},
      }
      projects[record.project] = project
    end
    project.rank = math.min(project.rank, status_order[record.status])

    local theme = project.themes[record.theme]
    if not theme then
      theme = {
        name = record.theme,
        page = record.theme_page,
        rank = status_order[record.status],
        features = {},
      }
      project.themes[record.theme] = theme
    end
    theme.rank = math.min(theme.rank, status_order[record.status])
    theme.features[#theme.features + 1] = record
  end

  local function values(map)
    local list = {}
    for _, value in pairs(map) do
      list[#list + 1] = value
    end
    table.sort(list, function(a, b)
      if a.rank ~= b.rank then
        return a.rank < b.rank
      end
      return a.name < b.name
    end)
    return list
  end

  for _, project in pairs(projects) do
    project.themes = values(project.themes)
    for _, theme in ipairs(project.themes) do
      table.sort(theme.features, function(a, b)
        if a.status ~= b.status then
          return status_order[a.status] < status_order[b.status]
        end
        return a.feature < b.feature
      end)
    end
  end

  return values(projects)
end

function M.collect(root)
  root = vim.fs.normalize(root or vim.fn.expand("~/vault"))
  local files = vim.fn.glob(root .. "/1_projects/*/themes/*/features/*/feature.md", false, true)
  local pages = {}
  local records = {}

  local function page(file)
    pages[file] = pages[file] or read_page(file)
    return pages[file]
  end

  for _, file in ipairs(files) do
    local feature_page = page(file)
    local status = feature_page.fields.status
    if feature_page.title and status_order[status] then
      local project_dir = file:match("^(.-)/themes/")
      local theme_dir = file:match("^(.-)/features/")
      local project_slug = project_dir:match("/([^/]+)$")
      local theme_slug = theme_dir:match("/([^/]+)$")
      local project_page = page(project_dir .. "/README.md")
      local theme_page = page(theme_dir .. "/theme.md")
      local feature_dir = vim.fs.dirname(file)

      records[#records + 1] = {
        feature = feature_page.title,
        feature_page = feature_page,
        project = page_title(project_page, project_slug),
        project_page = project_page,
        repository = vim.fn.expand(project_page.fields.repository or root),
        status = status,
        tasks = tasks(root, feature_dir, feature_page),
        theme = page_title(theme_page, theme_slug),
        theme_page = theme_page,
      }
    end
  end

  local root_item = { root = true }
  local items = {}

  for _, project in ipairs(group_records(records)) do
    local project_item = {
      file = project.page.file,
      kind = "project",
      label = project.name,
      parent = root_item,
      pos = { project.page.title_line or 1, 0 },
      project = project.name,
      repository = project.repository,
      text = project.name,
    }
    items[#items + 1] = project_item

    for _, theme in ipairs(project.themes) do
      local theme_item = {
        file = theme.page.file,
        kind = "theme",
        label = theme.name,
        parent = project_item,
        pos = { theme.page.title_line or 1, 0 },
        project = project.name,
        repository = project.repository,
        text = string.format("%s %s", project.name, theme.name),
        theme = theme.name,
      }
      items[#items + 1] = theme_item

      for _, feature in ipairs(theme.features) do
        local feature_item = {
          feature = feature.feature,
          file = feature.feature_page.file,
          kind = "feature",
          label = feature.feature,
          parent = theme_item,
          pos = { feature.feature_page.title_line or 1, 0 },
          project = project.name,
          repository = project.repository,
          status = feature.status,
          text = string.format("%s %s %s %s", project.name, theme.name, feature.feature, feature.status),
          theme = theme.name,
        }
        items[#items + 1] = feature_item

        for index, task in ipairs(feature.tasks) do
          task.kind = "task"
          task.label = string.format("%s %s", task.task_id, task.task)
          task.last = index == #feature.tasks
          task.parent = feature_item
          task.project = project.name
          task.repository = project.repository
          task.feature = feature.feature
          task.theme = theme.name
          task.text =
            string.format("%s %s %s %s %s", project.name, theme.name, feature.feature, task.task_id, task.task)
          items[#items + 1] = task
        end
      end
    end
  end

  return items
end

function M.format(item)
  if item.kind == "project" then
    return { { "▾ ", "Comment" }, { item.label, "Directory" } }
  elseif item.kind == "theme" then
    return { { "  ▾ ", "Comment" }, { item.label, "Title" } }
  elseif item.kind == "feature" then
    local marker = item.status == "in-progress" and "● " or "○ "
    local highlight = item.status == "in-progress" and "DiagnosticInfo" or "Comment"
    return { { "    " }, { marker, highlight }, { item.label } }
  end

  local branch = item.last and "└─ " or "├─ "
  local state_highlight = item.state == "x" and "DiagnosticOk" or item.state ~= " " and "DiagnosticInfo" or "Comment"
  return {
    { "      " },
    { branch, "Comment" },
    { string.format("[%s] ", item.state), state_highlight },
    { item.label },
  }
end

function M.agent_prompt(item)
  if
    not item
    or (item.kind ~= "feature" and item.kind ~= "task")
    or not item.file
    or not item.pos
    or not item.pos[1]
  then
    return nil
  end
  return string.format("$vault-hunter %s:%d", item.file, item.pos[1])
end

function M.agent_scope(item)
  local feature = item and (item.kind == "feature" and item or item.parent)
  if not feature or feature.kind ~= "feature" then
    return nil
  end
  local feature_slug = vim.fs.basename(vim.fs.dirname(feature.file))
  local task_slug = item.kind == "task"
      and (item.linked and vim.fs.basename(item.file):gsub("%.md$", "")
        or string.format("%s-%s", feature_slug, item.task_id:lower()))
    or nil
  return {
    feature_branch = "feature/" .. feature_slug,
    tab_label = item.kind == "task" and string.format("%s %s", item.task_id, item.task) or item.feature,
    task_branch = task_slug and "task/" .. task_slug or nil,
    workspace_label = item.kind == "task" and item.label or string.format("%s · %s", item.project, item.feature),
  }
end

function M.send_to_agent(item)
  local agent_scope = M.agent_scope(item)
  if
    not item
    or (item.kind ~= "feature" and item.kind ~= "task")
    or not item.file
    or not item.pos
    or not item.pos[1]
    or not item.repository
    or not M.agent_prompt(item)
    or not agent_scope
  then
    vim.notify("Select a vault feature or task", vim.log.levels.WARN)
    return nil
  end

  local herdr = require("plugins.sidekick.herdr")
  local internal = require("plugins.sidekick.internal")
  local suffix = item.kind == "task" and item.task_id or nil
  local slug = internal.normalize_label(
    suffix and string.format("%s-%s-%s", item.project, item.feature, suffix)
      or string.format("%s-%s", item.project, item.feature)
  )
  local name = "pi-" .. slug
  local scope = item.kind == "task"
      and herdr.ensure_task_scope(
        item.repository,
        agent_scope.workspace_label,
        agent_scope.feature_branch,
        agent_scope.task_branch
      )
    or herdr.ensure_feature_scope(item.repository, agent_scope.workspace_label, agent_scope.feature_branch)
  if not scope then
    return nil
  end
  local agent = herdr.get_agent(name)

  if not agent then
    local command = internal.tool_command_for_named_session("pi", slug)
    command[#command + 1] = M.agent_prompt(item)
    return herdr.start(
      name,
      scope.cwd,
      command,
      { [internal.named_env_var] = slug },
      { workspace_id = scope.workspace_id },
      agent_scope.tab_label
    )
  end

  agent = herdr.place_agent(agent, scope, agent_scope.tab_label)
  if not agent or not agent.pane_id or not herdr.run(agent.pane_id, M.agent_prompt(item)) then
    return nil
  end
  return agent
end

function M.activate_agent(agent)
  require("lazy").load({ plugins = { "sidekick.nvim" } })
  require("plugins.sidekick.registry").rehydrate()
  require("plugins.sidekick.last_session").record(agent.name, agent.terminal_id)
  require("plugins.sidekick.internal").toggle_tool_session(agent.name, true, agent.terminal_id)
end

function M.open()
  local items = M.collect()
  local feature_count = 0
  for _, item in ipairs(items) do
    feature_count = feature_count + (item.kind == "feature" and 1 or 0)
  end
  if feature_count == 0 then
    vim.notify("No active vault features found", vim.log.levels.INFO)
    return
  end

  Snacks.picker.pick({
    source = "active-vault-features",
    items = items,
    title = string.format("Active Vault Feature Tree (%d)", feature_count),
    format = M.format,
    preview = "file",
    matcher = {
      keep_parents = true,
    },
    sort = {
      fields = { "idx" },
    },
    layout = {
      preset = "telescope",
      reverse = false,
    },
    actions = {
      vault_hunter = {
        desc = "(Vault hunter) Action",
        action = function(picker, item)
          local agent = M.send_to_agent(item)
          if agent then
            picker:close()
            M.activate_agent(agent)
            vim.notify("Started Vault Hunter for " .. item.label, vim.log.levels.INFO)
          end
        end,
      },
    },
    win = {
      input = {
        keys = {
          ["<c-a>"] = { "vault_hunter", mode = { "i", "n" } },
        },
      },
      list = {
        keys = {
          ["<c-a>"] = "vault_hunter",
        },
      },
    },
  })
end

return M
