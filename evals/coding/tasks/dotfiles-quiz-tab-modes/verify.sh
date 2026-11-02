#!/usr/bin/env bash
# Verification for dotfiles-quiz-tab-modes.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Gold test from the task's final commit: red at base_commit, green when the
# behaviour the brief asks for exists.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout ec1965d1b88bd485578ccfd7b6c1a1c31f930bda -- pi/.pi/agent/extensions/user-input/input-modes.test.mjs || exit 1

# Environment shim: these August tests predate the shared jiti helper and pin the
# author's homebrew path. Point them at the local pi install instead.
jiti_root=$(ls -d "$HOME"/.pi/agent/install/releases/*/node_modules/jiti 2>/dev/null | tail -1)
if [ -n "${jiti_root:-}" ]; then
  perl -pi -e "s#/opt/homebrew/lib/node_modules/\@earendil-works/pi-coding-agent/node_modules/jiti#$jiti_root#g" pi/.pi/agent/extensions/user-input/input-modes.test.mjs
fi

node --test pi/.pi/agent/extensions/user-input/input-modes.test.mjs || exit 1

echo "VERIFY PASS: dotfiles-quiz-tab-modes"
