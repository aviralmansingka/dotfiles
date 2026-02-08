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

echo "==> Installing custom terminfo entries"
mkdir -p "$HOME/.terminfo"
tic -x -w "$DOTFILES_DIR/terminfo/xterm-ghostty.terminfo"

echo "==> Installing Neovim plugins via lazy.nvim"
# Use the actual nvim binary directly instead of the bob proxy, which fails
# with "Couldn't create downloads directory" when run from a copied .local tree
NVIM_BIN=$(find "$HOME/.local/share/bob" -name nvim -path "*/bin/nvim" ! -path "*/nvim-bin/*" 2>/dev/null | head -1)
if [ -z "$NVIM_BIN" ]; then
  echo "ERROR: Could not find nvim binary under ~/.local/share/bob/"
  ls -laR "$HOME/.local/share/bob/" || true
  exit 1
fi
echo "    Using nvim at: $NVIM_BIN"
"$NVIM_BIN" --headless "+Lazy! sync" +qa

# NOTE: git config is stowed in cleanup.sh (after shell plugin installs)
# because it contains url.insteadOf that rewrites HTTPS to SSH
