#!/usr/bin/env bash
# Verification for dotfiles-nm-visible-pane.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Gold test from the task's final commit: red at base_commit, green when the
# behaviour the brief asks for exists.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout 4c780d6229186ed67368b5a23f72f1e0fcd27331 -- pi/.pi/agent/extensions/no-mistakes-pane.test.mjs || exit 1

# Environment shim: these August tests predate the shared jiti helper and pin the
# author's homebrew path. Point them at the local pi install instead.
jiti_root=$(ls -d "$HOME"/.pi/agent/install/releases/*/node_modules/jiti 2>/dev/null | tail -1)
if [ -n "${jiti_root:-}" ]; then
  perl -pi -e "s#/opt/homebrew/lib/node_modules/\@earendil-works/pi-coding-agent/node_modules/jiti#$jiti_root#g" pi/.pi/agent/extensions/no-mistakes-pane.test.mjs
fi

node --test pi/.pi/agent/extensions/no-mistakes-pane.test.mjs || exit 1

echo "VERIFY PASS: dotfiles-nm-visible-pane"
