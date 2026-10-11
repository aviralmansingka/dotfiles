#!/bin/bash
set -euo pipefail

# Dotfiles installation script for macOS
# Mirrors the provisioning pipeline in ops/packer/scripts/ adapted for macOS+Homebrew:
#   1. System packages (Homebrew)
#   2. CLI tools not in Homebrew (Claude Code, OpenCode)
#   3. Rust toolchain + cargo tools
#   4. Dotfiles deployment via stow
#   5. Shell plugins (Oh My Zsh, zsh plugins, TPM)
#   6. Terminfo
#   7. Git config (deferred to avoid SSH URL rewrite during installs)
#   8. Git hooks

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
#  2. CLI tools    #
####################
# Tools not available in Homebrew

echo "==> Installing Claude Code"
curl -fsSL https://claude.ai/install.sh | bash

echo "==> Installing OpenCode"
curl -fsSL https://opencode.ai/install | bash

if ! command -v herdr >/dev/null 2>&1; then
    echo "==> Installing Herdr"
    curl -fsSL https://herdr.dev/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Mermaid rendering tooling, mirroring ops/packer/scripts/install_cli_tools.sh:
#   - mmdflux: pi mermaid-extension gates + nvim <leader>mm float. Pinned
#     release binary (the Homebrew tap needs `brew trust` for untrusted taps,
#     which breaks unattended installs). ~/.local/bin is the first candidate
#     path in pi's mermaid extension and mermaid.corpus.mjs.
#   - grok-mermaid: nvim inline mermaid render (npm root -g lookup).
MMDFLUX_VERSION=v2.6.1
if ! command -v mmdflux >/dev/null 2>&1; then
    echo "==> Installing mmdflux ${MMDFLUX_VERSION} (pinned release binary)"
    case "$(uname -m)" in
        arm64) MMDFLUX_ASSET="darwin-arm64" ;;
        x86_64) MMDFLUX_ASSET="darwin-x86_64" ;;
        *) MMDFLUX_ASSET="" ;;
    esac
    if [[ -n "$MMDFLUX_ASSET" ]]; then
        curl -fsSL -o /tmp/mmdflux.tar.gz "https://github.com/kevinswiber/mmdflux/releases/download/mmdflux-${MMDFLUX_VERSION}/mmdflux-${MMDFLUX_VERSION}-${MMDFLUX_ASSET}.tar.gz"
        tar xzf /tmp/mmdflux.tar.gz -C /tmp mmdflux
        mkdir -p "$HOME/.local/bin"
        install -m 0755 /tmp/mmdflux "$HOME/.local/bin/mmdflux"
        rm -f /tmp/mmdflux.tar.gz /tmp/mmdflux
    else
        echo "    no mmdflux prebuilt for $(uname -m); skipping"
    fi
fi

echo "==> Installing grok-mermaid (nvim inline mermaid engine)"
npm install -g grok-mermaid

####################
#  3. Rust         #
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
#  4. Stow         #
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
stow -d "$DOTFILES_DIR" -t "$HOME" gh-dash
stow -d "$DOTFILES_DIR" -t "$HOME" tuicr
stow -d "$DOTFILES_DIR" -t "$HOME" agents
"$DOTFILES_DIR/scripts/pi-settings-sync"
stow -d "$DOTFILES_DIR" -t "$HOME" pi
stow -d "$DOTFILES_DIR" -t "$HOME" herdr
if command -v omarchy >/dev/null 2>&1; then
    stow -d "$DOTFILES_DIR" -t "$HOME" omarchy
fi

echo "==> Installing Pi extension dependencies"
npm ci --ignore-scripts --no-fund --no-audit \
    --prefix "$DOTFILES_DIR/pi/.pi/agent/extensions/web-fetch"

echo "==> Installing gh-dash extension"
if command -v gh >/dev/null 2>&1; then
    gh extension install dlvhdr/gh-dash 2>/dev/null || true
fi

# Every herdr-dependent step sits behind one guard: on a host without
# herdr (e.g. a partial install, or the section-2 installer failed
# silently) these would abort under set -e (C36).
if command -v herdr >/dev/null 2>&1; then
    echo "==> Installing Herdr agent integrations"
    herdr integration install pi
    if command -v codex >/dev/null 2>&1; then
        herdr integration install codex
    fi

    echo "==> Installing pinned Herdr Flash"
    herdr plugin install youguanxinqing/herdr-flash \
        --ref f18645409965ebd5617dac9153925b826272e3e5 --yes
    flash_root="$(herdr plugin list --plugin youguanxinqing.herdr-flash --json | jq -er '.result.plugins[0].plugin_root')"
    [[ -x "$flash_root/bin/herdr-flash" ]] || {
        echo "Herdr Flash installation failed" >&2
        exit 1
    }

    echo "==> Installing Herdr Annotate and the protected custom reviewer"
    "$DOTFILES_DIR/scripts/install-herdr-annotate"
else
    echo "==> Herdr not found; skipping Herdr integrations (pi, codex, Flash, annotate)"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
    stow -d "$DOTFILES_DIR" -t "$HOME" launchd
    echo "==> Installing pinned No Mistakes and reconciling its LaunchAgent"
    "$DOTFILES_DIR/scripts/install-no-mistakes"
fi

echo "==> Installing the no-mistakes Herdr bridge (visible step agents)"
"$DOTFILES_DIR/scripts/install-nm-herdr-bridge" ||
    echo "==> no-mistakes Herdr bridge not installed (its installer failed; continuing)"

# Optional Linux-only systemd units
if command -v systemctl >/dev/null 2>&1; then
    stow -d "$DOTFILES_DIR" -t "$HOME" systemd
fi

####################
#  5. Shell plugins #
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
#  6. Terminfo     #
####################

if command -v tic &> /dev/null; then
    echo "==> Installing custom terminfo entries"
    mkdir -p ~/.terminfo
    tic -x -w "$DOTFILES_DIR/terminfo/xterm-ghostty.terminfo"
fi

####################
#  7. Git config   #
####################
# Mirrors: ops/packer/scripts/cleanup.sh
# Deferred to avoid SSH URL rewrite during installs

echo "==> Deploying git config (deferred to avoid SSH URL rewrite during installs)"
stow -d "$DOTFILES_DIR" -t "$HOME" git

####################
#  8. Git hooks    #
####################

echo "==> Installing git hooks"
ln -sf "$DOTFILES_DIR/scripts/hooks/pre-commit" "$DOTFILES_DIR/.git/hooks/pre-commit"

echo "==> Installation complete!"
