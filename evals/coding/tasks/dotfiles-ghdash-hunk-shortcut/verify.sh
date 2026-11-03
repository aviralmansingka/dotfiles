#!/usr/bin/env bash
# Behaviour-only verification for dotfiles-ghdash-hunk-shortcut.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Grades what the brief specifies through the public surface (registered tool,
# command, hook, CLI flag or config file) instead of importing helper names from
# the reference implementation. verify-strict.sh keeps the older gold-test
# grader for reference; it is not the score.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

bash "$here/check.sh" || exit 1

echo "VERIFY PASS: dotfiles-ghdash-hunk-shortcut"
