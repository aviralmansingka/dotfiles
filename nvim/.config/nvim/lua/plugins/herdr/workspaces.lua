local herdr = require("plugins.sidekick.herdr")

local M = {}

local vars = {
  id = "herdr_workspace_id",
  label = "herdr_workspace_label",
  detached = "herdr_workspace_detached",
  warned = "herdr_workspace_warned",
}

local status_hl = {
  blocked = "DiagnosticError",
  working = "DiagnosticWarn",
  done = "DiagnosticOk",
}

local function notify(message, level)
  vim.notify("Herdr workspaces: " .. message, level or vim.log.levels.ERROR)
end

local function command_error(command, err)
  notify(command .. " failed" .. (err and err ~= "" and (": " .. err) or ""))
end

local function tab_get(tab, name)
  local ok, value = pcall(vim.api.nvim_tabpage_get_var, tab, name)
  return ok and value or nil
end

local function tab_set(tab, name, value)
  pcall(vim.api.nvim_tabpage_set_var, tab, name, value)
end

local function tab_del(tab, name)
  pcall(vim.api.nvim_tabpage_del_var, tab, name)
end

local function workspace_tab(workspace_id)
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    if tab_get(tab, vars.id) == workspace_id then
      return tab
    end
  end
end

local function set_label(workspace_id, label)
  local tab = workspace_tab(workspace_id)
  if tab then
    tab_set(tab, vars.label, label)
    vim.cmd.redrawtabline()
  end
end

local function is_missing_error(err)
  local message = (err or ""):lower()
  return message:find("not found", 1, true)
    or message:find("unknown workspace", 1, true)
    or message:find("does not exist", 1, true)
end

local function focus_tab(tab)
  local workspace_id = tab_get(tab, vars.id)
  if not workspace_id then
    return
  end

  local result, err = herdr.call({ "workspace", "focus", workspace_id }, true)
  if result then
    tab_set(tab, vars.detached, false)
    tab_set(tab, vars.warned, false)
    return
  end

  if is_missing_error(err) then
    tab_set(tab, vars.detached, true)
  end
  if not tab_get(tab, vars.warned) then
    local label = tab_get(tab, vars.label) or workspace_id
    notify(string.format('could not focus "%s"%s', label, err and err ~= "" and (": " .. err) or ""), vim.log.levels.WARN)
    tab_set(tab, vars.warned, true)
  end
end

local function reconcile(workspaces)
  local live = {}
  for _, workspace in ipairs(workspaces) do
    live[workspace.workspace_id] = workspace
  end

  local redraw = false
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    local workspace_id = tab_get(tab, vars.id)
    if workspace_id then
      local workspace = live[workspace_id]
      if workspace then
        if tab_get(tab, vars.label) ~= workspace.label then
          tab_set(tab, vars.label, workspace.label)
          redraw = true
        end
        tab_set(tab, vars.detached, false)
        tab_set(tab, vars.warned, false)
      else
        tab_set(tab, vars.detached, true)
      end
    end
  end
  if redraw then
    vim.cmd.redrawtabline()
  end
end

