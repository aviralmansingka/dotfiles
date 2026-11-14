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

-- card_bounds centers the card in the window, so the layer ends where the card
-- does instead of leaving a field of empty space around it.
local function card_bounds(session_id)
  local cols, rows = window_cells(session_id)
  if cols == nil or cols < CARD_W or rows < CARD_H then return FALLBACK end
  local w = math.min(1, (CARD_W + SLACK_W) / cols)
  local h = math.min(1, (CARD_H + SLACK_H) / rows)
  return { (1 - w) / 2, (1 - h) / 2, w, h }
end

rex.action{
  name = "capture_note",
  title = "Capture Note",
  description = "Open the quicknote capture box in a floating layer.",
  category = "Notes",
  run = function(ctx, args)
    local session_id = ctx.session_id or rex.session_id
    local layer, err = rex.session.new_layer{
      session_id = session_id,
      bounds = card_bounds(session_id),
      focus = true,
      layout = rex.layout.block{
        flavor = terminal,
        -- The box starts at the card's own size, so it is never clipped while
        -- the layer settles, and it draws no larger than the card.
        options = { command = { "quicknote", "ui" }, size = { columns = CARD_W, rows = CARD_H } },
      },
    }
    if layer == nil then error(err, 0) end
    return { layer_id = layer.layer_id }
  end,
}

-- Cmd+Shift+N takes the note mnemonic and collides with nothing else here:
-- j/k cycle layers, =/- resize.
rex.bind("cmd+shift+n", "capture_note")
