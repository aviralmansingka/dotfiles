#!/usr/bin/env bash
# Paths: install.sh Brewfile nvim/**
#
# Sandbox smoke for install.sh. Drives the offline, Linux-runnable steps of
# install.sh (the stow deployment, the
# git stow of section 7) against a mktemp fake HOME. Also pins the nvim
# stow package's root shape: stray files at the package root get stowed
# into $HOME root (C35), so only the config tree and the intentional
# $HOME-root markdownlint pair may sit there. Never touches the real
# $HOME, never runs stow into the real $HOME, and never contacts a network.
# install.sh itself cannot run offline: it bootstraps Nix and then switches a
# profile, so this smoke mirrors its stow commands instead (the delta is
# documented in docs/ci-tests/install-smoke.md).
#
# Usage: scripts/test-install-smoke.sh        (missing stow/node -> SKIP)
#        STRICT=1 scripts/test-install-smoke.sh   (missing tools -> FAIL)
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# INSTALL_SH lets a CI self-check point the smoke at a mutated copy of
# install.sh to prove the drift and guard checks catch regressions.
INSTALL="${INSTALL_SH:-$REPO/install.sh}"
STRICT="${STRICT:-0}"
REAL_STOW="$(command -v stow || true)"
REAL_STOW_DIR="${REAL_STOW:+$(dirname "$REAL_STOW")}"
NODE_BIN="$(command -v node || true)"
ORIG_HOME="${HOME:-/nonexistent}"

PASS_C=0 FAIL_C=0 SKIP_C=0
TMPROOT="$(mktemp -d)"
cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
T0="$(now_ms)"

pass() { echo "PASS $1: ${2:-}"; PASS_C=$((PASS_C + 1)); }
fail() { echo "FAIL $1: ${2:-}"; FAIL_C=$((FAIL_C + 1)); }
skip() { echo "SKIP $1: ${2:-}"; SKIP_C=$((SKIP_C + 1)); }
# A required tool is missing: SKIP by default, FAIL under STRICT=1.
req_skip() {
  if [ "$STRICT" = "1" ]; then fail "$1" "$2 (STRICT=1: required tool missing)"
  else skip "$1" "$2"; fi
}
# Unique per call even under command substitution (no shared counter).
newtmp() { mktemp -d "$TMPROOT/smoke.XXXXXX"; }

# One representative target per stow package named by install.sh (the keys
# must match every `^stow` package in install.sh except `launchd` and the
# phase-5 `stow -R` restow; drift here fails the plan phase). A newline table
# keeps this portable: macOS ships bash 3.2, which has no associative arrays.
SENTINEL_TABLE='
zsh=.zshenv
tmux=.tmux.conf
nvim=.config/nvim
starship=.config/starship.toml
ghostty=.config/ghostty
aerospace=.aerospace.toml
gh-dash=.config/gh-dash
tuicr=.config/tuicr
rex=.config/rex
agents=.agents
pi=bin
herdr=.config/herdr
git=.config/git
'

sentinel_keys() { printf '%s\n' "$SENTINEL_TABLE" | sed '/^$/d' | cut -d= -f1; }
sentinel_for() { # $1 package -> sentinel target (empty when absent)
  printf '%s\n' "$SENTINEL_TABLE" | sed '/^$/d' \
    | awk -F= -v k="$1" '$1 == k { print $2; exit }'
}

# ---------------------------------------------------------------- plan ----
# Extract every `stow` line from install.sh (indented ones included) in
# file order as "<flags>|<pkg>" (flags: N = --no-folding, R = restow,
# "-" = none).
extract_plan() {
  # install.sh loops over scripts/stow-packages (plus the darwin file), so the
  # plan is read from those lists. A literal `stow ... <pkg>` line would mean
  # the script and the list had drifted apart again.
  local f
  for f in "$REPO/scripts/stow-packages" "$REPO/scripts/stow-packages-darwin"; do
    [ -f "$f" ] || continue
    grep -vE '^[[:space:]]*(#|$)' "$f" | while read -r pkg; do
      printf -- '-|%s\n' "$pkg"
    done
  done
  if grep -qE '^[[:space:]]*stow -d "[^"]*" -t "[^"]*" [a-z]' "$INSTALL"; then
    echo "DRIFT literal-stow-line" # surfaced by the plan/coverage gate below
  fi
}

PLAN_FILE="$(newtmp)/plan"
extract_plan > "$PLAN_FILE"

