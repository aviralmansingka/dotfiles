#!/usr/bin/env bash
# devbox sandbox entrypoint — link persistent state, then serve sshd.
#
# Passed as the Sandbox CMD by ops/modal-devbox/devbox.py. The container
# filesystem is disposable: only /persist (the Volume v2) survives. Mutable
# $HOME state moves onto the volume on first boot; later boots re-link and
# the volume copy wins over image-baked copies.
#
# DEVBOX_SSH_PUBLIC_KEY arrives via a per-launch ephemeral Secret. Host keys
# are generated per sandbox (fresh each start): connect with
# StrictHostKeyChecking=accept-new.
set -euo pipefail

PERSIST=/persist

link_dir() {
    # link_dir <home-path> <persist-path>
    if [ -L "$1" ]; then
        return 0
    fi
    if [ -e "$2" ]; then
        rm -rf "$1"                          # volume wins over image-baked copy
    elif [ -e "$1" ]; then
        mkdir -p "$(dirname "$2")"
        mv "$1" "$2"                         # first boot: seed the volume
    else
        mkdir -p "$2"
    fi
    mkdir -p "$(dirname "$1")"
    ln -s "$2" "$1"
}

link_file() {
    # link_file <home-path> <persist-path>
    if [ -L "$1" ]; then
        return 0
    fi
    if [ ! -e "$2" ]; then
        if [ -e "$1" ]; then
            mv "$1" "$2"
        else
            : > "$2"
        fi
    fi
    rm -f "$1"
    ln -s "$2" "$1"
}

link_dir "$HOME/.local/share/nvim" "$PERSIST/nvim-share"   # lazy.nvim + mason
link_dir "$HOME/.local/state/nvim"  "$PERSIST/nvim-state"  # shada, undo
link_dir "$HOME/.local/share/bob"   "$PERSIST/nvim-bob"    # nvim installs + bob 'used' marker
link_dir "$HOME/.cache"             "$PERSIST/cache"       # cargo, uv, pip
link_dir "$HOME/repos"              "$PERSIST/repos"       # work checkouts
link_dir "$HOME/vault"             "$PERSIST/vault"       # obsidian.nvim expects ~/vault
link_file "$HOME/.zsh_history"      "$PERSIST/zsh_history" # OMZ HISTFILE default

# Prefer bob's proxy shim: the build links the direct nightly binary, which
# would pin the version. Through the proxy, `bob use <version>` takes effect
# and persists (the used marker lives on the volume with the installs).
if [ -x "$HOME/.local/share/bob/nvim-bin/nvim" ]; then
    ln -sfn "$HOME/.local/share/bob/nvim-bin/nvim" "$HOME/.local/bin/nvim"
fi

# sshd: per-sandbox host keys, key-only root auth from the injected secret.
ssh-keygen -A
mkdir -p /run/sshd "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ -n "${DEVBOX_SSH_PUBLIC_KEY:-}" ]; then
    printf '%s\n' "$DEVBOX_SSH_PUBLIC_KEY" >> "$HOME/.ssh/authorized_keys"
    chmod 600 "$HOME/.ssh/authorized_keys"
fi

exec /usr/sbin/sshd -D -e -o PasswordAuthentication=no
