#!/usr/bin/env bash
# Behaviour-only verification for rack-bench-keepalive-pooling.
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

uv run --offline --python 3.14 --no-project python "$here/check.py" || exit 1

echo "VERIFY PASS: rack-bench-keepalive-pooling"
