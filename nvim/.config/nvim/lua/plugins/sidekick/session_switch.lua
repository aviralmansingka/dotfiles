local internal = require("plugins.sidekick.internal")
local cwd_picker = require("plugins.sidekick.cwd_picker")

local M = {}
local active

function M.open()
  if active then
    active.picker:close()
    return
  end

  local state = {
    restore = internal.hide_tool_sessions(),
    selected = false,
  }
  active = state

  local picker = cwd_picker.open({
    on_show = function(picker)
      if active == state then
        state.picker = picker
      end
    end,
    on_confirm = function()
      state.selected = true
    end,
    on_kill = function(item)
      if item.label == state.restore then
        state.restore = nil
      end
    end,
    on_close = function()
      if active ~= state then
        return
      end
      active = nil
      if not state.selected and state.restore then
        internal.toggle_tool_session(state.restore, true)
      end
    end,
  })
  state.picker = picker
  if not picker and active == state then
    active = nil
    if state.restore then
      internal.toggle_tool_session(state.restore, true)
    end
  end
end

return M
