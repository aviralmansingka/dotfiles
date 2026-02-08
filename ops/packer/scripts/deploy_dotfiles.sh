#!/bin/bash
set -euo pipefail

DOTFILES_DIR="$HOME/dotfiles"

echo "==> Cloning dotfiles"
git clone https://github.com/aviralmansingka/dotfiles.git "$DOTFILES_DIR"

echo "==> Removing conflicting files"
rm -f "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_logout" "$HOME/.profile"

echo "==> Deploying dotfiles via stow"
stow -d "$DOTFILES_DIR" -t "$HOME" zsh
stow -d "$DOTFILES_DIR" -t "$HOME" tmux
stow -d "$DOTFILES_DIR" -t "$HOME" nvim
stow -d "$DOTFILES_DIR" -t "$HOME" starship

# NOTE: git config is stowed in cleanup.sh (after shell plugin installs)
# because it contains url.insteadOf that rewrites HTTPS to SSH