# Gate decision per plan entry, mirroring install.sh's own guards.
# Prints "RUN <pkg> <flags>" or "SKIP <pkg> <reason>".
gate_plan() {
  local flags pkg
  while IFS='|' read -r flags pkg; do
    [ -n "$pkg" ] || continue
    case "$pkg" in
      launchd)
        if [ "$(uname -s)" = "Darwin" ]; then echo "RUN $pkg $flags"
        else echo "SKIP $pkg macOS-only (Darwin guard)"; fi ;;
      *)
        case "$flags" in *R*) echo "SKIP $pkg phase-5 omz restow (network phase, not smoked)" ;;
        *) echo "RUN $pkg $flags" ;; esac ;;  # flags "-" means no folding
    esac
  done < "$1"
}

GATED_FILE="$(newtmp)/gated"
gate_plan "$PLAN_FILE" > "$GATED_FILE"

phase_lint() {
  if bash -n "$INSTALL" 2>/dev/null; then pass "lint/bash-n" "install.sh parses"
  else fail "lint/bash-n" "bash -n rejected install.sh"; fi
}

# Static package-shape: everything tracked directly at the nvim package
# root is symlinked into $HOME ROOT by `stow nvim`. The config tree
# (.config/) and the intentional markdownlint pair belong there - the yaml
# is ~/.markdownlint-cli2.yaml, the default config markdownlint-cli2 picks
# up for every project, and its custom rule dir sits next to it (nvim's
# conform.lua/markdown.lua pass --config ~/.markdownlint-cli2.yaml).
# Anything else at the root is a stray (C35: tool-call-rendering-prototypes.md
# was relocated to docs/ for exactly this reason).
NVIM_ROOT_ALLOWLIST="|.config|.markdownlint-cli2.yaml|.markdownlint-rules|"
phase_pkgshape() {
  local entries e bad=0
  entries=$(git -C "$REPO" ls-files -- nvim | sed 's|^nvim/||' | cut -d/ -f1 | sort -u)
  [ -n "$entries" ] || fail "pkgshape/nvim-root" "no tracked files under nvim/"
  while read -r e; do
    [ -n "$e" ] || continue
    case "$NVIM_ROOT_ALLOWLIST" in
      *"|$e|"*) ;;
      *) bad=1; fail "pkgshape/nvim-root" "stray entry '$e' at the nvim package root would be stowed into \$HOME root (C35); move it under nvim/.config/ or docs/" ;;
    esac
  done <<<"$entries"
  # Allowlist hygiene: every allowlisted root entry must still be tracked.
  local keep
  for e in .config .markdownlint-cli2.yaml .markdownlint-rules; do
    keep=$(git -C "$REPO" ls-files -- "nvim/$e")
    [ -n "$keep" ] || { bad=1; fail "pkgshape/nvim-root" "allowlisted entry '$e' is no longer tracked; drop it from NVIM_ROOT_ALLOWLIST"; }
  done
  [ "$bad" = 0 ] && pass "pkgshape/nvim-root" "nvim package root holds only .config + the intentional markdownlint pair"
  return 0
}

phase_plan() {
  local total run skip_ pkgs
  total=$(wc -l < "$PLAN_FILE")
  run=$(grep -c '^RUN ' "$GATED_FILE" || true)
  skip_=$(grep -c '^SKIP ' "$GATED_FILE" || true)
  if [ "$total" -gt 0 ]; then pass "plan/extract" "$total stow lines in install.sh ($run run, $skip_ gated)"
  else fail "plan/extract" "no stow lines found in install.sh"; fi
  # Forward drift: every stowed package (launchd excepted, macOS-only)
  # needs a smoke sentinel.
  pkgs=$(awk -F'|' '{print $2}' "$PLAN_FILE" | sort -u | grep -vx launchd)
  while read -r p; do
    [ -n "$(sentinel_for "$p")" ] || fail "plan/coverage" "install.sh stows '$p' but the smoke has no sentinel for it"
  done <<<"$pkgs"
  # Reverse drift: every sentinel key must appear in install.sh's stow lines.
  local all_pkgs
  all_pkgs=$(awk -F'|' '{print $2}' "$PLAN_FILE" | sort -u)
  while read -r k; do
    [ -n "$k" ] || continue
    grep -qx "$k" <<<"$all_pkgs" || fail "plan/drift" "sentinel '$k' has no stow line in install.sh (stow-list drift?)"
  done <<<"$(sentinel_keys)"
}

