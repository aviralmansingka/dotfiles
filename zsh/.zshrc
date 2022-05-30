# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
tput cup $LINES
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:/usr/local/bin:$PATH
export JDTLS_HOME=$HOME/.local/share/nvim/lsp_servers/jdtls

export XDG_CONFIG_HOME="$HOME/.config"

# CHANGE THIS FOR DIFFERENT MACHINES
# Path to your oh-my-zsh installation.

export ZSH=~/.oh-my-zsh

# Install zsh if not present
if [ ! -d $ZSH ]; then
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

export AWS_USER_NAME=aviralmansingka
export TERM="screen-256color"

export KUBECONFIG=$KUBECONFIG:$HOME/.kube/config

alias vim='nvim'
alias rg='rg --hidden'
export EDITOR="nvim"

ZSH_THEME="powerlevel10k/powerlevel10k"

export FZF_DEFAULT_COMMAND='ag --hidden --ignore .git -g ""'

alias notifyDone='terminal-notifier -title "iTerm2" -message "Done with task!"'
alias mux='tmuxinator'

export PATH="/opt/homebrew/Cellar:$PATH"
export PATH="$HOME/scripts/local/python:$PATH"
export PATH="$HOME/scripts/local/shell:$PATH"
export PATH=$PATH:$(go env GOPATH)/bin
export PATH="$HOME/Library/Python/3.8/bin:$PATH"
export PATH="/opt/homebrew/opt/kubernetes-cli@1.22/bin:$PATH"
export DISABLE_AUTO_TITLE="true"

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

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/Users/aviralmansingka/opt/miniconda3/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/Users/aviralmansingka/opt/miniconda3/etc/profile.d/conda.sh" ]; then
        . "/Users/aviralmansingka/opt/miniconda3/etc/profile.d/conda.sh"
    else
        export PATH="/Users/aviralmansingka/opt/miniconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

export PATH="/opt/brew/bin:$PATH"

alias luamake=/Users/aviralmansingka/.config/lua-language-server/3rd/luamake/luamake

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh
export PATH="/opt/homebrew/opt/awscli@1/bin:$PATH"
export PATH="/opt/homebrew/opt/kubernetes-cli@1.22/bin:$PATH"
