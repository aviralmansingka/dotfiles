#!/usr/bin/env bash
# Verification for dotfiles-revise-practice.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout c56402636e445761089db599ddd6055190515fa9 -- pi/.pi/agent/extensions/practice.test.mjs pi/.pi/agent/extensions/md-log.test.mjs || exit 1

node --test pi/.pi/agent/extensions/practice.test.mjs pi/.pi/agent/extensions/md-log.test.mjs || exit 1
node scripts/test-extension-loader.mjs || exit 1

echo "VERIFY PASS: dotfiles-revise-practice"
