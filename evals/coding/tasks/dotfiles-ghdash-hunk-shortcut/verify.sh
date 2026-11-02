#!/usr/bin/env bash
# Verification for dotfiles-ghdash-hunk-shortcut.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Grading combines the repo tests shipped by the task final commit (checked out as gold)
# with checks written for this eval; see the header of each check for what it measures.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout dc8f0bf7ce588d6a22a895f790aa10e5d2773373 -- scripts/test-gh-dash-open-pr.sh || exit 1

bash scripts/test-gh-dash-open-pr.sh || exit 1

# Authored: the brief asks for a shell entry point named ghd.
if ! grep -Eq '(alias +ghd=|^ghd *\(\)|function +ghd)' zsh/.zshrc; then
  echo 'FAIL: no ghd alias or function in zsh/.zshrc'; exit 1
fi
grep -Eq 'alias +ghd=.*gh +dash|^ghd *\(\)|function +ghd' zsh/.zshrc || { echo 'FAIL: ghd does not launch gh dash'; exit 1; }

echo "VERIFY PASS: dotfiles-ghdash-hunk-shortcut"
