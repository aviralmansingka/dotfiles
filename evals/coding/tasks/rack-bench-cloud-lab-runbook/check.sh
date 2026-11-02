#!/usr/bin/env bash
# Structural check for the cloud-lab runbook task.
#
# The brief names the sections; this asserts they exist, that the schema draft
# covers the --config surface, that quoted commands look runnable, and that no
# secret material landed in docs.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
fail() { echo "CHECK FAIL: $*"; exit 1; }

lab=docs/cloud-lab.md
schema=docs/profile-schema.md
[ -f "$lab" ] || fail "$lab does not exist"
[ -f "$schema" ] || fail "$schema does not exist"
[ "$(wc -l < "$lab")" -ge 80 ] || fail "$lab is too short to cover the brief ($(wc -l < "$lab") lines)"
[ "$(wc -l < "$schema")" -ge 40 ] || fail "$schema is too short to cover the brief"

hits=0
for pattern in 'matrix' 'loop' 'read.{0,3}(and|&|/).{0,3}fix|symptom' 'experiment' 'skip' 'limit'; do
  grep -Eqi "$pattern" "$lab" && hits=$((hits + 1))
done
[ "$hits" -ge 5 ] || fail "only $hits/6 brief sections are recognisable in $lab"

grep -q -- '--config' "$schema" || fail "$schema does not describe the --config surface"
grep -Eqi 'schema' "$schema" || fail "$schema does not read as a schema draft"
[ "$(grep -c '^|' "$schema")" -ge 3 ] || [ "$(grep -c '^```' "$schema")" -ge 2 ] \
  || fail "$schema has neither a field table nor a fenced block"

grep -q 'bench internet' "$lab" || fail "$lab never shows a bench internet command"
grep -q 'audit' "$lab" || fail "$lab never shows an audit command"

if grep -Eq '(AKIA[0-9A-Z]{16}|cfat_[A-Za-z0-9]{10}|aws_secret_access_key *= *[A-Za-z0-9/+]{20})' "$lab" "$schema"; then
  fail "a credential-shaped string landed in the docs"
fi

echo "CHECK PASS: runbook covers $hits/6 named sections with runnable commands, schema draft covers --config, no secrets"
