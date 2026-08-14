-- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
-- Cwd-scoped peek picker for sidekick named sessions.
-- Bound to <c-.> in plugins/sidekick.lua.
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")
local branding = require("plugins.sidekick.branding")
local herdr = require("plugins.sidekick.herdr")

local M = {}
local collapsed = {}
local run_times = {}
local context_usage = {}
local session_paths = {}
local spinner_refresh_ms = 80
local preview_debounce_ms = 400
local preview_settle_ms = 16
local full_preview_lines = 2147483647 -- Herdr clamps this to the available scrollback.
local branch_glyph = ""
local workspace_ns = vim.api.nvim_create_namespace("sidekick_workspace_picker")
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
---@param cache table<string, SidekickGitContext|false>
---@return SidekickGitContext|nil
local function git_context(path, cache)
  if not path or path == "" then
    return nil
  end
  local key = normalize(path)
  if cache[key] == nil then
    cache[key] = herdr.git_context(key) or false
  end
  return cache[key] or nil
end

---@param context SidekickGitContext|nil
---@param cache table<string, { added: integer, removed: integer }|false>
---@return { added: integer, removed: integer }|nil
local function diff_stats(context, cache)
  if not context or context.branch == "main" then
    return nil
  end
  if cache[context.worktree] == nil then
    cache[context.worktree] = herdr.git_diff_stats(context.worktree, "main") or false
  end
  return cache[context.worktree] or nil
end

local function session_display_label(context, label, non_git_label)
  return context and context.branch ~= "main" and context.worktree_label or context and label or non_git_label or label
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

local function last_capture(text, pattern)
  local value
  for match in text:gmatch(pattern) do
    value = match
  end
  return value
end

local function parse_elapsed(value)
  if not value then
    return nil
  end
  local hours = tonumber(value:match("(%d+)%s*h")) or 0
  local minutes = tonumber(value:match("(%d+)%s*m")) or 0
  local seconds = tonumber(value:match("(%d+)%s*s")) or 0
  return hours * 3600 + minutes * 60 + seconds
end

local function context_used(output)
  local lines = vim.split(output, "\n", { plain = true })
  for index = #lines, 1, -1 do
    local used = lines[index]:match("(%d+%.?%d*)%%/%d+k")
    if used then
      return used
    end
    local left = tonumber(lines[index]:match("(%d+%.?%d*)%% context left"))
    if left then
      return tostring(100 - left)
    end
  end
end

local function codex_context_used(agent_session)
  if not agent_session or agent_session.kind ~= "id" or not agent_session.value then
    return nil
  end
  local id = agent_session.value
  local path = session_paths[id]
  if path == nil then
    path = vim.fn.glob(vim.fn.expand("~/.codex/sessions/**/*" .. id .. "*.jsonl"), false, true)[1] or false
    session_paths[id] = path
  end
  if not path then
    return nil
  end

  local file = io.open(path, "rb")
  if not file then
    return nil
  end
  local size = file:seek("end") or 0
  local offset = math.max(0, size - 512 * 1024)
  file:seek("set", offset)
  local tail = file:read("*a") or ""
  file:close()
  if offset > 0 then
    local newline = tail:find("\n", 1, true)
    tail = newline and tail:sub(newline + 1) or ""
  end

  local lines = vim.split(tail, "\n", { plain = true })
  for index = #lines, 1, -1 do
    local ok, event = pcall(vim.json.decode, lines[index])
    local info = ok
      and event.type == "event_msg"
      and event.payload
      and event.payload.type == "token_count"
      and event.payload.info
    local usage = info and info.last_token_usage
    local total = usage and usage.total_tokens
    local window = info and info.model_context_window
    if total and window and window > 0 then
      return (string.format("%.1f", total / window * 100):gsub("%.0$", ""))
    end
  end
end

local function agent_metrics(agent_name, agent_session, status, cache)
  if not cache or not agent_name then
    return {}
  end
  if cache[agent_name] then
    return cache[agent_name]
  end

  local metrics = {}
  local output = herdr.read(agent_name, "visible", 20, false)
  local now = vim.uv.now()
  local runtime = run_times[agent_name] or {}
  if output then
    metrics.context_used = codex_context_used(agent_session) or context_used(output)
    if metrics.context_used then
      context_usage[agent_name] = metrics.context_used
    end
    if status == "working" then
      local elapsed = parse_elapsed(last_capture(output, "Working%s*%((.-)%s+•%s+esc to interrupt"))
      if runtime.status ~= "working" or elapsed then
        runtime.working_since = now - (elapsed or 0) * 1000
        runtime.running_seconds = nil
      end
      metrics.working_since = runtime.working_since
    else
      local completed = parse_elapsed(last_capture(output, "Goal achieved%s*%((.-)%)"))
        or parse_elapsed(last_capture(output, "Worked for%s+([%d hms]+)"))
      if completed then
        runtime.running_seconds = completed
      elseif runtime.status == "working" and runtime.working_since then
        runtime.running_seconds = (now - runtime.working_since) / 1000
      end
    end
  elseif status == "working" and runtime.status ~= "working" then
    runtime.working_since = now
    runtime.running_seconds = nil
  end
  metrics.context_used = metrics.context_used or context_usage[agent_name]
  metrics.working_since = status == "working" and runtime.working_since or nil
  metrics.running_seconds = status ~= "working" and runtime.running_seconds or nil
  runtime.status = status
  run_times[agent_name] = runtime
  cache[agent_name] = metrics
  return metrics
