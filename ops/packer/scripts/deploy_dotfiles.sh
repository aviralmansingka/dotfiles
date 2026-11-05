#!/bin/bash
set -euo pipefail

DOTFILES_DIR="$HOME/dotfiles"

echo "==> Cloning dotfiles"
git clone https://github.com/aviralmansingka/dotfiles.git "$DOTFILES_DIR"

echo "==> Removing conflicting files"
rm -f "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_logout" "$HOME/.profile"

# Every stowable component for this OS, mirroring install.sh's macOS list.
# Linux ships everything except the mac-only packages (ghostty, aerospace,
# launchd). git is NOT stowed here: cleanup.sh stows it last, after the
# shell plugin installs, because it contains url.insteadOf that rewrites
# HTTPS to SSH and would break those installs' git clones.
LINUX_STOW_PACKAGES="zsh tmux nvim starship gh-dash tuicr agents pi herdr systemd"

echo "==> Materializing pi settings (base + local merge)"
"$DOTFILES_DIR/scripts/pi-settings-sync"

echo "==> Deploying dotfiles via stow"
for pkg in $LINUX_STOW_PACKAGES; do
    stow -d "$DOTFILES_DIR" -t "$HOME" "$pkg"
done

echo "==> Installing pi extension dependencies (web-fetch)"
npm ci --ignore-scripts --no-fund --no-audit \
    --prefix "$DOTFILES_DIR/pi/.pi/agent/extensions/web-fetch"

echo "==> Installing rataflow-view (live node-graph viewer)"
cargo install --path "$DOTFILES_DIR/rataflow" --locked

echo "==> Installing gh-dash extension"
if command -v gh >/dev/null 2>&1; then
    gh extension install dlvhdr/gh-dash 2>/dev/null || true
fi

if command -v herdr >/dev/null 2>&1; then
    echo "==> Installing Herdr agent integrations"
    herdr integration install pi
    if command -v codex >/dev/null 2>&1; then
        herdr integration install codex
    fi
fi

echo "==> Installing custom terminfo entries"
mkdir -p "$HOME/.terminfo"
tic -x -w "$DOTFILES_DIR/terminfo/xterm-ghostty.terminfo"

echo "==> Installing Neovim plugins via lazy.nvim"
# The editor itself comes from the Nix profile, so this provisioning step
# only syncs plugins and skips when nvim is not installed yet.
if command -v nvim >/dev/null 2>&1; then
  echo "    Using nvim at: $(command -v nvim)"
  nvim --headless "+Lazy! sync" +qa
else
  echo "    nvim not on PATH: skipping the lazy.nvim sync"
fi

# NOTE: git config is stowed in cleanup.sh (after shell plugin installs)
# because it contains url.insteadOf that rewrites HTTPS to SSH
