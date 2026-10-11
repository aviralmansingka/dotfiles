#!/usr/bin/env bash
# Offline headless-Neovim regression suite (CI test-surface plan row X11).
#
# Runs every lua case under `nvim --headless -u NONE`: no plugin bootstrap, no
# network, no stowed ~/.config resolution, no live tmux/herdr. Cases load the
# WORKTREE copy of the config via NVIM_TEST_CONFIG_ROOT / package.path and stub
# every external process (herdr, vim.system, Snacks) before import.
#
# Discovery: nvim/tests/ci/*_spec.lua by glob, plus the two wired specs in
# nvim/tests/. obsidian_spec runs twice (DST and UTC) because os.date cannot
# switch time zones inside one process.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"

# --- nvim discovery: PATH first, then bob fallbacks (mirrors scripts/verify-nvim)
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
  echo "test-nvim-headless: nvim not found on PATH or in ~/.local/share/bob" >&2
  exit 127
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
  local file="$1" label="$2" tz="$3"
  local start end ms rc=0 out=""
  start="$(now_ms)"
  out="$(TZ="$tz" env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
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

# Wired existing specs (load the worktree copy via the shared harness).
run_case "$config_root/tests/herdr_agent_send_spec.lua" "herdr_agent_send_spec" "UTC"
run_case "$config_root/tests/sidekick_ask_cli_spec.lua" "sidekick_ask_cli_spec" "UTC"

# Glob-discovered offline cases. obsidian_spec runs once per TZ fixture set.
for file in $(find "$config_root/tests/ci" -name '*_spec.lua' | sort); do
  name="$(basename "$file" .lua)"
  if [[ "$name" == "obsidian_spec" ]]; then
    run_case "$file" "obsidian_spec (America/New_York)" "America/New_York"
    run_case "$file" "obsidian_spec (UTC)" "UTC"
  else
    run_case "$file" "$name" "UTC"
  fi
done

total_ms=$(( $(now_ms) - total_start ))

echo
echo "nvim-headless: $passed passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"
printf '  %s\n' "${results[@]}"

if [[ $failed -gt 0 ]]; then
  echo "nvim-headless: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt 60000 ]]; then
  echo "nvim-headless: SLA breach — whole suite must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
