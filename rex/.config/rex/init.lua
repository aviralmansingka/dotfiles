-- Rex keybindings aligned with the tmux config in this repo:
-- C-a prefix, vim-style hjkl pane navigation, | and - splits.
-- Reload after edits: rex config reload

-- Missions: read the ground and steer its seats (rex/missions.lua)
require("missions")

-- Notes: the quicknote capture box in a floating layer (rex/notes.lua)
require("notes")

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
  description = "Focus the next or previous floating layer and hide the rest.",
  category = "Panes",
  args = { direction = "string" },
  -- Hold the key to walk the stack without pressing it again.
  repeats = true,
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
    local chosen = layers[target]
    -- One layer in view at a time: hide the others before raising this one, so
    -- the stack the human sees is exactly the layer they asked for.
    for i, layer in ipairs(layers) do
      if i ~= target and layer.state ~= "minimized" then
        rex.session.set_layer_state{
          session_id = session_id,
          layer_id = layer.layer_id,
          state = "minimized",
        }
      end
    end
    local r, e = rex.session.set_layer_state{
      session_id = session_id,
      layer_id = chosen.layer_id,
      state = "normal",
      focus = true,
    }
    if r == nil then error(e, 0) end
    return { index = target, count = #layers, layer_id = chosen.layer_id }
  end,
}
-- Cycle floating layers and hide the rest. Cmd+Shift+j/k follows the hjkl
-- vocabulary the pane moves already use (j next, k previous); h/l stay free
-- because left/right mean focus direction here, not cycling. These are direct
-- chords, so holding one repeats. Tabs keep Cmd+Shift+[ ].
rex.bind("cmd+shift+j", "layer_cycle", { direction = "next" })
rex.bind("cmd+shift+k", "layer_cycle", { direction = "previous" })

-- Grow or shrink the focused block (Cmd+Shift++ / Cmd+Shift+-). A tiled block
-- moves the border it shares with its sibling, and never closes it: the
-- sibling keeps at least 10 percent. A floating layer keeps its center and
-- scales its rect by 10 percent per press, capped at 95 percent of the window.
local RESIZE_STEP = 0.10
local RESIZE_MIN = 0.10
local RESIZE_MAX = 0.95

-- The split node that owns the focused block, with its two sides.
local function split_around(view, block_id)
  local function search(node)
    if node.split ~= nil then
      local sp = node.split
      local before, after = sp.before, sp.after
      local function holds(side)
        return side.block_id ~= nil and side.block_id == block_id
      end
      if holds(before) or holds(after) then
        return { direction = sp.direction, before = before, after = after }
      end
      local hit = search(sp.before)
      if hit == nil then hit = search(sp.after) end
      return hit
    end
    return nil
  end
  for _, layer in ipairs(view.windows and view.windows[1].layers or {}) do
    local hit = search(layer.layout)
    if hit ~= nil then return hit end
  end
  return nil
end

-- The floating layer that holds the focused block, if any.
local function floating_layer_around(view, block_id)
  local window = active_window(view)
  if window == nil then return nil end
  for _, layer in ipairs(window.layers or {}) do
    if layer.kind == "floating" then
      for _, block in ipairs(layer.blocks or {}) do
        if block.block_id == block_id then return layer end
      end
    end
  end
  return nil
end

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end

