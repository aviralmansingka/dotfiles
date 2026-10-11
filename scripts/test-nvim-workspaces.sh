#!/usr/bin/env bash
# Offline headless-Neovim suite for the workspace tab cluster 3: the
# herdr workspace tabs (snapshot/reconcile, bind/unbind, cross-worktree
# close safety, agent_closed funnel, picker seams) and the herdr
# scrollback capture helpers (document format, path identity, save/load).
#
# Paths: nvim/.config/nvim/lua/plugins/herdr/workspaces.lua nvim/.config/nvim/lua/plugins/herdr-workspaces.lua nvim/.config/nvim/lua/helpers/herdr_scrollback.lua
#
# Runs nvim/tests/ci/workspaces_spec.lua under `nvim --headless -u NONE`:
# no plugin bootstrap, no network, no stowed config resolution, no live
# herdr server — the spec stubs herdr.call, herdr.git_context, and the
# markdown_ansi require, and drives real (headless) tabpages and buffers.
# Dual mode: with no nvim on PATH the entry SKIPs (exit 0); STRICT=1
# turns the missing binary into a FAIL.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"
spec="$config_root/tests/ci/workspaces_spec.lua"

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
    echo "test-nvim-workspaces: STRICT mode: nvim not found on PATH or in ~/.local/share/bob" >&2
    exit 1
  fi
  echo "SKIP test-nvim-workspaces: nvim not found (set STRICT=1 to fail)"
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

# Every H.run block in the spec must print a PASS line (10 checks).
expected_checks=10
case_timeout=30
run_prefix=()
if command -v timeout >/dev/null 2>&1; then
  run_prefix=("timeout" "$case_timeout")
fi

start="$(now_ms)"
out=""
rc=0
out="$(TZ=UTC env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
  "+luafile $spec" '+qa!' 2>&1)" || rc=$?
end="$(now_ms)"
ms=$((end - start))

passed=0
if [[ $rc -eq 0 ]]; then
  passed="$(printf '%s\n' "$out" | grep -c '^PASS ' || true)"
fi

echo "$out" | grep '^PASS ' || true

if [[ $rc -ne 0 ]]; then
  echo "--- workspaces_spec FAILED (exit $rc) ---" >&2
  printf '%s\n' "$out" | tail -n 20 >&2
  exit 1
fi
if [[ "$passed" -lt "$expected_checks" ]]; then
  echo "--- workspaces_spec FAILED (only $passed/$expected_checks checks passed; no PASS marker) ---" >&2
  printf '%s\n' "$out" | tail -n 20 >&2
  exit 1
fi

echo "nvim-workspaces: $passed/$expected_checks checks passed, total ${ms} ms (nvim: $nvim_bin)"
if [[ $ms -gt 60000 ]]; then
  echo "nvim-workspaces: SLA breach — the entry must stay under 60 s (took ${ms} ms)" >&2
  exit 1
fi
exit 0
