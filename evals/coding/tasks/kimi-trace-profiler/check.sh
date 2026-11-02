#!/usr/bin/env bash
# Behaviour check for the trace profiler.
#
# Builds a private HOME holding one synthetic Codex rollout plus one pi session
# with known token counts, runs the analyzer over it, and asserts it reports
# those totals. No real user traces are read, so the result is deterministic.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
fail() { echo "CHECK FAIL: $*"; exit 1; }
PY=(uv run --offline --python 3.14 --no-project python)
TOOL=analysis_profile_traces.py
[ -f "$TOOL" ] || fail "$TOOL does not exist"

home=$(mktemp -d); trap 'rm -rf "$home"' EXIT
mkdir -p "$home/.codex/sessions/2026/11/03" "$home/.pi/agent/sessions/--test--"
day=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$home/.codex/sessions/2026/11/03/rollout-fixture.jsonl" <<JSON
{"timestamp":"$day","type":"session_meta","payload":{"cwd":"/tmp/fixture","timestamp":"$day"}}
{"timestamp":"$day","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"analyse the repo"}]}}
{"timestamp":"$day","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}}
{"timestamp":"$day","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000,"output_tokens":200,"cached_input_tokens":600},"total_token_usage":{"input_tokens":1000,"output_tokens":200,"cached_input_tokens":600},"model_context_window":100000}}}
JSON

cat > "$home/.pi/agent/sessions/--test--/fixture.jsonl" <<JSON
{"type":"message","message":{"role":"user","content":"profile these traces"}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"profiled"}]}}
JSON

out="$home/out"
HOME="$home" timeout 120 "${PY[@]}" "$TOOL" --days 4000 --output "$out" >/tmp/profiler-run.log 2>&1 \
  || { tail -5 /tmp/profiler-run.log; fail "the analyzer failed on a synthetic trace set"; }

count=$(find "$out" -type f 2>/dev/null | wc -l | tr -d ' ')
[ "$count" -ge 1 ] || fail "the analyzer wrote no report under --output"

blob=$(find "$out" -type f -exec cat {} +)
printf '%s' "$blob" | grep -q '1000' || fail "the report never states the fixture's input token total (1000)"
printf '%s' "$blob" | grep -q '200' || fail "the report never states the fixture's output token total (200)"
printf '%s' "$blob" | grep -Eq 'turn|session' || fail "the report carries neither turn nor session statistics"

echo "CHECK PASS: analyzer ran on a synthetic trace set and reported the known token totals ($count report files)"
