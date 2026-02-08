#!/bin/bash
set -euo pipefail

# Dotfiles installation script for macOS
# Mirrors the provisioning pipeline in ops/packer/scripts/ adapted for macOS+Homebrew:
#   1. System packages (Homebrew)
#   2. Rust toolchain + cargo tools
#   3. Dotfiles deployment via stow
#   4. Shell plugins (Oh My Zsh, zsh plugins, TPM)
#   5. Git config (deferred to avoid SSH URL rewrite during installs)

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

####################
#  1. Homebrew     #
####################

if ! command -v brew &> /dev/null; then
    echo "==> Installing Homebrew"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for the rest of the script
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

echo "==> Installing packages from Brewfile"
brew bundle --file="$DOTFILES_DIR/Brewfile"

####################
#  2. Rust         #
####################
# Mirrors: ops/packer/scripts/install_rust.sh

if ! command -v rustc &> /dev/null; then
    echo "==> Installing Rust via rustup"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

echo "==> Installing cargo tools (eza, bob-nvim)"
cargo install eza
cargo install bob-nvim

echo "==> Installing neovim nightly via bob"
bob use nightly

####################
#  3. Stow         #
####################
# Mirrors: ops/packer/scripts/deploy_dotfiles.sh

echo "==> Removing conflicting files"
rm -f "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_logout" "$HOME/.profile"

echo "==> Deploying dotfiles via stow"
stow -d "$DOTFILES_DIR" -t "$HOME" zsh
stow -d "$DOTFILES_DIR" -t "$HOME" tmux
stow -d "$DOTFILES_DIR" -t "$HOME" nvim
stow -d "$DOTFILES_DIR" -t "$HOME" starship
stow -d "$DOTFILES_DIR" -t "$HOME" ghostty
stow -d "$DOTFILES_DIR" -t "$HOME" aerospace

####################
#  4. Shell plugins #
####################
# Mirrors: ops/packer/scripts/install_shell_plugins.sh

echo "==> Installing Oh My Zsh"
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
    sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
fi

echo "==> Removing Oh My Zsh generated .zshrc and restoring stowed version"
rm -f "$HOME/.zshrc"
stow -R -d "$DOTFILES_DIR" -t "$HOME" zsh

echo "==> Installing zsh plugins"
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
[[ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]] && \
    git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
[[ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]] && \
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"

echo "==> Installing TPM (Tmux Plugin Manager)"
if [[ ! -d "$HOME/.tmux/plugins/tpm" ]]; then
    git clone https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
fi

####################
#  5. Terminfo     #
####################

if command -v tic &> /dev/null; then
    echo "==> Installing custom terminfo entries"
    mkdir -p ~/.terminfo
    tic -x -w "$DOTFILES_DIR/terminfo/xterm-ghostty.terminfo"
fi

####################
#  6. Git config   #
####################
# Mirrors: ops/packer/scripts/cleanup.sh
# Deferred to avoid SSH URL rewrite during installs

echo "==> Deploying git config (deferred to avoid SSH URL rewrite during installs)"
stow -d "$DOTFILES_DIR" -t "$HOME" git

echo "==> Installation complete!"