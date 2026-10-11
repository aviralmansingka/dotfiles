#!/usr/bin/env bash
# Neovim UI-and-bootstrap shape sweep (CI test-surface cluster 4, B-only).
#
# Paths: nvim/.config/nvim/lua/plugins/colorizer.lua nvim/.config/nvim/lua/plugins/fidget.lua nvim/.config/nvim/lua/plugins/gitsigns.lua nvim/.config/nvim/lua/plugins/trouble.lua nvim/.config/nvim/lua/plugins/treesitter.lua nvim/.config/nvim/lua/plugins/treesitter-context.lua nvim/.config/nvim/lua/plugins/which-key.lua nvim/.config/nvim/lua/plugins/snacks-picker.lua nvim/.config/nvim/lua/plugins/extend-mini-files.lua nvim/.config/nvim/lua/plugins/toggleterm.lua nvim/.config/nvim/lua/config/lazy.lua nvim/.config/nvim/lua/config/keymaps.lua nvim/.config/nvim/lua/config/autocmds.lua nvim/.config/nvim/after/ftplugin/markdown.lua nvim/.config/nvim/luasnippets/groovy.lua
#
# Runs nvim/.config/nvim/tests/ci/ui_shape_spec.lua under
# `nvim --headless -u NONE`: no plugin bootstrap, no network, no stowed
# ~/.config resolution, no live tmux/herdr, no GUI. Every spec file is
# dofile'd as a plain table; opts keys are asserted against pinned
# invariants. See docs/ci-tests/nvim-ui-shape.md.
#
# Dual mode: nvim missing -> SKIP (exit 0) by default; STRICT=1 makes the
# missing binary a failure (exit 127), mirroring scripts/test-nvim-headless.sh.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"
spec="$config_root/tests/ci/ui_shape_spec.lua"

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
  if [[ "${STRICT:-0}" == "1" ]]; then
    echo "test-nvim-ui-shape: nvim not found on PATH or in ~/.local/share/bob (STRICT=1)" >&2
    exit 127
  fi
  echo "SKIP test-nvim-ui-shape: nvim not found on PATH or in ~/.local/share/bob"
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

start="$(now_ms)"
out=""
rc=0
out="$(TZ=UTC env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
  "+luafile $spec" '+qa!' 2>&1)" || rc=$?
end="$(now_ms)"
ms=$((end - start))

failed=0
if [[ $rc -ne 0 ]]; then
  echo "--- ui_shape_spec FAILED (exit $rc, ${ms} ms) ---"
  printf '%s\n' "$out" | tail -n 30
  failed=1
elif [[ "$out" != *"PASS "* ]]; then
  # nvim exits 0 even when a luafile chunk errors: require the PASS marker.
  echo "--- ui_shape_spec FAILED (no PASS marker; case did not complete, ${ms} ms) ---"
  printf '%s\n' "$out" | tail -n 30
  failed=1
else
  # Per-check PASS lines (each carries its own timing).
  printf '%s\n' "$out" | grep '^PASS '
  echo
  echo "ui-shape: all checks passed, total ${ms} ms (nvim: $nvim_bin)"
fi

if [[ $failed -ne 0 ]]; then
  echo "ui-shape: FAILED" >&2
  exit 1
fi
if [[ $ms -gt 60000 ]]; then
  echo "ui-shape: SLA breach — entry must stay under 60 s (took ${ms} ms)" >&2
  exit 1
fi
exit 0
