#!/usr/bin/env bash
# Verification for dotfiles-thinking-hidden-row.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Grading combines the repo tests shipped by the task final commit (checked out as gold)
# with checks written for this eval; see the header of each check for what it measures.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout ce398d1dd9be6caffbd7a66ee7a8248267aa83d1 -- pi/.pi/agent/extensions/thinking-title.test.mjs || exit 1

node --test pi/.pi/agent/extensions/thinking-title.test.mjs || exit 1

echo "VERIFY PASS: dotfiles-thinking-hidden-row"
