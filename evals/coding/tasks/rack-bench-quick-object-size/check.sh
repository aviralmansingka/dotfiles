#!/usr/bin/env bash
# Behaviour check for the quick-profile object size and --object-size knob.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
fail() { echo "CHECK FAIL: $*"; exit 1; }
# Restore the base tests, except the files this task legitimately has to update
# (the base suite hardcodes the old 1 GiB quick object size).
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -f "$here/tests-updatable.txt" ]; then
  keep=$(grep -vxF -f "$here/tests-updatable.txt" < <(git ls-files tests/) || true)
  # shellcheck disable=SC2086
  [ -n "$keep" ] && git checkout HEAD -- $keep 2>/dev/null || true
else
  git checkout HEAD -- tests/ 2>/dev/null || true
fi
PY=(uv run --offline --python 3.14 --no-project python -c 'import sys;from rack_bench.cli import main;sys.exit(main())')

help=$("${PY[@]}" bench internet --help 2>&1) || fail "bench internet --help failed"
printf '%s' "$help" | grep -q -- '--object-size' || fail "--object-size is not in the CLI surface"
printf '%s' "$help" | grep -q '32' || fail "the quick-profile default size (32 MiB) is not stated in --help"

for bad in 0 -1; do
  out=$("${PY[@]}" bench internet --providers s3 --object-size "$bad" 2>&1)
  [ $? -ne 0 ] || fail "--object-size $bad was accepted"
  printf '%s' "$out" | grep -q -- '--object-size' || fail "--object-size $bad failed without naming the flag"
done

out=$("${PY[@]}" bench internet --providers s3 --object-size 128 2>&1) || fail "a legal --object-size was rejected: $out"
printf '%s' "$out" | grep -q 'SKIP' || fail "the run did not reach the credential gate with --object-size 128: $out"

out=$("${PY[@]}" bench internet --providers s3 2>&1) || fail "the default run failed: $out"
printf '%s' "$out" | grep -q 'SKIP' || fail "the default run did not reach the credential gate"

uv run --offline --python 3.14 --no-project python -m unittest discover -s tests -q >/tmp/quick-size-suite.log 2>&1 \
  || { tail -20 /tmp/quick-size-suite.log; fail "the repository suite is red"; }

echo "CHECK PASS: --object-size exists with the 32 MiB quick default, validates input, and the suite is green"
