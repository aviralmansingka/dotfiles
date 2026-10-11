#!/usr/bin/env bash
# Offline Octo-cluster Neovim regression suite (CI test-surface plan).
#
# Paths: nvim/.config/nvim/lua/plugins/octo.lua nvim/.config/nvim/lua/plugins/octo/**
#
# Runs the octo specs under `nvim --headless -u NONE` through the shared
# offline harness (nvim/tests/ci/harness.lua): no plugin bootstrap, no
# network, no live gh/GitQL, no stowed config resolution. Every stub is
# installed before the module loads (house pattern A7).
#
# Dual mode: without nvim the entry SKIPs with a message and exits 0;
# STRICT=1 turns the missing binary into a FAIL.
#
# SLA: the whole entry stays under 60 s and each spec under 5 s.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"

# --- nvim discovery: PATH first, then bob fallbacks (mirrors test-nvim-headless)
find_nvim() {
  if command -v nvim >/dev/null 2>&1; then
    command -v nvim
    return 0
  fi
  local bob_nvim="$HOME/.local/share/bob/nightly/bin/nvim"
  if [[ -x "$bob_nvim" ]]; then
    printf '%s\n' "$bob_nvim"
    return 0
  fi
  local bob_stable="$HOME/.local/share/bob/v0.12.2/bin/nvim"
  if [[ -x "$bob_stable" ]]; then
    printf '%s\n' "$bob_stable"
    return 0
  fi
  return 1
}

nvim_bin="$(find_nvim || true)"
if [[ -z "$nvim_bin" ]]; then
  if [[ "${STRICT:-0}" == "1" ]]; then
    echo "test-nvim-octo: STRICT=1 and nvim not found on PATH or in ~/.local/share/bob" >&2
    exit 1
  fi
  echo "SKIP test-nvim-octo: nvim not found on PATH or in ~/.local/share/bob (set STRICT=1 to fail)"
  exit 0
fi

export NVIM_TEST_CONFIG_ROOT="$config_root"
export LC_ALL=C

now_ms() {
  local t
  t="$(date +%s%N 2>/dev/null || true)"
  if [[ -n "$t" && "$t" != *N ]]; then
    echo $((t / 1000000))
    return 0
  fi
  t="$(perl -MTime::HiRes=time -e 'printf "%.0f\n", time()*1000' 2>/dev/null || true)"
  if [[ -n "$t" ]]; then
    echo "$t"
    return 0
  fi
  echo $((SECONDS * 1000))
}

spec_sla_ms=5000
case_timeout=20
run_prefix=()
if command -v timeout >/dev/null 2>&1; then
  run_prefix=("timeout" "$case_timeout")
fi

specs=()
while IFS= read -r file; do
  specs+=("$file")
done < <(find "$config_root/tests/ci" -name 'octo*_spec.lua' | sort)

if [[ ${#specs[@]} -eq 0 ]]; then
  echo "test-nvim-octo: no octo*_spec.lua found under $config_root/tests/ci" >&2
  exit 1
fi

passed=0
failed=0
results=()
run_case() {
  local file="$1" label="$2"
  local start end ms rc=0 out=""
  start="$(now_ms)"
  out="$(TZ=UTC env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
    "+luafile $file" '+qa!' 2>&1)" || rc=$?
  end="$(now_ms)"
  ms=$((end - start))
  if [[ $rc -ne 0 ]]; then
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, exit $rc)")
    echo "--- $label FAILED (exit $rc) ---"
    printf '%s\n' "$out" | tail -n 20
  elif [[ "$out" != *"PASS "* ]]; then
    # nvim exits 0 even when a luafile chunk errors: require the PASS marker.
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, no PASS marker)")
    echo "--- $label FAILED (no PASS marker; case did not complete) ---"
    printf '%s\n' "$out" | tail -n 20
  elif (( ms > spec_sla_ms )); then
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, spec SLA > ${spec_sla_ms} ms)")
    echo "--- $label FAILED (spec SLA: ${ms} ms > ${spec_sla_ms} ms) ---"
  else
    passed=$((passed + 1))
    results+=("ok   $label (${ms} ms)")
  fi
}

total_start="$(now_ms)"

for file in "${specs[@]}"; do
  run_case "$file" "$(basename "$file" .lua)"
done

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-octo: $passed passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"
printf '  %s\n' "${results[@]}"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-octo: FAILED" >&2
  exit 1
fi
if (( total_ms > 60000 )); then
  echo "test-nvim-octo: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
