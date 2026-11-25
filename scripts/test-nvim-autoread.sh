#!/usr/bin/env bash
# Neovim automatic on-disk reload suite: augroup autoread_changed_on_disk in
# nvim/.config/nvim/lua/config/autocmds.lua.
#
# Paths: nvim/.config/nvim/lua/config/autocmds.lua nvim/.config/nvim/tests/ci/autoread_spec.lua
#
# Runs nvim/.config/nvim/tests/ci/autoread_spec.lua under
# `nvim --headless -u NONE`: no plugin bootstrap, no network, no stowed
# ~/.config resolution, no live tmux/herdr, no GUI. Every case uses real temp
# files and fires the real FocusGained / BufEnter / CursorHold / BufWritePost
# events, so the reload path itself is exercised. File timestamps are set
# explicitly, so the suite never sleeps or waits.
# See docs/ci-tests/nvim-autoread.md.
#
# Dual mode: nvim missing -> SKIP (exit 0) by default; STRICT=1 makes the
# missing binary a failure (exit 127), mirroring scripts/test-nvim-headless.sh.
# The shared scripts/test-nvim-headless.sh also runs this spec by glob.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"
spec="$config_root/tests/ci/autoread_spec.lua"

# --- nvim discovery: the profile installs nvim, so PATH is the only source
find_nvim() {
  if command -v nvim >/dev/null 2>&1; then
    command -v nvim
    return 0
  fi
  return 1
}

nvim_bin="$(find_nvim || true)"
if [[ -z "$nvim_bin" ]]; then
  if [[ "${STRICT:-0}" == "1" ]]; then
    echo "test-nvim-autoread: nvim not found on PATH (STRICT=1)" >&2
    exit 127
  fi
  echo "SKIP test-nvim-autoread: nvim not found on PATH"
  exit 0
fi

# Neutral XDG dirs: a stowed ~/.config/nvim must never leak into the default
# runtimepath and mask a worktree regression (harness invariant,
# fix-markdown-line-length #238). Every case must load THIS worktree copy.
# Cleaned up on exit via the trap below.
xdg_root="$(mktemp -d)"
trap 'rm -rf "$xdg_root"' EXIT
mkdir -p "$xdg_root/config" "$xdg_root/data" "$xdg_root/state" "$xdg_root/cache"
export XDG_CONFIG_HOME="$xdg_root/config"
export XDG_DATA_HOME="$xdg_root/data"
export XDG_STATE_HOME="$xdg_root/state"
export XDG_CACHE_HOME="$xdg_root/cache"

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

start="$(now_ms)"
out=""
rc=0
out="$(TZ=UTC env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
  "+luafile $spec" '+qa!' 2>&1)" || rc=$?
end="$(now_ms)"
ms=$((end - start))

failed=0
if [[ $rc -ne 0 ]]; then
  echo "--- autoread_spec FAILED (exit $rc, ${ms} ms) ---"
  printf '%s\n' "$out" | tail -n 30
  failed=1
elif [[ "$out" != *"PASS "* ]]; then
  # nvim exits 0 even when a luafile chunk errors: require the PASS marker.
  echo "--- autoread_spec FAILED (no PASS marker; case did not complete, ${ms} ms) ---"
  printf '%s\n' "$out" | tail -n 30
  failed=1
else
  # Per-case PASS lines (each case names its own invariant).
  printf '%s\n' "$out" | grep '^PASS '
  echo
  echo "nvim-autoread: all cases passed, total ${ms} ms (nvim: $nvim_bin)"
fi

if [[ $failed -ne 0 ]]; then
  echo "nvim-autoread: FAILED" >&2
  exit 1
fi
if [[ $ms -gt 60000 ]]; then
  echo "nvim-autoread: SLA breach — entry must stay under 60 s (took ${ms} ms)" >&2
  exit 1
fi
exit 0
