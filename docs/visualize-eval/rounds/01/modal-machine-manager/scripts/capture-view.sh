#!/bin/sh
# Capture one rataflow view in a fresh 77x47 Herdr pane (no-focus, half split).
# usage: capture-view.sh <view-id> <spec-path> <split-from-pane-id>
set -u
BIN=/tmp/visualize-eval/round-01/bin/rataflow-view
DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$DIR" || exit 1
VIEW=$1
SPEC=$2
SRC_PANE=${3:-w7E:p31}
BASE=$(basename "$SPEC")
LOG="captures/$VIEW.commands.txt"

: > "$LOG"
echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) capture $VIEW spec=$SPEC split_from=$SRC_PANE" >> "$LOG"

# 1. spec hash + offline check evidence
shasum -a 256 "$SPEC" > "checks/$VIEW.spec.sha256"
echo "# $BIN --check $SPEC" >> "$LOG"
"$BIN" --check "$SPEC" > "checks/$VIEW.check.out" 2> "checks/$VIEW.check.err"
echo "$?" > "checks/$VIEW.check.exit"
cat "checks/$VIEW.check.out" >> "$LOG"

# 2. split a fresh no-focus pane and record the returned pane id
SPLIT_CMD="herdr pane split --pane $SRC_PANE --direction right --ratio 0.5 --cwd $DIR --no-focus"
echo "# $SPLIT_CMD" >> "$LOG"
RESP=$(herdr pane split --pane "$SRC_PANE" --direction right --ratio 0.5 --cwd "$DIR" --no-focus)
echo "$RESP" >> "$LOG"
PANE=$(printf '%s' "$RESP" | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
echo "pane=$PANE" >> "$LOG"
[ -n "$PANE" ] || { echo "split failed" >> "$LOG"; exit 1; }

# 3. measure the real terminal inside the pane, then launch the self-closing viewer
RUN_CMD="cd '$DIR' && { date -u +%Y-%m-%dT%H:%M:%SZ; echo pane=$PANE; stty size; } > 'captures/$VIEW.dimensions.txt' && clear && $BIN '$SPEC'; herdr pane close $PANE"
echo "# herdr pane run $PANE \"$RUN_CMD\"" >> "$LOG"
herdr pane run "$PANE" "$RUN_CMD" > /dev/null 2>&1

# 4. confirm the viewer header before capturing
echo "# herdr pane wait-output $PANE --match rataflow-view" >> "$LOG"
herdr pane wait-output "$PANE" --match "rataflow-view" --timeout 25 > "captures/$VIEW.header.json" 2>&1
echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) header wait finished" >> "$LOG"
sleep 2

# 5. unselected render: text + ansi
echo "# herdr pane read $PANE --source visible --format text" >> "$LOG"
herdr pane read "$PANE" --source visible --format text > "captures/$VIEW.unselected.txt" 2>&1
echo "# herdr pane read $PANE --source visible --format ansi" >> "$LOG"
herdr pane read "$PANE" --source visible --format ansi > "captures/$VIEW.unselected.ansi" 2>&1
shasum -a 256 "captures/$VIEW.unselected.txt" "captures/$VIEW.unselected.ansi" >> "checks/$VIEW.capture.sha256"
# header row of the render, plus a pass/fail line for the 'rataflow-view · ' marker
head -1 "captures/$VIEW.unselected.txt" > "checks/$VIEW.header.txt"
if head -1 "captures/$VIEW.unselected.txt" | grep -q 'rataflow-view .* · '; then
  echo "header_ok=yes (line 1 carries the rataflow-view · viewer banner)" >> "checks/$VIEW.header.txt"
else
  echo "header_ok=no" >> "checks/$VIEW.header.txt"
fi
echo "# header: $(head -1 "checks/$VIEW.header.txt")" >> "$LOG"

# 6. timestamped animation frames (slow dots move between frames)
i=1
while [ $i -le 5 ]; do
  STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  herdr pane read "$PANE" --source visible --format text > "frames/$VIEW.frame$i.txt" 2>&1
  echo "frame$i $STAMP sha=$(shasum -a 256 "frames/$VIEW.frame$i.txt" | cut -d' ' -f1)" >> "checks/$VIEW.frames.txt"
  sleep 1
  i=$((i+1))
done

# 7. selected-node state (Tab cycles selection) with ansi for border-handle colour
echo "# herdr pane send-keys $PANE Tab" >> "$LOG"
herdr pane send-keys "$PANE" Tab > /dev/null 2>&1
sleep 1
herdr pane read "$PANE" --source visible --format text > "captures/$VIEW.selected.txt" 2>&1
herdr pane read "$PANE" --source visible --format ansi > "captures/$VIEW.selected.ansi" 2>&1
shasum -a 256 "captures/$VIEW.selected.txt" "captures/$VIEW.selected.ansi" >> "checks/$VIEW.capture.sha256"

# 8. quit the viewer; the self-closing launch removes the pane
echo "# herdr pane send-keys $PANE q" >> "$LOG"
herdr pane send-keys "$PANE" q > /dev/null 2>&1
sleep 2
echo "# herdr pane get $PANE" >> "$LOG"
herdr pane get "$PANE" >> "checks/$VIEW.cleanup.txt" 2>&1
echo "exit=$?" >> "checks/$VIEW.cleanup.txt"
echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) done" >> "$LOG"
echo "PANE=$PANE"
