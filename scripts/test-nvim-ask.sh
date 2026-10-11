#!/usr/bin/env bash
# Offline headless-Neovim suite for the sidekick ask/edit inline pipeline.
# Paths: nvim/.config/nvim/lua/plugins/sidekick/ask/**
#
# Runs the ask-pipeline specs under `nvim --headless -u NONE`: no plugin
# bootstrap, no network, no live pi process (cli.spawn and vim.system are
# stubbed inside the specs), no real spinner timers (vim.uv.new_timer is
# faked). Cases load the WORKTREE copy of the config via
# NVIM_TEST_CONFIG_ROOT / the shared tests/ci/harness.lua.
#
# Dual mode: when nvim is missing the entry SKIPs (exit 0) by default and
# FAILs when STRICT=1, so CI lanes without a nvim binary stay green while
# a strict lane still catches a broken toolchain.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"

# --- nvim discovery: PATH first, then the pinned 0.13-dev, then bob -----
find_nvim() {
  if command -v nvim >/dev/null 2>&1; then
    command -v nvim
    return 0
  fi
  local pinned="$HOME/.local/bin/nvim"
  if [[ -x "$pinned" ]]; then
    printf '%s\n' "$pinned"
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
    echo "test-nvim-ask: FAILED (STRICT=1): nvim not found on PATH, ~/.local/bin, or bob" >&2
    exit 1
  fi
  echo "test-nvim-ask: SKIP (nvim not found; set STRICT=1 to make this a failure)"
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

case_timeout=30
run_prefix=()
if command -v timeout >/dev/null 2>&1; then
  run_prefix=("timeout" "$case_timeout")
fi

# The ask-pipeline cases, explicitly listed (this entry owns exactly these).
cases=(
  ask_diff_spec.lua
  ask_state_spec.lua
  ask_signs_spec.lua
  ask_pipeline_spec.lua
  ask_context_ui_spec.lua
)

passed=0
failed=0
skipped=0
results=()
run_case() {
  local file="$1" label="$2"
  if [[ ! -f "$file" ]]; then
    skipped=$((skipped + 1))
    results+=("skip $label (spec file missing)")
    return 0
  fi
  local start end ms rc=0 out=""
  start="$(now_ms)"
  out="$(env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
    "+luafile $file" '+qa!' 2>&1)" || rc=$?
  end="$(now_ms)"
  ms=$((end - start))
  if [[ $rc -ne 0 ]]; then
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, exit $rc)")
    echo "--- $label FAILED (exit $rc) ---"
    printf '%s\n' "$out" | tail -n 25
  elif [[ "$out" != *"PASS "* ]]; then
    # nvim exits 0 even when a luafile chunk errors: require the PASS marker.
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, no PASS marker)")
    echo "--- $label FAILED (no PASS marker; case did not complete) ---"
    printf '%s\n' "$out" | tail -n 25
  else
    passed=$((passed + 1))
    results+=("ok   $label (${ms} ms)")
  fi
}

total_start="$(now_ms)"

for name in "${cases[@]}"; do
  run_case "$config_root/tests/ci/$name" "$name"
done

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-ask: $passed passed, $failed failed, $skipped skipped, total ${total_ms} ms (nvim: $nvim_bin)"
printf '  %s\n' "${results[@]}"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-ask: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt 60000 ]]; then
  echo "test-nvim-ask: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
