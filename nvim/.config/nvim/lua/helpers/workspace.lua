local M = {}

local vars = {
  cwd = "workspace_cwd",
  label = "workspace_label",
  buffers = "workspace_buffers",
  herdr_id = "herdr_workspace_id",
  herdr_label = "herdr_workspace_label",
}

local function tab_get(tab, name)
  local ok, value = pcall(vim.api.nvim_tabpage_get_var, tab, name)
  return ok and value or nil
end

local function tab_set(tab, name, value)
  pcall(vim.api.nvim_tabpage_set_var, tab, name, value)
end

local function normalize(path)
  if not path or path == "" then
    return ""
  end
  local normalized = vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
  return normalized == "/" and normalized or normalized:gsub("/$", "")
end

local function is_tab_buffer(buf)
  return vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].buflisted and vim.bo[buf].buftype == ""
end

function M.get(tab)
  tab = tab or vim.api.nvim_get_current_tabpage()
  local cwd = tab_get(tab, vars.cwd)
  local herdr_id = tab_get(tab, vars.herdr_id)
  if type(cwd) ~= "string" or cwd == "" then
    if type(herdr_id) ~= "string" or herdr_id == "" then
      return nil
    end
    cwd = normalize(vim.fn.getcwd(-1, vim.api.nvim_tabpage_get_number(tab)))
  end
  local label = tab_get(tab, vars.label) or tab_get(tab, vars.herdr_label)
  if type(label) ~= "string" or label == "" then
    label = vim.fn.fnamemodify(cwd, ":t")
  end
  return {
    tab = tab,
    cwd = normalize(cwd),
    label = label,
    herdr_workspace_id = type(herdr_id) == "string" and herdr_id ~= "" and herdr_id or nil,
  }
end

function M.bind(tab, cwd, label)
  cwd = normalize(cwd)
  label = label or vim.fn.fnamemodify(cwd, ":t")
  tab_set(tab, vars.cwd, cwd)
  tab_set(tab, vars.label, label)
  if tab == vim.api.nvim_get_current_tabpage() then
    vim.cmd("tcd " .. vim.fn.fnameescape(cwd))
  end
  return M.get(tab)
end

function M.bind_herdr(tab, workspace_id, label)
  local workspace = M.get(tab)
  tab_set(tab, vars.herdr_id, workspace_id)
  tab_set(tab, vars.herdr_label, label or (workspace and workspace.label) or workspace_id)
  vim.cmd.redrawtabline()
end

function M.buffers(tab)
  tab = tab or vim.api.nvim_get_current_tabpage()
  local buffers = tab_get(tab, vars.buffers)
  buffers = type(buffers) == "table" and buffers or {}
  for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
    local buf = vim.api.nvim_win_get_buf(win)
    if is_tab_buffer(buf) and not vim.tbl_contains(buffers, buf) then
      buffers[#buffers + 1] = buf
    end
  end
  buffers = vim.tbl_filter(is_tab_buffer, buffers)
  tab_set(tab, vars.buffers, buffers)
  return buffers
end

function M.track(buf, tab)
  if not is_tab_buffer(buf) then
    return
  end
  tab = tab or vim.api.nvim_get_current_tabpage()
  local buffers = M.buffers(tab)
  if not vim.tbl_contains(buffers, buf) then
    buffers[#buffers + 1] = buf
    tab_set(tab, vars.buffers, buffers)
  end
end

function M.contains(buf, tab)
  return vim.tbl_contains(M.buffers(tab), buf)
end

function M.cycle(direction)
  local current = vim.api.nvim_get_current_buf()
  M.track(current)
  local buffers = M.buffers()
  if #buffers < 2 then
    return
  end
  local current_index = vim.fn.index(buffers, current)
  local index = current_index < 0 and (direction > 0 and 1 or #buffers)
    or ((current_index + direction) % #buffers) + 1
  vim.api.nvim_set_current_buf(buffers[index])
end

local function workspace_tab(cwd, label)
  local named
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    local workspace = M.get(tab)
    if workspace and workspace.cwd == cwd then
      return tab
    end
    if workspace and not named and workspace.label:lower() == label:lower() then
      named = tab
    end
  end
  return named
end

local function close_tabpage(tab)
  return pcall(vim.cmd, "tabclose " .. vim.api.nvim_tabpage_get_number(tab))
end

function M.startup(cwd)
  cwd = normalize(cwd or vim.fn.getcwd(-1, 0))
  local label = vim.fn.fnamemodify(cwd, ":t")
  if cwd == "" or label == "" then
    return false
  end

  local source = vim.api.nvim_get_current_tabpage()
  local source_buffer = vim.api.nvim_get_current_buf()
  local source_unbound = not M.get(source)
  local target = workspace_tab(cwd, label)
  if not target then
    if source_unbound then
      target = source
    else
      vim.cmd.tabnew()
      target = vim.api.nvim_get_current_tabpage()
    end
    M.bind(target, cwd, label)
  elseif target ~= source then
    vim.api.nvim_set_current_tabpage(target)
  end

  if source_unbound and source ~= target and vim.api.nvim_tabpage_is_valid(source) then
    if vim.api.nvim_buf_get_name(source_buffer) ~= "" or vim.bo[source_buffer].modified then
      vim.api.nvim_win_set_buf(vim.api.nvim_tabpage_get_win(target), source_buffer)
    end
    close_tabpage(source)
  end
  M.track(vim.api.nvim_get_current_buf(), target)
  return true
end

function M.setup()
  local group = vim.api.nvim_create_augroup("NvimWorkspaceTabs", { clear = true })
  local started = false
  local function startup()
    if started or #vim.api.nvim_list_uis() == 0 then
      return
    end
    started = true
    local cwd = vim.fn.getcwd(-1, 0)
    vim.schedule(function()
      M.startup(cwd)
    end)
  end
  vim.api.nvim_create_autocmd("VimEnter", { group = group, callback = startup })
  vim.api.nvim_create_autocmd("UIEnter", {
    group = group,
    callback = function()
      if vim.v.vim_did_enter == 1 then
        startup()
      end
    end,
  })
  vim.api.nvim_create_autocmd("BufEnter", {
    group = group,
    callback = function(args)
      M.track(args.buf)
    end,
  })
  vim.api.nvim_create_autocmd("TabEnter", {
    group = group,
    callback = function()
      local workspace = M.get()
      if workspace then
        vim.cmd("tcd " .. vim.fn.fnameescape(workspace.cwd))
      end
    end,
  })
  vim.api.nvim_create_autocmd({ "BufDelete", "BufWipeout" }, {
    group = group,
    callback = function(args)
      for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
        local buffers = vim.tbl_filter(function(buf)
          return buf ~= args.buf and is_tab_buffer(buf)
        end, M.buffers(tab))
        tab_set(tab, vars.buffers, buffers)
      end
    end,
  })
end

return M