local function snapshot()
  local workspace_result, workspace_err = herdr.call({ "workspace", "list" }, true)
  if not workspace_result or type(workspace_result.workspaces) ~= "table" then
    command_error("workspace list", workspace_err or "invalid response")
    return
  end

  local pane_result, pane_err = herdr.call({ "pane", "list" }, true)
  if not pane_result or type(pane_result.panes) ~= "table" then
    command_error("pane list", pane_err or "invalid response")
    return
  end

  local first_pane_cwd = {}
  local seen_workspace = {}
  for _, pane in ipairs(pane_result.panes) do
    if pane.workspace_id and not seen_workspace[pane.workspace_id] then
      seen_workspace[pane.workspace_id] = true
      if type(pane.cwd) == "string" and pane.cwd ~= "" then
        first_pane_cwd[pane.workspace_id] = herdr.normalize_cwd(pane.cwd)
      end
    end
  end

  local workspaces = {}
  for index, workspace in ipairs(workspace_result.workspaces) do
    if type(workspace.workspace_id) == "string" and type(workspace.label) == "string" then
      workspace.cwd = first_pane_cwd[workspace.workspace_id]
      workspace._order = index
      workspaces[#workspaces + 1] = workspace
    end
  end
  table.sort(workspaces, function(a, b)
    local a_number = tonumber(a.number) or math.huge
    local b_number = tonumber(b.number) or math.huge
    return a_number == b_number and a._order < b._order or a_number < b_number
  end)
  reconcile(workspaces)
  return workspaces
end

local function empty_initial_tab()
  local tabs = vim.api.nvim_list_tabpages()
  if #tabs ~= 1 then
    return false
  end
  local tab = tabs[1]
  if tab_get(tab, vars.id) or #vim.api.nvim_tabpage_list_wins(tab) ~= 1 then
    return false
  end
  local buffer = vim.api.nvim_win_get_buf(vim.api.nvim_tabpage_get_win(tab))
  return vim.api.nvim_buf_get_name(buffer) == ""
    and not vim.bo[buffer].modified
    and vim.bo[buffer].buftype == ""
    and vim.api.nvim_buf_line_count(buffer) == 1
    and vim.api.nvim_buf_get_lines(buffer, 0, 1, false)[1] == ""
end

local function bind_tab(workspace)
  local tab = workspace_tab(workspace.workspace_id)
  local is_new = not tab
  if not tab then
    if empty_initial_tab() then
      tab = vim.api.nvim_get_current_tabpage()
    else
      vim.cmd.tabnew()
      tab = vim.api.nvim_get_current_tabpage()
    end
    tab_set(tab, vars.id, workspace.workspace_id)
    tab_set(tab, vars.label, workspace.label)
    tab_set(tab, vars.detached, false)
    tab_set(tab, vars.warned, false)
    if workspace.cwd then
      vim.cmd("tcd " .. vim.fn.fnameescape(workspace.cwd))
    else
      notify(string.format('"%s" has no pane cwd; keeping the current tab cwd', workspace.label), vim.log.levels.WARN)
    end
    vim.cmd.redrawtabline()
  end

  local current = vim.api.nvim_get_current_tabpage()
  if current == tab then
    focus_tab(tab)
  else
    vim.api.nvim_set_current_tabpage(tab)
  end
  return tab, is_new
end

local function unbind(tab)
  for _, name in pairs(vars) do
    tab_del(tab, name)
  end
  vim.cmd.redrawtabline()
end

local function close_tab(workspace_id)
  local tab = workspace_tab(workspace_id)
  if not tab then
    return
  end
  if #vim.api.nvim_list_tabpages() == 1 then
    unbind(tab)
    return
  end
  local ok, err = pcall(vim.api.nvim_tabpage_close, tab, false)
  if not ok then
    notify("workspace closed, but its Neovim tab stayed open: " .. tostring(err), vim.log.levels.WARN)
  end
end

local function find_workspace(workspaces, workspace_id)
  for _, workspace in ipairs(workspaces) do
    if workspace.workspace_id == workspace_id then
      return workspace
    end
  end
end

local function reopen(picker, preferred_id)
  picker:close()
  vim.schedule(function()
    M.open(preferred_id)
  end)
end

local function create_workspace(picker)
  local cwd = vim.fn.getcwd(-1, 0)
  vim.ui.input({ prompt = "Workspace label: " }, function(input)
    local label = input and vim.trim(input) or ""
    if label == "" then
      return
    end
    local result, err =
      herdr.call({ "workspace", "create", "--cwd", cwd, "--label", label, "--no-focus" }, true)
    local workspace_id = result and result.workspace and result.workspace.workspace_id
    if not workspace_id then
      command_error("workspace create", err or "invalid response")
      return
    end

    local workspaces = snapshot()
    local workspace = workspaces and find_workspace(workspaces, workspace_id)
    if not workspace then
      picker:close()
      if workspaces then
        notify("created workspace was missing from the fresh workspace list")
      end
      return
    end
    picker:close()
    bind_tab(workspace)
  end)
end

local function rename_workspace(picker, item)
  if not item then
    return
  end
  vim.ui.input({ prompt = "Workspace label: ", default = item.label }, function(input)
    local label = input and vim.trim(input) or ""
    if label == "" or label == item.label then
      return
    end
    local result, err = herdr.call({ "workspace", "rename", item.workspace_id, label }, true)
    if not result then
      command_error("workspace rename", err)
      return
    end
    local authoritative_label = result.workspace and result.workspace.label or label
    set_label(item.workspace_id, authoritative_label)
    reopen(picker, item.workspace_id)
  end)
end

local function close_workspace(picker, item)
  if not item then
    return
  end
  local choice = vim.fn.confirm(
    string.format('Close workspace "%s"?\nHerdr panes/processes will exit.', item.label),
    "&Close\n&Cancel",
    2
  )
  if choice ~= 1 then
    return
  end
  local result, err = herdr.call({ "workspace", "close", item.workspace_id }, true)
  if not result then
    command_error("workspace close", err)
    return
  end
  picker:close()
  close_tab(item.workspace_id)
  vim.schedule(M.open)
end

local function picker_items(workspaces)
  local home = herdr.normalize_cwd(vim.fn.expand("~"))
  local items = {}
  for _, workspace in ipairs(workspaces) do
    local cwd_display = workspace.cwd or ""
    if cwd_display == home or cwd_display:sub(1, #home + 1) == home .. "/" then
      cwd_display = "~" .. cwd_display:sub(#home + 1)
    end
    items[#items + 1] = {
      text = workspace.label .. " " .. cwd_display,
      label = workspace.label,
      workspace_id = workspace.workspace_id,
      status = workspace.agent_status or "unknown",
      cwd = workspace.cwd,
      cwd_display = cwd_display,
      focused = workspace.focused == true,
    }
  end
  return items
end

local function format_item(item)
  local active = status_hl[item.status]
  local marker = active and "●" or "·"
  return {
    { marker .. " ", active or "Comment" },
    { item.label },
    { "  " },
    { item.cwd_display, "Comment" },
  }
end

function M.open(preferred_id)
  local workspaces = snapshot()
  if not workspaces then
    return
  end
  local items = picker_items(workspaces)
  local initial = 1
  for index, item in ipairs(items) do
    if item.workspace_id == preferred_id or (not preferred_id and item.focused) then
      initial = index
      break
    end
  end

  Snacks.picker.pick({
    source = "herdr_workspaces",
    title = "spaces",
    items = items,
    format = format_item,
    sort = false,
    preview = false,
    layout = {
      preset = "select",
      layout = {
        height = math.min(math.max(#items + 1, 3), 12),
        min_width = 60,
        max_width = 100,
      },
    },
    on_show = function(picker)
      if #items > 0 then
        vim.schedule(function()
          if not picker.closed then
            picker.list:view(initial)
          end
        end)
      end
    end,
    confirm = function(picker, item)
      picker:close()
      if item then
        bind_tab(item)
      end
    end,
    win = {
      input = {
        keys = {
          ["<c-n>"] = { "herdr_workspace_create", mode = { "n", "i" } },
          ["<c-r>"] = { "herdr_workspace_rename", mode = { "n", "i" } },
          ["<c-x>"] = { "herdr_workspace_close", mode = { "n", "i" } },
        },
      },
      list = {
        keys = {
          ["<c-n>"] = { "herdr_workspace_create", mode = { "n" } },
          ["<c-r>"] = { "herdr_workspace_rename", mode = { "n" } },
          ["<c-x>"] = { "herdr_workspace_close", mode = { "n" } },
        },
      },
    },
    actions = {
      herdr_workspace_create = create_workspace,
      herdr_workspace_rename = rename_workspace,
      herdr_workspace_close = close_workspace,
    },
  })
end

function M.setup()
  local group = vim.api.nvim_create_augroup("HerdrWorkspaceTabs", { clear = true })
  vim.api.nvim_create_autocmd("TabEnter", {
    group = group,
    callback = function()
      focus_tab(vim.api.nvim_get_current_tabpage())
    end,
  })
end

return M
