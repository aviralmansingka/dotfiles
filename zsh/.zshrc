# The shell's scaffolding belongs to the profile:
# nix/modules/shared/default.nix enables programs.zsh (oh-my-zsh with the
# plugin set this file used to list), programs.starship, programs.zoxide,
# programs.direnv and programs.fzf, holds the aliases in
# programs.zsh.shellAliases, and installs this file as ~/.zshrc with
# builtins.readFile. So ZSH, the plugins array, the oh-my-zsh source line,
# DISABLE_AUTO_TITLE, the four aliases and the three tool init lines
# (starship, zoxide, direnv) all live in that module now. What stays here is
# text with no declarative form: two shell functions, the bracketed-paste
# guard, and the TERM pin.

# Inside nvim :term, disable ZLE bracketed paste: nvim's terminal input layer
# throttles PTY writes and can stall mid-marker; when the gap exceeds ZLE's
# KEYTIMEOUT the torn marker leaks a literal '~'. With BP off, nvim's vim.paste
# override (nvim/.config/nvim/lua/config/options.lua) sends pastes raw.
# Trade-off: multi-line pastes execute line-by-line.
if [[ -n $NVIM ]]; then
  unset zle_bracketed_paste
fi

# `nvim` is the profile's neovim (home.packages in
# nix/modules/shared/default.nix); no version manager sits in front of it.
# Inside tmux the editor gets one --listen socket per session+window, so
# `nvim --server <sock> --remote ...` from a pane reuses that instance.
vim() {
  if [ -n "$TMUX" ]; then
    local session=$(tmux display-message -p '#S')
    local window=$(tmux display-message -p '#W')
    local sock="/tmp/nvim-${session}-${window}.sock"
    [ -S "$sock" ] && rm -f "$sock"
    nvim --listen "$sock" "$@"
  else
    nvim "$@"
  fi
}

# Copy text/URLs into OSC52 clipboard (works in terminals that allow it). Pi
# copies the same way after its local clipboard write (the variable is
# home.sessionVariables.PI_CLIPBOARD_OSC52 in the profile), which covers a
# remote Herdr attach that reaches pi without SSH variables.
osc52-copy() {
  local text
  if (( $# > 0 )); then
    text="${*}"
  else
    text="$(cat)"
  fi

  text=${text//$'\r'/}
  text=${text//$'\n'/}
  if [[ -z "$text" ]]; then
    echo "Usage: osc52-copy '<text>' or pipe text into stdin"
    return 1
  fi

  local b64
  b64=$(printf '%s' "$text" | base64 | tr -d '\n')
  printf '\033]52;c;%s\007' "$b64"
}

# Pin a safe TERM outside tmux and rex (the #21 leak class), but leave TERM
# alone inside panes: tmux sets tmux-256color and rex sets xterm-rex there,
# and overriding either breaks the pane's truecolor/clipboard contract.
[[ -z "$TMUX" && -z "$REX_SESSION" ]] && export TERM="xterm-256color"

# bun completions. bun is a host install under ~/.bun (the profile only puts
# ~/.bun/bin on PATH). if-form, not `[ -s ] &&`: a failed test as the last
# command would make an explicit `source ~/.zshrc` exit non-zero on a host
# without the file.
if [ -s "$HOME/.bun/_bun" ]; then source "$HOME/.bun/_bun"; fi
