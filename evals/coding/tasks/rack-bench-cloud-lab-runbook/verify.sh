#!/usr/bin/env bash
# Behaviour-only verification for rack-bench-cloud-lab-runbook.
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

bash "$here/check.sh" || exit 1

echo "VERIFY PASS: rack-bench-cloud-lab-runbook"
