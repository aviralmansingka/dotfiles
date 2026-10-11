#!/usr/bin/env bash
# nvim-open.sh — open vim in the current Herdr tab: attach to the tab's
# live herdr-nvim sidebar daemon, send files to an existing editor
# instance, or launch a vertical split.
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

# ── Launch provenance log ──────────────────────────────────────
# Every launch appends one attributable line (space-separated
# key=value pairs) to ~/.cache/pi/nvim-open-launches.log —
# PI_NVIM_LAUNCH_LOG overrides the path. Mirrors buildLaunchLogLine
# in the nvim-open extension. Best-effort only: a write failure must
# never fail or delay the launch, so the whole body runs inside a
# swallowed group.

# Quote a value that would break key=value token scanning: empty, or
# containing whitespace, quotes, backslash, or '='.
log_quote() {
	local value="$1"
	case "$value" in
		"" | *[[:space:]\"\'\\=]*)
			local escaped="${value//\'/\'\\\'\'}"
			printf "'%s'" "$escaped"
			;;
		*)
			printf '%s' "$value"
			;;
	esac
}

# $1 outcome, $2 pane (split/failed only, default -), $3 socket (default -).
log_launch() {
	{
		local outcome="$1" pane="${2:--}" socket="${3:--}" line log_path
		log_path="${PI_NVIM_LAUNCH_LOG:-$HOME/.cache/pi/nvim-open-launches.log}"
		line="ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$$ route=script"
		line="$line session=$(log_quote "${PI_SUBAGENT_SESSION:-${PI_SESSION_FILE:--}}")"
		line="$line subagent=$(log_quote "${PI_SUBAGENT_NAME:--}")"
		line="$line callerPane=$(log_quote "${HERDR_PANE_ID:--}")"
		line="$line cwd=$(log_quote "$CWD")"
		line="$line outcome=$outcome"
		if [[ "$outcome" == "split" || "$outcome" == "failed" ]]; then
			line="$line pane=$(log_quote "$pane") socket=$(log_quote "$socket")"
		fi
		line="$line files=${#FILES[@]}"
		mkdir -p "$(dirname "$log_path")" 2>/dev/null || true
		printf '%s\n' "$line" >>"$log_path"
	} 2>/dev/null || true
}

# Check for vim or nvim before doing anything else.
# If neither is installed, fail fast with a useful fallback.
if ! command -v vim >/dev/null 2>&1 && ! command -v nvim >/dev/null 2>&1; then
	echo "Error: neither vim nor nvim is installed on this host." >&2
	echo "Fallback: use 'less <file>' for read-only viewing or 'vi -R <file>' for vi." >&2
	echo "Files requested: ${FILES[*]:-$CWD}" >&2
	log_launch failed
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

# Check if herdr is available. herdr_json always exits 0 (its `|| true`),
# so the guard must test the response text: empty output means no herdr
# answered, and the tmux fallback below stays reachable.
if [ -z "$(herdr_json workspace list)" ]; then
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
		log_launch split - "${_SOCKET_PATH:--}"
		exit 0
	fi
	echo "Could not launch $EDITOR_CMD. Run manually: cd $CWD && $ENV_PREFIX $EDITOR_CMD ${FILES[*]}"
	log_launch failed
	exit 1
fi

# Get current pane info
CURRENT_PANE_JSON=$(herdr_json pane current)
if [[ -z "$CURRENT_PANE_JSON" ]]; then
	echo "Could not get current pane from herdr."
	log_launch failed
	exit 1
fi

TAB_ID=$(echo "$CURRENT_PANE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['pane']['tab_id'])" 2>/dev/null || echo "")
CURRENT_PANE_ID=$(echo "$CURRENT_PANE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['pane']['pane_id'])" 2>/dev/null || echo "")

if [[ -z "$TAB_ID" || -z "$CURRENT_PANE_ID" ]]; then
	echo "Could not parse current pane info."
	log_launch failed
	exit 1
fi

