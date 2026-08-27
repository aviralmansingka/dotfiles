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

# Add common nvim installation paths that may not be on PATH
# (bob version manager, homebrew on Linux/macOS).
if ! command -v nvim >/dev/null 2>&1; then
	for _p in \
		"$HOME/.local/share/bob/nightly/bin" \
		"$HOME/.local/share/bob/stable/bin" \
		"/home/linuxbrew/.linuxbrew/bin" \
		"/opt/homebrew/bin"; do
		[[ -d "$_p" ]] && PATH="$_p:$PATH"
	done
	unset _p
fi

# Check for vim or nvim before doing anything else.
# If neither is installed, fail fast with a useful fallback.
if ! command -v vim >/dev/null 2>&1 && ! command -v nvim >/dev/null 2>&1; then
	echo "Error: neither vim nor nvim is installed on this host." >&2
	echo "Fallback: use 'less <file>' for read-only viewing or 'vi -R <file>' for vi." >&2
	echo "Files requested: ${FILES[*]:-$CWD}" >&2
	exit 1
fi

# Pick whichever editor is available (prefer nvim, fall back to vim).
EDITOR_CMD="vim"
if command -v nvim >/dev/null 2>&1; then
	EDITOR_CMD="nvim"
fi

# ── Dotfiles worktree config detection ──────────────────────────────
# When the cwd is inside a dotfiles checkout (or a git worktree of it),
# detect the local nvim config and use it instead of ~/.config/nvim.
# The signal is a `nvim/.config/nvim/init.lua` file in a parent dir.
DOTFILES_XDG_CONFIG_HOME=""
detect_dotfiles_config() {
	local dir="$CWD"
	# Walk up the directory tree (max 20 levels to avoid infinite loops).
	for _ in $(seq 1 20); do
		if [[ -f "$dir/nvim/.config/nvim/init.lua" ]]; then
			DOTFILES_XDG_CONFIG_HOME="$dir/nvim/.config"
			return 0
		fi
		[[ "$dir" == "/" ]] && return 1
		dir=$(dirname "$dir")
	done
	return 1
}
if detect_dotfiles_config; then
	echo "Dotfiles config detected: $DOTFILES_XDG_CONFIG_HOME/nvim/init.lua"
fi

# Build the env prefix for launching nvim with the worktree config.
ENV_PREFIX=""
if [[ -n "$DOTFILES_XDG_CONFIG_HOME" ]]; then
	ENV_PREFIX="env XDG_CONFIG_HOME=$DOTFILES_XDG_CONFIG_HOME"
fi

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

# Create a listen socket dir so the nvimr skill can
# interact with the launched nvim session via RPC. The socket path
# matches nvimr's discovery glob: ${TMPDIR}nvim.<user>/<dir>/nvim.*.0
LISTEN_ARGS=""
if [[ "$EDITOR_CMD" == "nvim" ]]; then
	mkdir -p "${TMPDIR:-/tmp}nvim.$(id -un)" 2>/dev/null || true
	_SOCKET_DIR="$(mktemp -d "${TMPDIR:-/tmp}nvim.$(id -un)/nvim.XXXXXX")" 2>/dev/null || true
	if [[ -n "$_SOCKET_DIR" && -d "$_SOCKET_DIR" ]]; then
		_SOCKET_PATH="$_SOCKET_DIR/nvim.$(date +%s).0"
		LISTEN_ARGS="--listen $_SOCKET_PATH"
	fi
fi

# Check if herdr is available
if ! herdr_json workspace list >/dev/null 2>&1; then
	# No herdr — try tmux
	if command -v tmux >/dev/null 2>&1; then
		if [[ ${#FILES[@]} -gt 0 ]]; then
			quoted=$(printf "'%s' " "${FILES[@]}")
			tmux split-window -h -c "$CWD" "$ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS $quoted"
		else
			tmux split-window -h -c "$CWD" "$ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS"
		fi
		echo "Launched $EDITOR_CMD in a tmux split at $CWD."
		[[ -n "${_SOCKET_PATH:-}" ]] && echo "Listen socket: $_SOCKET_PATH"
		exit 0
	fi
	echo "Could not launch $EDITOR_CMD. Run manually: cd $CWD && $ENV_PREFIX $EDITOR_CMD ${FILES[*]}"
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

# If editor exists, send files to it.
# When a dotfiles config was detected, warn that the existing editor
# may be running with a different config — the captain can close and
# relaunch to pick up the worktree config.
if [[ "$EDITOR_FOUND" == "true" ]]; then
	if [[ -n "$DOTFILES_XDG_CONFIG_HOME" ]]; then
		echo "Note: dotfiles config detected at $DOTFILES_XDG_CONFIG_HOME but" >&2
		echo "      existing editor may be using a different config. Close and" >&2
		echo "      relaunch /nvim to use the worktree config." >&2
	fi
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
			tmux split-window -h -c "$CWD" "$ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS $quoted"
		else
			tmux split-window -h -c "$CWD" "$ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS"
		fi
		echo "Launched $EDITOR_CMD in a tmux split at $CWD."
		[[ -n "${_SOCKET_PATH:-}" ]] && echo "Listen socket: $_SOCKET_PATH"
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

# Launch $EDITOR_CMD in the new pane.
# When a dotfiles config was detected, prefix with env XDG_CONFIG_HOME=...
# so nvim reads the worktree's config instead of ~/.config/nvim.
if [[ ${#FILES[@]} -gt 0 ]]; then
	if herdr_ok pane run "$NEW_PANE_ID" $ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS "${FILES[@]}"; then
		echo "Launched $EDITOR_CMD in a vertical split (pane $NEW_PANE_ID) at $CWD with ${#FILES[@]} file(s)."
	else
		echo "Failed to launch $EDITOR_CMD in pane $NEW_PANE_ID."
		exit 1
	fi
else
	if herdr_ok pane run "$NEW_PANE_ID" $ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS; then
		echo "Launched $EDITOR_CMD in a vertical split (pane $NEW_PANE_ID) at $CWD."
	else
		echo "Failed to launch $EDITOR_CMD in pane $NEW_PANE_ID."
		exit 1
	fi
fi

# Print the listen socket path if created, so the agent knows where it is.
if [[ -n "${_SOCKET_PATH:-}" ]]; then
	echo "Listen socket: $_SOCKET_PATH"
fi
