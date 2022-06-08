# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
tput cup $LINES
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

export ZSH=~/.oh-my-zsh

# Install zsh if not present
if [ ! -d $ZSH ]; then
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

export XDG_CONFIG_HOME="$HOME/.config"
export TERM="screen-256color"
export EDITOR="nvim"
export FZF_DEFAULT_COMMAND='ag --hidden --ignore .git -g ""'

export AWS_USER_NAME=`whoami`
export KUBECONFIG=$KUBECONFIG:$HOME/.kube/config

export PATH=$HOME/bin:/usr/local/bin:$PATH
export PATH="/opt/homebrew/Cellar:$PATH"
export PATH="$HOME/scripts/local/python:$PATH"
export PATH="$HOME/scripts/local/shell:$PATH"
export PATH="$(go env GOPATH)/bin:$PATH"
export PATH="$HOME/Library/Python/3.8/bin:$PATH"
export PATH="/opt/homebrew/opt/kubernetes-cli@1.22/bin:$PATH"
export PATH="/opt/homebrew/opt/awscli@1/bin:$PATH"
export PATH="/opt/brew/bin:$PATH"

ZSH_THEME="powerlevel10k/powerlevel10k"
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
)

source $ZSH/oh-my-zsh.sh


# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

alias vim='nvim'
alias rg='rg --hidden'
alias ls='exa --icons -l'
alias z='zoxide'
alias k='kubernetes'

alias mux='tmuxinator'
alias luamake='~/.config/lua-language-server/3rd/luamake/luamake'

eval "$(zoxide init zsh)"
