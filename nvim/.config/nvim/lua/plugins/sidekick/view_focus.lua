-- A direct Herdr attachment owns PTY sizing even when its window is hidden.
-- Release only that local client; never stop or restart the durable agent.
local M = {}
local pending = {}
local focused = true
local restoring

local function terminals()
  return require("sidekick.cli.terminal").terminals
end

local function is_herdr(term)
  return term.parent and term.parent.backend == "herdr"
end

function M.configure(term)
  if restoring and term.parent == restoring.parent then
    term.opts = vim.deepcopy(restoring.opts)
    term.send_queue = vim.deepcopy(restoring.send_queue)
  end
end

function M.release(remember)
  if not remember then
    pending = {}
  end
  -- close() removes entries from the registry, so iterate a snapshot.
  for _, term in ipairs(vim.tbl_values(terminals())) do
    if is_herdr(term) then
      if remember and term:win_valid() then
        local tab = vim.api.nvim_win_get_tabpage(term.win)
        local opts = vim.deepcopy(term.opts)
        local floating = vim.api.nvim_win_get_config(term.win).relative ~= ""
        -- The float/split toggle can change the window without changing opts.
        opts.layout = floating and "float" or (opts.layout == "float" and "right" or opts.layout)
        pending[term.parent.id] = {
          parent = term.parent,
          tab = tab,
          opts = opts,
          focus = vim.api.nvim_tabpage_get_win(tab) == term.win,
          normal_mode = term.normal_mode,
          send_queue = vim.deepcopy(term.send_queue),
        }
      end
      term:close()
    end
  end
end

function M.resume()
  if not focused then
    return
  end
  for id, view in pairs(pending) do
    if not vim.api.nvim_tabpage_is_valid(view.tab) then
      pending[id] = nil
    elseif view.tab == vim.api.nvim_get_current_tabpage() then
      pending[id] = nil
      local attached = false
      for _, term in pairs(terminals()) do
        attached = attached or (is_herdr(term) and term.parent.id == id)
      end
      -- Do not resurrect exited agents or duplicate an explicitly reopened view.
      if not attached and view.parent:is_running() then
        restoring = view
        local ok, term = pcall(require("sidekick.cli.session").attach, view.parent)
        restoring = nil
        if ok then
          if view.focus then
            term:focus()
          end
          term.normal_mode = view.normal_mode
          if view.focus and view.normal_mode then
            vim.cmd.stopinsert()
          end
        else
          vim.notify("Sidekick: could not restore Herdr view: " .. tostring(term), vim.log.levels.WARN)
        end
      end
    end
  end
end

function M.setup()
  local group = vim.api.nvim_create_augroup("plugins.sidekick.view_focus", { clear = true })
  vim.api.nvim_create_autocmd("FocusLost", {
    group = group,
    callback = function()
      focused = false
      M.release(true)
    end,
  })
  vim.api.nvim_create_autocmd("FocusGained", {
    group = group,
    callback = function()
      focused = true
      M.resume()
    end,
  })
  vim.api.nvim_create_autocmd("TabEnter", { group = group, callback = M.resume })
  vim.api.nvim_create_autocmd("WinClosed", {
    group = group,
    callback = function()
      -- Defer until hide() or a float/split conversion has finished updating windows.
      vim.schedule(function()
        for _, term in ipairs(vim.tbl_values(terminals())) do
          if is_herdr(term) and term:buf_valid() and #vim.fn.win_findbuf(term.buf) == 0 then
            pending[term.parent.id] = nil
            term:close()
          end
        end
      end)
    end,
  })
  vim.api.nvim_create_user_command("SidekickRelease", function()
    M.release(false)
  end, { desc = "Release Sidekick views so Herdr owns agent sizing (agents keep running)" })
end

return M
