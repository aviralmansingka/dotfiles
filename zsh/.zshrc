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
  catimg
)

source $ZSH/oh-my-zsh.sh

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

mvim() {
  emulate -L zsh
  local remote_host="modal-dev"
  local remote_cwd='~/modal'
  local remote_sock='/tmp/nvim-modal.sock'
  local ctl_path="$HOME/.ssh/mvim-$$.ctl"
  local local_sock="/tmp/mvim-$$.sock"

  trap '
    [ -e "'"$ctl_path"'" ] && ssh -S "'"$ctl_path"'" -O exit "'"$remote_host"'" 2>/dev/null
    rm -f "'"$local_sock"'"
  ' EXIT INT TERM

  ssh -fN -M -S "$ctl_path" "$remote_host" || {
    echo "mvim: failed to connect to $remote_host" >&2
    return 1
  }

  if ! ssh -S "$ctl_path" "$remote_host" "[ -S '$remote_sock' ]" 2>/dev/null; then
    echo "mvim: no session at $remote_sock, starting one in $remote_cwd"
    ssh -S "$ctl_path" "$remote_host" \
      "cd $remote_cwd && nohup env LANG=C.UTF-8 LC_ALL=C.UTF-8 nvim --headless --listen '$remote_sock' >/dev/null 2>&1 &" || {
      echo "mvim: failed to start remote nvim" >&2
      return 1
    }
    local tries=0
    while (( tries < 30 )); do
      ssh -S "$ctl_path" "$remote_host" "[ -S '$remote_sock' ]" 2>/dev/null && break
      sleep 0.1
      (( tries++ ))
    done
    if (( tries >= 30 )); then
      echo "mvim: remote nvim did not produce socket $remote_sock in time" >&2
      return 1
    fi
  fi

  [ -S "$local_sock" ] && rm -f "$local_sock"
  ssh -S "$ctl_path" -O forward -L "$local_sock:$remote_sock" "$remote_host" || {
    echo "mvim: failed to set up socket forward" >&2
    return 1
  }

  nvim --server "$local_sock" --remote-ui
}

# CMake-built Neovim from this checkout (sets VIMRUNTIME + NVIM_GHOSTTY_VT); see scripts/run-built-nvim.sh.
alias dvim='$HOME/tools/neovim/scripts/run-built-nvim.sh'

alias rg='rg --hidden'
alias ls='eza --icons -l'
alias inv='uv run inv'

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
export TERM="xterm-256color"
# Pi uses COLORTERM to decide whether to emit 24-bit colors under SSH/tmux.
export COLORTERM="truecolor"
export EDITOR="bob run stable"
export FZF_DEFAULT_COMMAND='rg --hidden --ignore .git -g ""'
export DISABLE_AUTO_TITLE=true

export PATH="$HOME/bin:$PATH"
export PATH="/usr/local/bin:$PATH"
export PATH="/opt/homebrew/Cellar:$PATH"
export PATH="/opt/brew/bin:$PATH"
export PATH="/usr/local/go/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.bun/bin:$PATH"
export PATH="$HOME/.opencode/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"

# cuda
export CUDA_HOME=/usr/local/cuda
export PATH=$CUDA_HOME/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH

eval "$(starship init zsh)"
eval "$(zoxide init zsh)"
eval "$(direnv hook zsh)"

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

