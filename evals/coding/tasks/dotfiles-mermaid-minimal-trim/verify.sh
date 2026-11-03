#!/usr/bin/env bash
# Verification for dotfiles-mermaid-minimal-trim.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout 75579fbf46b990edfe9b587677e4075d9dd023b7 -- pi/.pi/agent/extensions/mermaid.test.mjs || exit 1

node --test pi/.pi/agent/extensions/mermaid.test.mjs || exit 1

echo "VERIFY PASS: dotfiles-mermaid-minimal-trim"
