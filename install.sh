#!/bin/bash

####################
#      Brew        #
####################

# Install all dependencies from Brewfile
brew bundle

# Get developer essentials
stow git

####################
#      Kitty       #
####################

# Move configuration files
stow kitty

####################
#      Tmux        #
####################

# Install tmux package manager
rm -rf ~/.tmux
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm

# Move configuration files
stow tmux

####################
#       Zsh        #
####################

# Install oh-my-zsh
rm -rf ~/.oh-my-zsh
sh -c "RUNZSH='no' KEEP_ZSHRC='yes' $(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Install plugins
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
git clone https://github.com/ptavares/zsh-exa.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-exa

# Move configuration files
rm -rf ~/.zshrc
stow zsh

####################
#      NeoVim      #
####################

# Move configuration files
stow nvim

# Language Servers
brew install \
  lua-language-server \
  luarocks \
  hashicorp/tap/terraform-ls \
  tflint

luarocks install luacheck

go install \
  golang.org/x/tools/gopls@latest \
  golang.org/x/tools/cmd/goimports@latest \
  github.com/grafana/jsonnet-language-server@latest

python3 -m pip install \
  pynvim \
  pyright

npm i -g \
  neovim \
  bash-language-server \
  dockerfile-language-server-nodejs \
  vscode-langservers-extracted \
  @tailwindcss/language-server \
  typescript \
  typescript-language-server \
  yaml-language-server
