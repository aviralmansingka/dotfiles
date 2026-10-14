#!/usr/bin/env bash
# Offline test runner pinned as the no-mistakes gate's Test step
# (.no-mistakes.yaml `commands.test`). Mirrors the area jobs in
# .github/workflows/ci.yml:
#   - every pi/.pi/agent/extensions/**/*.test.mjs, discovered dynamically so
#     deleted test files drop out and new ones join without editing this file
#   - the scripts suite under scripts/test-* plus the pi telegram daemon
#     unittests
#
# PATH-AWARE MODE (--changed): no-mistakes validates a branch, not the whole
# repo. With --changed the runner computes the files the branch changed
# (merge-base..HEAD) and selects exactly the suites whose trigger paths match
# — the same fixed gates + harvested "# Paths:"/"// Paths:" headers the CI
# changes job uses. A docs-only change selects nothing and passes. The
# default (no flag) remains the full suite. A test whose runtime dependency
# is missing is skipped with a notice instead of hanging. Exits nonzero if
# any run test fails.

set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root" || exit 1

fail=0
skips=0
changed_mode=0
changed_files=""

usage() { echo "usage: nm-test.sh [--changed [range]]   (--changed: run only suites matching the branch's changed paths; default range origin/main...HEAD)" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --changed)
      changed_mode=1
      shift
      ;;
    *) usage; exit 2 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }
# Prefer a modern interpreter when present: this repo's python uses 3.12+
# syntax (f-string backslashes), which the macOS system python3 (3.9)
# rejects. CI runners ship python3 >= 3.12 and fall through to it unchanged;
# no downloads, offline-safe.
py3=$(command -v python3.13 || command -v python3.12 || command -v python3 || true)

# Portable timeout: use coreutils timeout when present (CI/Linux), else a
# background watcher that kills on the deadline — macOS ships neither
# timeout nor bash 4, and the gate's Test step runs on macOS hosts too.
with_timeout() {
  local secs=$1; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
    return $?
  fi
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs" && kill -TERM "$cmd_pid" 2>/dev/null ) &
  local watch_pid=$!
  wait "$cmd_pid"
  local rc=$?
  kill -TERM "$watch_pid" 2>/dev/null
  wait "$watch_pid" 2>/dev/null
  return $rc
}

# --- portable timeout --------------------------------------------------------
# Linux ships GNU timeout; stock macOS does not. When the binary is missing,
# fall back to perl's exec+alarm one-liner: the alarm(2) timer survives
# exec, so the deadline kills the command itself. A timeout kill surfaces as
# exit 142 (SIGALRM) instead of GNU's 124; both are nonzero and FAIL the
# same way here. With neither timeout nor perl, run unguarded and say so
# once — the suites still run, only the SLA guard is off.
TIMEOUT_UNGUARDED_NOTICE=0
if ! have timeout; then
  if have perl; then
    timeout() { perl -e 'alarm shift; exec @ARGV' "$@"; }
  else
    timeout() {
      if [ "$TIMEOUT_UNGUARDED_NOTICE" -eq 0 ]; then
        echo "NOTICE: no timeout and no perl on PATH; suites run without the SLA guard" >&2
        TIMEOUT_UNGUARDED_NOTICE=1
      fi
      "$@"
    }
  fi
fi

# --- selection logic (mirrors the ci.yml changes job) ------------------------
# Fixed area gates (arrays kept in sync with ci.yml's changes job).
PI_FIXED=( 'pi/*' 'agents/*' '.github/workflows/ci.yml' )
NVIM_FIXED=( 'nvim/*' '.github/workflows/ci.yml' )
SCRIPTS_FIXED=( 'scripts/*' 'install.sh' 'Brewfile' '.stowrc' 'dependencies.json' '.github/workflows/ci.yml' )
OPS_FIXED=( 'ops/*' '.github/workflows/ci.yml' )

# Entry header harvest: "# Paths:" for .sh/.py, "// Paths:" for .mjs.
header_globs() {
  local f=$1 marker
  case "$f" in *.mjs) marker="// Paths:" ;; *) marker="# Paths:" ;; esac
  sed -n "s/^${marker}//p" "$f" 2>/dev/null | head -1 | tr ', ' '\n' | sed '/^$/d'
}

# runner_job mirrors the ci.yml routing classification.
runner_job() {
  case "$1" in
    scripts/test-nvim-*) echo nvim ;;
    scripts/test-terraform*) echo ops ;;
    *) echo scripts ;;
  esac
}

