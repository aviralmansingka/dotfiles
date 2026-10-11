#!/bin/bash
set -euo pipefail

echo "==> Installing Oh My Zsh"
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

echo "==> Removing Oh My Zsh generated .zshrc and restoring stowed version"
rm -f "$HOME/.zshrc"
cd "$HOME/dotfiles"
stow -R -t "$HOME" zsh

echo "==> Installing zsh plugins"
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"

# TPM is not cloned here: .tmux.conf self-bootstraps it into
# ~/.local/share/tmux/plugins (TMUX_PLUGIN_MANAGER_PATH) on first load.
