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
mkdir -p "$HOME/.local/share/bob/downloads"
"$HOME/.cargo/bin/bob" use nightly
