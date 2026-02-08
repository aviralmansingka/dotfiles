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
# bob-nvim checks SUDO_USER to resolve home dir; under sudo -iu this is
# the invoking user (ubuntu), not the target user. Unset it so bob falls
# through to USER/HOME which are set correctly by sudo -iu.
unset SUDO_USER
"$HOME/.cargo/bin/bob" use nightly