# bash [[ == ]] semantics: * crosses / (git-pathspec behavior).
bash_match() { # <path> <pattern>
  local path=$1 pattern=$2 re
  re="^$(printf '%s' "$pattern" | sed -e 's/[.+^${}()|[\]\\?*]/&/g' -e 's/\*/.*/g' -e 's/\?/./g' -e 's/\\/\\\\/g' | sed -e 's/\[\.\+\^(\[)\]/&/g')$"
  # Simpler and faithful enough for the glob shapes this repo uses:
  case "$path" in $pattern) return 0 ;; *) return 1 ;; esac
}

gate_hits() { # <files-list> <globs...>
  local files=$1; shift
  local f g
  for f in $files; do
    for g in "$@"; do
      case "$f" in $g) return 0 ;; esac
    done
  done
  return 1
}

tier2_list=$(grep -vE '^[[:space:]]*(#|$)' scripts/ci-tier2-exclusions.txt 2>/dev/null | cut -d'#' -f1 | sed 's/[[:space:]]*$//' || true)
is_tier2() { printf '%s\n' $tier2_list 2>/dev/null | grep -qxF "$1"; }

# --- changed-files computation (path-aware mode) ------------------------------
if [ "$changed_mode" -eq 1 ]; then
  base_ref=""
  for c in origin/main main; do
    if git rev-parse --verify -q "$c" >/dev/null 2>&1; then base_ref="$c"; break; fi
  done
  if [ -z "$base_ref" ]; then
    echo "NOTICE: no main ref found; falling back to the full suite" >&2
    changed_mode=0
  else
    mb=$(git merge-base HEAD "$base_ref" 2>/dev/null) || { echo "NOTICE: merge-base failed; full suite" >&2; changed_mode=0; }
    if [ "$changed_mode" -eq 1 ]; then
      changed_files=$(git diff --name-only "$mb" HEAD 2>/dev/null | tr '\n' ' ')
      if [ -z "$changed_files" ]; then
        echo "nm-test: no changed files vs $base_ref — nothing to select, passed"
        exit 0
      fi
      echo "== path-aware selection: $(printf '%s\n' $changed_files | wc -w) changed file(s) vs $base_ref"
    fi
  fi
fi

# --- selection ---------------------------------------------------------------
# Output: space-separated selected extension test files, selected scripts
# entries, and flags for the telegram unittest.
select_ext_tests=()    # pi/.pi/agent/extensions/**/*.test.mjs
select_scripts_tests=()  # scripts/test-* entries (any lane)
run_telegram=0

if [ "$changed_mode" -eq 0 ]; then
  # Full suite: everything.
  while IFS= read -r f; do
    [ -n "$f" ] && select_ext_tests+=("$f")
  done < <(find pi/.pi/agent/extensions -name node_modules -prune -o -name '*.test.mjs' -print | sort)
  while IFS= read -r f; do
    [ -n "$f" ] && ! is_tier2 "$f" && select_scripts_tests+=("$f")
  done < <(git ls-files 'scripts/test-*' | sort)
  run_telegram=1
