#!/usr/bin/env bash
# devbox sandbox entrypoint — link persistent state, then serve sshd.
#
# Passed as the Sandbox CMD by ops/modal-devbox/devbox.py. The container
# filesystem is disposable: only /persist (the Volume v2) survives. Mutable
# $HOME state moves onto the volume on first boot; later boots re-link and
# the volume copy wins over image-baked copies.
#
# DEVBOX_SSH_PUBLIC_KEY arrives via a per-launch ephemeral Secret (applied
# last in the Sandbox secrets list, so it wins any clash with the persistent
# devbox-ssh Secret). Host keys are generated per sandbox (fresh each start):
# connect with StrictHostKeyChecking=accept-new.
set -euo pipefail

# DEVBOX_PERSIST / DEVBOX_SKIP_SSHD exist so the offline suite can execute the
# link semantics in a throwaway tree (no /persist mount, no host-key writes);
# neither is set in a real sandbox.
PERSIST="${DEVBOX_PERSIST:-/persist}"

# Must match devbox.py's STOW_PACKAGES / STOW_PACKAGES_LATE / STOW_IGNORE; the
# offline suite (M21) fails if the two drift.
STOW_IGNORE="--ignore=node_modules --ignore=__pycache__ --ignore=auth.json"
STOW_PACKAGES="zsh tmux nvim starship gh-dash tuicr agents pi herdr aerospace ghostty launchd systemd"
STOW_PACKAGES_LATE="git"

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

# Nothing nvim-owned goes on the volume: /persist is FUSE, its page cache is
# per container, and every fresh sandbox paid seconds re-reading the plugin
# tree, the nvim runtime and lazy.nvim's state through it (measured: first nvim
# start 4.3 s, with the state dir local 1.0 s; steady state 90 ms either way).
# The image already carries plugins, mason tools and the nvim install, so the
# volume copy only added latency. Cost: session-made plugin/mason installs and
# nvim history/undo are per-sandbox — the image is the deploy path (or use
# `devbox snapshot`). Repos, vault and shell history stay on the volume.
link_dir "$HOME/.cache"             "$PERSIST/cache"       # cargo, uv, pip
link_dir "$HOME/repos"              "$PERSIST/repos"       # work checkouts
link_dir "$HOME/vault"             "$PERSIST/vault"       # obsidian.nvim expects ~/vault
link_file "$HOME/.zsh_history"      "$PERSIST/zsh_history" # OMZ HISTFILE default

