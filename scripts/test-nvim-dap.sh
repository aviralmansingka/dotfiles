#!/usr/bin/env bash
# DAP eval-helper regression suite (nvim CI cluster B).
# Paths: nvim/.config/nvim/lua/plugins/dap.lua
#
# Runs nvim/tests/ci/dap_eval_spec.lua under `nvim --headless -u NONE` via
# the shared offline harness: no plugin bootstrap, no Mason, no network, no
# real debugger session. The spec pins the eval-helper symbols through the
# real module closures (H.upvalue) — this is the test that would have
# blocked the #27 merge-clobber (an accidental revert shipped inside #24)
# and guards the #23 E565 duplicate-setup class plus the #29 java STRINGIFY
# wrapper.
#
# Dual-mode (PR #293 rule):
#   default : nvim missing prints SKIP and exits 0.
#   STRICT=1: nvim missing FAILs (CI can pin a nightly).
#
# SLA: whole entry < 60 s, each spec < 5 s. Exit non-zero on any FAIL.
# Offline and deterministic: no network, no $HOME mutation, no sleeps.

set -uo pipefail

STRICT="${STRICT:-0}"

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
  if [[ "$STRICT" == "1" ]]; then
    echo "test-nvim-dap: FAIL — nvim not found on PATH or in ~/.local/share/bob (STRICT=1)" >&2
    exit 127
  fi
  echo "test-nvim-dap: SKIP — nvim not found (set STRICT=1 to make this a failure)"
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

spec_timeout=30
entry_sla_ms=60000
spec_sla_ms=5000

run_prefix=()
if command -v timeout >/dev/null 2>&1; then
  run_prefix=("timeout" "$spec_timeout")
fi

passed=0
failed=0
results=()

run_spec() {
  local file="$1" label="$2"
  local start end ms rc=0 out=""
  start="$(now_ms)"
  out="$(env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
    "+luafile $file" '+qa!' 2>&1)" || rc=$?
  end="$(now_ms)"
  ms=$((end - start))

  # nvim exits 0 even when a luafile chunk errors: require the PASS marker
  # and treat any FAIL line (harness writes them to stderr) as failure.
  # (The harness print() joins args with a tab — squeeze whitespace runs
  # to single spaces before matching.)
  local clean
  clean="$(printf '%s' "$out" | tr -s '[:space:]' ' ')"
  local spec_failed=0
  if [[ $rc -ne 0 ]]; then
    spec_failed=1
    results+=("FAIL $label (${ms} ms, exit $rc)")
  elif [[ "$clean" != *"PASS $label"* ]]; then
    spec_failed=1
    results+=("FAIL $label (${ms} ms, no PASS marker — case did not complete)")
  elif [[ "$clean" == *"FAIL "* ]]; then
    spec_failed=1
    results+=("FAIL $label (${ms} ms, harness reported a failing case)")
  elif [[ $ms -gt $spec_sla_ms ]]; then
    spec_failed=1
    results+=("FAIL $label (${ms} ms, SLA breach — each spec must stay under 5 s)")
  else
    results+=("ok   $label (${ms} ms)")
  fi

  if [[ $spec_failed -ne 0 ]]; then
    failed=$((failed + 1))
    echo "--- $label FAILED ---"
    printf '%s\n' "$out" | tail -n 30
  else
    passed=$((passed + 1))
    # Surface the per-case PASS lines (each H.run case prints its own).
    printf '%s\n' "$out" | grep '^PASS ' || true
  fi
}

total_start="$(now_ms)"

run_spec "$config_root/tests/ci/dap_eval_spec.lua" "dap_eval_spec"

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-dap: $passed passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"
printf '  %s\n' "${results[@]}"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-dap: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt $entry_sla_ms ]]; then
  echo "test-nvim-dap: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
