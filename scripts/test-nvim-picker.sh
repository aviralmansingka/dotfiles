#!/usr/bin/env bash
# Paths: nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua nvim/.config/nvim/lua/plugins/sidekick/herdr.lua nvim/.config/nvim/lua/plugins/sidekick/last_session.lua
#
# Offline headless-nvim suite for the Sidekick picker action lifecycle and
# the session-resolution invariants (cluster 1): M.open action closures
# (activate, rename_item, kill_item, active_item), workspace_groups, the
# herdr resolution VALUES (workspace_for_repository, agent_for_worktree,
# ensure_workspace, is_durable_agent), and last_session record/open pairing.
#
# Runs nvim/.config/nvim/tests/ci/picker_actions_spec.lua under
# `nvim --headless -u NONE` through the shared offline harness: no plugin
# bootstrap, no network, no live herdr (argv recorder only), no stowed
# ~/.config resolution. Every check prints PASS; a failure exits non-zero
# with a traceback. See docs/ci-tests/nvim-picker.md.
#
# Dual mode:
#   default : missing nvim prints SKIP with a message, no fail.
#   STRICT=1: missing nvim FAILs (CI can install nvim first).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"
spec="$config_root/tests/ci/picker_actions_spec.lua"

STRICT="${STRICT:-0}"

# --- nvim discovery: PATH first, then bob fallbacks (mirrors verify-nvim) ---
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
  if [[ "$STRICT" = "1" ]]; then
    echo "test-nvim-picker: FAIL — nvim not found on PATH or in ~/.local/share/bob (STRICT=1)" >&2
    exit 1
  fi
  echo "test-nvim-picker: SKIP — nvim not found; install nvim to run this check"
  exit 0
fi

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

export NVIM_TEST_CONFIG_ROOT="$config_root"
export LC_ALL=C

total_start="$(now_ms)"
rc=0
out=""
start="$(now_ms)"
out="$(TZ=UTC env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
  "+luafile $spec" '+qa!' 2>&1)" || rc=$?
ms=$(( $(now_ms) - start ))

failed=0
passed=0
if [[ $rc -ne 0 ]]; then
  failed=1
  echo "FAIL picker_actions_spec (${ms} ms, exit $rc)"
  printf '%s\n' "$out" | tail -n 25
elif [[ "$out" != *"PASS "* ]]; then
  # nvim exits zero even when a luafile chunk errors: require PASS marks.
  failed=1
  echo "FAIL picker_actions_spec (${ms} ms, no PASS marker; case did not complete)"
  printf '%s\n' "$out" | tail -n 25
else
  # Each H.run check prints its own PASS line; report them per check.
  while IFS= read -r line; do
    if [[ "$line" == PASS* ]]; then
      passed=$((passed + 1))
      echo "ok   ${line#PASS  } (${ms} ms total)"
    fi
  done <<<"$out"
fi

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-picker: $passed checks passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-picker: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt 60000 ]]; then
  echo "test-nvim-picker: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
