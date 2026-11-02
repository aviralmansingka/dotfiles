#!/usr/bin/env bash
# Verification for dotfiles-opengateway-provider.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Grading combines the repo tests shipped by the task final commit (checked out as gold)
# with checks written for this eval; see the header of each check for what it measures.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout e974e6610459736a5d8463243e5cbeaa566f0303 -- pi/.pi/agent/extensions/opengateway.test.mjs || exit 1

node --test pi/.pi/agent/extensions/opengateway.test.mjs || exit 1
grep -q '"+extensions/opengateway.ts"' pi/.pi/agent/settings.json || exit 1

echo "VERIFY PASS: dotfiles-opengateway-provider"
