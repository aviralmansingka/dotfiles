#!/usr/bin/env bash
# Behaviour check for the agentic load harness.
#
# The brief names the surfaces: five traffic patterns, --list-patterns, a
# dry-run that prints payloads instead of hitting the network, --streaming, and
# a OpenAI-compatible target. This drives those and never needs a server.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
fail() { echo "CHECK FAIL: $*"; exit 1; }
PY=(uv run --offline --python 3.14 --no-project python)
BENCH=bench_agentic.py
[ -f "$BENCH" ] || fail "$BENCH does not exist"

"${PY[@]}" "$BENCH" --help >/tmp/harness-help.log 2>&1 || fail "--help failed"
for flag in --streaming --base-url --concurrency --duration; do
  grep -q -- "$flag" /tmp/harness-help.log || fail "--help does not document $flag"
done

patterns=$("${PY[@]}" "$BENCH" --list-patterns 2>&1) || fail "--list-patterns failed"
for p in shared-prefix multi-turn-growth tool-loop fan-out poisson; do
  printf '%s' "$patterns" | grep -q -- "$p" || fail "pattern $p is not listed by --list-patterns"
done

for p in shared-prefix multi-turn-growth tool-loop fan-out poisson; do
  out=$(timeout 90 "${PY[@]}" "$BENCH" --pattern "$p" --dry-run 2>&1) || fail "--dry-run for $p failed: $(printf '%s' "$out" | tail -3)"
  printf '%s' "$out" | grep -q '[{[]' || fail "--dry-run for $p printed no payload"
done

# No network during a dry run: it must finish quickly with no server present.
start=$(date +%s)
"${PY[@]}" "$BENCH" --pattern poisson --dry-run >/dev/null 2>&1 || fail "--dry-run for poisson failed on the second run"
[ $(( $(date +%s) - start )) -le 90 ] || fail "a dry run took longer than 90 s, so it is not offline"

echo "CHECK PASS: 5 patterns listed, dry-run payloads for each, streaming/base-url knobs documented, offline"
