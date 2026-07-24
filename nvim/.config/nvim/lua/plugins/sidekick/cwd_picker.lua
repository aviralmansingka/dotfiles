-- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
-- Cwd-scoped peek picker for sidekick named sessions.
-- Bound to <c-.> in plugins/sidekick.lua.
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")
local branding = require("plugins.sidekick.branding")
local herdr = require("plugins.sidekick.herdr")

local M = {}
local status_rank = { working = 1, blocked = 2, done = 3, idle = 4 }
local status_display = {
  blocked = { "!", "DiagnosticError" },
  done = { "●", "DiagnosticWarn" },
  working = { "›", "DiagnosticInfo" },
  idle = { "·", "Comment" },
}

local function workspace_scope()
  local tab = vim.api.nvim_get_current_tabpage()
  local ok, workspace_id = pcall(vim.api.nvim_tabpage_get_var, tab, "herdr_workspace_id")
  if not ok or type(workspace_id) ~= "string" or workspace_id == "" then
    return nil
  end
  local label_ok, label = pcall(vim.api.nvim_tabpage_get_var, tab, "herdr_workspace_label")
  return workspace_id, label_ok and type(label) == "string" and label ~= "" and label or workspace_id
end

local function workspace_list()
  local result = herdr.call({ "workspace", "list" }, true)
  return result and result.workspaces or {}
end

---@param p string
---@return string
local function normalize(p)
  if not p or p == "" then
    return ""
  end
  return vim.fs.normalize(vim.fn.fnamemodify(p, ":p")):gsub("/$", "")
end

---@param path string|nil
---@return string|nil
local function git_common_dir(path)
  if not path or path == "" then
    return nil
  end
  local result = vim.system(
    { "git", "-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir" },
    { text = true }
  ):wait()
  if result.code ~= 0 then
    return nil
  end
  return normalize((result.stdout or ""):gsub("%s+$", ""))
end

