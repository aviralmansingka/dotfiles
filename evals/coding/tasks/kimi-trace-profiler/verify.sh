#!/usr/bin/env bash
# Behaviour-only verification for kimi-trace-profiler.
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 1

bash "$here/check.sh" || exit 1

echo "VERIFY PASS: kimi-trace-profiler"
