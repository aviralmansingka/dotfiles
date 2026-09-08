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

local function current_view(parent)
  for _, term in pairs(terminals()) do
    if term.parent == parent and not term.closed then
      return term
    end
  end
end

local function patch_terminal_sends()
  local Terminal = require("sidekick.cli.terminal")
  if Terminal._dotfiles_view_focus_send then
    return
  end
  Terminal._dotfiles_view_focus_send = Terminal.send
  Terminal._dotfiles_view_focus_on_ready = Terminal.on_ready

  function Terminal:send(input)
    if self.closed and is_herdr(self) then
      local Session = require("sidekick.cli.session")
      if Session._attached[self.id] == self then
        Session.detach(self)
      end
      local term = current_view(self.parent)
      if term then
        term:send(input)
      elseif pending[self.parent.id] then
        table.insert(pending[self.parent.id].send_queue, input)
      end
      return
    end
    return Terminal._dotfiles_view_focus_send(self, input)
  end

  function Terminal:on_ready()
    if not is_herdr(self) then
      return Terminal._dotfiles_view_focus_on_ready(self)
    end
    self.timer:start(0, 100, function()
      local next = self.send_queue[1]
      if next and not self._dotfiles_view_focus_sending then
        self._dotfiles_view_focus_sending = true
        next = next:gsub("\r\n", "\n")
        vim.schedule(function()
          if self:is_running() then
            vim.api.nvim_buf_call(self.buf, function()
              vim.api.nvim_put(vim.split(next, "\n", { plain = true }), "c", false, true)
            end)
            table.remove(self.send_queue, 1)
            if self:is_focused() then
              vim.cmd.startinsert()
            end
          end
          self._dotfiles_view_focus_sending = false
        end)
      end
    end)
  end
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
      local attached = false
      for _, term in pairs(terminals()) do
        attached = attached or (is_herdr(term) and term.parent.id == id)
      end
      if attached then
        pending[id] = nil
      else
        local running = view.parent:is_running()
        if running == false then
          pending[id] = nil
        elseif running then
          restoring = view
          local ok, term = pcall(require("sidekick.cli.session").attach, view.parent)
          restoring = nil
          if ok and term and term:is_running() then
            pending[id] = nil
            if view.focus then
              term:focus()
            end
            term.normal_mode = view.normal_mode
            if view.focus and view.normal_mode then
              vim.cmd.stopinsert()
            end
          else
            local err = ok and "attachment did not start" or term
            vim.notify("Sidekick: could not restore Herdr view: " .. tostring(err), vim.log.levels.WARN)
          end
        end
      end
    end
  end
end

function M.setup()
  patch_terminal_sends()
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
