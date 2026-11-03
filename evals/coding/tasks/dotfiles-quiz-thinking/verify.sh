#!/usr/bin/env bash
# Verification for dotfiles-quiz-thinking.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout b3b1eeaa569cf25a59ccf8f4ff0d4e0f7fda27af -- pi/.pi/agent/extensions/md-log.test.mjs pi/.pi/agent/extensions/quiz-result.test.mjs || exit 1

node --test pi/.pi/agent/extensions/md-log.test.mjs pi/.pi/agent/extensions/quiz-result.test.mjs || exit 1

echo "VERIFY PASS: dotfiles-quiz-thinking"