end

local function diff_chunks(item)
  local diff = item.diff
  if not diff then
    return {}
  end
  if diff.added == 0 and diff.removed == 0 then
    return { { " · clean", "Comment" } }
  end
  return {
    { " · ", "Comment" },
    { "+" .. tostring(diff.added), "DiagnosticOk" },
    { " ", "Comment" },
    { "−" .. tostring(diff.removed), "DiagnosticError" },
  }
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

local function scrub_working_status(output)
  local lines = vim.split(output, "\r\n", { plain = true })
  return table.concat(vim.tbl_filter(function(line)
    local prefix, suffix = strip_ansi(line):match("^(.-)Working(.*)$")
    return not (
      prefix
      and not prefix:find("[%w]")
      and (suffix:match("^%.%.%.%s*$") or suffix:match("^…%s*$") or suffix:find("esc to interrupt", 1, true))
    )
  end, lines), "\r\n")
end

local function trim_terminal_padding(output)
  local lines = vim.split(output, "\r\n", { plain = true })
  for index, line in ipairs(lines) do
    local suffix = {}
    line = line:gsub("[ \t]+$", "")
    while true do
      local prefix, sgr = line:match("^(.*)(\27%[[%d;:]*m)$")
      if not sgr then
        break
      end
      table.insert(suffix, 1, sgr)
      line = prefix:gsub("[ \t]+$", "")
    end
    lines[index] = line .. table.concat(suffix)
  end
  return table.concat(lines, "\r\n")
end

local function scrub_preview_output(item, output)
  if output and item.tool == "codex" then
    output = scrub_codex_prompt(output)
  elseif output and item.tool == "pi" then
    output = scrub_pi_prompt(output)
  end
  if output then
    output = trim_terminal_padding(scrub_working_status(output))
  end
  return output
end

local function preview_text(item, lines)
  if not item or item._empty or not item.agent_name then
    return nil, "(no session)"
  end
  local output = scrub_preview_output(item, herdr.read(item.agent_name, "recent-unwrapped", lines, true))
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

---@return snacks.picker.finder.Item[]
function M.list_items(metric_cache)
  local workspace_id = workspace_scope()
  local root = normalize(vim.fn.getcwd())
  local context_cache = {}
  local stats_cache = {}
  local root_context = git_context(root, context_cache)
  local items = {}

  local function is_local(entry)
    local entry_cwd = entry.cwd
    local entry_context = git_context(entry_cwd, context_cache)
    if root_context then
      return entry_context and entry_context.worktree == root_context.worktree
    end
    if workspace_id then
      return entry.workspace_id == workspace_id and in_cwd_subtree(entry_cwd, root)
    end
    return in_cwd_subtree(entry_cwd, root)
  end

  for _, agent in ipairs(herdr.list_agents()) do
    local parsed = registry.parse_session_name(agent.name)
    local tool = parsed and parsed.tool or agent.agent
    local entry = {
      label = parsed and parsed.label or tool,
      tool = tool,
      slug = parsed and parsed.slug or nil,
      pane_id = agent.pane_id,
      tab_id = agent.tab_id,
      workspace_id = agent.workspace_id,
      terminal_id = agent.terminal_id,
      agent_name = agent.name,
      agent_session = agent.agent_session,
      status = agent.agent_status or "unknown",
      cwd = agent.foreground_cwd or agent.cwd or "",
    }
    local label = entry.label
    if herdr.is_durable_agent(agent) and tool and internal.tool_commands[tool] and is_local(entry) then
      local context = git_context(entry.cwd, context_cache)
      local metrics = agent_metrics(entry.agent_name, entry.agent_session, entry.status, metric_cache)
      items[#items + 1] = {
        text = string.format("%s  [%s]", session_display_label(context, label), entry.status),
        label = label,
        display_label = session_display_label(context, label),
        tool = entry.tool,
        slug = entry.slug,
        pane_id = entry.pane_id,
        tab_id = entry.tab_id,
        workspace_id = entry.workspace_id,
        terminal_id = entry.terminal_id,
        agent_name = entry.agent_name,
        agent_session = entry.agent_session,
        status = entry.status,
        cwd = entry.cwd,
        repository = context and context.repository or nil,
        worktree = context and context.worktree or entry.cwd,
        branch = context and context.branch or nil,
        diff = diff_stats(context, stats_cache),
        working_since = metrics.working_since,
        running_seconds = metrics.running_seconds,
        context_used = metrics.context_used,
      }
    end
  end
  table.sort(items, compare_items)
  return items
end

local function status_icon(status)
  local display = status_display[status] or { "?", "Comment" }
  return status == "working" and Snacks.util.spinner() or display[1], display[2]
