#!/usr/bin/env bash
# Offline plugin-config contract suite (CI: small plugin-config contracts).
#
# Runs nvim/.config/nvim/tests/ci/plugin_configs_spec.lua under
# `nvim --headless -u NONE`: no plugin bootstrap, no network, no Mason/Lazy
# start, no $HOME mutation, no stowed ~/.config resolution. Every assert runs
# on the dofile'd spec TABLES and pure config functions only — external
# modules (neotest-java.model.path, jdtls.setup, lspconfig.util) are faked
# via package.preload, and vim.fn/vim.system boundaries are stubbed.
#
# Paths: nvim/.config/nvim/lua/plugins/java.lua nvim/.config/nvim/lua/plugins/neovide.lua nvim/.config/nvim/lua/plugins/mason.lua nvim/.config/nvim/lua/plugins/conform.lua nvim/.config/nvim/lua/plugins/lsp.lua nvim/.config/nvim/lua/plugins/c.lua nvim/.config/nvim/lua/plugins/build-files.lua nvim/.config/nvim/lua/plugins/jdtls.lua nvim/.config/nvim/lua/plugins/obsidian.lua nvim/.config/nvim/lua/plugins/blink-cmp.lua nvim/.config/nvim/lua/plugins/spring-boot.lua
#
# Dual mode: when nvim cannot be found, the entry SKIPs (exit 0) by default;
# STRICT=1 turns the missing binary into a FAIL (exit 1).
#
# SLA: the whole entry stays under 60 s and each spec under 5 s.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"
spec_file="$config_root/tests/ci/plugin_configs_spec.lua"
spec_name="plugin_configs_spec"

# --- nvim discovery: PATH first, then the pinned dev build, then bob -------
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
    echo "test-nvim-plugin-configs: nvim not found; STRICT=1 → FAIL" >&2
    exit 1
  fi
  echo "SKIP test-nvim-plugin-configs: nvim not found on PATH, ~/.local/bin, or in ~/.local/share/bob (STRICT=1 to fail)"
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

spec_timeout=5
run_prefix=()
if command -v timeout >/dev/null 2>&1; then
  run_prefix=("timeout" "$spec_timeout")
fi

total_start="$(now_ms)"
start="$(now_ms)"
rc=0
out=""
out="$(TZ=UTC env "${run_prefix[@]}" "$nvim_bin" --headless -u NONE \
  "+luafile $spec_file" '+qa!' 2>&1)" || rc=$?
end="$(now_ms)"
ms=$((end - start))

# Per-case lines from the spec itself (each H.run prints PASS <case>).
printf '%s\n' "$out" | grep -E '^(PASS|FAIL) ' || true

failed=0
if [[ $rc -ne 0 ]]; then
  failed=1
  echo "--- $spec_name FAILED (exit $rc) ---" >&2
  printf '%s\n' "$out" | tail -n 20 >&2
elif [[ "$out" != *"PASS "* ]]; then
  # nvim exits 0 even when a luafile chunk errors: require the PASS marker.
  failed=1
  echo "--- $spec_name FAILED (no PASS marker; spec did not complete) ---" >&2
  printf '%s\n' "$out" | tail -n 20 >&2
elif [[ $ms -gt 5000 ]]; then
  failed=1
  echo "--- $spec_name FAILED (SLA breach: ${ms} ms > 5000 ms per spec) ---" >&2
else
  echo "ok   $spec_name (${ms} ms)"
fi

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-plugin-configs: $((1 - failed)) passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-plugin-configs: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt 60000 ]]; then
  echo "test-nvim-plugin-configs: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
