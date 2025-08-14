export ZSH=~/.oh-my-zsh

# Install zsh if not present
if [ ! -d $ZSH ]; then
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

export XDG_CONFIG_HOME="$HOME/.config"
export TERM="xterm-256color"
export EDITOR="nvim"
export FZF_DEFAULT_COMMAND='ag --hidden --ignore .git -g ""'
export DISABLE_AUTO_TITLE=true

export AWS_USER_NAME=`whoami`

export PATH=$HOME/bin:/usr/local/bin:$PATH
export PATH="$PATH:/snap/bin"
export PATH="/opt/homebrew/Cellar:$PATH"
export PATH="$HOME/scripts/local/python:$PATH"
export PATH="$HOME/scripts/local/shell:$PATH"
export PATH="$(go env GOPATH)/bin:$PATH"
export PATH="/opt/homebrew/opt/kubernetes-cli@1.22/bin:$PATH"
export PATH="/opt/homebrew/opt/awscli@1/bin:$PATH"
export PATH="/opt/brew/bin:$PATH"

alias k="kubectl"
alias kg="kubectl get"
alias kgp="kubectl get pods"
alias kgs="kubectl get services"
alias kgd="kubectl get deployments"
alias ka="kubectl apply"
alias kpf="kubectl port-forward"

DISABLE_AUTO_TITLE="true"

plugins=(
	git
	zsh-syntax-highlighting
	zsh-autosuggestions
	extract
	colored-man-pages
	sudo
	history
	catimg
	pip
	python
  poetry
)

source $ZSH/oh-my-zsh.sh


alias claude="$HOME/.claude/local/claude"
alias vim='nvim'
alias rg='rg --hidden'
alias ls='eza --icons -l'
alias k='kubernetes'
alias kx='kubectx'

alias mux='tmuxinator'
alias luamake='~/.config/lua-language-server/3rd/luamake/luamake'

export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"

# Created by `pipx` on 2024-07-24 14:36:47
export PATH="$PATH:$HOME/.local/bin"

# pyenv
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

# cuda
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH

# .local/bin
export PATH="/home/$USER/.local/bin:$PATH"

# opencode
export PATH=$PATH:$HOME/.opencode/bin
eval "$(starship init zsh)"
eval "$(zoxide init zsh)"
eval "$(direnv hook zsh)"


# bun completions
[ -s "/Users/aviralmansingka/.bun/_bun" ] && source "/Users/aviralmansingka/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# opencode
export PATH=/Users/aviralmansingka/.opencode/bin:$PATH

alias claude="/Users/aviralmansingka/.claude/local/claude"
