#!/usr/bin/env bash
# Verification for rack-bench-part-size.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout 4e212312c4633af4e6a6f3491804cc49e7880d3e -- tests/test_bench.py tests/test_bench_internet_transfer.py || exit 1

# The suite carries one known pre-existing flake (a loaded-GET at_seconds race):
# run it twice before calling it red.
ok=0
for attempt in 1 2; do
  if uv run --offline --python 3.14 --no-project python -m unittest discover -s tests -q; then ok=1; break; fi
  echo "attempt ${attempt} failed; retrying once"
done
[ "$ok" = 1 ] || exit 1

echo "VERIFY PASS: rack-bench-part-size"
