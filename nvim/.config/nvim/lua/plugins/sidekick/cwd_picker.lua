-- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
-- Cwd-scoped peek picker for sidekick named sessions.
-- Bound to <c-.> in plugins/sidekick.lua.
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")
local branding = require("plugins.sidekick.branding")
local herdr = require("plugins.sidekick.herdr")

local M = {}
local collapsed = {}
local static_spinner = "⠋"
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

---@return snacks.picker.finder.Item[]
function M.list_items()
  local workspace_id = workspace_scope()
  local root = normalize(vim.fn.getcwd())
  local root_repo = not workspace_id and git_common_dir(root) or nil
  local repo_cache = {}
  local items = {}

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
      items[#items + 1] = {
        text = string.format("%s  [%s]", label, entry.status),
        label = label,
        tool = entry.tool,
        slug = entry.slug,
        pane_id = entry.pane_id,
        workspace_id = entry.workspace_id,
        terminal_id = entry.terminal_id,
        agent_name = entry.agent_name,
        status = entry.status,
        cwd = entry.cwd,
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

local function workspace_spinner(running)
  return running > 0 and Snacks.util.spinner() or static_spinner
end

local function workspace_groups(hidden_workspace_id)
  local grouped = {}
  for _, agent in ipairs(herdr.list_agents()) do
    local parsed = registry.parse_session_name(agent.name)
    local tool = parsed and parsed.tool or agent.agent
    if tool and internal.tool_commands[tool] then
      local workspace_id = agent.workspace_id or "unknown"
      local group = grouped[workspace_id]
      if not group then
        group = {
          item = { _workspace = true, workspace_id = workspace_id },
          running = 0,
          done = 0,
          agents = {},
        }
        grouped[workspace_id] = group
      end
      local status = agent.agent_status or "unknown"
      group.running = group.running + (status == "working" and 1 or 0)
      group.done = group.done + (status == "done" and 1 or 0)
      group.agents[#group.agents + 1] = {
        label = parsed and parsed.label
          or (agent.name and not agent.name:match("^sk%-") and agent.name)
          or tool,
        toggle_name = parsed and parsed.label or tool,
        tool = tool,
        workspace_id = workspace_id,
        terminal_id = agent.terminal_id,
        agent_name = agent.name,
        status = status,
      }
    end
  end

  local groups, seen = {}, {}
  local function add_workspace(workspace_id, label)
    seen[workspace_id] = true
    local group = grouped[workspace_id]
    if not group then
      return
    end
    group.total = #group.agents
    group.item.workspace_label = label
    if collapsed[workspace_id] == nil then
      collapsed[workspace_id] = true
    end
    group.item._collapsed = collapsed[workspace_id]
    table.sort(group.agents, compare_items)
    if workspace_id ~= hidden_workspace_id then
      groups[#groups + 1] = group
    end
  end

  for _, workspace in ipairs(workspace_list()) do
    if workspace.workspace_id then
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
  return groups
end

local function format_local(item)
  if item._empty then
    return { { item.text or "", "Comment" } }
  end
  local symbol, symbol_hl = status_icon(item.status)
  return {
    { symbol .. " ", symbol_hl },
    { item.label or "", branding.hl_groups(branding.tool_of(item.tool)).title },
  }
end

local function workspace_chunks(group)
  local item = group.item
  return {
    { item._collapsed and "▸ " or "▾ ", "SnacksPickerTree" },
    { "● ", group.done > 0 and "DiagnosticWarn" or "Comment" },
    { tostring(group.done), "Comment" },
    { "  " .. workspace_spinner(group.running) .. " ", group.running > 0 and "DiagnosticInfo" or "Comment" },
    { tostring(group.running), "Comment" },
    { "  ·  ", "Comment" },
    { item.workspace_label or item.workspace_id or "unknown", "Directory" },
    { "  Σ ", "Title" },
    { tostring(group.total), "Comment" },
  }
end

local function workspace_agent_chunks(item, last)
  local symbol, symbol_hl = status_icon(item.status)
  return {
    { last and "  └─ " or "  ├─ ", "SnacksPickerTree" },
    { symbol .. " ", symbol_hl },
    { item.label or item.agent_name or "unknown", branding.hl_groups(branding.tool_of(item.tool)).title },
  }
end

local function preview_selected(buf, item)
  if not item or item._empty then
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "(no session)" })
    return
  end
  if item._workspace then
    return
  end
  local output, err = preview_text(item)
  if output then
    vim.api.nvim_chan_send(vim.api.nvim_open_term(buf, {}), output)
  else
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { err })
  end