else
  # Harvested gates per area (fixed + every on-disk entry's declared globs).
  harvest_pi=(); harvest_nvim=(); harvest_scripts=(); harvest_ops=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    is_tier2 "$f" && continue
    job=$(runner_job "$f")
    globs=$(header_globs "$f" | tr '\n' ' ')
    case "$job" in
      pi) harvest_pi+=($globs) ;;
      nvim) harvest_nvim+=($globs) ;;
      scripts) harvest_scripts+=($globs) ;;
      ops) harvest_ops+=($globs) ;;
    esac
  done < <(git ls-files 'scripts/test-*' | sort)

  pi_hit=0;  gate_hits "$changed_files" "${PI_FIXED[@]}" ${harvest_pi[@]+"${harvest_pi[@]}"} && pi_hit=1
  nvim_hit=0; gate_hits "$changed_files" "${NVIM_FIXED[@]}" ${harvest_nvim[@]+"${harvest_nvim[@]}"} && nvim_hit=1
  scripts_hit=0; gate_hits "$changed_files" "${SCRIPTS_FIXED[@]}" ${harvest_scripts[@]+"${harvest_scripts[@]}"} && scripts_hit=1
  ops_hit=0; gate_hits "$changed_files" "${OPS_FIXED[@]}" ${harvest_ops[@]+"${harvest_ops[@]}"} && ops_hit=1

  # Fine-grained (tighter than the CI lanes, which run a whole lane per
  # area): no-mistakes validates one branch, so each suite runs only when
  # the branch touched that suite's own surface.
  # Extension tests: the extension tree itself.
  if gate_hits "$changed_files" 'pi/.pi/agent/extensions/*' 'agents/*'; then
    while IFS= read -r f; do
      [ -n "$f" ] && select_ext_tests+=("$f")
    done < <(find pi/.pi/agent/extensions -name node_modules -prune -o -name '*.test.mjs' -print | sort)
  fi
  # Loader smoke: extension tree or the settings entries it guards.
  if gate_hits "$changed_files" 'pi/.pi/agent/extensions/*' 'pi/.pi/agent/settings.json'; then
    select_scripts_tests+=("scripts/test-extension-loader.mjs")
  fi
  # Telegram daemon: its own files.
  if gate_hits "$changed_files" 'pi/bin/*'; then
    run_telegram=1
  fi
  # Each scripts entry: run when its runner job's gate hit AND (its own
  # declared globs match the changed files OR it has no header and the
  # scripts fixed gate hit).
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    is_tier2 "$f" && continue
    job=$(runner_job "$f")
    case "$job" in
      scripts) [ "$scripts_hit" -eq 1 ] || continue ;;
      nvim) [ "$nvim_hit" -eq 1 ] || continue ;;
      ops) [ "$ops_hit" -eq 1 ] || continue ;;
    esac
    globs=$(header_globs "$f" | tr '\n' ' ')
    if [ -n "$globs" ]; then
      gate_hits "$changed_files" $globs && select_scripts_tests+=("$f")
    else
      # Headerless entry: the scripts/** default gate's own surface.
      case "$job" in scripts) gate_hits "$changed_files" 'scripts/*' && select_scripts_tests+=("$f") ;; esac
    fi
    # A changed test entry always runs itself.
    case "$f" in $changed_files) select_scripts_tests+=("$f") ;; esac
  done < <(git ls-files 'scripts/test-*' | sort)
fi

# --- jiti bootstrap (mirrors the ci.yml extensions job) ---------------------
if [ "${#select_ext_tests[@]}" -gt 0 ]; then
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
    node_modules_dir=$(dirname "$(dirname "$(dirname "$JITI_PATH")")")
    [ -d "$node_modules_dir" ] && export NODE_PATH="$node_modules_dir"
  fi
fi

# --- extension tests ---------------------------------------------------------
if [ "${#select_ext_tests[@]}" -gt 0 ]; then
  if have node; then
    for f in "${select_ext_tests[@]}"; do
      if with_timeout 120 node "$f"; then
        echo "PASS $f"
      else
        echo "FAIL $f"
        fail=1
      fi
    done
  else
    echo "SKIP extension tests: node not found on PATH" >&2
    skips=$((skips + 1))
  fi
fi

# --- scripts tests -----------------------------------------------------------
run_entry() {
  case "$1" in
    *.sh) with_timeout 120 bash "$1" ;;
    *.py) with_timeout 120 "$py3" "$1" ;;
    *.mjs) with_timeout 120 node "$1" ;;
    *) with_timeout 120 "$1" ;;
  esac
}
if [ "${#select_scripts_tests[@]}" -gt 0 ]; then
  # Dedupe (loader smoke may be added twice); bash-3.2-safe (no mapfile).
  uniq_scripts=()
  while IFS= read -r f; do
    [ -n "$f" ] && uniq_scripts+=("$f")
  done < <(printf '%s\n' "${select_scripts_tests[@]}" | sort -u)
  for f in "${uniq_scripts[@]}"; do
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
  done
fi

# --- telegram daemon unittests ----------------------------------------------
if [ "$run_telegram" -eq 1 ]; then
  if [ -n "$py3" ]; then
    echo "== pi/bin telegram daemon unittests"
    if with_timeout 120 "$py3" -m unittest discover -s pi/bin -p 'test_pi_telegram_daemon.py'; then
      echo "PASS pi-telegram-daemon"
    else
      echo "FAIL pi-telegram-daemon"
      fail=1
    fi
  else
    echo "SKIP pi-telegram-daemon: python3 not found" >&2
    skips=$((skips + 1))
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "nm-test: FAILED"
  exit 1
fi
echo "nm-test: passed (skipped: $skips)"
