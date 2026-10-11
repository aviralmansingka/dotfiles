#!/usr/bin/env bash
# Offline headless-Neovim suite for the send orchestration cluster:
# agent_send resolve/send sequencing and fallback, term_send chan delivery,
# and the sidekick view_focus queue/patch core. Every external boundary
# (herdr CLI, Snacks terminal, sidekick Terminal/Session, channels) is
# stubbed through the shared nvim/tests/ci harness — no network, no live
# herdr or tmux, no stowed ~/.config resolution.
# Paths: nvim/.config/nvim/lua/plugins/herdr/agent_send.lua nvim/.config/nvim/lua/plugins/herdr-agent.lua nvim/.config/nvim/lua/plugins/herdr/term_send.lua nvim/.config/nvim/lua/plugins/sidekick/view_focus.lua
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"

# --- nvim discovery: PATH first, then bob fallbacks (mirrors verify-nvim)
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
    echo "test-nvim-send: FAILED — nvim not found and STRICT=1" >&2
    exit 1
  fi
  echo "test-nvim-send: SKIP — nvim not found (set STRICT=1 to make this a failure)"
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

passed=0
failed=0
results=()
run_case() {
  local file="$1" label="$2"
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
    printf '%s\n' "$out" | tail -n 20
  elif [[ "$out" != *"PASS "* ]]; then
    # nvim exits 0 even when a luafile chunk errors: require the PASS marker.
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, no PASS marker)")
    echo "--- $label FAILED (no PASS marker; case did not complete) ---"
    printf '%s\n' "$out" | tail -n 20
  else
    passed=$((passed + 1))
    results+=("ok   $label (${ms} ms)")
  fi
}

total_start="$(now_ms)"

run_case "$config_root/tests/ci/send_orchestration_spec.lua" "send_orchestration_spec"
run_case "$config_root/tests/ci/herdr_term_send_spec.lua" "herdr_term_send_spec"
run_case "$config_root/tests/ci/sidekick_view_focus_spec.lua" "sidekick_view_focus_spec"

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-send: $passed passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"
printf '  %s\n' "${results[@]}"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-send: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt 60000 ]]; then
  echo "test-nvim-send: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
