#!/usr/bin/env bash
# Verification for dotfiles-fast-command.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout 0b7051406cb953bdc7d9fff208d99ac6cb35e93b -- pi/.pi/agent/extensions/fast-mode.test.mjs || exit 1

node --test pi/.pi/agent/extensions/fast-mode.test.mjs || exit 1
node scripts/test-extension-loader.mjs || exit 1

echo "VERIFY PASS: dotfiles-fast-command"
