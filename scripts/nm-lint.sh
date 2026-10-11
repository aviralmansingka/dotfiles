#!/usr/bin/env bash
# Offline lint runner pinned as the no-mistakes gate's Lint step
# (.no-mistakes.yaml `commands.lint`). Mirrors the lint job in
# .github/workflows/ci.yml: bash/sh -n over shell scripts, py_compile over
# python, and nvim loadfile parse-only over lua. Exits nonzero on any failure.

set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root" || exit 1

# py_compile always writes bytecode; redirect it to a scratch tree so the
# worktree stays clean (PYTHONDONTWRITEBYTECODE does not stop py_compile).
pycache_root=$(mktemp -d)
trap 'rm -rf "$pycache_root"' EXIT
export PYTHONPYCACHEPREFIX="$pycache_root"

# Discovery uses git ls-files, exactly like ci.yml; refuse to run vacuously
# outside a work tree.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "FAIL: $repo_root is not a git work tree; cannot enumerate lint targets" >&2
  exit 1
fi

fail=0

echo "== shell syntax (bash/sh -n)"

# Every tracked *.sh file (sh shebangs get sh -n, everything else bash -n) ...
while IFS= read -r f; do
  [ -n "$f" ] || continue
  sb=$(head -n 1 "$f")
  case "$sb" in
    '#!/bin/sh' | '#!/usr/bin/env sh')
      sh -n "$f" || { echo "FAIL $f"; fail=1; } ;;
    *)
      bash -n "$f" || { echo "FAIL $f"; fail=1; } ;;
  esac
done < <(git ls-files '*.sh')

# ... plus extensionless scripts under scripts/ with a bash/sh shebang.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  sb=$(head -n 1 "$f" 2>/dev/null)
  case "$sb" in
    '#!/bin/bash' | '#!/usr/bin/env bash')
      bash -n "$f" || { echo "FAIL $f"; fail=1; } ;;
    '#!/bin/sh' | '#!/usr/bin/env sh')
      sh -n "$f" || { echo "FAIL $f"; fail=1; } ;;
  esac
done < <(git ls-files 'scripts/*')

echo "== python syntax (py_compile)"
if command -v python3 >/dev/null 2>&1; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    python3 -m py_compile "$f" || { echo "FAIL $f"; fail=1; }
  done < <(git ls-files '*.py')
else
  echo "FAIL: python3 not found on PATH; python syntax checks cannot run" >&2
  fail=1
fi

echo "== lua syntax (nvim loadfile parse-only)"
if command -v nvim >/dev/null 2>&1; then
  # Parse-only via loadfile: catches syntax errors in neovim's lua dialect
  # without bootstrapping plugins (deterministic, no network).
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    nvim --headless -u NONE -c "lua local fn,err=loadfile('$f'); if not fn then io.stderr:write(tostring(err)..'\n'); vim.cmd('cquit 1') else vim.cmd('qa') end" 2>&1 \
      || { echo "FAIL $f"; fail=1; }
  done < <(git ls-files '*.lua')
else
  echo "FAIL: nvim not found on PATH; lua parse checks cannot run (install neovim and rerun)" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "nm-lint: FAILED"
  exit 1
fi
echo "nm-lint: passed (shell, python, lua syntax)"
