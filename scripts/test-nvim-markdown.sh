#!/usr/bin/env bash
# Offline markdown-layer cluster suite (headless nvim, markdown/mermaid/links).
#
# Paths: nvim/.config/nvim/lua/helpers/markdown_links.lua nvim/.config/nvim/lua/helpers/mermaid_render.lua nvim/.config/nvim/lua/helpers/markdown_ansi.lua nvim/.config/nvim/lua/plugins/markdown.lua
#
# Runs the four markdown-layer specs with `nvim --headless -u NONE` through
# the shared tests/ci/harness.lua: markdown_links (treesitter link select/
# edit/paste), mermaid_render_state (render guards + inline auto-render state
# machine), markdown_ansi_autocmds (reload idempotency + byte preservation),
# markdown_plugin (plugins/markdown.lua wiring, #159 PencilSoft wrap, todo
# scan filters). No plugin bootstrap, no network, no mmdflux/grok-mermaid
# binaries (all stubbed), no $HOME mutation: fixture trees are mktemp'd and
# XDG_CONFIG_HOME is pinned to a temp copy so the treesitter query shadow
# reads this worktree's file, never a stowed config.
#
# Dual mode: when nvim is missing, the entry reports SKIP and exits 0;
# STRICT=1 turns that into a FAIL. SLA: each spec < 5 s, entry < 60 s.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_root="$repo_root/nvim/.config/nvim"

# --- nvim discovery (PATH first, then bob nightly, mirrors test-nvim-headless)
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
  return 1
}

nvim_bin="$(find_nvim || true)"
if [[ -z "$nvim_bin" ]]; then
  echo "test-nvim-markdown: nvim not found on PATH or in ~/.local/share/bob" >&2
  if [[ "${STRICT:-0}" == "1" ]]; then
    echo "test-nvim-markdown: FAILED (STRICT=1 treats a missing nvim as FAIL)" >&2
    exit 1
  fi
  echo "test-nvim-markdown: SKIP (nvim missing; set STRICT=1 to make this fatal)"
  exit 0
fi

export NVIM_TEST_CONFIG_ROOT="$config_root"
export LC_ALL=C

# Pin stdpath("config") to a temp copy so the mermaid images.scm query
# shadow reads the WORKTREE file, never a stowed ~/.config/nvim.
xdg_root="$(mktemp -d)"
trap 'rm -rf "$xdg_root"' EXIT
mkdir -p "$xdg_root/nvim/queries/markdown"
cp "$config_root/queries/markdown/images.scm" "$xdg_root/nvim/queries/markdown/images.scm"
export XDG_CONFIG_HOME="$xdg_root"

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

specs=(
  "markdown_links_spec.lua"
  "mermaid_render_state_spec.lua"
  "markdown_ansi_autocmds_spec.lua"
  "markdown_plugin_spec.lua"
)

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
    # nvim exits 0 even when a luafile chunk errors: require the PASS marker
    # (harness prints it with a tab separator; match like test-nvim-headless).
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, no PASS marker)")
    echo "--- $label FAILED (no PASS marker; case did not complete) ---"
    printf '%s\n' "$out" | tail -n 20
  elif [[ $ms -gt $((spec_timeout * 1000)) ]]; then
    failed=$((failed + 1))
    results+=("FAIL $label (${ms} ms, over the ${spec_timeout}s spec SLA)")
    echo "--- $label FAILED (spec SLA breach: ${ms} ms) ---"
  else
    passed=$((passed + 1))
    results+=("ok   $label (${ms} ms)")
  fi
}

total_start="$(now_ms)"

for name in "${specs[@]}"; do
  run_case "$config_root/tests/ci/$name" "${name%.lua}"
done

total_ms=$(( $(now_ms) - total_start ))

echo
echo "test-nvim-markdown: $passed passed, $failed failed, total ${total_ms} ms (nvim: $nvim_bin)"
printf '  %s\n' "${results[@]}"

if [[ $failed -gt 0 ]]; then
  echo "test-nvim-markdown: FAILED" >&2
  exit 1
fi
if [[ $total_ms -gt 60000 ]]; then
  echo "test-nvim-markdown: SLA breach — entry must stay under 60 s (took ${total_ms} ms)" >&2
  exit 1
fi
exit 0
