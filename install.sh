#!/usr/bin/env bash
# Fleet bootstrap. Two roles only:
#
#   1. bootstrap Nix when it is absent, and
#   2. run stow for this repository's file packages, with the stow binary the
#      deployed profile provides.
#
# Every package and service install lives in the flake: see flake.nix and
# docs/nix-profiles.md. Homebrew keeps applications, casks and fonts, and its
# command (`brew bundle --file Brewfile`) is a documented separate step that
# this script does not run.
#
# Usage:
#   ./install.sh                 # bootstrap Nix, deploy the local profile, stow
#   ./install.sh --stow-only     # skip the profile switch (stow already present)
#   SKIP_DEPLOY=1 ./install.sh   # bootstrap Nix and stow without switching
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
STOW_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --stow-only) STOW_ONLY=1 ;;
        -h | --help)
            sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "install.sh: unknown argument $arg" >&2
            exit 2
            ;;
    esac
done

####################
#  1. Nix          #
####################
# The only install that can run before Nix exists.

if ! command -v nix >/dev/null 2>&1; then
    echo "==> Installing Nix (multi-user daemon)"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        # Determinate Nix is the supported installer on current macOS; it keeps
        # /nix writable by the daemon and enables flakes by default.
        curl -fsSL https://install.determinate.systems/nix | sh -s -- install macos --no-confirm
    else
        curl -fsSL https://install.determinate.systems/nix | sh -s -- install linux --init none --no-confirm
    fi
    for profile in /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh \
        "$HOME/.nix-profile/etc/profile.d/nix.sh"; do
        # shellcheck disable=SC1090
        [[ -f "$profile" ]] && . "$profile" && break
    done
fi

if ! command -v nix >/dev/null 2>&1; then
    echo "install.sh: Nix is still missing after the installer; open a new shell and rerun" >&2
    exit 1
fi

# Flakes are the only interface this repo uses.
mkdir -p "$HOME/.config/nix"
if ! grep -qs 'experimental-features' "$HOME/.config/nix/nix.conf"; then
    echo "experimental-features = nix-command flakes" >> "$HOME/.config/nix/nix.conf"
fi
export NIX_CONFIG="${NIX_CONFIG:-experimental-features = nix-command flakes}"

####################
#  2. Profile      #
####################
# The profile switch is what installs every package and every user service.

if [[ "$STOW_ONLY" = 0 && "${SKIP_DEPLOY:-0}" != 1 ]]; then
    case "$(uname -s)" in
        Darwin) PROFILE=macbook ;;
        *) PROFILE=remote ;;
    esac
    echo "==> Deploying the $PROFILE profile"
    "$DOTFILES_DIR/scripts/nix-deploy" "$PROFILE" local
else
    echo "==> Skipping the profile switch (stow-only run)"
fi

####################
#  3. Stow         #
####################
# Files are not a package: stow links them. The binary comes from the profile
# (home-manager installs it); install it into the profile only when the first
# switch has not happened yet.

if ! command -v stow >/dev/null 2>&1 && [[ ! -x "$HOME/.nix-profile/bin/stow" ]]; then
    echo "==> Installing stow into the Nix profile"
    nix profile install nixpkgs#stow
fi
export PATH="$HOME/.nix-profile/bin:$PATH"

echo "==> Removing conflicting files"
# ~/.zshenv and ~/.zshrc are absent on purpose: Home Manager writes both from
# the profile, and deleting them here would leave the login shell without the
# environment the switch just installed.
rm -f "$HOME/.bashrc" "$HOME/.bash_logout" "$HOME/.profile"

echo "==> Deploying dotfiles via stow"
# The list lives in scripts/stow-packages so the deploy script links the same
# set. `agents` must precede `pi` (settings materialize between them) and `git`
# must come last.
stow_list() {
    local f
    for f in $@; do
        grep -vE '^\s*(#|$)' "$f" | while read -r pkg; do
            printf '%s\n' "$pkg"
        done
    done
}

for pkg in $(stow_list "$DOTFILES_DIR/scripts/stow-packages"); do
    case "$pkg" in
    pi)
        # Pi has no user-local overlay, so its settings are materialized from
        # the repo base plus the live local preferences.
        if [[ -x "$DOTFILES_DIR/scripts/pi-settings-sync" ]]; then
            "$DOTFILES_DIR/scripts/pi-settings-sync"
        fi
        stow -d "$DOTFILES_DIR" -t "$HOME" "$pkg"
        ;;
    git)
        # Deferred to the end: git's url.insteadOf rewrites HTTPS to SSH, and an
        # early rewrite breaks the installer-style fetches a fresh host may
        # still need.
        echo "==> Deploying git config"
        stow -d "$DOTFILES_DIR" -t "$HOME" "$pkg"
        ;;
    *) stow -d "$DOTFILES_DIR" -t "$HOME" "$pkg" ;;
    esac
done

if [[ "$(uname -s)" == "Darwin" ]]; then
    for pkg in $(stow_list "$DOTFILES_DIR/scripts/stow-packages-darwin"); do
        stow -d "$DOTFILES_DIR" -t "$HOME" "$pkg"
    done
fi

####################
#  4. gh dash      #
####################
# The gh binary comes from the profile or the Brewfile; the extension does
# not, and the stowed gh-dash config is useless without `gh dash`.

if command -v gh >/dev/null 2>&1; then
    echo "==> Installing the GitHub CLI extension"
    gh extension list 2>/dev/null | grep -q 'dlvhdr/gh-dash' || gh extension install dlvhdr/gh-dash || true
fi

echo "==> Bootstrap complete"
echo "    Applications, casks and fonts: brew bundle --file \"$DOTFILES_DIR/Brewfile\""
echo "    Offline checks:                 scripts/test-nix-deploy.sh"