rex.action{
  name = "block_resize",
  title = "Resize the Focused Block",
  description = "Grow or shrink the focused block by 10 percent.",
  category = "Layouts",
  args = { direction = "string" },
  repeats = true,
  run = function(ctx, args)
    local grow = args.direction == "grow"
    local session_id = ctx.session_id or rex.session_id
    local view, err = rex.session.view{ session_id = session_id }
    if view == nil then error(err, 0) end
    local block_id = ctx.block_id or view.windows and view.windows[1].focused_block_id
    if block_id == nil then error("no focused block", 0) end

    local layer = floating_layer_around(view, block_id)
    if layer ~= nil then
      local x, y, w, h = unpack(layer.bounds)
      local scale = grow and (1 + RESIZE_STEP) or (1 - RESIZE_STEP)
      w = clamp(w * scale, RESIZE_MIN, RESIZE_MAX)
      h = clamp(h * scale, RESIZE_MIN, RESIZE_MAX)
      local cx, cy = x + w / 2, y + h / 2
      x = clamp(cx - w / 2, 0, 1 - w)
      y = clamp(cy - h / 2, 0, 1 - h)
      local r, e = rex.call("session.resize_layer", {
        session_id = session_id,
        layer_id = layer.layer_id,
        bounds = { x, y, w, h },
      })
      if r == nil then error(e, 0) end
      return { mode = "layer", w = w, h = h }
    end

    local hit = split_around(view, block_id)
    if hit == nil then
      return { mode = "none" }
    end
    local direction, before, after = hit.direction, hit.before, hit.after
    local sp = nil
    -- Re-read the split through its own node to get the current ratio.
    local function find_split(node)
      if node.split ~= nil then
        local s = node.split
        if (s.before.block_id ~= nil and s.before.block_id == block_id) or
           (s.after.block_id ~= nil and s.after.block_id == block_id) then
          return s
        end
        local f = find_split(s.before)
        if f == nil then f = find_split(s.after) end
        return f
      end
      return nil
    end
    for _, ly in ipairs(view.windows and view.windows[1].layers or {}) do
      sp = find_split(ly.layout)
      if sp ~= nil then break end
    end
    if sp == nil then return { mode = "none" } end

    -- ratio is the before side's share. Moving the border toward the sibling
    -- grows the focused block, whichever side it is on.
    local focused_is_before = sp.before.block_id == block_id
    local share = focused_is_before and sp.ratio or (1 - sp.ratio)
    share = share + (grow and RESIZE_STEP or -RESIZE_STEP)
    share = clamp(share, RESIZE_MIN, 1 - RESIZE_MIN)
    local ratio = focused_is_before and share or (1 - share)
    local r, e = rex.call("session.resize_pane", {
      session_id = session_id,
      direction = direction,
      before_block_id = before.block_id,
      after_block_id = after.block_id,
      ratio = ratio,
    })
    if r == nil then error(e, 0) end
    return { mode = "pane", ratio = ratio }
  end,
}
rex.bind("cmd+shift+=", "block_resize", { direction = "grow" })
rex.bind("cmd+shift+-", "block_resize", { direction = "shrink" })

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

-- Minimize every floating layer in the active window (C-a M). Restore any one
-- with C-a N / C-a P; a layer that is already minimized is left alone, so the
-- result reports how many it actually changed.
rex.action{
  name = "layer_minimize_all",
  title = "Minimize All Floating Layers",
  description = "Minimize every floating layer in the active window.",
  category = "Panes",
  run = function(ctx, args)
    local session_id = ctx.session_id or rex.session_id
    local view, err = rex.session.view{ session_id = session_id }
    if view == nil then error(err, 0) end
    local window = active_window(view)
    if window == nil then error("no active window", 0) end
    local minimized = 0
    local failed = 0
    for _, layer in ipairs(window.layers or {}) do
      if layer.kind == "floating" and layer.state ~= "minimized" then
        local r, e = rex.session.set_layer_state{
          session_id = session_id,
          layer_id = layer.layer_id,
          state = "minimized",
        }
        if r == nil then failed = failed + 1 else minimized = minimized + 1 end
      end
    end
    return { minimized = minimized, failed = failed }
  end,
}
rex.bind("ctrl+a>shift+m", "layer_minimize_all")

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
-- Cmd+O runs the same search without the prefix.
rex.bind("cmd+o", "activity_search")

-- Session picker with its search field focused (C-a s, Cmd+S)
rex.bind("ctrl+a>s", "session.switch")
rex.bind("cmd+s", "session.switch")

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
