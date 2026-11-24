-- Review: one key opens, hides, and brings back the tuicr review of the
-- current change, in a floating layer of its own.
--
-- Rex owns the layer; tuicr owns the review session inside it. Hiding the layer
-- only minimizes it, so a human who is halfway through a review keeps the same
-- session, and a restore asks for no rect because the server keeps the bounds.
-- The layer is found again by a block label this file sets, and only inside the
-- active window of this session.
--
-- init.lua passes the block-directory reader in, so the rules for where a block
-- actually runs keep one definition.

local notes = require("notes")

if type(notes) ~= "table" or notes.bounds_for == nil then
  error("rex/review.lua needs rex/notes.lua to return its card helpers", 0)
end

local terminal = "com.superlogical.terminal.shell"

-- The block label is the only handle on the layer, so the program's mark and
-- the match below stay in step.
local LABEL = "tuicr"

-- The scope is always the working tree: the change in front of the human, with
-- no commit selector to answer first.
local COMMAND = { "tuicr", "tui", "--working-tree" }

-- active_window is the window the session shows, the same rule init.lua uses.
local function active_window(view)
  for _, window in ipairs(view.windows or {}) do
    if window.window_id == view.active_window_id then return window end
  end
  return nil
end

-- holds_review is true for a floating layer whose block carries the label.
local function holds_review(layer)
  if layer.kind ~= "floating" then return false end
  for _, block in ipairs(layer.blocks or {}) do
    if block.label == LABEL then return true end
  end
  return false
end

-- toplevel is the repository that holds dir, or nil when dir sits outside one.
local function toplevel(dir)
  if type(dir) ~= "string" or dir == "" then return nil end
  local r, err = rex.exec({ "git", "-C", dir, "rev-parse", "--show-toplevel" })
  if r == nil then
    rex.log("warn", "tuicr_float: git could not be read: " .. tostring(err))
    return nil
  end
  if (r.exit_code or 0) ~= 0 then return nil end
  local top = (r.stdout or ""):gsub("%s+$", "")
  if top == "" then return nil end
  return top
end

-- say is the one clear line for a press this key cannot serve on its own.
local function say(message) rex.log("warn", "tuicr_float: " .. message) end

return function(deps)
  local block_cwd = deps and deps.block_cwd
  if type(block_cwd) ~= "function" then
    error("rex/review.lua needs block_cwd from init.lua", 0)
  end

  rex.action{
    name = "tuicr_float",
    title = "Review the Change",
    description = "Open the tuicr review of the focused block's change, or hide and restore its layer.",
    category = "Panes",
    run = function(ctx, args)
      local session_id = ctx.session_id or rex.session_id
      local view, err = rex.session.view{ session_id = session_id }
      if view == nil then error(err, 0) end
      local window = active_window(view)
      if window == nil then error("no active window", 0) end

      -- One review per session: find it before creating anything, so a press
      -- never opens a second session over a live one.
      local mine, elsewhere
      for _, win in ipairs(view.windows or {}) do
        for _, layer in ipairs(win.layers or {}) do
          if holds_review(layer) then
            if win.window_id == window.window_id then
              mine = layer
            else
              elsewhere = win
            end
          end
        end
      end

      -- A review that lives in another window is that window's layer. Leave it
      -- alone and point at it instead.
      if mine == nil and elsewhere ~= nil then
        local label = elsewhere.label
        if label == nil or label == "" then label = "another tab" end
        say(("the review is already open in %q; switch to that tab to reach it"):format(label))
        return { layer_id = nil, window = label }
      end

      if mine ~= nil then
        if mine.state == "minimized" then
          -- Restore in place: the server keeps the rect, so no bounds here.
          local r, e = rex.session.set_layer_state{
            session_id = session_id,
            layer_id = mine.layer_id,
            state = "normal",
            focus = true,
          }
          if r == nil then error(e, 0) end
          return { layer_id = mine.layer_id, state = "normal" }
        end
        -- Minimize, never close: the review session in the layer is the
        -- human's, and it must outlive the press.
        local r, e = rex.session.set_layer_state{
          session_id = session_id,
          layer_id = mine.layer_id,
          state = "minimized",
        }
        if r == nil then error(e, 0) end
        return { layer_id = mine.layer_id, state = "minimized" }
      end

      local block_id = ctx.block_id or window.focused_block_id
      local cwd = block_cwd(session_id, block_id)
      local repo = toplevel(cwd)
      -- The review covers the repository's change, so it starts at its
      -- toplevel. Outside a repository the block's own directory is used and
      -- one line says so; the press still opens the layer.
      local at = repo or cwd
      if repo == nil then
        if at == nil then
          say("the focused block reports no directory; opening the review in Rex's default directory")
        else
          say(("%s is not in a git repository; opening the review there"):format(at))
        end
      end

      local options = {
        command = COMMAND,
        -- The program starts at the box's own size, so it is never clipped
        -- while the layer settles.
        size = { columns = notes.CARD_W, rows = notes.CARD_H },
      }
      if at ~= nil then options.cwd = at end

      local layer, lerr = rex.session.new_layer{
        session_id = session_id,
        window_id = window.window_id,
        bounds = notes.bounds_for(session_id, notes.CARD_W, notes.CARD_H),
        focus = true,
        layout = rex.layout.block{
          flavor = terminal,
          label = LABEL,
          options = options,
        },
      }
      if layer == nil then error(lerr, 0) end
      return { layer_id = layer.layer_id, state = "normal", repo = repo, cwd = at }
    end,
  }

  -- Cmd+Shift+R takes the review mnemonic and collides with nothing else here:
  -- j/k cycle layers, n/p take notes and processing, =/- resize.
  rex.bind("cmd+shift+r", "tuicr_float")
end
