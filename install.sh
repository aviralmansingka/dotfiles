#!/bin/bash

# Install all dependencies from Brewfile
brew bundle

# Get developer essentials
stow aws git gradle pip ssh

# Setup kitty
stow kitty

# Install oh-my-zsh
rm -rf ~/.oh-my-zsh
sh -c "RUNZSH='no' KEEP_ZSHRC='yes' $(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Install plugins
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

rm -rf ~/.zshrc
stow zsh

# Install tmux package manager
rm -rf ~/.tmux
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
stow tmux

# Tooling for go development
go install golang.org/x/tools/gopls@latest
go install golang.org/x/tools/cmd/goimports@latest

# Set up EDITOR
python3 -m pip install pynvim
npm i -g neovim
stow nvim
