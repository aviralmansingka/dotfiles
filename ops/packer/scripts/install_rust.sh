#!/bin/bash
set -euo pipefail

echo "==> Installing Rust via rustup"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

echo "==> Installing eza"
cargo install eza

echo "==> Installing bob-nvim"
cargo install bob-nvim

echo "==> Installing neovim nightly via bob"
echo "    HOME=$HOME, USER=$(whoami)"
echo "    XDG_DATA_HOME=${XDG_DATA_HOME:-unset}"
ls -la "$HOME/.local/share/bob/" 2>&1 || true
export XDG_DATA_HOME="$HOME/.local/share"
mkdir -p "$HOME/.local/share/bob/downloads"
"$HOME/.cargo/bin/bob" use nightly
