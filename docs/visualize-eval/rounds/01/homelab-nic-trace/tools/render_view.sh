#!/bin/sh
# Render one evaluation view in a fresh no-focus half-split pane and capture evidence.
# Usage: render_view.sh <view-id> <spec-path>
# Writes captures/<view>-*.txt|ansi, frames/<view>-frame0{1,2,3}.*, checks/<view>-borders.json,
# captures/<view>-commands.txt (pane id, timestamps, measured size, exact commands).
set -u
VIEW="$1"
SPEC="$2"
BIN=/tmp/visualize-eval/round-01/bin/rataflow-view
HERDR=${HERDR_BIN_PATH:-herdr}
OUT="$VIEW"-commands.txt

log() { printf '%s\n' "$*" >> "captures/$OUT"; }

log "# view=$VIEW spec=$SPEC"
log "# spec sha256: $(shasum -a 256 "$SPEC" | cut -d' ' -f1)"
log "# binary: $BIN sha256: $(shasum -a 256 "$BIN" | cut -d' ' -f1)"
log "# stty size measured inside the viewer pane before start (rows cols expected 47 77)"

SPLIT=$("$HERDR" pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus)
PANE=$(printf '%s' "$SPLIT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
TAB=$(printf '%s' "$SPLIT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["tab_id"])')
log "# split utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "# cmd: herdr pane split --current --direction right --ratio 0.5 --cwd \"\$PWD\" --no-focus  -> pane=$PANE tab=$TAB"

"$HERDR" pane run "$PANE" "stty size"
sleep 2
SIZE=$(printf '%s' "$("$HERDR" pane read "$PANE" --source visible --format text)" | grep -E '^[0-9]+ [0-9]+$' | head -1)
log "# pane_read_stty_size: ${SIZE:-MISSING}"
printf '%s\n' "${SIZE:-MISSING}" > "captures/$VIEW-size.txt"

log "# cmd: herdr pane run $PANE \"$BIN $SPEC; herdr pane close $PANE\""
"$HERDR" pane run "$PANE" "$BIN $SPEC; herdr pane close $PANE"
sleep 3

"$HERDR" pane read "$PANE" --source visible --format text > "captures/$VIEW-unselected.txt"
"$HERDR" pane read "$PANE" --source visible --format ansi > "captures/$VIEW-unselected.ansi"
log "# unselected capture utc: $(date -u +%Y-%m-%dT%H:%M:%SZ) (text+ansi)"
log "# header: $(head -1 "captures/$VIEW-unselected.txt")"

python3 tools/validate_grid.py "captures/$VIEW-unselected.ansi" > "checks/$VIEW-borders.json"
log "# border check exit: $? (checks/$VIEW-borders.json)"

for i in 1 2 3; do
  log "# frame $i utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$HERDR" pane read "$PANE" --source visible --format text > "frames/$VIEW-frame0$i.txt"
  "$HERDR" pane read "$PANE" --source visible --format ansi > "frames/$VIEW-frame0$i.ansi"
  sleep 1
done

"$HERDR" pane send-keys "$PANE" Tab
sleep 1
"$HERDR" pane read "$PANE" --source visible --format text > "captures/$VIEW-selected.txt"
"$HERDR" pane read "$PANE" --source visible --format ansi > "captures/$VIEW-selected.ansi"
log "# cmd: herdr pane send-keys $PANE Tab ; then selected capture utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 tools/ansi_grid.py --diff "captures/$VIEW-unselected.ansi" "captures/$VIEW-selected.ansi" > "checks/$VIEW-selection-diff.json"
log "# selection diff cells: $(python3 -c 'import json,sys; print(len(json.load(open("checks/'"$VIEW"'-selection-diff.json"))))')"

log "# cmd: herdr pane send-keys $PANE q  (viewer exits; self-closing command removes the pane)"
"$HERDR" pane send-keys "$PANE" q
sleep 2
if "$HERDR" pane get "$PANE" >/dev/null 2>&1; then
  log "# cleanup: pane $PANE still present; closing explicitly"
  "$HERDR" pane close "$PANE"
  log "# cleanup after explicit close: $("$HERDR" pane get "$PANE" 2>&1 | cut -c1-60)"
else
  log "# cleanup: pane $PANE closed by the self-closing viewer command"
fi
log "# hashes:"
for f in "captures/$VIEW-unselected.txt" "captures/$VIEW-unselected.ansi" "captures/$VIEW-selected.txt" "captures/$VIEW-selected.ansi" "frames/$VIEW-frame01.txt" "frames/$VIEW-frame02.txt" "frames/$VIEW-frame03.txt"; do
  log "#   $(shasum -a 256 "$f")"
done
