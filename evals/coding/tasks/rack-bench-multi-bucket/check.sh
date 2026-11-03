#!/usr/bin/env bash
# Behaviour-only check for multiple buckets per provider.
#
# The brief lets the agent pick the syntax, so this accepts any form that the
# public CLI parses without the old "duplicate bucket" rejection, and requires
# the repository's own suite to stay green.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
fail() { echo "CHECK FAIL: $*"; exit 1; }
# Restore the repository's own test files from the base commit: the graded
# contract is the base suite plus the behaviour below, so deleting or weakening
# tests cannot help.
git checkout HEAD -- tests/ 2>/dev/null || true

PY=(uv run --offline --python 3.14 --no-project python -c 'import sys;from rack_bench.cli import main;sys.exit(main())')

accepted=""
for form in "repeat" "comma"; do
  if [ "$form" = repeat ]; then
    out=$("${PY[@]}" bench internet --providers s3 --buckets s3=bench-a --buckets s3=bench-b 2>&1)
  else
    out=$("${PY[@]}" bench internet --providers s3 --buckets s3=bench-a,s3=bench-b 2>&1)
  fi
  rc=$?
  if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -qi 'duplicate bucket'; then
    printf '%s' "$out" | grep -q 'SKIP' || fail "$form form parsed but never reached the credential gate: $out"
    accepted="$form"
    break
  fi
done
[ -n "$accepted" ] || fail "no CLI form declares two buckets for one provider (tried repeated --buckets and a repeated provider inside one list)"

single=$("${PY[@]}" bench internet --providers s3 --buckets s3=bench-a 2>&1) || fail "the single-bucket form regressed: $single"

uv run --offline --python 3.14 --no-project python -m unittest discover -s tests -q >/tmp/multi-bucket-suite.log 2>&1 \
  || { tail -20 /tmp/multi-bucket-suite.log; fail "the repository suite is red"; }

echo "CHECK PASS: multiple buckets accepted via $accepted form, single-bucket unchanged, suite green"
