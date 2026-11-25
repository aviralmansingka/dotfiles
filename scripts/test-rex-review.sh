#!/usr/bin/env bash
# Paths: rex/.config/rex/review.lua rex/.config/rex/init.lua rex/.config/rex/notes.lua scripts/test-rex-review.sh docs/ci-tests/rex-review.md
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
review="$repo_root/rex/.config/rex/review.lua"
init="$repo_root/rex/.config/rex/init.lua"
notes="$repo_root/rex/.config/rex/notes.lua"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
want() { grep -qF -- "$1" "$2" || fail "$3"; pass "$3"; }
reject() { ! grep -qF -- "$1" "$2" || fail "$3"; pass "$3"; }

[ -f "$review" ] || fail "rex/.config/rex/review.lua is missing"

# The chord is the contract with the human, and it is bound once.
want 'rex.bind("cmd+shift+r", "tuicr_float")' "$review" "cmd+shift+r is bound to tuicr_float"
[ "$(grep -c 'cmd+shift+r' "$review")" -eq 1 ] \
  || fail "cmd+shift+r must appear exactly once in review.lua"
want 'name = "tuicr_float"' "$review" "the action is named tuicr_float"

# The review scope is the working tree, launched through the tui subcommand.
want '{ "tuicr", "tui", "--working-tree" }' "$review" "tuicr opens the working tree in the TUI"

# First press creates a labeled floating layer in the active window, focused.
want 'label = LABEL' "$review" "the layer's block carries the match label"
want 'local LABEL = "tuicr"' "$review" "the match label is tuicr"
want 'window_id = window.window_id' "$review" "the layer is created in the active window"
want 'focus = true,' "$review" "a new layer is focused"
want 'notes.bounds_for(session_id, notes.CARD_W, notes.CARD_H)' "$review" \
  "the layer is cut by the card helper"

# Hiding keeps the review alive: state changes only, never a layer close.
want 'state = "minimized"' "$review" "a press minimizes the layer"
reject 'close_layer' "$review" "review.lua never closes the layer"
reject 'block.close' "$review" "review.lua never closes the block"

# Restore is in place: state plus focus, and the server owns the rect.
want 'state = "normal"' "$review" "a press restores the layer"
line=$(grep -n 'state = "normal",' "$review" | head -1 | cut -d: -f1)
[ -n "$line" ] || fail "the restore call is not found"
restore=$(sed -n "${line},$((line + 3))p" "$review")
printf '%s\n' "$restore" | grep -qF 'focus = true' \
  || fail "the restore must ask for focus"
! printf '%s\n' "$restore" | grep -qF 'bounds' \
  || fail "the restore must pass no bounds"
pass "the restore asks for focus and passes no bounds"

# The toggle never writes a rect, so a minimized layer keeps its place.
reject 'session.resize_layer' "$review" "review.lua never resizes the layer"

# Another window's layer is named, never touched.
want 'holds_review' "$review" "layers are matched by the label"
want 'the review is already open in' "$review" "a layer in another window is reported"
want 'say(("%s is not in a git repository' "$review" \
  "a directory outside a repository gets one clear line"

# The wiring: init.lua hands the block reader in, notes.lua hands the card out.
want 'require("review"){ block_cwd = block_cwd }' "$init" \
  "init.lua requires review with the block reader"
want 'require("notes")' "$init" "init.lua still requires notes"
want 'return { CARD_W = CARD_W, CARD_H = CARD_H, bounds_for = bounds_for }' "$notes" \
  "notes.lua returns the card helpers"
want 'rex.bind("cmd+shift+n", "capture_note")' "$notes" "the note chord is unchanged"
want 'rex.bind("cmd+shift+p", "process_notes")' "$notes" "the processing chord is unchanged"

# The key must stay free: no other file binds cmd+shift+r.
others=$(grep -rlF 'cmd+shift+r' "$repo_root/rex/.config/rex/" | grep -vF "$review" || true)
[ -z "$others" ] || fail "cmd+shift+r is also bound in: $others"
pass "cmd+shift+r is bound in review.lua only"

echo "rex review tests passed"