# ── herdr-nvim sidebar daemon: attach instead of a duplicate split ──
# ChmaraX/herdr-nvim keeps one headless nvim daemon per tab, registered
# as <tab key>.sock (tab id with ':'→'_') under $XDG_RUNTIME_DIR/herdr-nvim,
# else the temp dir. A live daemon means the sidebar owns this tab's
# editing: open files in it and make sure the sidebar is shown.
DAEMON_TAB_KEY="${TAB_ID//:/_}"
DAEMON_SOCKET=""
for _dir in "${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/herdr-nvim}" "${TMPDIR:-/tmp}/herdr-nvim"; do
	if [[ -S "$_dir/$DAEMON_TAB_KEY.sock" ]]; then
		DAEMON_SOCKET="$_dir/$DAEMON_TAB_KEY.sock"
		break
	fi
done
unset _dir
if [[ -n "$DAEMON_SOCKET" && "$EDITOR_CMD" == "nvim" ]] && \
	nvim --server "$DAEMON_SOCKET" --remote-expr 1 >/dev/null 2>&1; then
	if [[ -n "$DOTFILES_XDG_CONFIG_HOME" ]]; then
		echo "Note: the sidebar daemon runs the global nvim config, not the detected worktree config." >&2
	fi
	DAEMON_OK=true
	for file in "${FILES[@]}"; do
		# Resolve against CWD — the daemon's own cwd is unrelated.
		if [[ "$file" != /* ]]; then
			file="$CWD/$file"
		fi
		nvim --server "$DAEMON_SOCKET" --remote "$file" || DAEMON_OK=false
	done
	# Find the visible sidebar pane: the `herdr-nvim sidebar` launcher (brief
	# on Unix before it execs, the parent on Windows) or the
	# `nvim --server <socket> --remote-ui` client it execs into on Unix —
	# the steady state, matched by this tab's own daemon socket.
	TAB_PANES_LIST=$(herdr_json pane list | python3 -c "
import sys, json
data = json.load(sys.stdin)
panes = [p['pane_id'] for p in data.get('result', {}).get('panes', []) if p.get('tab_id') == '$TAB_ID']
print('\n'.join(panes))
" 2>/dev/null || echo "")
	SIDEBAR_VISIBLE=false
	while IFS= read -r _pane; do
		[[ -z "$_pane" ]] && continue
		if herdr_json pane process-info --pane "$_pane" | python3 -c "
import sys, json
socket = sys.argv[1]
data = json.load(sys.stdin)
for p in data.get('result', {}).get('process_info', {}).get('foreground_processes', []):
    argv = p.get('argv') or []
    exe = (p.get('name', '') or (argv[0] if argv else '')).replace(chr(92), '/').rsplit('/', 1)[-1]
    if exe in ('herdr-nvim', 'herdr-nvim.exe') and 'sidebar' in argv:
        sys.exit(0)
    server = ''
    if '--server' in argv:
        i = argv.index('--server')
        if i + 1 < len(argv):
            server = argv[i + 1]
    if exe in ('nvim', 'nvim.exe') and '--remote-ui' in argv and server == socket:
        sys.exit(0)
sys.exit(1)
" "$DAEMON_SOCKET" 2>/dev/null; then
			SIDEBAR_VISIBLE=true
			break
		fi
	done <<< "$TAB_PANES_LIST"
	if [[ "$DAEMON_OK" != "true" ]]; then
		echo "Could not open files in the herdr-nvim sidebar (tab $TAB_ID)." >&2
		log_launch failed - "$DAEMON_SOCKET"
		exit 1
	fi
	# Toggled-off sidebar: never show the pane from the agent side — an
	# action invoke follows the focused tab (possibly another workspace)
	# and a raw pane open bypasses the plugin's state machinery. The
	# files are in the persistent daemon; prefix+t shows them.
	VIEW_NOTE=""
	if [[ "$SIDEBAR_VISIBLE" != "true" ]]; then
		VIEW_NOTE=" — press prefix+t in that tab to view"
	fi
	if [[ ${#FILES[@]} -gt 0 ]]; then
		echo "Opened ${#FILES[@]} file(s) in the herdr-nvim sidebar (tab $TAB_ID)$VIEW_NOTE."
	else
		echo "herdr-nvim sidebar (tab $TAB_ID) is this tab's editor$VIEW_NOTE."
	fi
	log_launch sidebar
	exit 0
fi

# ── Per-tab launch lock ──────────────────────────────────────
# Two invocations of this script in one tab (an agent tool call and a
# skill call, or two racing callers) can both scan "no editor" and both
# split — the provenance log recorded two splits 27 ms apart. Serialize
# the detect→split section below on a per-tab lockfile. flock is
# advisory and best-effort: when it is missing the script behaves as
# before. The lock releases when fd 9 closes — every path below exits.
LAUNCH_LOCK="/tmp/pi-nvim-launch-${TAB_ID//:/_}.lock"
if command -v flock >/dev/null 2>&1; then
	if exec 9>>"$LAUNCH_LOCK" 2>/dev/null; then
		flock -w 15 9 || true
	fi
fi

# Detect existing editor in the current tab (sets EDITOR_PANE_ID,
# EDITOR_FOUND, SCAN_ERROR). A function so the pre-split settle re-check
# below can run the exact same scan.
scan_tab_for_editor() {
	EDITOR_PANE_ID=""
	EDITOR_FOUND=false
	SCAN_ERROR=false

	local PANES_JSON TAB_PANES PROC_JSON IS_EDITOR pane_id
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
}

# Send files to / focus the existing editor pane (EDITOR_PANE_ID), then
# exit. A function so the settle re-check reuses the exact same routing.
use_existing_editor() {
	# When a dotfiles config was detected, warn that the existing editor
	# may be running with a different config — the captain can close and
	# relaunch to pick up the worktree config.
	if [[ -n "$DOTFILES_XDG_CONFIG_HOME" ]]; then
		echo "Note: dotfiles config detected at $DOTFILES_XDG_CONFIG_HOME but" >&2
		echo "      existing editor may be using a different config. Close and" >&2
		echo "      relaunch /nvim to use the worktree config." >&2
	fi
	if [[ ${#FILES[@]} -gt 0 ]]; then
		local escaped file
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
	local dir NEIGHBOR
	for dir in right down left up; do
		NEIGHBOR=$(herdr_json pane neighbor --pane "$CURRENT_PANE_ID" --direction "$dir" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('neighbor',{}).get('neighbor_pane_id',''))" 2>/dev/null || echo "")
		if [[ "$NEIGHBOR" == "$EDITOR_PANE_ID" ]]; then
			herdr_ok pane focus --pane "$CURRENT_PANE_ID" --direction "$dir"
			break
		fi
	done
	log_launch existing
	exit 0
}

scan_tab_for_editor
if [[ "$EDITOR_FOUND" == "true" ]]; then
	use_existing_editor
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
		log_launch split - "${_SOCKET_PATH:--}"
		exit 0
	fi
fi

# Settle re-check before splitting: a concurrent invocation may have
# split moments ago and its nvim has not reached the pane's foreground
# processes yet (the 27 ms incident shape). Wait briefly and re-scan
# once — a late-appearing editor wins over a duplicate split.
if [[ "$SCAN_ERROR" != "true" ]]; then
	sleep 0.3
	scan_tab_for_editor
	if [[ "$EDITOR_FOUND" == "true" ]]; then
		use_existing_editor
	fi
fi

# No existing editor — launch a new vertical split
SPLIT_JSON=$(herdr_json pane split --current --direction right --cwd "$CWD" --focus)
NEW_PANE_ID=$(echo "$SPLIT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('pane',{}).get('pane_id',''))" 2>/dev/null || echo "")

if [[ -z "$NEW_PANE_ID" ]]; then
	echo "Could not create split pane."
	log_launch failed
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
		log_launch failed "$NEW_PANE_ID" "${_SOCKET_PATH:--}"
		exit 1
	fi
else
	if herdr_ok pane run "$NEW_PANE_ID" $ENV_PREFIX $EDITOR_CMD $LISTEN_ARGS; then
		echo "Launched $EDITOR_CMD in a vertical split (pane $NEW_PANE_ID) at $CWD."
	else
		echo "Failed to launch $EDITOR_CMD in pane $NEW_PANE_ID."
		log_launch failed "$NEW_PANE_ID" "${_SOCKET_PATH:--}"
		exit 1
	fi
fi

# Every launch is attributable: record this one before finishing.
log_launch split "$NEW_PANE_ID" "${_SOCKET_PATH:--}"

# Print the listen socket path if created, so the agent knows where it is.
if [[ -n "${_SOCKET_PATH:-}" ]]; then
	echo "Listen socket: $_SOCKET_PATH"
fi
