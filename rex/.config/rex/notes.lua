-- Notes: one keystroke from thought to vault.
--
-- Rex supplies only the chord and the floating layer. The box itself is the
-- quicknote binary, so changing the card never touches this file.

local terminal = "com.superlogical.terminal.shell"

-- The card draws about 60 columns by 10 rows and paints no background, so a
-- generous layer only puts empty space around it on a wide window.
local BOUNDS = { 0.24, 0.28, 0.52, 0.34 }

rex.action{
  name = "capture_note",
  title = "Capture Note",
  description = "Open the quicknote capture box in a floating layer.",
  category = "Notes",
  run = function(ctx, args)
    local layer, err = rex.session.new_layer{
      session_id = ctx.session_id or rex.session_id,
      bounds = BOUNDS,
      focus = true,
      layout = rex.layout.block{
        flavor = terminal,
        options = { command = { "quicknote", "ui" } },
      },
    }
    if layer == nil then error(err, 0) end
    return { layer_id = layer.layer_id }
  end,
}

-- Cmd+Shift+N takes the note mnemonic and collides with nothing else here:
-- j/k cycle layers, =/- resize.
rex.bind("cmd+shift+n", "capture_note")
