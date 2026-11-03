#!/usr/bin/env bash
# Verification for rack-bench-gcs-provider.
#
# Usage:  cd <worktree of the task repo> && bash <path>/verify.sh
# The graded spec is the task final commit: gold test files are checked out from it
# first, so a plain checkout of base_commit is red and a correct solution is green.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

git checkout 8c8008b5689aa20e923532a39bf1bbed7e365ad6 -- tests/test_bench.py tests/test_bench_internet_latency.py tests/test_bench_internet_path.py tests/test_bench_internet_transfer.py tests/test_bench_s3client.py || exit 1

# The suite carries one known pre-existing flake (a loaded-GET at_seconds race):
# run it twice before calling it red.
ok=0
for attempt in 1 2; do
  if uv run --offline --python 3.14 --no-project python -m unittest discover -s tests -q; then ok=1; break; fi
  echo "attempt ${attempt} failed; retrying once"
done
[ "$ok" = 1 ] || exit 1

echo "VERIFY PASS: rack-bench-gcs-provider"
