-- Rex keybindings aligned with the tmux config in this repo:
-- C-a prefix, vim-style hjkl pane navigation, | and - splits.
-- Reload after edits: rex config reload

-- Missions: read the ground and steer its seats (rex/missions.lua)
require("missions")

-- Focus panes, vim-style (tmux: bind -r h/j/k/l select-pane)
rex.bind("ctrl+a>h", "pane.focus.left")
rex.bind("ctrl+a>j", "pane.focus.down")
rex.bind("ctrl+a>k", "pane.focus.up")
rex.bind("ctrl+a>l", "pane.focus.right")

-- Tabs are tmux windows (tmux: H/L previous/next window, c new window)
rex.bind("ctrl+a>shift+h", "client.tab.previous")
rex.bind("ctrl+a>shift+l", "client.tab.next")
rex.bind("ctrl+a>n", "client.tab.next")
rex.bind("ctrl+a>p", "client.tab.previous")
rex.bind("ctrl+a>c", "client.tab.new")

-- Splits (tmux: | split-window -h, - split-window -v)
rex.bind("ctrl+a>shift+\\", "pane.split.right")
rex.bind("ctrl+a>-", "pane.split.down")

-- Pane state (tmux defaults: z zoom, x kill-pane)
rex.bind("ctrl+a>z", "pane.zoom")
rex.bind("ctrl+a>x", "pane.close")

-- Cycle floating layers (C-a N next, C-a P previous). A layer belongs to one
-- window, so this cycles the layers of the active window only. It restores a
-- minimized layer before focusing it, which is how a floating subagent, opened
-- minimized, comes back into view. Nothing is bound here when a window has no
-- floating layers; the key reports how many it found.
local function active_window(view)
  for _, window in ipairs(view.windows or {}) do
    if window.window_id == view.active_window_id then return window end
  end
  return nil
end

rex.action{
  name = "layer_cycle",
  title = "Cycle Floating Layers",
  description = "Focus the next or previous floating layer in the active window.",
  category = "Panes",
  args = { direction = "string" },
  run = function(ctx, args)
    local session_id = ctx.session_id or rex.session_id
    local view, err = rex.session.view{ session_id = session_id }
    if view == nil then error(err, 0) end
    local window = active_window(view)
    if window == nil then error("no active window", 0) end
    local layers = {}
    for _, layer in ipairs(window.layers or {}) do
      if layer.kind == "floating" then layers[#layers + 1] = layer end
    end
    if #layers == 0 then return { count = 0 } end
    -- The layer holding the focused block is the one to move away from.
    local current = nil
    for i, layer in ipairs(layers) do
      for _, block in ipairs(layer.blocks or {}) do
        if block.block_id == window.focused_block_id then current = i end
      end
    end
    local step = args.direction == "previous" and -1 or 1
    local target
    if current == nil then
      target = step > 0 and 1 or #layers
    else
      target = ((current - 1 + step) % #layers) + 1
    end
    local layer = layers[target]
    local r, e = rex.session.set_layer_state{
      session_id = session_id,
      layer_id = layer.layer_id,
      state = "normal",
      focus = true,
    }
    if r == nil then error(e, 0) end
    return { index = target, count = #layers, layer_id = layer.layer_id }
  end,
}
rex.bind("ctrl+a>shift+n", "layer_cycle", { direction = "next" })
rex.bind("ctrl+a>shift+p", "layer_cycle", { direction = "previous" })

-- Minimize or restore the floating layer that holds the focused block (C-a m).
-- A restored layer is raised and focused, so this one key both hides a floating
-- subagent and brings it back.
rex.action{
  name = "layer_minimize",
  title = "Minimize or Restore the Floating Layer",
  description = "Toggle the state of the floating layer holding the focused block.",
  category = "Panes",
  run = function(ctx, args)
    local session_id = ctx.session_id or rex.session_id
    local view, err = rex.session.view{ session_id = session_id }
    if view == nil then error(err, 0) end
    local window = active_window(view)
    if window == nil then error("no active window", 0) end
    local found
    for _, layer in ipairs(window.layers or {}) do
      if layer.kind == "floating" then
        for _, block in ipairs(layer.blocks or {}) do
          if block.block_id == window.focused_block_id then found = layer end
        end
      end
    end
    if found == nil then
      return { count = 0 }
    end
    local minimize = found.state ~= "minimized"
    local new_state = minimize and "minimized" or "normal"
    local r, e = rex.session.set_layer_state{
      session_id = session_id,
      layer_id = found.layer_id,
      state = new_state,
      focus = not minimize,
    }
    if r == nil then error(e, 0) end
    return { layer_id = found.layer_id, state = new_state }
  end,
}
rex.bind("ctrl+a>m", "layer_minimize")

-- Float the focused pane into a layer of its own (C-a f). Rex does the move;
-- the layer is normal, so the pane stays in view.
rex.bind("ctrl+a>f", "pane.float")

-- Type a literal C-a in the pane (tmux: bind C-a send-prefix)
rex.bind("ctrl+a>ctrl+a", "pane.send_key", { key = "ctrl+a" })

-- App UI (C-a b expands and minimizes the sidebar/tab viewer)
rex.bind("ctrl+a>b", "client.sidebar.toggle")

-- Activity page with its search focused (tmux has no counterpart). It lists
-- every tab and focuses the one you pick. C-a o, where o stands for overview.
-- Rex has no query for whether the page is open, so this key toggles it:
-- a press opens it with the filter focused, the next press closes it.
rex.action{
  name  = "activity_search",
  title = "Activity Search",
  run = function()
    rex.client.queue("client.sidebar.activity.toggle")
    rex.client.queue("client.sidebar.filter.focus")
  end,
}
rex.bind("ctrl+a>o", "activity_search")

-- Session picker with its search field focused (C-a s)
rex.bind("ctrl+a>s", "session.switch")

-- tmux defaults that the map above did not cover yet. Keys follow .tmux.conf
-- where it maps, and tmux's own defaults where that file is silent.

-- Move a divider (tmux: C-a C-arrow, resize-pane)
rex.bind("ctrl+a>shift+left", "pane.resize", { direction = "left" })
rex.bind("ctrl+a>shift+right", "pane.resize", { direction = "right" })
rex.bind("ctrl+a>shift+up", "pane.resize", { direction = "up" })
rex.bind("ctrl+a>shift+down", "pane.resize", { direction = "down" })

-- Step to the previous pane (tmux: ; select-pane -l)
rex.bind("ctrl+a>;", "pane.focus_previous")

-- Break the focused pane out into its own tab (tmux: ! break-pane)
rex.bind("ctrl+a>shift+1", "pane.move_to_new_tab")

-- Rename and close the tab (tmux: , rename-window, & kill-window)
rex.bind("ctrl+a>,", "client.tab.rename")
rex.bind("ctrl+a>shift+7", "client.tab.close")

-- Rename the session (tmux: $ rename-session)
rex.bind("ctrl+a>shift+4", "session.rename")

-- Jump straight to a tab by number (tmux: 0-9 select-window)
for tab = 1, 9 do
  rex.bind("ctrl+a>" .. tab, "client.tab.goto", { index = tab })
end