end

local function identity_hl(item)
  if item.branch and item.branch ~= "main" then
    return "SidekickBranch"
  end
  return branding.hl_groups(branding.tool_of(item.tool)).title
end

local function workspace_groups(first_repository, metric_cache)
  local grouped = {}
  local context_cache = {}
  local stats_cache = {}
  local workspace_labels = {}
  for _, workspace in ipairs(workspace_list()) do
    workspace_labels[workspace.workspace_id] = workspace.label
  end
  for _, agent in ipairs(herdr.list_agents()) do
    local parsed = registry.parse_session_name(agent.name)
    local tool = parsed and parsed.tool or agent.agent
    if herdr.is_durable_agent(agent) and tool and internal.tool_commands[tool] then
      local workspace_id = agent.workspace_id or "unknown"
      local context = git_context(agent.foreground_cwd or agent.cwd, context_cache)
      local group_key = context and ("repository:" .. context.repository) or ("workspace:" .. workspace_id)
      local group = grouped[group_key]
      if not group then
        group = {
          item = {
            _workspace = true,
            group_key = group_key,
            repository = context and context.repository or nil,
            workspace_id = workspace_id,
            workspace_label = context and context.repository_label or workspace_labels[workspace_id] or workspace_id,
          },
          running = 0,
          done = 0,
          agents = {},
          worktrees = {},
        }
        grouped[group_key] = group
      end
      local status = agent.agent_status or "unknown"
      local metrics = agent_metrics(agent.name, agent.agent_session, status, metric_cache)
      group.running = group.running + (status == "working" and 1 or 0)
      group.done = group.done + (status == "done" and 1 or 0)
      local worktree = context and context.worktree or (agent.foreground_cwd or agent.cwd or agent.name)
      local label = parsed and parsed.label
        or (agent.name and not agent.name:match("^sk%-") and agent.name)
        or tool
      group.worktrees[worktree] = true
      group.agents[#group.agents + 1] = {
        label = label,
        display_label = session_display_label(
          context,
          label,
          vim.fn.fnamemodify(agent.foreground_cwd or agent.cwd or agent.name or tool, ":t")
        ),
        slug = parsed and parsed.slug,
        toggle_name = parsed and parsed.label or tool,
        tool = tool,
        pane_id = agent.pane_id,
        tab_id = agent.tab_id,
        workspace_id = workspace_id,
        terminal_id = agent.terminal_id,
        agent_name = agent.name,
        agent_session = agent.agent_session,
        status = status,
        cwd = agent.foreground_cwd or agent.cwd,
        repository = context and context.repository or nil,
        worktree = context and context.worktree or nil,
        branch = context and context.branch or nil,
        diff = diff_stats(context, stats_cache),
        working_since = metrics.working_since,
        running_seconds = metrics.running_seconds,
        context_used = metrics.context_used,
      }
    end
  end

  local groups = {}
  local function add_group(group)
    local key = group.item.group_key
    if collapsed[key] == nil then
      collapsed[key] = false
    end
    group.item._collapsed = collapsed[key]
    group.worktree_count = vim.tbl_count(group.worktrees)
    table.sort(group.agents, compare_items)
    groups[#groups + 1] = group
  end

  local keys = vim.tbl_keys(grouped)
  table.sort(keys, function(a, b)
    local left = grouped[a].item
    local right = grouped[b].item
    if first_repository and left.repository ~= right.repository then
      if left.repository == first_repository then
        return true
      end
      if right.repository == first_repository then
        return false
      end
    end
    return (left.workspace_label or a) < (right.workspace_label or b)
  end)
  for _, key in ipairs(keys) do
    add_group(grouped[key])
  end
  return groups
end

local function format_local(item)
  if item._empty then
    return { { item.text or "", "Comment" } }
  end
  local symbol, symbol_hl = status_icon(item.status)
  local chunks = { { symbol .. " ", symbol_hl } }
  if item.branch and item.branch ~= "main" then
    chunks[#chunks + 1] = { branch_glyph .. " ", "SidekickBranch" }
  end
  chunks[#chunks + 1] = {
    item.display_label or item.label or "",
    identity_hl(item),
  }
  vim.list_extend(chunks, diff_chunks(item))
  return chunks
end

local function workspace_chunks(group)
  local item = group.item
  local count = group.worktree_count or #group.agents
  return {
    { item._collapsed and "▸ " or "▾ ", "SnacksPickerTree" },
    { item.workspace_label or item.workspace_id or "unknown", "Directory" },
    { string.format(" · %d worktree%s", count, count == 1 and "" or "s"), "Comment" },
  }
end

local function workspace_agent_chunks(item, last)
  local symbol, symbol_hl = status_icon(item.status)
  local chunks = {
    { last and "  └─ " or "  ├─ ", "SnacksPickerTree" },
    { symbol .. " ", symbol_hl },
  }
  if item.branch and item.branch ~= "main" then
    chunks[#chunks + 1] = { branch_glyph .. " ", "SidekickBranch" }
  end
  chunks[#chunks + 1] = {
    item.display_label or item.label or item.agent_name or "unknown",
    identity_hl(item),
  }
  vim.list_extend(chunks, diff_chunks(item))
  return chunks
end

-- A transparent highlight so the picker windows let the terminal bg show
-- through instead of painting Normal/NormalFloat over it.
local function ensure_picker_hl()
  vim.api.nvim_set_hl(0, "SidekickPickerTransparent", { bg = "NONE", default = false })
end

---@param opts? table
function M.open(opts)
  opts = opts or {}
  registry.rehydrate()
  ensure_picker_hl()

  local metric_cache = {}
  local workspace_id, workspace_label = workspace_scope()
  local current_git = herdr.git_context(vim.fn.getcwd())
  local items = M.list_items(metric_cache)
  local groups = workspace_groups(current_git and current_git.repository or nil, metric_cache)
  local workspace_matcher = require("snacks.picker.core.matcher").new({ sort = false })
  if #items == 0 then
    items = {
      {
        text = current_git and "(no session in worktree)"
          or (workspace_id and "(no named sessions in workspace)" or "(no named sessions in cwd)"),
        _empty = true,
      },
    }
  end

  local workspace_rows = {}
  local workspace_pattern = ""
  local picker
  local spinner_timer
  local workspace_win
  local rendered_workspace_item
  local pending_workspace_item
  local workspace_active = false
  local preview_loading = false
  local displayed_preview_item
  local expanded_preview_item
  local loading_full_preview_item
  local pending_preview_scroll
  local refreshed_preview_item
  local refreshed_preview_output
  local reopening = false
  local preview_generation = 0
  local preview_selection
  local staging_buffers = {}
  local transition_preview
  local has_local_working = vim.iter(items):any(function(item)
    return item.status == "working"
  end)
  local has_workspace_working = vim.iter(groups):any(function(group)
    return group.running > 0
  end)
  local has_working = has_local_working or has_workspace_working

  local function stop_spinner()
    local timer = spinner_timer
    spinner_timer = nil
    if timer and not timer:is_closing() then
      timer:stop()
      timer:close()
    end
  end

  local function set_active_selector(is_workspace_active)
    workspace_active = is_workspace_active
    if not picker or not workspace_win or not workspace_win:valid() or not picker.list.win:valid() then
      return
    end
    local active =
      "Normal:SidekickPickerTransparent,NormalNC:SidekickPickerTransparent,FloatBorder:SnacksPickerPreviewBorder,FloatTitle:SnacksPickerPreviewTitle"
    local inactive = "Normal:SidekickPickerTransparent,NormalNC:SidekickPickerTransparent"
    workspace_win.opts.wo.winhighlight = workspace_active and active or inactive
    picker.list.win.opts.wo.winhighlight = workspace_active and inactive or active
    vim.wo[workspace_win.win].winhighlight = workspace_win.opts.wo.winhighlight
    vim.wo[picker.list.win.win].winhighlight = picker.list.win.opts.wo.winhighlight
  end

  local preview_workspace_cursor

  local function render_workspace()
    if not workspace_win or not workspace_win:valid() then
      return
    end
    local pattern = picker and picker.input:get() or ""
    workspace_matcher:init(pattern)
    local function matches(text)
      return workspace_matcher:match({ text = text }) > 0
    end
    local lines, highlights = {}, {}
    workspace_rows = {}
    for _, group in ipairs(groups) do
      local label = group.item.workspace_label or group.item.workspace_id or "unknown"
      local workspace_matches = matches(label)
      local agents = vim.tbl_filter(function(agent)
        return workspace_matches
          or matches(table.concat({
            agent.display_label or "",
            agent.label or "",
            agent.agent_name or "",
            agent.tool or "",
          }, " "))
      end, group.agents)
      if workspace_matches or #agents > 0 then
        local chunks = workspace_chunks(group)
        workspace_rows[#workspace_rows + 1] = group.item
        lines[#lines + 1] = ""
        local col = 0
        for _, chunk in ipairs(chunks) do
          lines[#lines] = lines[#lines] .. chunk[1]
          highlights[#highlights + 1] = { #lines - 1, col, col + #chunk[1], chunk[2] }
          col = col + #chunk[1]
        end
        if not group.item._collapsed or pattern ~= "" then
          for index, agent in ipairs(agents) do
            chunks = workspace_agent_chunks(agent, index == #agents)
            workspace_rows[#workspace_rows + 1] = agent
            lines[#lines + 1] = ""
            col = 0
            for _, chunk in ipairs(chunks) do
              lines[#lines] = lines[#lines] .. chunk[1]
              highlights[#highlights + 1] = { #lines - 1, col, col + #chunk[1], chunk[2] }
              col = col + #chunk[1]
            end
          end
        end
      end
    end
    if #lines == 0 then
      lines = { pattern == "" and "(no repositories with sessions)" or "(no matching worktrees)" }
      highlights = { { 0, 0, -1, "Comment" } }
    end

    local cursor = vim.api.nvim_win_get_cursor(workspace_win.win)
    local cursor_row = math.min(cursor[1], #lines)
    if pattern ~= "" and pattern ~= workspace_pattern then
      for row, item in ipairs(workspace_rows) do
        if not item._workspace then
          cursor_row = row
          break
        end
      end
    end
    workspace_pattern = pattern
    if workspace_active and preview_selection ~= nil and workspace_rows[cursor_row] ~= preview_selection then
      transition_preview()
      rendered_workspace_item = nil
      pending_workspace_item = nil
    end
    vim.bo[workspace_win.buf].modifiable = true
    vim.api.nvim_buf_set_lines(workspace_win.buf, 0, -1, false, lines)
    vim.bo[workspace_win.buf].modifiable = false
    vim.api.nvim_buf_clear_namespace(workspace_win.buf, workspace_ns, 0, -1)
    for _, hl in ipairs(highlights) do
      vim.api.nvim_buf_add_highlight(workspace_win.buf, workspace_ns, hl[4], hl[1], hl[2], hl[3])
    end
    vim.api.nvim_win_set_cursor(workspace_win.win, { cursor_row, 0 })
    if workspace_active and preview_workspace_cursor then
      vim.schedule(preview_workspace_cursor)
    end
  end

  local function preview_window(preview)
    local win = preview and preview.win or picker and picker.preview.win
    return win and win:win_valid() and win or nil
  end

  local function preview_line_limit(preview)
    local win = preview_window(preview)
    if win then
      return math.max(vim.api.nvim_win_get_height(win.win) * 2, 1)
    end
    return math.max(vim.o.lines * 2, 1)
  end

  local show_preview

  local render_workspace_preview = Snacks.util.debounce(function()
    if not picker or picker.closed or not workspace_win:valid() then
      return
    end
    local item = pending_workspace_item
    pending_workspace_item = nil
    if
      item
      and item ~= rendered_workspace_item
      and item == workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
    then
      rendered_workspace_item = item
      show_preview(item)
    end
  end, { ms = preview_debounce_ms })

  preview_workspace_cursor = function()
    if not picker or picker.closed or not workspace_win:valid() then
      return
    end
    local item = workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
    if not item then
      pending_workspace_item = nil
      if rendered_workspace_item or preview_selection then
        transition_preview()
        rendered_workspace_item = nil
      end
      return
    end
    if item == rendered_workspace_item then
      pending_workspace_item = nil
    elseif item and item ~= pending_workspace_item then
      transition_preview()
      pending_workspace_item = item
      render_workspace_preview()
    end
  end

  local function current_preview_item()
    return workspace_active and rendered_workspace_item or picker:current()
  end

  local function prepare_preview_buffer(output, fallback, preview)
    local buf = vim.api.nvim_create_buf(false, true)
    vim.bo[buf].bufhidden = "wipe"
    vim.bo[buf].filetype = "snacks_picker_preview"
    local staging_win
    if output then
      local width = 80
      local height = 24
      local win = preview_window(preview)
      if win then
        width = vim.api.nvim_win_get_width(win.win)
        height = vim.api.nvim_win_get_height(win.win)
      end
      staging_win = vim.api.nvim_open_win(buf, false, {
        relative = "editor",
        row = 0,
        col = 0,
        width = width,
        height = height,
        style = "minimal",
        focusable = false,
        hide = true,
        noautocmd = true,
      })
      local channel = vim.api.nvim_open_term(buf, {})
      vim.api.nvim_chan_send(channel, output)
    else
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, { fallback or "(agent read failed)" })
    end
    staging_buffers[buf] = staging_win or false
    return buf, staging_win
  end

  local function preview_buffer_ready(buf, previous_tick)
    local tick = vim.api.nvim_buf_get_changedtick(buf)
    return tick == previous_tick, tick
  end

  local function discard_preview_buffer(buf, staging_win)
    staging_buffers[buf] = nil
    if staging_win and vim.api.nvim_win_is_valid(staging_win) then
      vim.api.nvim_win_close(staging_win, true)
    end
    if vim.api.nvim_buf_is_valid(buf) then
      vim.api.nvim_buf_delete(buf, { force = true })
    end
  end

  local function discard_staging_buffers()
    local buffers = {}
    for buf, staging_win in pairs(staging_buffers) do
      buffers[#buffers + 1] = { buf, staging_win or nil }
    end
    for _, staged in ipairs(buffers) do
      discard_preview_buffer(staged[1], staged[2])
    end
  end

  local function invalidate_preview()
    preview_generation = preview_generation + 1
    discard_staging_buffers()
  end

  transition_preview = function()
    invalidate_preview()
    preview_selection = nil
    displayed_preview_item = nil
    expanded_preview_item = nil
    pending_preview_scroll = nil
  end

  local function swap_preview_buffer(buf, staging_win, item, rendered, generation, on_swap, previous_tick)
    if
      generation ~= preview_generation
      or item ~= preview_selection
      or not picker
      or picker.closed
      or item ~= current_preview_item()
    then
      discard_preview_buffer(buf, staging_win)
      return
    end
    local ready, tick = preview_buffer_ready(buf, previous_tick)
    if not ready then
      vim.defer_fn(function()
        swap_preview_buffer(buf, staging_win, item, rendered, generation, on_swap, tick)
      end, preview_settle_ms)
      return
    end
    picker.preview:set_buf(buf)
    staging_buffers[buf] = nil
    if staging_win and vim.api.nvim_win_is_valid(staging_win) then
      vim.api.nvim_win_close(staging_win, true)
    end
    picker.preview.win:map()
    picker.preview:minimal()
    refreshed_preview_item = item
    refreshed_preview_output = rendered
    if on_swap then
      on_swap()
    end
  end

  local function render_default_preview(item, preview, generation)
    if generation ~= preview_generation or item ~= preview_selection then
      return
    end
    local output, err = preview_text(item, preview_line_limit(preview))
    local rendered = output or err
    local buf, staging_win = prepare_preview_buffer(output, err, preview)
    vim.schedule(function()
      swap_preview_buffer(buf, staging_win, item, rendered, generation)
    end)
  end

  show_preview = function(item, preview)
    if item ~= preview_selection then
      transition_preview()
      preview_selection = item
      displayed_preview_item = item
    elseif item == displayed_preview_item and item == expanded_preview_item then
      return
    end
    render_default_preview(item, preview, preview_generation)
  end

  local function move_workspace_selection(step)
    if not workspace_win or not workspace_win:valid() then
      return
    end
    local row = vim.api.nvim_win_get_cursor(workspace_win.win)[1] + step
    local item = workspace_rows[row]
    if not item then
      return
    end
    vim.api.nvim_win_set_cursor(workspace_win.win, { row, 0 })
    rendered_workspace_item = item._workspace and nil or item
    pending_workspace_item = nil
    set_active_selector(true)
    if not item._workspace then
      show_preview(item)
    end
  end

  local function refresh_preview()
    local item = current_preview_item()
    if
      preview_loading
      or not item
      or (item.status ~= "working" and not vim.iter(items):any(function(candidate)
        return candidate.agent_name == item.agent_name and candidate.status == "working"
      end))
      or item == expanded_preview_item
    then
      return
    end

    local generation = preview_generation
    preview_loading = true
    herdr.read_async(item.agent_name, "recent-unwrapped", preview_line_limit(), true, function(output)
      preview_loading = false
      if generation ~= preview_generation or item ~= preview_selection then
        return
      end
      if not picker or picker.closed or item ~= current_preview_item() then
        return
      end
      if item == expanded_preview_item then
        return
      end
      output = scrub_preview_output(item, output)
      local rendered = output or "(agent read failed)"
      if item == refreshed_preview_item and rendered == refreshed_preview_output then
        return
      end

      local buf, staging_win = prepare_preview_buffer(output)
      vim.schedule(function()
        swap_preview_buffer(buf, staging_win, item, rendered, generation)
      end)
    end)
  end

  local function scroll_preview_window(up, from_bottom)
    local win = picker.preview.win.win
    local view = vim.api.nvim_win_call(win, function()
      return vim.fn.winsaveview()
    end)
    local step = math.max(vim.wo[win].scroll, 1)
    local last_topline =
      math.max(vim.api.nvim_buf_line_count(picker.preview.win.buf) - vim.api.nvim_win_get_height(win) + 1, 1)
    if from_bottom then
      view.topline = last_topline
    end
    view.topline = math.max(1, math.min(view.topline + (up and -step or step), last_topline))
    vim.api.nvim_win_call(win, function()
      vim.fn.winrestview(view)
    end)
  end

  local function scroll_preview(up)
    local item = current_preview_item()
    if not item or item._empty or item._workspace then
      return
    end
    if item == expanded_preview_item and item ~= loading_full_preview_item then
      scroll_preview_window(up)
      return
    end
    expanded_preview_item = item
    pending_preview_scroll = up
    if item == loading_full_preview_item then
      return
    end

    local generation = preview_generation
    loading_full_preview_item = item
    herdr.read_async(item.agent_name, "recent-unwrapped", full_preview_lines, true, function(output)
      if loading_full_preview_item == item then
        loading_full_preview_item = nil
      end
      if generation ~= preview_generation or item ~= preview_selection then
        return
      end
      if not picker or picker.closed or item ~= current_preview_item() or item ~= expanded_preview_item then
        return
      end
      output = scrub_preview_output(item, output)
      local rendered = output or "(agent read failed)"
      local buf, staging_win = prepare_preview_buffer(output)
      vim.schedule(function()
        swap_preview_buffer(buf, staging_win, item, rendered, generation, function()
          local direction = pending_preview_scroll
          pending_preview_scroll = nil
          scroll_preview_window(direction, true)
        end)
      end)
    end)
  end

  local function activate(active_picker, item)
    if not item or item._empty or item._workspace then
      return
    end
    if opts.on_confirm then
      opts.on_confirm(item)
    end
    local target = item.toggle_name or item.label
    active_picker:close()
    local current_workspace_id = workspace_scope()
    if
      item.workspace_id
      and item.workspace_id ~= current_workspace_id
      and not require("plugins.herdr.workspaces").focus(item.workspace_id)
    then
      return
    end
    if item.status == "done" then
      herdr.focus(item.agent_name)
    end
    require("plugins.sidekick.last_session").record(target, item.terminal_id)
    internal.toggle_tool_session(target, true, item.terminal_id)
  end

  local function rename_item(active_picker, item)
    if not item or item._empty or not item.agent_name or not item.tool then
      return
    end
    local current_slug = internal.normalize_label(item.slug or item.label)
    vim.ui.input({ prompt = item.tool .. " session label: ", default = item.slug or item.label }, function(input)
      local slug = internal.normalize_label(input)
      local name = item.tool .. "-" .. slug
      if slug == "" or slug == current_slug then
        return
      end
      local result, err = herdr.call({ "agent", "rename", item.agent_name, name }, true)
      if not result then
        vim.notify("Sidekick: session rename failed: " .. (err or "unknown error"), vim.log.levels.ERROR)
        return
      end
      reopening = true
      active_picker:close()
      vim.schedule(function()
        M.open(opts)
      end)
    end)
  end

  local function kill_item(active_picker, item)
    if not item or item._empty or not item.pane_id then
      return
    end
    if vim.fn.confirm("Kill agent " .. item.label .. "?", "&Yes\n&No", 2) ~= 1 then
      return
    end
    if not herdr.close(item.pane_id) then
      vim.notify("Sidekick: session close failed: " .. item.label, vim.log.levels.ERROR)
      return
    end
    if opts.on_kill then
      opts.on_kill(item)
    end
    reopening = true
    active_picker:close()
    require("plugins.herdr.workspaces").agent_closed(item.workspace_id, item.cwd)
    vim.schedule(function()
      M.open(opts)
    end)
  end

  local function active_item()
    if workspace_active and workspace_win and workspace_win:valid() then
      return workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
    end
    return picker and picker:current() or nil
  end

  local function rename_active_item()
    rename_item(picker, active_item())
  end

  local function kill_active_item()
    kill_item(picker, active_item())
  end

  local function focus_input()
    picker:focus("input")
    vim.cmd.startinsert()
  end

  local function workspace_enter()
    local item = workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
    if not item then
      return
    end
    if item._workspace then
      collapsed[item.group_key] = not collapsed[item.group_key]
      item._collapsed = collapsed[item.group_key]
      render_workspace()
      focus_input()
    else
      activate(picker, item)
    end
  end

  local function clear_input()
    picker.input:set("")
    focus_input()
  end

  local function toggle_selector()
    transition_preview()
    rendered_workspace_item = nil
    pending_workspace_item = nil
    set_active_selector(not workspace_active)
    if workspace_active then
      local item = workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
      if item and not item._workspace then
        rendered_workspace_item = item
        show_preview(item)
      end
    else
      show_preview(picker:current())
    end
    focus_input()
  end

  local function move_active_selector(step)
    if workspace_active then
      move_workspace_selection(step)
    else
      picker.list:move(step)
    end
  end

  local function move_next()
    move_active_selector(1)
  end

  local function move_previous()
    move_active_selector(-1)
  end

  local function confirm_active_selector()
    if workspace_active then
      workspace_enter()
    else
      picker:action("confirm")
    end
  end

  workspace_win = Snacks.win({
    show = false,
    focusable = false,
    bo = { buftype = "nofile", bufhidden = "wipe", modifiable = false },
    wo = {
      cursorline = true,
      number = false,
      relativenumber = false,
      signcolumn = "no",
      foldcolumn = "0",
      winhighlight = "Normal:SidekickPickerTransparent,NormalNC:SidekickPickerTransparent",
    },
    keys = {
      ["<cr>"] = workspace_enter,
      ["<c-w>"] = focus_input,
      ["<c-u>"] = clear_input,
      ["<c-x>"] = kill_active_item,
      ["<c-b>"] = function()
        scroll_preview(true)
      end,
      ["<c-f>"] = function()
        scroll_preview(false)
      end,
      ["<esc>"] = focus_input,
    },
  })
  local bottom_layout = {
    box = "horizontal",
    height = 14,
    {
      width = 0.5,
      win = "workspace",
      height = 12,
      title = " Repositories / Worktrees ",
      footer = " <C-w> Current Worktree · <Enter> Expand/Open ",
      footer_pos = "center",
      border = "rounded",
    },
    {
      width = 0.5,
      win = "list",
      height = 12,
      title = " Current Worktree ",
      footer = " <C-w> Repositories ",
      footer_pos = "center",
      border = "rounded",
    },
  }
  local layout_wins = { workspace = workspace_win }

  local agent_float = require("sidekick.config").cli.win.float
  -- Sidekick sizes the float's content first; its rounded border then adds one
  -- cell on every side. The borderless picker root must include those cells.
  local picker_width = math.max(
    agent_float.width <= 1 and math.floor(vim.o.columns * agent_float.width) or agent_float.width,
    80
  ) + 2
  local picker_height = math.max(
    agent_float.height <= 1 and math.floor(vim.o.lines * agent_float.height) or agent_float.height,
    10
  ) + 2
  local winhl = "Normal:SidekickPickerTransparent"
    .. ",NormalFloat:SidekickPickerTransparent"
    .. ",NormalNC:SidekickPickerTransparent"

  picker = Snacks.picker.pick({
    source = "sidekick_cwd_peek",
    title = current_git and ("Sidekick Session in Worktree: " .. current_git.worktree_label)
      or (workspace_id and ("Sidekick Sessions in Workspace: " .. workspace_label) or "Sidekick Sessions in Cwd"),
    items = items,
    format = format_local,
    auto_close = false,
    layout = {
      reverse = false,
      preview = true,
      wins = layout_wins,
      layout = {
        box = "vertical",
        width = picker_width,
        height = picker_height,
        border = "none",
        backdrop = false,
        { win = "preview", title = " Preview ", border = "rounded" },
        { win = "input", height = 1, border = "rounded" },
        bottom_layout,
      },
    },
    preview = function(ctx)
      show_preview(ctx.item, ctx.preview)
      return true
    end,
    confirm = function(active_picker, item)
      if not item or item._empty then
        active_picker:close()
        return
      end
      activate(active_picker, item)
    end,
    on_show = function(active_picker)
      picker = active_picker
      if preview_selection then
        transition_preview()
      end
      render_workspace()
      set_active_selector(true)
      if opts.on_show then
        opts.on_show(picker)
      end
      workspace_win:on("WinEnter", function()
        if not workspace_active then
          transition_preview()
        end
        set_active_selector(true)
        preview_workspace_cursor()
        vim.schedule(focus_input)
      end, { buf = true })
      picker.input.win:on({ "TextChangedI", "TextChanged" }, render_workspace, { buf = true })
      picker.list.win:on("WinEnter", function()
        if workspace_active then
          transition_preview()
        end
        rendered_workspace_item = nil
        pending_workspace_item = nil
        set_active_selector(false)
        vim.schedule(focus_input)
      end, { buf = true })
      workspace_win:on("CursorMoved", preview_workspace_cursor, { buf = true })
      focus_input()
      if has_working then
        spinner_timer = vim.uv.new_timer()
        spinner_timer:start(
          spinner_refresh_ms,
          spinner_refresh_ms,
          vim.schedule_wrap(function()
            if picker.closed then
              stop_spinner()
            else
              picker.list:update({ force = true })
              if has_workspace_working then
                render_workspace()
              end
              refresh_preview()
            end
          end)
        )
      end
    end,
    on_close = function(active_picker)
      stop_spinner()
      invalidate_preview()
      if not reopening and opts.on_close then
        opts.on_close(active_picker)
      end
    end,
    win = {
      input = {
        wo = { winhighlight = winhl },
        keys = {
          ["<CR>"] = { confirm_active_selector, mode = { "n", "i" } },
          ["<Down>"] = { move_next, mode = { "n", "i" } },
          ["<Up>"] = { move_previous, mode = { "n", "i" } },
          ["<c-j>"] = { move_next, mode = { "n", "i" } },
          ["<c-k>"] = { move_previous, mode = { "n", "i" } },
          ["<c-n>"] = { move_next, mode = { "n", "i" } },
          ["<c-p>"] = { move_previous, mode = { "n", "i" } },
          ["<c-w>"] = { toggle_selector, mode = { "n", "i" } },
          ["<a-w>"] = { toggle_selector, mode = { "n", "i" } },
          ["<c-u>"] = { clear_input, mode = { "n", "i" } },
          ["<c-b>"] = { "sidekick_preview_scroll_up", mode = { "n", "i" } },
          ["<c-f>"] = { "sidekick_preview_scroll_down", mode = { "n", "i" } },
          ["<c-r>"] = { rename_active_item, mode = { "n", "i" } },
          ["<c-x>"] = { kill_active_item, mode = { "n", "i" } },
        },
      },
      list = {
        focusable = false,
        wo = { winhighlight = winhl },
        keys = {
          ["<c-w>"] = toggle_selector,
          ["<c-u>"] = clear_input,
          ["<c-b>"] = "sidekick_preview_scroll_up",
          ["<c-f>"] = "sidekick_preview_scroll_down",
          ["<c-r>"] = { rename_active_item, mode = { "n" } },
          ["<c-x>"] = { kill_active_item, mode = { "n" } },
        },
      },
      preview = {
        wo = { winhighlight = winhl, wrap = true, linebreak = true },
        keys = {
          ["<c-b>"] = "sidekick_preview_scroll_up",
          ["<c-f>"] = "sidekick_preview_scroll_down",
        },
      },
    },
    actions = {
      sidekick_preview_scroll_up = function()
        scroll_preview(true)
      end,
      sidekick_preview_scroll_down = function()
        scroll_preview(false)
      end,
      sidekick_rename_session = function(active_picker, item)
        rename_item(active_picker, item)
      end,
      sidekick_kill_session = function(active_picker, item)
        kill_item(active_picker, item)
      end,
    },
  })
  return picker
end

return M
