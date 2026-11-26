# rex review layer

Offline checks for the tuicr floating layer and its chord. Entry:
`scripts/test-rex-review.sh` (`# Paths: rex/.config/rex/** …`), so the suite
joins `scripts-tests` only when the Rex config or this suite changes.

## What it covers

- The chord: `rex.bind("cmd+shift+r", "tuicr_float")` appears exactly once in
  `rex/.config/rex/review.lua`, and no other file under `rex/.config/rex/`
  mentions `cmd+shift+r`, so the key stays free.
- The action name is `tuicr_float`, and its command is
  `{ "tuicr", "tui", "--working-tree" }`.
- Opening: the layer is created in the active window (`window_id`), with
  `focus = true`, a block label of `tuicr`, and a rect from
  `notes.bounds_for(session_id, notes.CARD_W, notes.CARD_H)`.
- Hiding keeps the review alive: the file sets `state = "minimized"` and never
  names `close_layer` or `block.close`, and it never calls
  `session.resize_layer`.
- Restoring: the `state = "normal"` call carries `focus = true` and no
  `bounds`, so the server keeps the rect the layer had.
- Matching: layers are found by the block label, and a review that lives in
  another window is reported with its tab name instead of being touched.
- A directory outside a git repository gets one clear line
  (`is not in a git repository`) and still opens the layer.
- The wiring: `init.lua` has `require("review"){ block_cwd = block_cwd }` and
  still requires `notes`; `notes.lua` returns `CARD_W`, `CARD_H`, and
  `bounds_for`; `cmd+shift+n` captures a note, `cmd+shift+t` processes the
  queue, and the command palette keeps `cmd+shift+p`.

## Rules

- Text assertions only: no Rex server, no session, no `tuicr` binary, no
  terminal. The action needs a live server, so its behaviour is proved by the
  source anchors above, not by running it.
- `REX_CONFIG=<checkout>/rex/.config/rex/init.lua rex config check` is the
  manual load gate: it must report one more binding and one more action than
  the config without this file.
- Runtime is under 100 ms.
