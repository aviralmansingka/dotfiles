#!/usr/bin/env bash
# Capture one visualize view: split my own tab, measure the tty, run the frozen
# viewer with its self-closing command, then read none/selected states and quit.
# Usage: capture.sh <view-name> <spec-path-relative-to-case-dir>
set -euo pipefail

view="$1"
spec="$2"
case_dir="/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/docs/visualize-eval/rounds/01/modal-runtime"
BIN="/tmp/visualize-eval/round-01/bin/rataflow-view"
cd "$case_dir"

log="evidence/${view}.timeline.txt"
say() { date -u +"%Y-%m-%dT%H:%M:%SZ $*" | tee -a "$log"; }

say "split start"
split_json="$(herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus)"
printf '%s\n' "$split_json" > "evidence/${view}.split.json"
pane="$(printf '%s' "$split_json" | jq -r '.result.pane.pane_id')"
say "pane=$pane"

herdr pane run "$pane" "stty size | tee evidence/${view}.tty-size.txt" >/dev/null
sleep 1.2
herdr pane read "$pane" --source visible > "evidence/${view}.pane-shell.txt" 2>&1
say "measured tty=$(tr '\n' 'x' < "evidence/${view}.tty-size.txt")"

launch="$BIN '$PWD/$spec'; herdr pane close $pane"
printf '%s\n' "$launch" > "evidence/${view}.launch-cmd.txt"
herdr pane run "$pane" "$launch" >/dev/null
say "viewer launched"

sleep 3
herdr pane read "$pane" --source visible > "captures/${view}.text.none.txt" 2>&1
herdr pane read "$pane" --source visible --format ansi > "captures/${view}.ansi.none.txt" 2>&1
say "captured none-state"

herdr pane send-keys "$pane" Tab >/dev/null
sleep 0.9
herdr pane read "$pane" --source visible > "captures/${view}.text.sel-tab.txt" 2>&1
herdr pane read "$pane" --source visible --format ansi > "captures/${view}.ansi.sel-tab.txt" 2>&1
say "captured tab-selected"

herdr pane send-keys "$pane" Right >/dev/null
sleep 0.9
herdr pane read "$pane" --source visible > "captures/${view}.text.sel-right.txt" 2>&1
herdr pane read "$pane" --source visible --format ansi > "captures/${view}.ansi.sel-right.txt" 2>&1
say "captured right-selected"

herdr pane send-keys "$pane" q >/dev/null
sleep 1.6
if herdr pane get "$pane" >/dev/null 2>&1; then
  say "cleanup needed for $pane"
  herdr pane close "$pane" >/dev/null || true
  say "cleanup closed $pane"
else
  say "pane $pane self-closed"
fi

head -1 "captures/${view}.text.none.txt" | tee -a "$log"
for state in none sel-tab sel-right; do
  printf '%s ' "$state" >> "$log"
  shasum -a 256 "captures/${view}.text.$state.txt" "captures/${view}.ansi.$state.txt" >> "$log"
done
tail -1 "$log" >/dev/null
