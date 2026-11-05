export ZSH=$HOME/.oh-my-zsh

# Install zsh if not present
if [ ! -d $ZSH ]; then
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

DISABLE_AUTO_TITLE="true"

plugins=(
  zsh-syntax-highlighting
  zsh-autosuggestions
  git
  extract
  colored-man-pages
  history
)

source $ZSH/oh-my-zsh.sh

# Inside nvim :term, disable ZLE bracketed paste: nvim's terminal input layer
# throttles PTY writes and can stall mid-marker; when the gap exceeds ZLE's
# KEYTIMEOUT the torn marker leaks a literal '~'. With BP off, nvim's vim.paste
# override (nvim/.config/nvim/lua/config/options.lua) sends pastes raw.
# Trade-off: multi-line pastes execute line-by-line.
if [[ -n $NVIM ]]; then
  unset zle_bracketed_paste
fi

vim() {
  if [ -n "$TMUX" ]; then
    local session=$(tmux display-message -p '#S')
    local window=$(tmux display-message -p '#W')
    local sock="/tmp/nvim-${session}-${window}.sock"
    [ -S "$sock" ] && rm -f "$sock"
    bob run nightly --listen "$sock" "$@"
  else
    bob run nightly "$@"
  fi
}


alias rg='rg --hidden'
alias ls='eza --icons -l'
alias inv='uv run inv'
alias ghd='gh dash'

# Pi: also send copies via OSC 52 after the local clipboard write. Covers
# remote Herdr attaches that reach pi without SSH variables.
export PI_CLIPBOARD_OSC52=1

# Copy text/URLs into OSC52 clipboard (works in terminals that allow it)
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

export XDG_CONFIG_HOME="$HOME/.config"
# Pin a safe TERM outside tmux and rex (the #21 leak class), but leave TERM
# alone inside panes: tmux sets tmux-256color and rex sets xterm-rex there,
# and overriding either breaks the pane's truecolor/clipboard contract.
[[ -z "$TMUX" && -z "$REX_SESSION" ]] && export TERM="xterm-256color"
# Pi uses COLORTERM to decide whether to emit 24-bit colors under SSH/tmux.
export COLORTERM="truecolor"
export EDITOR="bob run stable"
export FZF_DEFAULT_COMMAND='rg --hidden --ignore .git -g ""'

# The Nix user profile owns the current Nix. It must win over /usr/bin/nix, which
# a distribution package can leave behind at an older release.
[ -d "$HOME/.nix-profile/bin" ] && export PATH="$HOME/.nix-profile/bin:$PATH"
export PATH="$HOME/bin:$PATH"
export PATH="/usr/local/bin:$PATH"
export PATH="/usr/local/go/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.bun/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"

# cuda
export CUDA_HOME=/usr/local/cuda
export PATH=$CUDA_HOME/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH

# command -v guards: a missing tool must never break or spam shell startup.
command -v starship >/dev/null 2>&1 && eval "$(starship init zsh)"
command -v zoxide >/dev/null 2>&1 && eval "$(zoxide init zsh)"
command -v direnv >/dev/null 2>&1 && eval "$(direnv hook zsh)"

export HOMEBREW_NO_AUTO_UPDATE=1

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"

# The next line updates PATH for the Google Cloud SDK.
if [ -f "$HOME/google-cloud-sdk/path.zsh.inc" ]; then . "$HOME/google-cloud-sdk/path.zsh.inc"; fi

# The next line enables shell command completion for gcloud.
if [ -f "$HOME/google-cloud-sdk/completion.zsh.inc" ]; then . "$HOME/google-cloud-sdk/completion.zsh.inc"; fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion


# Added by Windsurf
export PATH="/Users/aviral/.codeium/windsurf/bin:$PATH"