---@param entry_cwd string|nil
---@param root string  already normalized
---@return boolean
local function in_cwd_subtree(entry_cwd, root)
  -- root == "" only when getcwd() was "/" (normalize strips its only slash).
  -- Treat as "match nothing" — a degenerate scenario, opt for safe empty state.
  if not entry_cwd or entry_cwd == "" or root == "" then
    return false
  end
  local n = normalize(entry_cwd)
  if n == root then
    return true
  end
  return n:sub(1, #root + 1) == root .. "/" or root:sub(1, #n + 1) == n .. "/"
end

local function strip_ansi(line)
  return line:gsub("\27%[[%d;:]*m", "")
end

local function scrub_codex_prompt(output)
  local lines = vim.split(output, "\r\n", { plain = true })
  for i = #lines, math.max(1, #lines - 8), -1 do
    if lines[i]:find("›", 1, true) and lines[i]:find("\27[48;", 1, true) then
      local first = i
      local previous = lines[first - 1]
      if previous
        and previous:find("\27[48;", 1, true)
        and strip_ansi(previous):match("^%s*$")
      then
        first = first - 1
      end
      while first > 1 and lines[first - 1] == "" do
        first = first - 1
      end
      return table.concat(lines, "\r\n", 1, first - 1) .. "\27[0m"
    end
  end
  return output
end

local function scrub_pi_prompt(output)
  local lines = vim.split(output, "\r\n", { plain = true })
  local footer
  for i = #lines, math.max(1, #lines - 8), -1 do
    if strip_ansi(lines[i]):match("^MCP:%s") then
      footer = i
      break
    end
  end
  if not footer then
    return output
  end

  local first
  local separators = 0
  for i = footer - 1, math.max(1, footer - 50), -1 do
    local text = strip_ansi(lines[i])
    if text ~= "" and text:gsub("─", "") == "" then
      first = i
      separators = separators + 1
      if separators == 2 then
        break
      end
    end
  end
  if separators < 2 then
    return output
  end

  while first > 1 do
    local previous = lines[first - 1]
    local text = strip_ansi(previous)
    if text:match("^%s*$") or (previous:find("\27[", 1, true) and text:match("^%s*.*Working%.%.%.%s*$")) then
      first = first - 1
    else
      break
    end
  end
  return table.concat(lines, "\r\n", 1, first - 1) .. "\27[0m"
end

local function preview_text(item)
  if not item or item._empty or not item.agent_name then
    return nil, "(no session)"
  end
  local output = herdr.read(item.agent_name, "recent-unwrapped", 120, true)
  if output and item.tool == "codex" then
    output = scrub_codex_prompt(output)
  elseif output and item.tool == "pi" then
    output = scrub_pi_prompt(output)
  end
  return output, "(agent read failed)"
end

local function compare_items(a, b)
  local ar = status_rank[a.status] or math.huge
  local br = status_rank[b.status] or math.huge
  if ar ~= br then
    return ar < br
  end
  if a.tool ~= b.tool then
    return internal.compare_agents(a.tool, b.tool)
  end
  return a.label < b.label
end

local function global_items(home, current_workspace_id, current_workspace_label)
  local grouped = {}
  for _, agent in ipairs(herdr.list_agents()) do
    local parsed = registry.parse_session_name(agent.name)
    local tool = parsed and parsed.tool or agent.agent
    if tool and internal.tool_commands[tool] then
      local cwd = agent.foreground_cwd or agent.cwd or ""
      local cwd_display = cwd
      if home ~= "" and cwd_display:sub(1, #home) == home then
        cwd_display = "~" .. cwd_display:sub(#home + 1)
      end
      local label = parsed and parsed.label
        or (agent.name and not agent.name:match("^sk%-") and agent.name)
        or tool
      local workspace_id = agent.workspace_id or "unknown"
      grouped[workspace_id] = grouped[workspace_id] or {}
      grouped[workspace_id][#grouped[workspace_id] + 1] = {
        text = label,
        label = label,
        toggle_name = parsed and parsed.label or tool,
        tool = tool,
        pane_id = agent.pane_id,
        workspace_id = workspace_id,
        terminal_id = agent.terminal_id,
        agent_name = agent.name,
        status = agent.agent_status or "unknown",
        cwd = cwd,
        cwd_display = cwd_display,
      }
    end
  end

  local items, seen = {}, {}
  local function add_workspace(workspace_id, label)
    seen[workspace_id] = true
    local agents = grouped[workspace_id] or {}
    table.sort(agents, compare_items)
    local parent = {
      text = "",
      _workspace = true,
      _current_workspace = workspace_id == current_workspace_id,
      workspace_id = workspace_id,
      workspace_label = label,
      agent_count = #agents,
    }
    items[#items + 1] = parent
    for index, item in ipairs(agents) do
      item.parent = parent
      item.last = index == #agents
      items[#items + 1] = item
    end
  end

  local workspaces = workspace_list()
  if current_workspace_id then
    local current
    for _, workspace in ipairs(workspaces) do
      if workspace.workspace_id == current_workspace_id then
        current = workspace
        break
      end
    end
    add_workspace(
      current_workspace_id,
      current and (current.label or current_workspace_id) or current_workspace_label or current_workspace_id
    )
  end
  for _, workspace in ipairs(workspaces) do
    if workspace.workspace_id and workspace.workspace_id ~= current_workspace_id then
      add_workspace(workspace.workspace_id, workspace.label or workspace.workspace_id)
    end
  end
  local orphan_ids = {}
  for workspace_id in pairs(grouped) do
    if not seen[workspace_id] then
      orphan_ids[#orphan_ids + 1] = workspace_id
    end
  end
  table.sort(orphan_ids)
  for _, workspace_id in ipairs(orphan_ids) do
    add_workspace(workspace_id, workspace_id)
  end
  return items
end

---@param opts? { global?: boolean }
---@return snacks.picker.finder.Item[]
function M.list_items(opts)
  opts = opts or {}
  local workspace_id, workspace_label = workspace_scope()
  local root = normalize(vim.fn.getcwd())
  local root_repo = not workspace_id and git_common_dir(root) or nil
  local repo_cache = {}
  local home = normalize(vim.fn.expand("~"))
  local items = {}
  if opts.global then
    return global_items(home, workspace_id, workspace_label)
  end

  local function is_local(entry)
    if workspace_id then
      return entry.workspace_id == workspace_id
    end
    local entry_cwd = entry.cwd
    if in_cwd_subtree(entry_cwd, root) then
      return true
    end
    if not root_repo or not entry_cwd or entry_cwd == "" then
      return false
    end
    if repo_cache[entry_cwd] == nil then
      repo_cache[entry_cwd] = git_common_dir(entry_cwd) or false
    end
    return repo_cache[entry_cwd] == root_repo
  end

  for label, entry in pairs(registry.discover()) do
    if is_local(entry) then
      local cwd_display = entry.cwd or ""
      if home ~= "" and cwd_display:sub(1, #home) == home then
        cwd_display = "~" .. cwd_display:sub(#home + 1)
      end
      items[#items + 1] = {
        text = string.format("%s  [%s]  %s", label, entry.status, cwd_display),
        label = label,
        tool = entry.tool,
        slug = entry.slug,
        pane_id = entry.pane_id,
        workspace_id = entry.workspace_id,
        terminal_id = entry.terminal_id,
        agent_name = entry.agent_name,
        status = entry.status,
        cwd = entry.cwd,
        cwd_display = cwd_display,
      }
    end
  end
  table.sort(items, compare_items)
  return items
end

-- A transparent highlight so the picker windows let the terminal bg show
-- through instead of painting Normal/NormalFloat over it.
local function ensure_picker_hl()
  vim.api.nvim_set_hl(0, "SidekickPickerTransparent", { bg = "NONE", default = false })
  vim.api.nvim_set_hl(0, "SidekickPickerCurrentWorkspace", { bg = "#3c3836", bold = true, default = false })
end

---@param opts? table
function M.open(opts)
  opts = opts or {}
  registry.rehydrate()
  ensure_picker_hl()
  local workspace_id, workspace_label
  if not opts.global then
    workspace_id, workspace_label = workspace_scope()
  end
  local items = M.list_items({ global = opts.global })
  local empty = #items == 0
  if empty then
    items = { {
      text = opts.global and "(no named sessions)"
        or workspace_id and "(no named sessions in workspace)"
        or "(no named sessions in cwd)",
      _empty = true,
    } }
  end
  local has_working = vim.iter(items):any(function(item)
    return item.status == "working"
  end)
  local agent_float = require("sidekick.config").cli.win.float
  local picker_width =
    math.max(agent_float.width <= 1 and math.floor(vim.o.columns * agent_float.width) or agent_float.width, 80) + 2
  local picker_height =
    math.max(agent_float.height <= 1 and math.floor(vim.o.lines * agent_float.height) or agent_float.height, 10) + 2
  local spinner_timer
  local reopening = false
  local initial
  if opts.global then
    for index, item in ipairs(items) do
      if not item._workspace then
        initial = index
        break
      end
    end
  end

  local function stop_spinner()
    local timer = spinner_timer
    spinner_timer = nil
    if timer and not timer:is_closing() then
      timer:stop()
      timer:close()
    end
  end

  local winhl = "Normal:SidekickPickerTransparent"
    .. ",NormalFloat:SidekickPickerTransparent"
    .. ",NormalNC:SidekickPickerTransparent"

  local function format_item(item)
    if item._empty then
      return { { item.text or "", "Comment" } }
    end
    if item._workspace then
      local count = item.agent_count or 0
      if item._current_workspace then
        return {
          {
            string.format(
              "▾ %s  %d agent%s",
              item.workspace_label or item.workspace_id or "unknown",
              count,
              count == 1 and "" or "s"
            ),
            "SidekickPickerCurrentWorkspace",
          },
        }
      end
      return {
        { "▾ ", "SnacksPickerTree" },
        { item.workspace_label or item.workspace_id or "unknown", "Directory" },
        { string.format("  %d agent%s", count, count == 1 and "" or "s"), "Comment" },
      }
    end
    local hl = branding.hl_groups(branding.tool_of(item.tool))
    local status = status_display[item.status] or { "?", "Comment" }
    local chunks = {}
    if opts.global then
      chunks[#chunks + 1] = { item.last and "  └─ " or "  ├─ ", "SnacksPickerTree" }
    end
    vim.list_extend(chunks, {
      { (item.status == "working" and Snacks.util.spinner() or status[1]) .. " ", status[2] },
      { item.label or "", hl.title },
    })
    if opts.global or (item.status ~= "idle" and item.status ~= "working") then
      vim.list_extend(chunks, {
        { "  " },
        { "[" .. (item.status or "unknown") .. "]", "Comment" },
      })
    end
    if not opts.global then
      vim.list_extend(chunks, {
        { "  " },
        { item.cwd_display or "", "Directory" },
      })
    end
    return chunks
  end

  local layout = {
    preset = "default",
    reverse = false,
    preview = not opts.global,
    layout = {
      box = "vertical",
      width = picker_width,
      height = picker_height,
      border = "none",
      backdrop = false,
    },
  }
  if opts.global then
    layout.layout[1] = { win = "input", height = 1, border = "rounded" }
    layout.layout[2] = { win = "list", border = "rounded" }
  else
    layout.layout[1] = { win = "preview", border = "rounded" }
    layout.layout[2] = { win = "input", height = 1, border = "rounded" }
    layout.layout[3] = { win = "list", height = 5, border = "rounded" }
  end
  local preview = false
  if not opts.global then
    preview = function(ctx)
      local buf = ctx.preview:scratch()
      local output, err = preview_text(ctx.item)
      if output then
        vim.api.nvim_chan_send(vim.api.nvim_open_term(buf, {}), output)
      else
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, { err })
      end
      return true
    end
  end

  return Snacks.picker.pick({
    source = "sidekick_cwd_peek",
    title = opts.global and "Sidekick Agents by Workspace"
      or workspace_id and ("Sidekick Sessions in Workspace: " .. workspace_label)
      or "Sidekick Sessions in Cwd",
    items = items,
    format = format_item,
    matcher = opts.global and { keep_parents = true, sort = false } or nil,
    on_show = function(picker)
      if opts.on_show then
        opts.on_show(picker)
      end
      if initial then
        vim.schedule(function()
          if not picker.closed then
            picker.list:view(initial)
          end
        end)
      end
      if not has_working or spinner_timer then
        return
      end
      spinner_timer = vim.uv.new_timer()
      spinner_timer:start(80, 80, vim.schedule_wrap(function()
        if picker.closed then
          stop_spinner()
        else
          picker.list:update({ force = true })
        end
      end))
    end,
    on_close = function(picker)
      stop_spinner()
      if not reopening and opts.on_close then
        opts.on_close(picker)
      end
    end,
    layout = layout,
    preview = preview,
    confirm = function(picker, item)
      if item and item._workspace then
        return
      end
      if not item or item._empty then
        picker:close()
        return
      end
      if item.label then
        if opts.on_confirm then
          opts.on_confirm(item)
        end
        picker:close()
        local current_workspace_id = workspace_scope()
        if
          opts.global
          and item.workspace_id
          and item.workspace_id ~= current_workspace_id
          and not require("plugins.herdr.workspaces").focus(item.workspace_id)
        then
          return
        end
        local target = item.toggle_name or item.label
        require("plugins.sidekick.last_session").record(target, item.terminal_id)
        internal.toggle_tool_session(target, true, item.terminal_id)
      end
    end,
    win = {
      input = {
        wo = { winhighlight = winhl },
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n", "i" } },
        },
      },
      list = {
        wo = { cursorline = opts.global, winhighlight = winhl },
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n" } },
        },
      },
      preview = {
        wo = { winhighlight = winhl, wrap = true, linebreak = true },
      },
    },
    actions = {
      sidekick_kill_session = function(picker, item)
        if not item or item._empty or not item.pane_id then
          return
        end
        if herdr.close(item.pane_id) then
          if opts.on_kill then
            opts.on_kill(item)
          end
          reopening = true
          picker:close()
          vim.schedule(function()
            M.open(opts)
          end)
        end
      end,
    },
  })
end

return M
