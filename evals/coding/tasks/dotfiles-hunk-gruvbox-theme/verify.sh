#!/usr/bin/env bash
# Verification for dotfiles-hunk-gruvbox-theme.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# Grading combines the repo tests shipped by the task final commit (checked out as gold)
# with checks written for this eval; see the header of each check for what it measures.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

# Property check authored for this eval (tomllib, stdlib only).
uv run --offline --python 3.14 --no-project python "$here/check.py" || exit 1

echo "VERIFY PASS: dotfiles-hunk-gruvbox-theme"
