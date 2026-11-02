#!/usr/bin/env bash
# capture-view.sh <view-dir> — open one frozen-rataflow view in my own Herdr pane and
# record every piece of evidence the round-01 generator task asks for.
# Writes only inside <view-dir>/captures/. Uses the frozen binary only.
set -u
VIEW_DIR="$1"
BIN=/tmp/visualize-eval/round-01/bin/rataflow-view
SPEC="$PWD/$VIEW_DIR/spec.json"
CAP="$PWD/$VIEW_DIR/captures"
mkdir -p "$CAP/frames"
LOG="$CAP/commands.txt"
: > "$LOG"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# 1. even, no-focus half split in my own tab
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus > "$CAP/pane-split.json"
PID=$(python3 -c 'import json,sys;print(json.load(open("'"$CAP"'/pane-split.json"))["result"]["pane"]["pane_id"])')
echo "$(ts) herdr pane split --current --direction right --ratio 0.5 --cwd $PWD --no-focus  -> pane $PID" >> "$LOG"
herdr pane get "$PID" > "$CAP/pane-get.json"

# 2. measure the real terminal inside the pane before the viewer starts
herdr pane run "$PID" 'stty size; tput cols; tput lines'
echo "$(ts) herdr pane run $PID 'stty size; tput cols; tput lines'" >> "$LOG"
sleep 2
herdr pane read "$PID" --source visible --format text > "$CAP/dims-raw.txt"
echo "$(ts) herdr pane read $PID --source visible --format text > captures/dims-raw.txt" >> "$LOG"

# 3. launch the viewer with the skill's self-closing command
herdr pane run "$PID" "rataflow-view $SPEC; herdr pane close $PID"
echo "$(ts) herdr pane run $PID \"rataflow-view $SPEC; herdr pane close $PID\"" >> "$LOG"
sleep 3

# 4. timestamped animation frames (unicode text, then one ANSI frame)
for i in 1 2 3 4; do
  herdr pane read "$PID" --source visible --format text > "$CAP/frames/frame-0$i.txt"
  printf '%s frame-0%s\n' "$(ts)" "$i" >> "$CAP/timestamps.txt"
  sleep 2.5
done

# 5. unselected state, text and ANSI
herdr pane read "$PID" --source visible --format text > "$CAP/unselected.txt"
herdr pane read "$PID" --source visible --format ansi > "$CAP/unselected.ansi.txt"
echo "$(ts) unselected text+ansi captured" >> "$CAP/timestamps.txt"

# 6. selected-node state: Tab to move the selection, then an arrow key
herdr pane send-keys "$PID" Tab
sleep 1
herdr pane read "$PID" --source visible --format text > "$CAP/selected-tab.txt"
herdr pane read "$PID" --source visible --format ansi > "$CAP/selected-tab.ansi.txt"
echo "$(ts) selected-tab text+ansi captured" >> "$CAP/timestamps.txt"

herdr pane send-keys "$PID" Right
sleep 1
herdr pane read "$PID" --source visible --format text > "$CAP/selected-right.txt"
herdr pane read "$PID" --source visible --format ansi > "$CAP/selected-right.ansi.txt"
echo "$(ts) selected-right text+ansi captured" >> "$CAP/timestamps.txt"

herdr pane read "$PID" --source visible --format text > "$CAP/selected-after-frames.txt"
echo "$(ts) selected animation frame captured" >> "$CAP/timestamps.txt"

# 7. header check
head -1 "$CAP/unselected.txt" > "$CAP/header.txt"

# 8. quit; the viewer closes its own pane
herdr pane send-keys "$PID" q
echo "$(ts) herdr pane send-keys $PID q (self-closing)" >> "$LOG"
sleep 2
herdr pane layout --pane w7E:p2R > "$CAP/layout-after-close.json"
if herdr pane get "$PID" >/dev/null 2>&1; then
  echo "$(ts) CLEANUP-FAILURE pane $PID still present" >> "$LOG"
  herdr pane close "$PID" >> "$LOG" 2>&1
else
  echo "$(ts) pane $PID gone after q" >> "$LOG"
fi
echo "pane=$PID" > "$CAP/pane-id.txt"
shasum -a 256 "$SPEC" > "$CAP/spec.sha256"
cat "$LOG"