# ------------------------------------------------------------- deploy ----
# Mirror of install.sh's stow section, in its exact order:
#   pre-clean rm -f, the stow lines, then pi-settings-sync between `stow agents`
#   and `stow pi`. install.sh has no other offline step since S03: the package
#   and service installs moved into the flake, and this smoke therefore checks
#   the file-deployment half only.
# On any failure it unstows the packages it already placed (no half-stowed
# tree) and exits non-zero. Usage: run_deploy <dotfiles> <fakehome> <stubdir>
stow_from_list() { # $1 repo, $2 home
  local pkg
  grep -vE '^[[:space:]]*(#|$)' "$1/scripts/stow-packages" | while read -r pkg; do
    printf 'STOW %s\n' "$pkg"
    stow -d "$1" -t "$2" "$pkg" 2>/dev/null || true
  done
}

run_deploy() {
  local dep_d="$1" dep_h="$2" dep_stub="${3:-}"
  (
    set -u
    export HOME="$dep_h"
    export PATH="${dep_stub:+$dep_stub:}${REAL_STOW_DIR:+$REAL_STOW_DIR:}/usr/bin:/bin"
    local ok_p=() ok_n=() p nf out
    rollback() {
      echo "ROLLBACK: ${ok_p[*]:-none}"
      local i
      for ((i = ${#ok_p[@]} - 1; i >= 0; i--)); do
        "$REAL_STOW" -D ${ok_n[i]:+--no-folding} -d "$dep_d" -t "$HOME" "${ok_p[i]}" >/dev/null 2>&1 || true
      done
    }
    stowit() { # $1 pkg, $2 nofold(1/0)
      local p="$1" nf="$2" out
      if ! out=$(stow ${nf:+--no-folding} -d "$dep_d" -t "$HOME" "$p" 2>&1); then
        echo "FAILSTEP $p: $out"
        rollback
        exit 1
      fi
      echo "OK stow $p"
      ok_p+=("$p"); ok_n+=("$nf")
    }
    rm -f "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_logout" "$HOME/.profile"
    local act p nf
    while read -r act p nf; do
      [ -n "$p" ] || continue
      if [ "$act" = "SKIP" ]; then echo "SKIP stow $p $nf"; continue; fi
      if [ "$p" = "pi" ]; then
        if ! out=$("$NODE_BIN" "$dep_d/scripts/pi-settings-sync" 2>&1); then
          echo "FAILSTEP pi-settings-sync: $out"; rollback; exit 1
        fi
        echo "OK pi-settings-sync"
      fi
      stowit "$p" "$nf"
    # Third field "N" marks --no-folding (hunk); empty means default folding.
    done < <(awk '{print $1, $2, ($3 ~ /N/ ? "N" : "")}' "$GATED_FILE")
  )
}

# All symlinks under $1 must resolve inside the repo $2.
check_containment() {
  local bad=0 l t
  while IFS= read -r l; do
    t="$(readlink -f "$l" 2>/dev/null || true)"
    case "$t" in "$REPO"/*) ;; *) bad=1; fail "deploy/containment" "symlink $l resolves outside repo ($t)";; esac
  done < <(find "$1" -type l)
  [ "$bad" = 0 ] && pass "deploy/containment" "every symlink in fake HOME resolves into the repo"
  return 0
}

# No real file may appear except those install.sh itself writes as real
# files (pi-settings-sync materialized settings, compiled terminfo entry).
check_real_files() {
  local f bad=0
  while IFS= read -r f; do
    case "${f#"$1"/}" in
      .pi/agent/settings.json|.pi/agent/settings.local.json|.terminfo/x/xterm-ghostty) ;;
      *) bad=1; fail "deploy/symlinks" "real file (not a symlink) at ${f#"$1"/}" ;;
    esac
  done < <(find "$1" \! -type l \! -type d)
  [ "$bad" = 0 ] && pass "deploy/symlinks" "stowed packages created symlinks only (no real files)"
  return 0
}

check_sentinels() { # $1 fake home, $2 gated file
  local act p nf target
  while read -r act p nf; do
    [ "$act" = "RUN" ] || continue
    target="$(sentinel_for "$p")"
    [ -n "$target" ] || continue
    if [ -L "$1/$target" ]; then
      case "$(readlink -f "$1/$target")" in "$REPO/$p"/*)
        pass "deploy/$p" "$target is a symlink into the repo" ;;
      *) fail "deploy/$p" "$target does not resolve into $REPO/$p" ;;
      esac
    else
      fail "deploy/$p" "expected symlink at $target"
    fi
  done < "$2"
}

# Read-only proof the real $HOME was not touched: state of every sentinel
# target must be identical before and after the smoke.
REALHOME_STATES="$(newtmp)/states"
snapshot_real_home() { # $1 outfile
  local k t line=""
  while read -r k; do
    [ -n "$k" ] || continue
    t="$ORIG_HOME/$(sentinel_for "$k")"
    if [ -L "$t" ]; then line="L"
    elif [ -d "$t" ]; then line="D"
    elif [ -f "$t" ]; then line="F"
    else line="-"
    fi
    printf '%s %s\n' "$k" "$line" >> "$1"
  done <<<"$(sentinel_keys)"
}

FH="$(newtmp)"
# Resolve the tree through any symlinked ancestor (macOS /var -> /private/var):
the sync guard correctly refuses a folded agent dir, so a fake HOME reached
through a symlink would trip it for the wrong reason.
FH="$(cd "$FH" && pwd -P)"
DEPLOY_OUT="$(newtmp)/out"
DEPLOY_RC=0

phase_deploy() {
  if [ -z "$REAL_STOW" ]; then req_skip "deploy/all" "stow not installed"; return; fi
  if [ -z "$NODE_BIN" ]; then req_skip "deploy/all" "node not installed (pi-settings-sync)"; return; fi
  snapshot_real_home "$REALHOME_STATES"
  run_deploy "$REPO" "$FH" "" > "$DEPLOY_OUT" 2>&1; DEPLOY_RC=$?
  if [ "$DEPLOY_RC" -eq 0 ]; then pass "deploy/exit" "install.sh-equivalent sequence exited 0"
  else
    fail "deploy/exit" "sequence exited $DEPLOY_RC"; sed 's/^/  | /' "$DEPLOY_OUT"; return
  fi
  grep -q '^OK pi-settings-sync$' "$DEPLOY_OUT" && pass "deploy/pi-settings-sync" "ran offline against fake HOME" \
    || fail "deploy/pi-settings-sync" "did not run"
  # install.sh no longer compiles terminfo: the profile's activation owns it
  # (nix/modules/shared/default.nix, home.activation.ghosttyTerminfo), so this
  # phase must not mirror a step the script does not run.
  if grep -q '^OK terminfo$' "$DEPLOY_OUT"; then
    fail "deploy/terminfo" "the mirror still runs a step install.sh dropped"
  else
    pass "deploy/terminfo" "no terminfo step outside the profile"
  fi
  check_containment "$FH"
  check_real_files "$FH"
  check_sentinels "$FH" "$GATED_FILE"
  # Every gated skip must appear in the run log (skip-with-reason, no abort).
  local p reason
  while read -r _ p reason; do
    grep -q "^SKIP stow $p " "$DEPLOY_OUT" && pass "deploy/skip-$p" "$reason" \
      || fail "deploy/skip-$p" "expected skip not logged"
  done < <(grep '^SKIP ' "$GATED_FILE")
}

# Portable stand-ins for GNU find's -printf (macOS find has none): one
# "<relpath> <target>" line per symlink, one "<relpath>" line per real file.
list_links() { # $1 root
  local l
  find "$1" -type l | while IFS= read -r l; do
    printf '%s %s\n' "${l#"$1"/}" "$(readlink "$l")"
  done | sort
}
list_reals() { # $1 root
  local f
  find "$1" \! -type l \! -type d | while IFS= read -r f; do
    printf '%s\n' "${f#"$1"/}"
  done | sort
}

phase_idempotence() {
  if [ -z "$REAL_STOW" ] || [ -z "$NODE_BIN" ] || [ "$DEPLOY_RC" -ne 0 ]; then
    req_skip "idempotence/all" "deploy phase did not run"; return
  fi
  local before after
  list_links "$FH" > "$DEPLOY_OUT.links1"
  list_reals "$FH" > "$DEPLOY_OUT.reals1"
  run_deploy "$REPO" "$FH" "" > "$DEPLOY_OUT.2" 2>&1; local rc=$?
  list_links "$FH" > "$DEPLOY_OUT.links2"
  list_reals "$FH" > "$DEPLOY_OUT.reals2"
  if [ "$rc" -eq 0 ]; then pass "idempotence/exit" "second run exited 0"
  else fail "idempotence/exit" "second run exited $rc"; sed 's/^/  | /' "$DEPLOY_OUT.2"; fi
  if grep -qiE 'conflict|cannot|error' "$DEPLOY_OUT.2"; then
    fail "idempotence/no-conflicts" "second run reported errors about existing targets"
  else pass "idempotence/no-conflicts" "no errors about existing targets"; fi
  diff "$DEPLOY_OUT.links1" "$DEPLOY_OUT.links2" >/dev/null \
    && pass "idempotence/symlinks" "symlink set unchanged" \
    || fail "idempotence/symlinks" "second run changed the symlink set"
  diff "$DEPLOY_OUT.reals1" "$DEPLOY_OUT.reals2" >/dev/null \
    && pass "idempotence/real-files" "real-file set unchanged" \
    || fail "idempotence/real-files" "second run changed real files"
  # Real $HOME untouched (read-only comparison).
  local after
  after="$(newtmp)/states2"; snapshot_real_home "$after"
  diff "$REALHOME_STATES" "$after" >/dev/null \
    && pass "deploy/real-home-untouched" "no writes to the real \$HOME" \
    || fail "deploy/real-home-untouched" "real \$HOME state changed"
}

phase_guards() {
  # install.sh has exactly two roles since S03: bootstrap Nix, then run stow.
  # Every package and service install moved into the flake (flake.nix), so
  # the old per-step fragility guards now live in the flake, not in this file.
  # What stays guarded here: the platform gates on the stow set, and the rule
  # that no installer crept back into install.sh.

  local guard_line
  guard_line() { # $1 step pattern, $2 guard pattern, $3 look-back lines
    local n hit gn
    n=$(grep -nE "$1" "$INSTALL" | head -1 | cut -d: -f1)
    if [ -z "$n" ]; then fail "guards/$1" "step not found in install.sh"; return; fi
    gn=$(head -n $((n - 1)) "$INSTALL" | tail -n "${3:-3}" | grep -nE "$2" | tail -1 | cut -d: -f1)
    if [ -n "$gn" ]; then pass "guards/$1" "guarded by $2"
    else fail "guards/$1" "no $2 guard within ${3:-3} lines above (set -e abort risk)"; fi
  }
  # launchd is Darwin-only; install.sh guards it with an uname check around the
  # darwin list loop, so look for that guard instead of a literal stow line.
  if grep -q 'uname -s.*Darwin' "$INSTALL" && grep -q 'stow-packages-darwin' "$INSTALL"; then
    pass "guards/launchd" "guarded by the uname check around the darwin list"
  else
    fail "guards/launchd" "no Darwin guard around the launchd stow"
  fi

  # The owner rule: installs belong to the flake. Only the Nix bootstrap may
  # fetch an installer; brew bundle, npm/cargo/go installs, git clones and
  # plugin installs must stay absent.
  local leaks
  # A line that only prints a hint inside an echo is documentation, not a step:
  # require the token to start a command, not to sit inside a quoted string.
  leaks=$(grep -nE '^[[:space:]]*(sudo[[:space:]]+)?(brew bundle|npm (install|ci)|cargo install|go install|git clone|herdr plugin install|rustup|pip install|snap install)' "$INSTALL" || true)
  if [ -z "$leaks" ]; then
    pass "guards/no-installers" "install.sh runs no package or plugin installer"
  else
    fail "guards/no-installers" "installer step returned to install.sh: $leaks"
  fi

  # The Nix bootstrap is the one allowed download, and it must stay guarded by
  # a `command -v nix` test so a second run does nothing.
  guard_line 'install\.determinate\.systems' 'command -v nix' 6
}


phase_conflict() {
  if [ -z "$REAL_STOW" ] || [ -z "$NODE_BIN" ]; then
    req_skip "conflict/all" "stow/node not installed"; return
  fi
  local FHC out
  FHC="$(newtmp)"
  # Never seed through a symlink: a fresh home guarantees .config is real.
  if [ -L "$FHC/.config" ] || [ -e "$FHC/.config" ]; then
    fail "conflict/setup" "fake HOME not fresh; refusing to seed"; return
  fi
  mkdir -p "$FHC/.config/ghostty"
  echo PRECIOUS-DATA > "$FHC/.config/ghostty/config"
  out=$(run_deploy "$REPO" "$FHC" "" 2>&1); local rc=$?
  if [ "$rc" -ne 0 ]; then pass "conflict/detected" "pre-existing real file made the deployment fail (rc=$rc)"
  else fail "conflict/detected" "deployment succeeded despite a conflicting real file (silent clobber risk)"; fi
  if grep -qi conflict <<<"$out"; then pass "conflict/message" "stow reported the conflict clearly"
  else fail "conflict/message" "no conflict message in output: $out"; fi
  if [ "$(cat "$FHC/.config/ghostty/config")" = "PRECIOUS-DATA" ] && [ ! -L "$FHC/.config/ghostty/config" ]; then
    pass "conflict/no-clobber" "pre-existing file untouched (still a real file)"
  else fail "conflict/no-clobber" "pre-existing file was clobbered or replaced"; fi
  if [ -z "$(find "$FHC" -type l)" ]; then
    pass "conflict/contained" "failed deployment left no half-stowed tree (rollback removed earlier packages)"
  else fail "conflict/contained" "half-stowed tree left behind: $(find "$FHC" -type l | head -5)"; fi
}

phase_stub() {
  if [ -z "$REAL_STOW" ] || [ -z "$NODE_BIN" ]; then
    req_skip "stub/all" "stow/node not installed"; return
  fi
  # Sandbox copy of the repo (never the shared worktree) + a failing stow
  # stub on PATH: it passes the first call through, then fails.
  local SB STUBD MARK FHS out
  SB="$(newtmp)"; STUBD="$(newtmp)"; FHS="$(newtmp)"
  MARK="$STUBD/fail-now"
  mkdir -p "$SB/scripts"
  cp -a "$REPO/install.sh" "$REPO/terminfo" "$SB/"
  cp -a "$REPO/scripts/pi-settings-sync" "$REPO/scripts/hooks" "$SB/scripts/"
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    cp -a "$REPO/$p" "$SB/"
  done <<<"$(sentinel_keys)"
  printf '#!/bin/sh\nif [ -e "%s" ]; then exit 1; fi\n: > "%s"\nexec "%s" "$@"\n' \
    "$MARK" "$MARK" "$REAL_STOW" > "$STUBD/stow"
  chmod +x "$STUBD/stow"
  out=$(run_deploy "$SB" "$FHS" "$STUBD" 2>&1); local rc=$?
  if [ "$rc" -ne 0 ] && grep -q '^FAILSTEP ' <<<"$out"; then
    pass "stub/detected" "failing step surfaced as a hard failure (rc=$rc)"
  else fail "stub/detected" "failing step was not reported (rc=$rc): $out"; fi
  if grep -q '^OK stow zsh$' <<<"$out" && grep -q '^ROLLBACK: zsh' <<<"$out"; then
    pass "stub/rollback" "first package stowed, then unstowed by rollback"
  else fail "stub/rollback" "rollback did not undo the stowed package"; fi
  if [ -z "$(find "$FHS" -type l)" ]; then
    pass "stub/contained" "no half-stowed tree after the failure"
  else fail "stub/contained" "half-stowed tree survived: $(find "$FHS" -type l | head -5)"; fi
  # Git hooks step (install.sh section 8), exercised in the sandbox copy so
  # the shared worktree's .git is never touched.
  mkdir -p "$SB/.git/hooks"
  ln -sf "$SB/scripts/hooks/pre-commit" "$SB/.git/hooks/pre-commit"
  local l1 l2
  l1="$(readlink "$SB/.git/hooks/pre-commit")"
  ln -sf "$SB/scripts/hooks/pre-commit" "$SB/.git/hooks/pre-commit"
  l2="$(readlink "$SB/.git/hooks/pre-commit")"
  if [ "$l1" = "$SB/scripts/hooks/pre-commit" ] && [ "$l2" = "$l1" ] && [ -f "$l1" ]; then
    pass "stub/git-hook" "pre-commit hook linked into sandbox .git, idempotent on re-run"
  else fail "stub/git-hook" "hook link wrong or not idempotent ($l1 vs $l2)"; fi
}

PHASES=(lint pkgshape plan deploy idempotence guards conflict stub)
for ph in "${PHASES[@]}"; do
  echo "-- phase: $ph"
  t0="$(now_ms)"
  "phase_$ph"
  echo "   (${ph}: $(( $(now_ms) - t0 )) ms)"
done

TOTAL_MS=$(( $(now_ms) - T0 ))
if [ "$TOTAL_MS" -le 60000 ]; then pass "sla/total" "suite finished in ${TOTAL_MS} ms (< 60 s)"
else fail "sla/total" "suite took ${TOTAL_MS} ms (> 60 s)"; fi

echo "== test-install-smoke: ${#PHASES[@]} phases — $PASS_C pass, $SKIP_C skip, $FAIL_C fail — ${TOTAL_MS} ms"
[ "$FAIL_C" -eq 0 ] || exit 1
exit 0
