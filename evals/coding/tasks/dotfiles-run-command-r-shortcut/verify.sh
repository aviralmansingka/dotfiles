#!/usr/bin/env bash
# Verification for dotfiles-run-command-r-shortcut.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Gold test from the task's final commit: red at base_commit, green when the
# behaviour the brief asks for exists.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout 350fa9c1e1632687b6def21c1cc71d458bcc9e45 -- pi/.pi/agent/extensions/run-command.test.mjs || exit 1

# Environment shim: these August tests predate the shared jiti helper and pin the
# author's homebrew path. Point them at the local pi install instead.
jiti_root=$(ls -d "$HOME"/.pi/agent/install/releases/*/node_modules/jiti 2>/dev/null | tail -1)
if [ -n "${jiti_root:-}" ]; then
  perl -pi -e "s#/opt/homebrew/lib/node_modules/\@earendil-works/pi-coding-agent/node_modules/jiti#$jiti_root#g" pi/.pi/agent/extensions/run-command.test.mjs
fi

node --test pi/.pi/agent/extensions/run-command.test.mjs || exit 1

echo "VERIFY PASS: dotfiles-run-command-r-shortcut"
