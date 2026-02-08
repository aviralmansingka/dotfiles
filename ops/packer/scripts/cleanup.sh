#!/bin/bash
set -euo pipefail

echo "==> Deploying git config (deferred to avoid SSH URL rewrite during installs)"
stow -d "$HOME/dotfiles" -t "$HOME" git

echo "==> Setting zsh as default shell"
sudo chsh -s "$(which zsh)" aviralmansingka

echo "==> Cleaning up apt cache"
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*

echo "==> Cleaning up temp files"
sudo rm -rf /tmp/* /var/tmp/*

echo "==> Provisioning complete"
