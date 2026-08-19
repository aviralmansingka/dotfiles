#!/usr/bin/env bash
# nvim-open.sh — open vim in the current Herdr tab as a vertical split,
# or send files to an existing editor instance.
#
# Usage:
#   nvim-open.sh [cwd] [file1] [file2] ...
#   nvim-open.sh /path/to/cwd           # open vim at cwd
#   nvim-open.sh /path/to/cwd file.ts   # open file in vim
set -euo pipefail

CWD="${1:-$(pwd)}"
shift || true
FILES=("$@")

HERDR_TIMEOUT=5

# Escape a file path for Vim :e ex command (fnameescape semantics)
fnameescape() {
	local path="$1"
	# Backslash-escape: backslash, space, pipe, percent, hash, double-quote,
	# single-quote, tab, newline, CR
	printf '%s' "$path" | sed 's/[][\\ |%"'"'"'#\t\r\n]/\\&/g'
}

# Run herdr command, return JSON or null
herdr_json() {
	timeout "$HERDR_TIMEOUT" herdr "$@" 2>/dev/null || true
}

herdr_ok() {
	timeout "$HERDR_TIMEOUT" herdr "$@" >/dev/null 2>&1
}

# Check if herdr is available
if ! herdr_json workspace list >/dev/null 2>&1; then
	# No herdr — try tmux
	if command -v tmux >/dev/null 2>&1; then
		if [[ ${#FILES[@]} -gt 0 ]]; then
			quoted=$(printf "'%s' " "${FILES[@]}")
			tmux split-window -h -c "$CWD" "vim $quoted"
		else
			tmux split-window -h -c "$CWD" "vim"
		fi
		echo "Launched vim in a tmux split at $CWD."
		exit 0
	fi
	echo "Could not launch vim. Run manually: cd $CWD && vim ${FILES[*]}"
	exit 1
fi

# Get current pane info
CURRENT_PANE_JSON=$(herdr_json pane current)
if [[ -z "$CURRENT_PANE_JSON" ]]; then
	echo "Could not get current pane from herdr."
	exit 1
fi

TAB_ID=$(echo "$CURRENT_PANE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['pane']['tab_id'])" 2>/dev/null || echo "")
CURRENT_PANE_ID=$(echo "$CURRENT_PANE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['pane']['pane_id'])" 2>/dev/null || echo "")

if [[ -z "$TAB_ID" || -z "$CURRENT_PANE_ID" ]]; then
	echo "Could not parse current pane info."
	exit 1
fi

# Detect existing editor in the current tab
EDITOR_PANE_ID=""
EDITOR_FOUND=false
SCAN_ERROR=false

PANES_JSON=$(herdr_json pane list)
if [[ -z "$PANES_JSON" ]]; then
	SCAN_ERROR=true
else
	# Get panes in this tab
	TAB_PANES=$(echo "$PANES_JSON" | python3 -c "
import sys,json
data=json.load(sys.stdin)
panes=[p['pane_id'] for p in data.get('result',{}).get('panes',[]) if p.get('tab_id')=='$TAB_ID']
print('\n'.join(panes))
" 2>/dev/null || echo "")

	if [[ -z "$TAB_PANES" ]]; then
		SCAN_ERROR=true
	else
		while IFS= read -r pane_id; do
			[[ -z "$pane_id" ]] && continue
			PROC_JSON=$(herdr_json pane process-info --pane "$pane_id")
			if [[ -z "$PROC_JSON" ]]; then
				SCAN_ERROR=true
				continue
			fi
			# Check if foreground process is vim or nvim
			IS_EDITOR=$(echo "$PROC_JSON" | python3 -c "
import sys,json
data=json.load(sys.stdin)
procs=data.get('result',{}).get('process_info',{}).get('foreground_processes',[])
for p in procs:
    name=p.get('name','')
    argv0=(p.get('argv',[''])[0]) if p.get('argv') else ''
    if name in ('vim','nvim') or argv0 in ('vim','nvim'):
        print('yes')
        break
" 2>/dev/null || echo "")

			if [[ "$IS_EDITOR" == "yes" ]]; then
				EDITOR_PANE_ID="$pane_id"
				EDITOR_FOUND=true
				break
			fi
		done <<< "$TAB_PANES"
	fi
fi

# If editor exists, send files to it
if [[ "$EDITOR_FOUND" == "true" ]]; then
	if [[ ${#FILES[@]} -gt 0 ]]; then
		for file in "${FILES[@]}"; do
			escaped=$(fnameescape "$file")
			# Escape to exit insert mode, then :e with escaped path, then Enter
			herdr_ok pane send-text "$EDITOR_PANE_ID" $'\x1b:e '"$escaped"$'\r'
		done
		echo "Sent ${#FILES[@]} file(s) to existing editor (pane $EDITOR_PANE_ID)."
	else
		echo "Editor already running (pane $EDITOR_PANE_ID)."
	fi
	# Focus the editor pane — find direction via neighbor
	for dir in right down left up; do
		NEIGHBOR=$(herdr_json pane neighbor --pane "$CURRENT_PANE_ID" --direction "$dir" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('neighbor',{}).get('pane_id',''))" 2>/dev/null || echo "")
		if [[ "$NEIGHBOR" == "$EDITOR_PANE_ID" ]]; then
			herdr_ok pane focus --current --direction "$dir"
			break
		fi
	done
	exit 0
fi

# On scan error, don't launch a duplicate — fall through to tmux
if [[ "$SCAN_ERROR" == "true" ]]; then
	echo "Warning: could not fully scan panes for existing editor." >&2
	if command -v tmux >/dev/null 2>&1; then
		if [[ ${#FILES[@]} -gt 0 ]]; then
			quoted=$(printf "'%s' " "${FILES[@]}")
			tmux split-window -h -c "$CWD" "vim $quoted"
		else
			tmux split-window -h -c "$CWD" "vim"
		fi
		echo "Launched vim in a tmux split at $CWD."
		exit 0
	fi
fi

# No existing editor — launch a new vertical split
SPLIT_JSON=$(herdr_json pane split --current --direction right --cwd "$CWD" --focus)
NEW_PANE_ID=$(echo "$SPLIT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('pane',{}).get('pane_id',''))" 2>/dev/null || echo "")

if [[ -z "$NEW_PANE_ID" ]]; then
	echo "Could not create split pane."
	exit 1
fi

# Launch vim in the new pane
if [[ ${#FILES[@]} -gt 0 ]]; then
	if herdr_ok pane run "$NEW_PANE_ID" vim "${FILES[@]}"; then
		echo "Launched vim in a vertical split (pane $NEW_PANE_ID) at $CWD with ${#FILES[@]} file(s)."
	else
		echo "Failed to launch vim in pane $NEW_PANE_ID."
		exit 1
	fi
else
	if herdr_ok pane run "$NEW_PANE_ID" vim; then
		echo "Launched vim in a vertical split (pane $NEW_PANE_ID) at $CWD."
	else
		echo "Failed to launch vim in pane $NEW_PANE_ID."
		exit 1
	fi
fi