# A writable dotfiles checkout to edit inside the devbox, and the live stow
# source: everything (pi extensions, agent skills, nvim/tmux/zsh config) is
# linked out of it, so an edit here takes effect on the next session. Seeded
# from the image's pinned clone on first boot, then owned by the volume.
# Backgrounded: copying tens of MB onto the FUSE volume must not delay sshd
# (foreground, it pushed readiness past the wrapper's connect retries).
seed_and_restow() {
    local src="$HOME/repos/dotfiles"
    if [ ! -e "$src" ] && [ -d "$HOME/dotfiles" ]; then
        cp -a "$HOME/dotfiles" "$src" || return 0
    fi
    [ -d "$src/.git" ] || return 0
    command -v stow >/dev/null 2>&1 || return 0
    # auth.json is pi *runtime* state (the devbox-pi-auth secret writes it), not
    # package content; STOW_IGNORE keeps stow from linking a stray copy over it.
    # Unstow the image clone first: stow refuses to take over links it thinks
    # belong to another stow directory. Then link everything from the checkout.
    # git stays last (url.insteadOf rewrites HTTPS to SSH).
    stow -D -d "$HOME/dotfiles" -t "$HOME" $STOW_IGNORE $STOW_PACKAGES >/dev/null 2>&1 || true
    stow -d "$src" -t "$HOME" $STOW_IGNORE $STOW_PACKAGES >/dev/null 2>&1 || true
    stow -d "$src" -t "$HOME" $STOW_IGNORE $STOW_PACKAGES_LATE >/dev/null 2>&1 || true
    # pi's extension deps live per-directory; carry them over when the checkout
    # lacks them (a fresh clone/pull would not have node_modules).
    local ext
    for ext in "$src"/pi/.pi/agent/extensions/*/; do
        [ -f "$ext/package.json" ] || continue
        [ -d "$ext/node_modules" ] && continue
        ( cd "$ext" && npm ci --ignore-scripts --no-fund --no-audit ) >/dev/null 2>&1 || true
    done
    # Re-materialize provider auth: relinking can land auth.json at a fresh path
    # (or the checkout can carry a stale copy), and the secret is still in this
    # process's environment. Cheap and idempotent.
    if [ -n "${DEVBOX_PI_AUTH_JSON:-}" ]; then
        materialize_file "$HOME/.pi/agent/auth.json" DEVBOX_PI_AUTH_JSON
    fi
    # Prewarm Neovim last, once the restow has pointed config at the checkout,
    # so the warm cache covers the paths a session will actually load. This
    # runs in the background subshell; sshd does not wait for it.
    local nvim_bin="$HOME/.local/bin/nvim"
    [ -x "$nvim_bin" ] || nvim_bin="$(command -v nvim 2>/dev/null || true)"
    if [ -n "$nvim_bin" ]; then
        "$nvim_bin" --headless +qa >/dev/null 2>&1 || true
    fi
}
# Seeded + restowed below, after the secret materialization exists (the
# restow must not race the auth.json write).

# Prefer bob's proxy shim: the build links the direct nightly binary, which
# would pin the version. Through the proxy, `bob use <version>` takes effect
# for this sandbox (the install lives on the image, not the volume).
if [ -x "$HOME/.local/share/bob/nvim-bin/nvim" ]; then
    ln -sfn "$HOME/.local/share/bob/nvim-bin/nvim" "$HOME/.local/bin/nvim"
fi

# --- Secrets materialization (phase 2) --------------------------------------
# Modal injects every workspace Secret this Sandbox mounts as env vars into
# the entrypoint process; sshd does NOT pass its environment to SSH sessions,
# so the values are written back to disk here for config parity with the Mac
# (env files and decoded file secrets, all 0600, all container-local — never
# on /persist). The concrete calls are generated by devbox.py from
# ops/modal-devbox/secrets-manifest.json (the single source of truth) and
# spliced over the marker line below at launch; entrypoint.sh ships
# per-launch, so manifest changes need no image rebuild.

materialize_env() {
    # materialize_env <path> <VAR>... — write an env file (export KEY=value).
    # Skipped entirely when no listed variable is set (secret not mounted),
    # so a fresh workspace boots without stray empty files.
    local path="$1"; shift
    local var val found=0 tmp
    tmp="$(mktemp)"
    for var in "$@"; do
        val="${!var:-}"
        [ -n "$val" ] || continue
        printf 'export %s=%q\n' "$var" "$val" >> "$tmp"
        found=1
    done
    if [ "$found" = 1 ]; then
        mkdir -p "$(dirname "$path")"
        mv "$tmp" "$path"
        chmod 600 "$path"
    else
        rm -f "$tmp"
    fi
}

materialize_file() {
    # materialize_file <path> <B64VAR> — decode a base64 payload to <path>.
    local path="$1" var="$2" val
    val="${!var:-}"
    [ -n "$val" ] || return 0
    mkdir -p "$(dirname "$path")"
    printf '%s' "$val" | base64 -d > "$path"
    chmod 600 "$path"
}

#@devbox-materialize@#

# Now that secrets are materialized, seed the writable checkout and restow from
# it (synchronous: the stow is fast, the 32 MB seed happens once). The restow
# re-materializes provider auth itself, because relinking can move that path.
seed_and_restow >/dev/null 2>&1 || true

# GH_TOKEN/GITHUB_TOKEN (devbox-gh -> ~/.config/devbox-env.sh) reach every
# zsh invocation — including non-interactive `ssh host 'cmd'` shells — via
# a guarded include appended to the stowed ~/.zshenv. The stowed file is a
# symlink into the container-local dotfiles clone (disposable, reset each
# sandbox), so the append never touches the repo, the image, or the volume,
# and it stays minimal PATH-only otherwise.
# pi's managed provider auth (devbox-pi-auth) holds the Fireworks key that pi
# itself reads from auth.json. Also export it as FIREWORKS_API_KEY so any other
# tool or SDK in the box picks it up; the value never leaves the container and
# the file is 0600.
if [ -f "$HOME/.pi/agent/auth.json" ] && command -v jq >/dev/null 2>&1; then
    fw_key="$(jq -r '.fireworks.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
    if [ -n "$fw_key" ]; then
        envfile="$HOME/.config/devbox-env.sh"
        mkdir -p "$(dirname "$envfile")"
        touch "$envfile"
        chmod 600 "$envfile"
        grep -v '^export FIREWORKS_API_KEY=' "$envfile" >"$envfile.tmp" 2>/dev/null || : >"$envfile.tmp"
        printf 'export FIREWORKS_API_KEY=%s\n' "$fw_key" >>"$envfile.tmp"
        mv "$envfile.tmp" "$envfile"
        chmod 600 "$envfile"
    fi
fi

if [ -f "$HOME/.config/devbox-env.sh" ] && ! grep -q "devbox-env.sh" "$HOME/.zshenv" 2>/dev/null; then
    printf '\n[ -f "$HOME/.config/devbox-env.sh" ] && source "$HOME/.config/devbox-env.sh"\n' >> "$HOME/.zshenv"
fi

# sshd: per-sandbox host keys, key-only root auth from the injected secret.
if [ "${DEVBOX_SKIP_SSHD:-0}" = 1 ]; then
    exit 0  # test hook: link + materialize done, skip host-key/sshd writes
fi
ssh-keygen -A
mkdir -p /run/sshd "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ -n "${DEVBOX_SSH_PUBLIC_KEY:-}" ]; then
    printf '%s\n' "$DEVBOX_SSH_PUBLIC_KEY" >> "$HOME/.ssh/authorized_keys"
    chmod 600 "$HOME/.ssh/authorized_keys"
fi

# Neovim is prewarmed inside seed_and_restow, after the restow, so the cache
# covers the paths a session actually loads.

exec /usr/sbin/sshd -D -e -o PasswordAuthentication=no
