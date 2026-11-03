#!/usr/bin/env bash
# Behaviour-only check for --part-size.
#
# Drives the public CLI: the flag must exist, reject out-of-range values with a
# clear message, accept a legal value, and the repository's own suite must stay
# green. No module constant or helper name is asserted.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
fail() { echo "CHECK FAIL: $*"; exit 1; }
# Restore the repository's own test files from the base commit: the graded
# contract is the base suite plus the behaviour below, so deleting or weakening
# tests cannot help.
git checkout HEAD -- tests/ 2>/dev/null || true

PY=(uv run --offline --python 3.14 --no-project python -c 'import sys;from rack_bench.cli import main;sys.exit(main())')

"${PY[@]}" bench internet --help 2>&1 | grep -q -- '--part-size' || fail "--part-size is not in the CLI surface"

for bad in 4 513 0 -1; do
  out=$("${PY[@]}" bench internet --providers s3 --part-size "$bad" 2>&1); rc=$?
  [ "$rc" -ne 0 ] || fail "--part-size $bad was accepted"
  printf '%s' "$out" | grep -q -- '--part-size' || fail "--part-size $bad failed without naming the flag: $out"
done

out=$("${PY[@]}" bench internet --providers s3 --part-size 64 2>&1) || fail "a legal --part-size was rejected: $out"
printf '%s' "$out" | grep -q 'SKIP' || fail "the run did not reach the credential gate with --part-size 64: $out"

out=$("${PY[@]}" bench internet --providers s3 2>&1) || fail "the default (no --part-size) run failed: $out"
printf '%s' "$out" | grep -q 'SKIP' || fail "the default run did not reach the credential gate"

uv run --offline --python 3.14 --no-project python -m unittest discover -s tests -q >/tmp/part-size-suite.log 2>&1 \
  || { tail -20 /tmp/part-size-suite.log; fail "the repository suite is red"; }

echo "CHECK PASS: --part-size exists, validates 8..512 with a clear message, accepts legal values and the suite is green"
