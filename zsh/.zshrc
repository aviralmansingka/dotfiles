export ZSH=$HOME/.oh-my-zsh

# Install zsh if not present
if [ ! -d $ZSH ]; then
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

DISABLE_AUTO_TITLE="true"

plugins=(
  zsh-syntax-highlighting
  zsh-autosuggestions
  extract
  colored-man-pages
  history
  catimg
)

source $ZSH/oh-my-zsh.sh

alias vim='nvim'
alias rg='rg --hidden'
alias ls='eza --icons -l'
alias claude="${HOME}/.claude/local/claude"

export XDG_CONFIG_HOME="$HOME/.config"
export TERM="xterm-ghostty"
export EDITOR="nvim"
export FZF_DEFAULT_COMMAND='rg --hidden --ignore .git -g ""'
export DISABLE_AUTO_TITLE=true

export PATH="$HOME/bin:$PATH"
export PATH="/usr/local/bin:$PATH"
export PATH="/opt/homebrew/Cellar:$PATH"
export PATH="/opt/brew/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.bun/bin:$PATH"
export PATH="$HOME/.opencode/bin:$PATH"

# cuda
export CUDA_HOME=/usr/local/cuda
export PATH=$CUDA_HOME/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH

eval "$(starship init zsh)"
eval "$(zoxide init zsh)"
eval "$(direnv hook zsh)"

export HOMEBREW_NO_AUTO_UPDATE=1
source $HOME/modal/venv/bin/activate

# bun completions
[ -s "/Users/aviralmansingka/.bun/_bun" ] && source "/Users/aviralmansingka/.bun/_bun"
