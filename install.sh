#!/bin/bash

# Dotfiles installation script
# Dependencies are managed centrally in dependencies.yml
# Brewfile is automatically generated from dependencies.yml via scripts/generate-brewfile.sh

####################
#      Brew        #
####################

# Install all dependencies from Brewfile (generated from dependencies.yml)
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
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Move configuration files
rm -rf ~/.zshrc
stow zsh

####################
#      NeoVim      #
####################

cargo install bob-nvim
bob use nightly

# Move configuration files
stow lazyvim

####################
#      NeoVim      #
####################
