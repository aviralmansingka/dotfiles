#!/usr/bin/env bash
# Verification for dotfiles-remove-fix-code-remote.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

if grep -rn "fix-code\|fix_code\|fixcode" . --exclude-dir=.git --exclude=.git; then echo 'FAIL: expected no matches/errors'; exit 1; fi
if grep -rn "extensions/remote.ts\|remote.test.mjs\|ci-tests/remote.md" . --exclude-dir=.git --exclude=.git; then echo 'FAIL: expected no matches/errors'; exit 1; fi
if grep -rn '"+extensions/remote.ts"' pi/.pi/agent/settings.json; then echo 'FAIL: expected no matches/errors'; exit 1; fi
node -e 'JSON.parse(require("fs").readFileSync("pi/.pi/agent/settings.json","utf8"))' || exit 1
node scripts/test-extension-loader.mjs || exit 1

echo "VERIFY PASS: dotfiles-remove-fix-code-remote"