end

local function preview_item(ctx)
  preview_selected(ctx.preview:scratch(), ctx.item)
  return true
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

  local workspace_id, workspace_label = workspace_scope()
  local items = M.list_items()
  local local_workspace_id = workspace_id
  if not local_workspace_id then
    for _, item in ipairs(items) do
      if item.workspace_id then
        local_workspace_id = item.workspace_id
        break
      end
    end
  end
  local groups = workspace_groups(local_workspace_id)
  if #items == 0 then
    items = { {
      text = workspace_id and "(no named sessions in workspace)" or "(no named sessions in cwd)",
      _empty = true,
    } }
  end

  local workspace_rows = {}
  local picker
  local spinner_timer
  local workspace_win
  local rendered_workspace_item
  local pending_workspace_item
  local reopening = false
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

  local function set_active_selector(workspace_active)
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

  local function render_workspace()
    if not workspace_win or not workspace_win:valid() then
      return
    end
    local lines, highlights = {}, {}
    workspace_rows = {}
    for _, group in ipairs(groups) do
      local chunks = workspace_chunks(group)
      workspace_rows[#workspace_rows + 1] = group.item
      lines[#lines + 1] = ""
      local col = 0
      for _, chunk in ipairs(chunks) do
        lines[#lines] = lines[#lines] .. chunk[1]
        highlights[#highlights + 1] = { #lines - 1, col, col + #chunk[1], chunk[2] }
        col = col + #chunk[1]
      end
      if not group.item._collapsed then
        for index, agent in ipairs(group.agents) do
          chunks = workspace_agent_chunks(agent, index == #group.agents)
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
    if #lines == 0 then
      lines = { "(no other workspaces with agents)" }
      highlights = { { 0, 0, -1, "Comment" } }
    end

    local cursor = vim.api.nvim_win_get_cursor(workspace_win.win)
    vim.bo[workspace_win.buf].modifiable = true
    vim.api.nvim_buf_set_lines(workspace_win.buf, 0, -1, false, lines)
    vim.bo[workspace_win.buf].modifiable = false
    vim.api.nvim_buf_clear_namespace(workspace_win.buf, workspace_ns, 0, -1)
    for _, hl in ipairs(highlights) do
      vim.api.nvim_buf_add_highlight(workspace_win.buf, workspace_ns, hl[4], hl[1], hl[2], hl[3])
    end
    vim.api.nvim_win_set_cursor(workspace_win.win, { math.min(cursor[1], #lines), 0 })
  end

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
      preview_selected(picker.preview:scratch(), item)
    end
  end, { ms = 400 })

  local function preview_workspace_cursor()
    if not picker or picker.closed or not workspace_win:valid() then
      return
    end
    local item = workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
    if not item or item._workspace then
      pending_workspace_item = nil
      return
    end
    if item == rendered_workspace_item then
      pending_workspace_item = nil
    elseif item and item ~= pending_workspace_item then
      pending_workspace_item = item
      render_workspace_preview()
    end
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
    require("plugins.sidekick.last_session").record(target, item.terminal_id)
    internal.toggle_tool_session(target, true, item.terminal_id)
  end

  local function workspace_enter()
    local item = workspace_rows[vim.api.nvim_win_get_cursor(workspace_win.win)[1]]
    if not item then
      return
    end
    if item._workspace then
      collapsed[item.workspace_id] = not collapsed[item.workspace_id]
      item._collapsed = collapsed[item.workspace_id]
      render_workspace()
      vim.schedule(function()
        if workspace_win:valid() then
          workspace_win:focus()
        end
      end)
    else
      activate(picker, item)
    end
  end

  local function focus_input()
    picker:focus("input")
    vim.cmd.startinsert()
  end

  local function clear_input()
    picker.input:set("")
    focus_input()
  end

  workspace_win = Snacks.win({
    show = false,
    bo = { buftype = "nofile", bufhidden = "wipe", modifiable = false },
    wo = {
      cursorline = true,
      winhighlight = "Normal:SidekickPickerTransparent,NormalNC:SidekickPickerTransparent",
    },
    keys = {
      ["<cr>"] = workspace_enter,
      ["<c-w>"] = focus_input,
      ["<c-u>"] = clear_input,
      ["<esc>"] = focus_input,
    },
  })

  local agent_float = require("sidekick.config").cli.win.float
  -- Sidekick sizes the float's content first; its rounded border then adds one
  -- cell on every side. The borderless picker root must include those cells.
  local picker_width =
    math.max(agent_float.width <= 1 and math.floor(vim.o.columns * agent_float.width) or agent_float.width, 80) + 2
  local picker_height =
    math.max(agent_float.height <= 1 and math.floor(vim.o.lines * agent_float.height) or agent_float.height, 10) + 2
  local winhl = "Normal:SidekickPickerTransparent"
    .. ",NormalFloat:SidekickPickerTransparent"
    .. ",NormalNC:SidekickPickerTransparent"

  picker = Snacks.picker.pick({
    source = "sidekick_cwd_peek",
    title = workspace_id and ("Sidekick Sessions in Workspace: " .. workspace_label) or "Sidekick Sessions in Cwd",
    items = items,
    format = format_local,
    auto_close = false,
    layout = {
      reverse = false,
      preview = true,
      wins = { workspace = workspace_win },
      layout = {
        box = "vertical",
        width = picker_width,
        height = picker_height,
        border = "none",
        backdrop = false,
        { win = "preview", title = " Preview ", border = "rounded" },
        { win = "input", height = 1, border = "rounded" },
        {
          box = "horizontal",
          height = 14,
          {
            width = 0.5,
            win = "list",
            height = 12,
            title = " Local sessions ",
            footer = " <C-w> Workspaces ",
            footer_pos = "center",
            border = "rounded",
          },
          {
            win = "workspace",
            height = 12,
            title = " Workspaces ",
            footer = " <C-w> Agents · <Enter> Expand/Open ",
            footer_pos = "center",
            border = "rounded",
          },
        },
      },
    },
    preview = preview_item,
    confirm = function(active_picker, item)
      if not item or item._empty then
        active_picker:close()
        return
      end
      activate(active_picker, item)
    end,
    on_show = function(active_picker)
      picker = active_picker
      render_workspace()
      set_active_selector(false)
      if opts.on_show then
        opts.on_show(picker)
      end
      workspace_win:on("WinEnter", function()
        set_active_selector(true)
        preview_workspace_cursor()
      end, { buf = true })
      picker.input.win:on("WinEnter", function()
        rendered_workspace_item = nil
        pending_workspace_item = nil
        set_active_selector(false)
      end, { buf = true })
      picker.list.win:on("WinEnter", function()
        rendered_workspace_item = nil
        pending_workspace_item = nil
        set_active_selector(false)
      end, { buf = true })
      workspace_win:on("CursorMoved", preview_workspace_cursor, { buf = true })
      if has_working then
        spinner_timer = vim.uv.new_timer()
        spinner_timer:start(80, 80, vim.schedule_wrap(function()
          if picker.closed then
            stop_spinner()
          else
            picker.list:update({ force = true })
            if has_workspace_working then
              render_workspace()
            end
          end
        end))
      end
    end,
    on_close = function(active_picker)
      stop_spinner()
      if not reopening and opts.on_close then
        opts.on_close(active_picker)
      end
    end,
    win = {
      input = {
        wo = { winhighlight = winhl },
        keys = {
          ["<c-w>"] = {
            function()
              workspace_win:focus()
            end,
            mode = { "n", "i" },
          },
          ["<c-u>"] = { clear_input, mode = { "n", "i" } },
          ["<c-r>"] = { "sidekick_rename_session", mode = { "n", "i" } },
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n", "i" } },
        },
      },
      list = {
        wo = { winhighlight = winhl },
        keys = {
          ["<c-w>"] = function()
            workspace_win:focus()
          end,
          ["<c-u>"] = clear_input,
          ["<c-r>"] = { "sidekick_rename_session", mode = { "n" } },
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n" } },
        },
      },
      preview = {
        wo = { winhighlight = winhl, wrap = true, linebreak = true },
      },
    },
    actions = {
      sidekick_rename_session = function(active_picker, item)
        if not item or item._empty or not item.agent_name or not item.tool then
          return
        end
        vim.ui.input({ prompt = item.tool .. " session label: ", default = item.slug }, function(input)
          local slug = internal.normalize_label(input)
          local name = item.tool .. "-" .. slug
          if slug == "" or name == item.agent_name then
            return
          end
          local result, err = herdr.call({ "agent", "rename", item.terminal_id or item.agent_name, name }, true)
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
      end,
      sidekick_kill_session = function(active_picker, item)
        if not item or item._empty or not item.pane_id then
          return
        end
        if herdr.close(item.pane_id) then
          if opts.on_kill then
            opts.on_kill(item)
          end
          reopening = true
          active_picker:close()
          vim.schedule(function()
            M.open(opts)
          end)
        end
      end,
    },
  })
  return picker
end

return M
