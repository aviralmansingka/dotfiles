#!/usr/bin/env bash
# Offline test runner pinned as the no-mistakes gate's Test step
# (.no-mistakes.yaml `commands.test`). Mirrors the extensions and
# scripts-tests jobs in .github/workflows/ci.yml:
#   - every pi/.pi/agent/extensions/**/*.test.mjs, discovered dynamically so
#     deleted test files drop out and new ones join without editing this file
#   - the scripts suite: auto-git-sync, gh-dash-open-pr, herdr-clean-handoff,
#     herdr-flash-copy, herdr-annotate-install, pi-live-config,
#     pi-hidden-thinking, and the pi telegram daemon unittests
# A test whose runtime dependency is missing is skipped with a notice instead
# of hanging. Exits nonzero if any run test fails.

set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root" || exit 1

fail=0
skips=0

have() { command -v "$1" >/dev/null 2>&1; }

# run_test <label> <space-separated required tools> <command...>
run_test() {
  local label=$1 deps=$2
  shift 2
  local d missing=""
  # deps is an intentional word list
  # shellcheck disable=SC2086
  for d in $deps; do
    have "$d" || missing="$missing $d"
  done
  if [ -n "$missing" ]; then
    echo "SKIP $label tests: missing$missing" >&2
    skips=$((skips + 1))
    return 0
  fi
  echo "== $label tests"
  if "$@"; then
    echo "PASS $label"
  else
    echo "FAIL $label"
    fail=1
  fi
}

# --- jiti bootstrap (mirrors the ci.yml extensions job) ---------------------
# The extension tests import TS sources through jiti with typebox on
# NODE_PATH; several resolve jiti only via JITI_PATH (their built-in
# fallbacks point at macOS homebrew paths), so ensure both here.
if [ -z "${JITI_PATH:-}" ] || [ ! -f "${JITI_PATH:-}" ]; then
  jiti_root=$(mktemp -d)
  trap 'rm -rf "${jiti_root:-}"' EXIT
  echo "== installing jiti@2 typebox@1.3.27 to $jiti_root"
  if npm install --prefix "$jiti_root" jiti@2 typebox@1.3.27; then
    export JITI_PATH="$jiti_root/node_modules/jiti/lib/jiti.cjs"
    export NODE_PATH="$jiti_root/node_modules${NODE_PATH:+:$NODE_PATH}"
  else
    echo "NOTICE: jiti bootstrap failed (no npm or no network); extension tests will rely on their own fallbacks" >&2
  fi
elif [ -z "${NODE_PATH:-}" ]; then
  # JITI_PATH was provided but NODE_PATH was not; derive NODE_PATH from the
  # jiti root the way ci.yml does so typebox resolves for the TS imports.
  node_modules_dir=$(dirname "$(dirname "$(dirname "$JITI_PATH")")")
  if [ -d "$node_modules_dir" ]; then
    export NODE_PATH="$node_modules_dir"
  fi
fi

# --- extension tests (dynamic discovery) ------------------------------------
if have node; then
  echo "== extension tests (pi/.pi/agent/extensions)"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if node "$f"; then
      echo "PASS $f"
    else
      echo "FAIL $f"
      fail=1
    fi
  done < <(find pi/.pi/agent/extensions -name '*.test.mjs' | sort)
else
  echo "SKIP extension tests: node not found on PATH" >&2
  skips=$((skips + 1))
fi

# --- scripts tests (mirror the ci.yml scripts-tests job: dynamic discovery) --
# Every scripts/test-* entry runs, discovered with git ls-files exactly like
# ci.yml — never a hand list, so new entries join automatically. The nvim and
# terraform entries route to their own CI lanes and self-skip (dual mode) when
# their binaries are absent. Tier-2 live-env exclusions come from
# scripts/ci-tier2-exclusions.txt. Exit 127 (command not found) counts as a
# SKIP, not a FAIL: this runner must skip, never hang, on a host that lacks a
# tool. CI itself runs every lane with tools provisioned (STRICT semantics).
tier2_list=$(grep -vE '^[[:space:]]*(#|$)' scripts/ci-tier2-exclusions.txt 2>/dev/null | cut -d'#' -f1 | sed 's/[[:space:]]*$//' || true)
run_entry() {
	case "$1" in
		*.sh) timeout 120 bash "$1" ;;
		*.py) timeout 120 python3 "$1" ;;
		*.mjs) timeout 120 node "$1" ;;
		*) timeout 120 "$1" ;;
	esac
}
while IFS= read -r f; do
	[ -n "$f" ] || continue
	case "$f" in
		scripts/test-nvim-* | scripts/test-terraform*) continue ;; # own CI lanes
	esac
	# shellcheck disable=SC2086
	if [ -n "$tier2_list" ] && printf '%s\n' $tier2_list | grep -qxF "$f"; then
		continue
	fi
	echo "== $f"
	rc=0; run_entry "$f" || rc=$?
	if [ "$rc" -eq 0 ]; then
		echo "PASS $f"
	elif [ "$rc" -eq 127 ]; then
		echo "SKIP $f: required tool not found (exit 127)" >&2
		skips=$((skips + 1))
	else
		echo "FAIL $f (exit $rc)"
		fail=1
	fi
done < <(git ls-files 'scripts/test-*' | sort)

run_test pi-telegram-daemon "python3" python3 -m unittest discover -s pi/bin -p 'test_pi_telegram_daemon.py'

if [ "$fail" -ne 0 ]; then
  echo "nm-test: FAILED"
  exit 1
fi
echo "nm-test: passed (skipped: $skips)"
