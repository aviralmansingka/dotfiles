-- Notes: one keystroke from thought to vault.
--
-- Rex supplies only the chord and the floating layer. The box itself is the
-- quicknote binary, so changing the card never touches this file.

local terminal = "com.superlogical.terminal.shell"

-- The card's footprint in character cells: 56 text columns inside a border and a
-- column of padding each side, plus one blank row above and below. The last row
-- is the detail field that the first Tab reveals, so the layer is cut for the
-- taller of the two; go/quicknote's ui_test.go holds the same footprint, and
-- that test is what keeps the two in step.
local CARD_W, CARD_H = 64, 11

-- The processing list needs more room: a dozen rows of captures plus its own
-- chrome, and enough width for a thought to read without truncating.
local REVIEW_W, REVIEW_H = 80, 18

-- Rex rounds a layer's rect outwards to whole cells and edges it, which costs a
-- short layer up to two columns and one row (measured at 197x53: 66x12 asked for
-- arrives 64x11). Ask for that much extra: a spare cell falls in the card's own
-- padding and never shows, while a lost one would clip the frame.
local SLACK_W, SLACK_H = 2, 1

-- Shown only when the window cannot be measured, or is smaller than the card.
local FALLBACK = { 0.24, 0.28, 0.52, 0.34 }

-- walk visits every block placement in a layout tree.
local function walk(node, visit)
  if node == nil then return end
  if node.split then
    walk(node.split.before, visit)
    walk(node.split.after, visit)
    return
  end
  visit(node)
end

-- median is the middle sample, so one block reporting a stale size cannot move
-- the window it implies.
local function median(values)
  if #values == 0 then return nil end
  table.sort(values)
  return values[math.floor((#values + 1) / 2)]
end

-- window_cells measures the active window in character cells. Layer bounds are
-- fractions of the window, so a layer that hugs the card needs the window's real
-- size: every tiled block reports its own cells, and the view reports the share
-- of the window it was given, which is enough to recover the whole from any one
-- of them.
local function window_cells(session_id)
  local view, err = rex.call("session.view", { session_id = session_id })
  if view == nil then return nil, err end
  local win
  for _, w in ipairs(view.windows or {}) do
    if w.window_id == view.active_window_id then win = w end
  end
  if win == nil then return nil, "no active window" end
  local cols, rows = {}, {}
  for _, layer in ipairs(win.layers or {}) do
    if layer.kind == "tiled" then
      walk(layer.layout, function(node)
        if node.rect[3] <= 0 or node.rect[4] <= 0 then return end
        local size = rex.call("block.method", {
          session_id = session_id,
          block_id = node.block_id,
          method = "size",
        })
        if size == nil or size.columns <= 0 or size.rows <= 0 then return end
        table.insert(cols, size.columns / node.rect[3])
        table.insert(rows, size.rows / node.rect[4])
      end)
    end
  end
  local c, r = median(cols), median(rows)
  if c == nil or r == nil then return nil, "no block to measure" end
  return math.floor(c + 0.5), math.floor(r + 0.5)
end

-- bounds_for centers a box of the given cells in the window, so the layer ends
-- where the box does instead of leaving a field of empty space around it.
local function bounds_for(session_id, want_w, want_h)
  local cols, rows = window_cells(session_id)
  if cols == nil or cols < want_w or rows < want_h then return FALLBACK end
  local w = math.min(1, (want_w + SLACK_W) / cols)
  local h = math.min(1, (want_h + SLACK_H) / rows)
  return { (1 - w) / 2, (1 - h) / 2, w, h }
end

-- open_layer puts one command in a floating layer cut to its own size.
local function open_layer(ctx, want_w, want_h, command)
  local session_id = ctx.session_id or rex.session_id
  local layer, err = rex.session.new_layer{
    session_id = session_id,
    bounds = bounds_for(session_id, want_w, want_h),
    focus = true,
    layout = rex.layout.block{
      flavor = terminal,
      -- The program starts at the box's own size, so it is never clipped while
      -- the layer settles, and it draws no larger than the box.
      options = { command = command, size = { columns = want_w, rows = want_h } },
    },
  }
  if layer == nil then error(err, 0) end
  return { layer_id = layer.layer_id }
end

rex.action{
  name = "capture_note",
  title = "Capture Note",
  description = "Open the quicknote capture box in a floating layer.",
  category = "Notes",
  run = function(ctx, args)
    return open_layer(ctx, CARD_W, CARD_H, { "quicknote", "ui" })
  end,
}

-- processing walks the captures that are due and turns them into atomic notes.
rex.action{
  name = "process_notes",
  title = "Process Notes",
  description = "Walk the fleeting queue and promote captures into atomic notes.",
  category = "Notes",
  run = function(ctx, args)
    return open_layer(ctx, REVIEW_W, REVIEW_H, { "quicknote", "review" })
  end,
}

-- Cmd+Shift+N takes the note mnemonic and Cmd+Shift+P the processing one. Both
-- collide with nothing else here: j/k cycle layers, =/- resize.
rex.bind("cmd+shift+n", "capture_note")
rex.bind("cmd+shift+p", "process_notes")
