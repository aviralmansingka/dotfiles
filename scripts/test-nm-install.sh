#!/bin/sh
# Paths: scripts/install-no-mistakes scripts/rollback-no-mistakes pi/bin/no-mistakes-daemon
#
# Offline regression suite for the owned No Mistakes installer, rollback, and
# daemon wrapper (CI surfaces prs-08 #1-#2: PRs #105 pinned install, #278
# bridge era). It complements scripts/verify-no-mistakes-installation (V01):
# V01 drives the full lifecycle through a fixture curl; this suite drives the
# NO_MISTAKES_ASSET offline path, the fixture-version pin surface, lock
# contention with live and reaped pids, the daemon wrapper (run via `sh`),
# and mutation tests that prove each guard catches its regression.
#
# Checks:
#   fixtures-checksums      : fixture tarballs match checksums.sha256.
#   install-offline         : NO_MISTAKES_ASSET happy path; manifest pinned.
#   install-idempotent      : re-run keeps inode, manifest; no rollback copy.
#   install-sha-mismatch    : wrong pin and corrupt asset abort pre-mutation.
#   install-wrong-version   : asset version != pin aborts before replacement.
#   install-trap-cleanup    : failed init leaves no temps/lock; retry repairs.
#   install-version-replacement: different version reinstalls + keeps rollback;
#                             same version skips the replacement.
#   install-refusals       : unmanifested/tampered prior state and a wrong-agent
#                             config abort before any damage.
#   lock-live-owner         : live pid lock is respected by both scripts.
#   lock-stale-reclaim      : reaped-pid and non-numeric pid locks are reclaimed.
#   rollback-history        : rollback restores prior binary, keeps NM_HOME
#                             runtime history, and is idempotent.
#   rollback-missing        : no rollback manifest gives a clean failure.
#   wrapper-exports         : wrapper exports telemetry/update/NM_HOME/PI dir.
#   wrapper-daemon-root     : daemon execs run --root with NM_HOME override.
#   wrapper-args            : daemon/exec/unknown/relative-home validation.
#   wrapper-missing-binary  : missing binary fails cleanly with exit 1.
#   pin-drift               : repo pinned VERSION matches the installed
#                             no-mistakes binary's version when one exists
#                             (SKIP when none is installed — absence is not
#                             drift, e.g. CI runners); FAIL on mismatch with
#                             the pin-update procedure. Offline and read-only:
#                             the version probe runs with
#                             NO_MISTAKES_NO_UPDATE_CHECK=1 so no network
#                             update check happens and no update-check.json
#                             is written.
#   mutation-*              : each guard removed must let the regression in.
#
# Dual-mode pattern (PR #293 rule):
#   default : a missing primitive prints SKIP with a message and exits 0.
#   STRICT=1: a missing primitive FAILs. Use this mode in CI.
#
# Deterministic: no network, no real launchd/systemd (fixture launchctl and
# systemctl stubs shadow the real ones inside each sandbox), no real NM_HOME,
# no mutation of the caller's HOME. Sandboxes live under mktemp. No sleep
# longer than 100 ms is ever waited on. Total runtime stays under 30 s.

set -u

# Resolve the script dir with shell builtins only, so a stripped PATH
# cannot corrupt the gap reasons before the SKIP gate.
case $0 in
  */*) SCRIPT_DIR=$(CDPATH= cd -- "${0%/*}" && pwd -P) || SCRIPT_DIR= ;;
  *) SCRIPT_DIR=$(pwd) ;;
esac
REPO_ROOT=
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/test-nm-install.sh" ]; then
  REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
fi
INSTALL_SRC=${REPO_ROOT:-}/scripts/install-no-mistakes
ROLLBACK_SRC=${REPO_ROOT:-}/scripts/rollback-no-mistakes
WRAPPER_SRC=${REPO_ROOT:-}/pi/bin/no-mistakes-daemon
PLIST_SRC=${REPO_ROOT:-}/launchd/Library/LaunchAgents/com.aviral.no-mistakes.plist
FIXTURE_DIR=${SCRIPT_DIR:-}/fixtures/nm-install
# Fixture versions mirror real release strings (B25): V1 is the current repo
# pin's version; V2 is a hypothetical next release used to exercise the
# exact-version replacement/rollback paths.
FIXTURE_V1=v1.84.0
FIXTURE_V2=v1.85.0
FIXTURE_TARBALL_V1=$FIXTURE_DIR/no-mistakes-$FIXTURE_V1-fixture.tar.gz
FIXTURE_TARBALL_V2=$FIXTURE_DIR/no-mistakes-$FIXTURE_V2-fixture.tar.gz
FIXTURE_NAME_V1=no-mistakes-$FIXTURE_V1-fixture.tar.gz
FIXTURE_NAME_V2=no-mistakes-$FIXTURE_V2-fixture.tar.gz

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
STRICT=${STRICT:-0}

bail() {
  printf 'test-nm-install: %s\n' "$*" >&2
  exit 1
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

now_ms() {
  # A host without date reports 0 ms rather than failing the run.
  command -v date >/dev/null 2>&1 || { printf '0'; return; }
  tms_t=$(date +%s%N 2>/dev/null)
  case $tms_t in
    *N|'') tms_t=$(( $(date +%s) * 1000 )) ;;
    *) tms_t=$(( tms_t / 1000000 )) ;;
  esac
  printf '%s' "$tms_t"
}

report() {
  # $1 status  $2 name  $3 surface file  $4 reason  $5 ms
  printf '%s %-26s %-9s %s (%s ms)\n' "$1" "$2" "$3" "$4" "$5"
  case $1 in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

run_check() {
  rc_name=$1
  rc_file=$2
  rc_err=$(mktemp "${TMPDIR:-/tmp}/nm-install-check.XXXXXX")
  rc_start=$(now_ms)
  if ( "check_$rc_name" ) 2>"$rc_err"; then
    rc_status=PASS
    rc_reason=ok
  else
    rc_status=FAIL
    rc_reason=$(sed -n '1p' "$rc_err")
    [ -n "$rc_reason" ] || rc_reason='check exited non-zero without a reason'
  fi
  rm -f "$rc_err"
  rc_ms=$(( $(now_ms) - rc_start ))
  report "$rc_status" "$rc_name" "$rc_file" "$rc_reason" "$rc_ms"
}

# --- sandbox infrastructure ------------------------------------------------
# Each check builds a throwaway world: a fake HOME, a git worktree that holds
# patched copies of the real scripts (VERSION + platform SHA pinned to the
# fixture tarball), and a stub bin dir whose systemctl/launchctl/pi fixtures
# shadow the real ones. The installer never observes the real host.

SB_PLATFORM=
SB_SHA_VAR=

detect_platform() {
  command -v uname >/dev/null 2>&1 || return
  case $(uname -s)/$(uname -m) in
    Darwin/arm64) SB_PLATFORM=darwin-arm64; SB_SHA_VAR=DARWIN_ARM64_SHA256 ;;
    Linux/x86_64) SB_PLATFORM=linux-amd64; SB_SHA_VAR=LINUX_AMD64_SHA256 ;;
  esac
}

build_sandbox() {
  # $1 fixture version  $2 fixture tarball  $3 optional pin override digest
  bs_version=$1
  bs_tarball=$2
  bs_pin=${3:-}
  SB=$(mktemp -d "${TMPDIR:-/tmp}/nm-install-sandbox.XXXXXXXX") || bail 'mktemp -d failed'
  trap 'rm -rf "$SB"' EXIT
  SB_HOME=$SB/home
  SB_BIN=$SB_HOME/.local/bin
  SB_STATE=$SB_HOME/.local/state/no-mistakes-installer
  SB_NM=$SB_HOME/.no-mistakes
  SB_REPO=$SB/repo
  SB_STUB=$SB/stub-bin
  SB_TARGET=$SB_BIN/no-mistakes
  SB_MANIFEST=$SB_STATE/current.manifest
  SB_LOCK=$SB_STATE/install.lock
  SB_ASSET=$bs_tarball
  SB_INSTALLER=$SB_REPO/scripts/install-no-mistakes
  SB_ROLLBACK=$SB_REPO/scripts/rollback-no-mistakes
  mkdir -p "$SB_BIN" "$SB_STATE/rollback" "$SB_NM" \
    "$SB_HOME/Library/LaunchAgents" "$SB_REPO/scripts" \
    "$SB_REPO/launchd/Library/LaunchAgents" "$SB_STUB" || bail 'mkdir -p failed'
  git init -q "$SB_REPO" || bail 'git init failed'
  bs_sha=$(sha256_file "$bs_tarball") || bail 'SHA-256 tool failed'
  [ -n "$bs_pin" ] || bs_pin=$bs_sha
  sed -e "s/^VERSION=.*/VERSION=$bs_version/" \
      -e "s/^$SB_SHA_VAR=.*/$SB_SHA_VAR=$bs_pin/" \
      "$INSTALL_SRC" > "$SB_INSTALLER" || bail 'installer pin patch failed'
  chmod 0755 "$SB_INSTALLER"
  cp "$ROLLBACK_SRC" "$SB_ROLLBACK" || bail 'rollback copy failed'
  chmod 0755 "$SB_ROLLBACK"
  if [ -f "$PLIST_SRC" ]; then
    cp "$PLIST_SRC" "$SB_REPO/launchd/Library/LaunchAgents/" || bail 'plist copy failed'
    cp "$PLIST_SRC" "$SB_HOME/Library/LaunchAgents/" || bail 'plist deploy failed'
  fi
  cat > "$SB_STUB/pi" <<'STUB'
#!/bin/sh
exit 0
STUB
  cat > "$SB_STUB/systemctl" <<'STUB'
#!/bin/sh
# Fixture systemctl: no unit is ever enabled, so the Linux fallback path runs.
exit 1
STUB
  cat > "$SB_STUB/launchctl" <<'STUB'
#!/bin/sh
# Fixture launchctl: serves a state file only. It never touches a real
# launchd domain.
state=${NM_FIXTURE_LAUNCHD_LOADED:-}
case ${1:-} in
  print)
    [ -n "$state" ] || exit 64
    [ -e "$state" ] || exit 1
    printf 'state = running\npid = 4242\n'
    ;;
  bootout)
    [ -n "$state" ] || exit 64
    rm -f "$state"
    ;;
  bootstrap|kickstart)
    [ -n "$state" ] || exit 64
    : > "$state"
    ;;
  *)
    exit 64
    ;;
esac
exit 0
STUB
  chmod 0755 "$SB_STUB/pi" "$SB_STUB/systemctl" "$SB_STUB/launchctl"
}

sb_run() {
  # Runs a command with the sandbox env. Extra VAR=value operands may precede
  # the command (env applies them after the base set).
  env -i \
    HOME="$SB_HOME" \
    NM_HOME="$SB_NM" \
    NO_MISTAKES_INSTALL_DIR="$SB_BIN" \
    NO_MISTAKES_INSTALL_STATE_DIR="$SB_STATE" \
    NO_MISTAKES_ASSET="$SB_ASSET" \
    NM_FIXTURE_LAUNCHD_LOADED="$SB/launchd-loaded" \
    PATH="$SB_STUB:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" \
    "$@"
}

run_install() {
  # Extra VAR=value operands may precede nothing else; runs the sandbox
  # installer. Sets RUN_OUT, RUN_ERR, RUN_RC.
  if RUN_OUT=$(sb_run "$@" "$SB_INSTALLER" 2>"$SB/run.err"); then
    RUN_RC=0
  else
    RUN_RC=$?
  fi
  RUN_ERR=$(cat "$SB/run.err" 2>/dev/null || printf '')
}

run_rollback() {
  if RUN_OUT=$(sb_run "$SB_ROLLBACK" 2>"$SB/run.err"); then
    RUN_RC=0
  else
    RUN_RC=$?
  fi
  RUN_ERR=$(cat "$SB/run.err" 2>/dev/null || printf '')
}

expect_install_ok() {
  run_install "$@"
  [ "$RUN_RC" -eq 0 ] || bail "install failed ($RUN_RC): $RUN_ERR"
  case $RUN_OUT in
    *"no-mistakes $EXPECT_VERSION installed for $SB_PLATFORM"*) ;;
    *) bail "unexpected install output: $RUN_OUT" ;;
  esac
}

manifest_line() {
  grep -Fx "$2" "$1" >/dev/null 2>&1 || bail "manifest lacks line: $2 ($1)"
}

assert_no_temps() {
  for nt_path in "$SB_BIN"/.no-mistakes.* "$SB_STATE"/rollback/.no-mistakes.*; do
    [ -e "$nt_path" ] && bail "leftover temp file: $nt_path"
  done
  return 0
}

assert_lock_released() {
  [ ! -d "$SB_LOCK" ] || bail "install lock left behind: $SB_LOCK"
}

inode_of() {
  ls -i "$1" | awk '{print $1}'
}

# --- checks -----------------------------------------------------------------

check_fixtures_checksums() {
  fxv1_recorded=$(awk -v n="$FIXTURE_NAME_V1" '$NF == n {print $1}' "$FIXTURE_DIR/checksums.sha256")
  fxv2_recorded=$(awk -v n="$FIXTURE_NAME_V2" '$NF == n {print $1}' "$FIXTURE_DIR/checksums.sha256")
  [ -n "$fxv1_recorded" ] || bail "checksums.sha256 has no $FIXTURE_NAME_V1 entry"
  [ -n "$fxv2_recorded" ] || bail "checksums.sha256 has no $FIXTURE_NAME_V2 entry"
  fxv1_actual=$(sha256_file "$FIXTURE_TARBALL_V1") || bail 'SHA-256 tool failed'
  fxv2_actual=$(sha256_file "$FIXTURE_TARBALL_V2") || bail 'SHA-256 tool failed'
  [ "$fxv1_actual" = "$fxv1_recorded" ] || \
    bail "$FIXTURE_NAME_V1 does not match checksums.sha256 (corrupt fixture)"
  [ "$fxv2_actual" = "$fxv2_recorded" ] || \
    bail "$FIXTURE_NAME_V2 does not match checksums.sha256 (corrupt fixture)"
  fxv1_listing=$(tar -tzf "$FIXTURE_TARBALL_V1") || bail 'could not list fixture tarball'
  [ "$fxv1_listing" = "no-mistakes" ] || \
    bail "fixture tarball must contain only no-mistakes, got: $fxv1_listing"
  tar -tvzf "$FIXTURE_TARBALL_V1" | awk '$1 ~ /^-/ && $NF == "no-mistakes" {ok=1} END {exit !ok}' || \
    bail 'fixture tarball member is not a regular executable'
}

check_install_offline() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  expect_install_ok
  [ -x "$SB_TARGET" ] || bail 'target binary missing after install'
  io_version=$("$SB_TARGET" --version)
  case $io_version in
    *"$FIXTURE_V1"*) ;;
    *) bail "target reports wrong version: $io_version" ;;
  esac
  manifest_line "$SB_MANIFEST" "version=$FIXTURE_V1"
  manifest_line "$SB_MANIFEST" "binary_sha256=$(sha256_file "$SB_TARGET")"
  manifest_line "$SB_MANIFEST" "archive_sha256=$FIXTURE_SHA_V1"
  manifest_line "$SB_MANIFEST" "platform=$SB_PLATFORM"
  [ "$(cat "$SB_NM/config.yaml")" = 'agent: pi' ] || bail 'config.yaml not initialized to agent: pi'
  [ -f "$SB_HOME/.agents/skills/no-mistakes/SKILL.md" ] || \
    bail 'canonical skill not generated under HOME'
  [ ! -e "$SB_REPO/.agents/skills/no-mistakes/SKILL.md" ] || \
    bail 'repository-local skill must be forbidden'
  [ "$(cat "$SB_NM/init-invocations")" = "$SB_REPO" ] || \
    bail 'init did not run from the dotfiles worktree'
  assert_no_temps
  assert_lock_released
}

check_install_idempotent() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  expect_install_ok
  ii_inode1=$(inode_of "$SB_TARGET")
  cp "$SB_MANIFEST" "$SB/manifest.before"
  expect_install_ok
  ii_inode2=$(inode_of "$SB_TARGET")
  [ "$ii_inode1" = "$ii_inode2" ] || bail 're-run replaced the binary inode'
  cmp -s "$SB/manifest.before" "$SB_MANIFEST" || bail 'manifest changed on re-run'
  [ ! -e "$SB_STATE/rollback/no-mistakes" ] || \
    bail 'clean re-run must not create a rollback binary'
  [ ! -e "$SB_STATE/rollback/manifest" ] || \
    bail 'clean re-run must not create a rollback manifest'
  ii_inits=$(wc -l < "$SB_NM/init-invocations")
  [ "$ii_inits" -eq 2 ] || bail "init ran $ii_inits times, expected 2"
  assert_no_temps
  assert_lock_released
}

check_install_sha_mismatch() {
  EXPECT_VERSION=$FIXTURE_V1
  # Case 1: valid asset pinned to a wrong digest.
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1" 0000000000000000000000000000000000000000000000000000000000000000
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "wrong pin must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"archive SHA-256 mismatch"*) ;;
    *) bail "wrong pin error missing: $RUN_ERR" ;;
  esac
  case $RUN_ERR in
    *"expected 0000000000000000000000000000000000000000000000000000000000000000"*) ;;
    *) bail "mismatch error lacks expected digest: $RUN_ERR" ;;
  esac
  [ ! -e "$SB_TARGET" ] || bail 'target must not exist after SHA abort'
  [ ! -e "$SB_MANIFEST" ] || bail 'manifest must not exist after SHA abort'
  [ ! -e "$SB_NM/config.yaml" ] || bail 'config must not exist after SHA abort'
  [ ! -e "$SB_HOME/.agents/skills/no-mistakes/SKILL.md" ] || bail 'skill must not exist after SHA abort'
  [ ! -e "$SB_STATE/rollback/no-mistakes" ] || bail 'rollback binary must not exist after SHA abort'
  assert_no_temps
  assert_lock_released
  # Case 2: byte-corrupted asset with a correct pin.
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  cp "$FIXTURE_TARBALL_V1" "$SB/corrupt.tar.gz"
  printf 'X' | dd of="$SB/corrupt.tar.gz" bs=1 seek=0 conv=notrunc 2>/dev/null || bail 'dd failed'
  SB_ASSET=$SB/corrupt.tar.gz
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "corrupt asset must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"archive SHA-256 mismatch"*) ;;
    *) bail "corrupt asset error missing: $RUN_ERR" ;;
  esac
  [ ! -e "$SB_TARGET" ] || bail 'target must not exist after corrupt-asset abort'
  assert_no_temps
  assert_lock_released
}

check_install_wrong_version() {
  # Pin says v9.9.1 but the asset ships a v9.9.2 binary: the SHA passes and
  # only the exact-version check can stop it.
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V2"
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "wrong-version asset must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"binary did not report exact version $FIXTURE_V1"*) ;;
    *) bail "exact-version error missing: $RUN_ERR" ;;
  esac
  [ ! -e "$SB_TARGET" ] || bail 'target must not exist after version abort'
  [ ! -e "$SB_MANIFEST" ] || bail 'manifest must not exist after version abort'
  assert_no_temps
  assert_lock_released
}

check_install_trap_cleanup() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  # Case 1: init succeeds but does not write the skill. The installer must
  # abort through its own check, and the trap must clean temps and lock.
  run_install NM_STUB_SKIP_SKILL=1
  [ "$RUN_RC" -eq 1 ] || bail "skillless init must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"canonical skill"*) ;;
    *) bail "canonical-skill error missing: $RUN_ERR" ;;
  esac
  assert_no_temps
  assert_lock_released
  [ -x "$SB_TARGET" ] || bail 'pinned binary must already be in place by design'
  [ -f "$SB_MANIFEST" ] || bail 'current manifest must already be written by design'
  [ ! -e "$SB_NM/init-invocations" ] || bail 'skillless init must not have logged a run'
  # A retry with a working init must repair the interrupted install.
  expect_install_ok
  [ -f "$SB_HOME/.agents/skills/no-mistakes/SKILL.md" ] || bail 'retry did not repair the skill'
  tc_inits=$(wc -l < "$SB_NM/init-invocations")
  [ "$tc_inits" -eq 1 ] || bail "init ran $tc_inits times after retry, expected 1"
  assert_no_temps
  assert_lock_released
  # Case 2: init itself fails. set -e propagates the stub status (72); the
  # trap must still leave no half-state behind.
  rm -f "$SB_NM/init-invocations"
  run_install NM_STUB_FAIL_INIT=1
  [ "$RUN_RC" -eq 72 ] || \
    bail "failing init must propagate status 72, got rc $RUN_RC"
  assert_no_temps
  assert_lock_released
}

check_install_version_replacement() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  expect_install_ok
  vr_v1_sha=$(sha256_file "$SB_TARGET")
  vr_inode1=$(inode_of "$SB_TARGET")
  # Upgrade the pin to v9.9.2 within the same sandbox: the different version
  # must trigger a reinstall that preserves a verified rollback of v9.9.1.
  sed -e "s/^VERSION=.*/VERSION=$FIXTURE_V2/" \
      -e "s/^$SB_SHA_VAR=.*/$SB_SHA_VAR=$FIXTURE_SHA_V2/" \
      "$INSTALL_SRC" > "$SB_INSTALLER" || bail 'upgrade pin patch failed'
  chmod 0755 "$SB_INSTALLER"
  SB_ASSET=$FIXTURE_TARBALL_V2
  EXPECT_VERSION=$FIXTURE_V2
  expect_install_ok
  vr_v2_sha=$(sha256_file "$SB_TARGET")
  vr_inode2=$(inode_of "$SB_TARGET")
  [ "$vr_inode1" != "$vr_inode2" ] || bail 'different version must replace the binary'
  case $("$SB_TARGET" --version) in
    *"$FIXTURE_V2"*) ;;
    *) bail 'target does not report the upgraded version' ;;
  esac
  manifest_line "$SB_MANIFEST" "version=$FIXTURE_V2"
  manifest_line "$SB_MANIFEST" "binary_sha256=$vr_v2_sha"
  manifest_line "$SB_MANIFEST" "archive_sha256=$FIXTURE_SHA_V2"
  [ "$(sha256_file "$SB_STATE/rollback/no-mistakes")" = "$vr_v1_sha" ] || \
    bail 'rollback binary does not preserve the previous version'
  manifest_line "$SB_STATE/rollback/manifest" "version=$FIXTURE_V1"
  manifest_line "$SB_STATE/rollback/manifest" "binary_sha256=$vr_v1_sha"
  # Same version again: no replacement, rollback metadata stays untouched.
  cp "$SB_MANIFEST" "$SB/manifest.before"
  cp "$SB_STATE/rollback/manifest" "$SB/rollback-manifest.before"
  expect_install_ok
  [ "$(inode_of "$SB_TARGET")" = "$vr_inode2" ] || bail 'same version must not replace the binary'
  cmp -s "$SB/manifest.before" "$SB_MANIFEST" || bail 'manifest changed on same-version re-run'
  cmp -s "$SB/rollback-manifest.before" "$SB_STATE/rollback/manifest" || \
    bail 'rollback manifest changed on same-version re-run'
  assert_no_temps
  assert_lock_released
}

check_lock_live_owner() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  mkdir "$SB_LOCK" || bail 'could not create the lock'
  sleep 5 &
  ll_pid=$!
  printf '%s\n' "$ll_pid" > "$SB_LOCK/owner.pid"
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "install must reject a live lock, got rc $RUN_RC"
  case $RUN_ERR in
    *"another install or rollback holds"*) ;;
    *) bail "live-lock error missing: $RUN_ERR" ;;
  esac
  case $RUN_ERR in
    *"pid $ll_pid"*) ;;
    *) bail "live-lock error lacks the holder pid: $RUN_ERR" ;;
  esac
  [ -d "$SB_LOCK" ] || bail 'live lock must stay intact'
  [ "$(cat "$SB_LOCK/owner.pid")" = "$ll_pid" ] || bail 'live lock owner.pid must stay intact'
  run_rollback
  [ "$RUN_RC" -eq 1 ] || bail "rollback must reject a live lock, got rc $RUN_RC"
  case $RUN_ERR in
    *"another install or rollback holds"*) ;;
    *) bail "rollback live-lock error missing: $RUN_ERR" ;;
  esac
  [ -d "$SB_LOCK" ] || bail 'live lock must stay intact after rollback rejection'
  kill "$ll_pid" 2>/dev/null || true
  wait "$ll_pid" 2>/dev/null || true
  [ ! -e "$SB_TARGET" ] || bail 'no install may happen behind a live lock'
}

check_lock_stale_reclaim() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  # A genuinely reaped pid: spawn, wait for exit, then record it as the owner.
  sh -c 'exit 0' &
  ls_dead=$!
  wait "$ls_dead"
  mkdir "$SB_LOCK" || bail 'could not create the stale lock'
  printf '%s\n' "$ls_dead" > "$SB_LOCK/owner.pid"
  expect_install_ok
  [ -x "$SB_TARGET" ] || bail 'stale lock reclaim did not install'
  assert_lock_released
  assert_no_temps
  # A non-numeric owner pid is equally stale and must be reclaimed.
  mkdir "$SB_LOCK" || bail 'could not re-create the lock'
  printf 'not-a-pid\n' > "$SB_LOCK/owner.pid"
  expect_install_ok
  assert_lock_released
  assert_no_temps
}

check_rollback_history() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  expect_install_ok
  rh_v1_sha=$(sha256_file "$SB_TARGET")
  sed -e "s/^VERSION=.*/VERSION=$FIXTURE_V2/" \
      -e "s/^$SB_SHA_VAR=.*/$SB_SHA_VAR=$FIXTURE_SHA_V2/" \
      "$INSTALL_SRC" > "$SB_INSTALLER" || bail 'upgrade pin patch failed'
  chmod 0755 "$SB_INSTALLER"
  SB_ASSET=$FIXTURE_TARBALL_V2
  EXPECT_VERSION=$FIXTURE_V2
  expect_install_ok
  # Runtime history the rollback must preserve untouched.
  mkdir -p "$SB_NM/logs"
  printf 'fixture history database\n' > "$SB_NM/history.sqlite3"
  printf 'fixture history log\n' > "$SB_NM/logs/history.log"
  rh_db_sha=$(sha256_file "$SB_NM/history.sqlite3")
  rh_log_sha=$(sha256_file "$SB_NM/logs/history.log")
  run_rollback
  [ "$RUN_RC" -eq 0 ] || bail "rollback failed ($RUN_RC): $RUN_ERR"
  case $RUN_OUT in
    *"no-mistakes rolled back to $FIXTURE_V1"*) ;;
    *) bail "unexpected rollback output: $RUN_OUT" ;;
  esac
  case $("$SB_TARGET" --version) in
    *"$FIXTURE_V1"*) ;;
    *) bail 'rollback did not restore the previous binary' ;;
  esac
  [ "$(sha256_file "$SB_TARGET")" = "$rh_v1_sha" ] || bail 'rollback binary digest mismatch'
  manifest_line "$SB_MANIFEST" "version=$FIXTURE_V1"
  manifest_line "$SB_MANIFEST" "binary_sha256=$rh_v1_sha"
  [ "$(sha256_file "$SB_NM/history.sqlite3")" = "$rh_db_sha" ] || \
    bail 'rollback touched NM_HOME history database'
  [ "$(sha256_file "$SB_NM/logs/history.log")" = "$rh_log_sha" ] || \
    bail 'rollback touched NM_HOME history log'
  assert_no_temps
  assert_lock_released
  # Second rollback is idempotent: same inode, same manifest.
  rh_inode1=$(inode_of "$SB_TARGET")
  cp "$SB_MANIFEST" "$SB/manifest.before"
  run_rollback
  [ "$RUN_RC" -eq 0 ] || bail "second rollback failed ($RUN_RC): $RUN_ERR"
  [ "$(inode_of "$SB_TARGET")" = "$rh_inode1" ] || bail 'second rollback replaced the binary'
  cmp -s "$SB/manifest.before" "$SB_MANIFEST" || bail 'second rollback changed the manifest'
  assert_no_temps
  assert_lock_released
}

check_rollback_missing() {
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  run_rollback
  [ "$RUN_RC" -eq 1 ] || bail "rollback without artifacts must fail, got rc $RUN_RC"
  case $RUN_ERR in
    *"no verified rollback manifest"*) ;;
    *) bail "missing-artifact error missing: $RUN_ERR" ;;
  esac
  [ ! -e "$SB_TARGET" ] || bail 'rollback must not install a binary'
  assert_no_temps
  assert_lock_released
  # An incomplete rollback manifest is rejected before any replacement.
  mkdir -p "$SB_STATE/rollback"
  tar -xzf "$FIXTURE_TARBALL_V1" -C "$SB_STATE/rollback" no-mistakes || bail 'extraction failed'
  chmod 0755 "$SB_STATE/rollback/no-mistakes"
  printf 'version=%s\n' "$FIXTURE_V1" > "$SB_STATE/rollback/manifest"
  run_rollback
  [ "$RUN_RC" -eq 1 ] || bail "incomplete rollback manifest must fail, got rc $RUN_RC"
  case $RUN_ERR in
    *"rollback manifest is incomplete"*) ;;
    *) bail "incomplete-manifest error missing: $RUN_ERR" ;;
  esac
  [ ! -e "$SB_TARGET" ] || bail 'incomplete manifest rollback must not install'
  assert_no_temps
  assert_lock_released
}

check_install_refusals() {
  # Case 1: an existing binary without a current manifest refuses replacement.
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  expect_install_ok
  ir_v1_sha=$(sha256_file "$SB_TARGET")
  rm -f "$SB_MANIFEST"
  sed -e "s/^VERSION=.*/VERSION=$FIXTURE_V2/" \
      -e "s/^$SB_SHA_VAR=.*/$SB_SHA_VAR=$FIXTURE_SHA_V2/" \
      "$INSTALL_SRC" > "$SB_INSTALLER" || bail 'upgrade pin patch failed'
  chmod 0755 "$SB_INSTALLER"
  SB_ASSET=$FIXTURE_TARBALL_V2
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "unmanifested replacement must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"existing binary has no verified current manifest"*) ;;
    *) bail "unmanifested-replacement error missing: $RUN_ERR" ;;
  esac
  [ "$(sha256_file "$SB_TARGET")" = "$ir_v1_sha" ] || \
    bail 'refused replacement must leave the installed binary untouched'
  assert_no_temps
  assert_lock_released
  # Case 2: a manifest that does not match the installed binary.
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  expect_install_ok
  ir2_v1_sha=$(sha256_file "$SB_TARGET")
  sed 's/^binary_sha256=.*/binary_sha256=0000000000000000000000000000000000000000000000000000000000000000/' \
    "$SB_MANIFEST" > "$SB_MANIFEST.new" || bail 'manifest tamper failed'
  mv -f "$SB_MANIFEST.new" "$SB_MANIFEST"
  sed -e "s/^VERSION=.*/VERSION=$FIXTURE_V2/" \
      -e "s/^$SB_SHA_VAR=.*/$SB_SHA_VAR=$FIXTURE_SHA_V2/" \
      "$INSTALL_SRC" > "$SB_INSTALLER" || bail 'upgrade pin patch failed'
  chmod 0755 "$SB_INSTALLER"
  SB_ASSET=$FIXTURE_TARBALL_V2
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "manifest-binary mismatch must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"installed binary does not match its current manifest"*) ;;
    *) bail "manifest-mismatch error missing: $RUN_ERR" ;;
  esac
  [ "$(sha256_file "$SB_TARGET")" = "$ir2_v1_sha" ] || \
    bail 'refused replacement must leave the installed binary untouched'
  assert_no_temps
  assert_lock_released
  # Case 3: an existing config that does not select native Pi aborts.
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  printf 'agent: codex\n' > "$SB_NM/config.yaml"
  run_install
  [ "$RUN_RC" -eq 1 ] || bail "wrong-agent config must abort, got rc $RUN_RC"
  case $RUN_ERR in
    *"must select native Pi with 'agent: pi'"*) ;;
    *) bail "wrong-agent error missing: $RUN_ERR" ;;
  esac
  assert_no_temps
  assert_lock_released
}

# --- daemon wrapper checks (always run via `sh`) ----------------------------

wrapper_managed_home() {
  # $1 dir: prepares a managed home with the fixture binary installed.
  mkdir -p "$1/.local/bin" || bail 'mkdir failed'
  tar -xzf "$FIXTURE_TARBALL_V1" -C "$1/.local/bin" no-mistakes || \
    bail 'fixture binary extraction failed'
  chmod 0755 "$1/.local/bin/no-mistakes"
}

check_wrapper_exports() {
  we_home=$(mktemp -d "${TMPDIR:-/tmp}/nm-install-wrapper.XXXXXXXX") || bail 'mktemp -d failed'
  trap 'rm -rf "$we_home"' EXIT
  wrapper_managed_home "$we_home"
  we_out=$(env -i HOME="$we_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME="$we_home" \
    sh "$WRAPPER_SRC" exec /bin/sh -c \
    'printf "%s\n%s\n%s\n%s\n%s\n" "$NO_MISTAKES_TELEMETRY" "$NO_MISTAKES_NO_UPDATE_CHECK" "$NM_HOME" "$PI_CODING_AGENT_DIR" "${PATH%%:*}"') || \
    bail 'wrapper exec failed'
  we_telemetry=$(printf '%s\n' "$we_out" | sed -n '1p')
  we_update=$(printf '%s\n' "$we_out" | sed -n '2p')
  we_nmhome=$(printf '%s\n' "$we_out" | sed -n '3p')
  we_pidir=$(printf '%s\n' "$we_out" | sed -n '4p')
  we_path0=$(printf '%s\n' "$we_out" | sed -n '5p')
  [ "$we_telemetry" = 0 ] || bail "NO_MISTAKES_TELEMETRY is not 0: $we_telemetry"
  [ "$we_update" = 1 ] || bail "NO_MISTAKES_NO_UPDATE_CHECK is not 1: $we_update"
  [ "$we_nmhome" = "$we_home/.no-mistakes" ] || bail "NM_HOME wrong: $we_nmhome"
  [ "$we_pidir" = "$we_home/.pi/agent" ] || bail "PI_CODING_AGENT_DIR wrong: $we_pidir"
  [ "$we_path0" = "$we_home/.local/bin" ] || bail "PATH does not start with the managed bin: $we_path0"
}

check_wrapper_daemon_root() {
  wd_home=$(mktemp -d "${TMPDIR:-/tmp}/nm-install-wrapper.XXXXXXXX") || bail 'mktemp -d failed'
  trap 'rm -rf "$wd_home"' EXIT
  wrapper_managed_home "$wd_home"
  # Default: daemon run --root points at the managed NM_HOME.
  env -i HOME="$wd_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME="$wd_home" NM_STUB_LOG="$wd_home/run.log" \
    sh "$WRAPPER_SRC" daemon || bail 'wrapper daemon failed'
  [ "$(cat "$wd_home/run.log")" = "daemon run --root $wd_home/.no-mistakes" ] || \
    bail "daemon run --root wrong: $(cat "$wd_home/run.log")"
  # Override: an explicit NM_HOME wins for both the export and --root.
  env -i HOME="$wd_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME="$wd_home" NM_HOME="$wd_home/custom-home" \
    NM_STUB_LOG="$wd_home/run2.log" \
    sh "$WRAPPER_SRC" daemon || bail 'wrapper daemon with NM_HOME override failed'
  [ "$(cat "$wd_home/run2.log")" = "daemon run --root $wd_home/custom-home" ] || \
    bail "daemon run --root ignored NM_HOME override: $(cat "$wd_home/run2.log")"
  wd_probe=$(env -i HOME="$wd_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME="$wd_home" NM_HOME="$wd_home/custom-home" \
    sh "$WRAPPER_SRC" exec /bin/sh -c 'printf "%s\n" "$NM_HOME"') || \
    bail 'wrapper exec probe failed'
  [ "$wd_probe" = "$wd_home/custom-home" ] || bail "NM_HOME override not exported: $wd_probe"
}

check_wrapper_args() {
  wa_home=$(mktemp -d "${TMPDIR:-/tmp}/nm-install-wrapper.XXXXXXXX") || bail 'mktemp -d failed'
  trap 'rm -rf "$wa_home"' EXIT
  wrapper_managed_home "$wa_home"
  wa_run() {
    env -i HOME="$wa_home" PATH=/bin:/usr/bin \
      NO_MISTAKES_MANAGED_HOME="$wa_home" \
      sh "$WRAPPER_SRC" "$@" 2>"$wa_home/err"
  }
  if wa_out=$(wa_run daemon extra-arg); then
    bail 'daemon must reject extra arguments'
  else
    wa_rc=$?
  fi
  [ "$wa_rc" -eq 1 ] || bail "daemon arg rejection must exit 1, got $wa_rc"
  case $(cat "$wa_home/err") in
    *'daemon takes no arguments'*) ;;
    *) bail "daemon arg error missing: $(cat "$wa_home/err")" ;;
  esac
  if wa_out=$(wa_run exec); then
    bail 'exec must reject an empty command'
  else
    wa_rc=$?
  fi
  [ "$wa_rc" -eq 1 ] || bail "exec rejection must exit 1, got $wa_rc"
  case $(cat "$wa_home/err") in
    *'exec requires a command'*) ;;
    *) bail "exec error missing: $(cat "$wa_home/err")" ;;
  esac
  if wa_out=$(wa_run frobnicate); then
    bail 'unknown subcommand must fail'
  else
    wa_rc=$?
  fi
  [ "$wa_rc" -eq 1 ] || bail "unknown subcommand must exit 1, got $wa_rc"
  case $(cat "$wa_home/err") in
    *'usage: no-mistakes-daemon'*) ;;
    *) bail "usage error missing: $(cat "$wa_home/err")" ;;
  esac
  if wa_out=$(env -i HOME="$wa_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME=relative-home \
    sh "$WRAPPER_SRC" daemon 2>"$wa_home/err"); then
    bail 'relative managed home must fail'
  else
    wa_rc=$?
  fi
  [ "$wa_rc" -eq 1 ] || bail "relative home must exit 1, got $wa_rc"
  case $(cat "$wa_home/err") in
    *'managed home must be an absolute path'*) ;;
    *) bail "relative home error missing: $(cat "$wa_home/err")" ;;
  esac
}

check_wrapper_missing_binary() {
  wm_home=$(mktemp -d "${TMPDIR:-/tmp}/nm-install-wrapper.XXXXXXXX") || bail 'mktemp -d failed'
  trap 'rm -rf "$wm_home"' EXIT
  if wm_out=$(env -i HOME="$wm_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME="$wm_home" \
    sh "$WRAPPER_SRC" daemon 2>"$wm_home/err"); then
    bail 'missing binary must fail'
  else
    wm_rc=$?
  fi
  [ "$wm_rc" -eq 1 ] || \
    bail "missing binary must be a clean exit 1, got $wm_rc (crash?)"
  case $(cat "$wm_home/err") in
    *'pinned binary is not executable'*) ;;
    *) bail "missing binary error missing: $(cat "$wm_home/err")" ;;
  esac
}

# --- pin drift tripwire (B25) ----------------------------------------------

# Offline, read-only: compare the repo installer's pinned VERSION against the
# version an installed no-mistakes binary reports. The 2026-10 incident let
# the host binary drift to v1.84.0 past the v1.41.2 pin via a manual
# `no-mistakes update` on the wizard's self-managed install (symlink under
# ~/.local/bin), which the pin never governed. This check makes the next
# silent drift loud. Absence of an installed binary is a SKIP, not drift.
check_pin_drift() {
  pd_pin=$(sed -n 's/^VERSION=//p' "$INSTALL_SRC" | head -n 1)
  case $pd_pin in
    v[0-9]*) ;;
    *) bail "could not read the pinned VERSION from $INSTALL_SRC" ;;
  esac
  pd_out=$(NO_MISTAKES_NO_UPDATE_CHECK=1 NO_MISTAKES_TELEMETRY=0 \
    "$PD_BIN" --version 2>/dev/null) || \
    bail "installed binary failed to report a version: $PD_BIN"
  for pd_token in $pd_out; do
    pd_token=$(printf '%s' "$pd_token" | tr -d ',;()[]')
    case $pd_token in
      "$pd_pin"|"${pd_pin#v}") return 0 ;;
    esac
  done
  bail "version drift: repo pin is $pd_pin, but the installed binary at $PD_BIN reports [$pd_out]. Never run 'no-mistakes update' — move the pin by editing VERSION (+ the release digests) in scripts/install-no-mistakes to the official release, then re-run scripts/install-no-mistakes."
}

# --- mutation checks: each guard removed must let the regression in ---------

mutate_installer() {
  # $1 sed expression. Rewrites the sandbox installer in place. A sed that
  # changes nothing must fail the check: a no-op mutation would PASS for the
  # wrong reason.
  mu_tmp=$SB/installer.mutated
  sed "$1" "$SB_INSTALLER" > "$mu_tmp" || bail 'mutation sed failed'
  if cmp -s "$mu_tmp" "$SB_INSTALLER"; then
    bail "mutation did not change the installer: $1"
  fi
  mv -f "$mu_tmp" "$SB_INSTALLER"
  chmod 0755 "$SB_INSTALLER"
}

check_mutation_sha_guard() {
  # Without the SHA abort, a wrong pin installs the asset anyway.
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1" 0000000000000000000000000000000000000000000000000000000000000000
  mutate_installer 's|^  fail "archive SHA-256 mismatch.*|  :|'
  run_install
  [ "$RUN_RC" -eq 0 ] || \
    bail "sha guard removed but install still aborted ($RUN_RC): $RUN_ERR — guard duplicated elsewhere; revise install-sha-mismatch"
  [ -x "$SB_TARGET" ] || bail 'un-guarded wrong pin did not install'
}

check_mutation_version_guard() {
  # Without the exact-version abort, a mismatched binary installs anyway.
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V2"
  mutate_installer '/^has_exact_version "$temporary" "$VERSION" || fail/d'
  run_install
  [ "$RUN_RC" -eq 0 ] || \
    bail "version guard removed but install still aborted ($RUN_RC): $RUN_ERR — guard duplicated elsewhere; revise install-wrong-version"
  case $("$SB_TARGET" --version) in
    *"$FIXTURE_V2"*) ;;
    *) bail 'un-guarded wrong-version install did not ship the asset binary' ;;
  esac
}

check_mutation_lock_guard() {
  # Without the live-owner rejection, a second run steals a live lock.
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  mutate_installer 's|^        fail "another install or rollback holds.*|        :|'
  mkdir "$SB_LOCK" || bail 'could not create the lock'
  sleep 5 &
  ml_pid=$!
  printf '%s\n' "$ml_pid" > "$SB_LOCK/owner.pid"
  run_install
  [ "$RUN_RC" -eq 0 ] || \
    bail "lock guard removed but install still aborted ($RUN_RC): $RUN_ERR — guard duplicated elsewhere; revise lock-live-owner"
  [ -x "$SB_TARGET" ] || bail 'un-guarded run did not install behind the live lock'
  kill "$ml_pid" 2>/dev/null || true
  wait "$ml_pid" 2>/dev/null || true
}

check_mutation_trap() {
  # Without the trap, a failed init leaves temps and the lock behind.
  EXPECT_VERSION=$FIXTURE_V1
  build_sandbox "$FIXTURE_V1" "$FIXTURE_TARBALL_V1"
  mutate_installer 's|^trap cleanup EXIT HUP INT TERM$|:|'
  run_install NM_STUB_FAIL_INIT=1
  [ "$RUN_RC" -eq 72 ] || \
    bail "failing init must still abort with status 72, got rc $RUN_RC"
  [ -d "$SB_LOCK" ] || \
    bail 'lock was released without the trap — revise install-trap-cleanup'
  mt_found=0
  for mt_path in "$SB_BIN"/.no-mistakes.*; do
    if [ -e "$mt_path" ]; then mt_found=1; fi
  done
  [ "$mt_found" -eq 1 ] || \
    bail 'no temp files left without the trap — revise install-trap-cleanup'
}

check_mutation_wrapper_telemetry() {
  # Without the export, the exec'd command sees no NO_MISTAKES_TELEMETRY.
  mtw_home=$(mktemp -d "${TMPDIR:-/tmp}/nm-install-wrapper.XXXXXXXX") || bail 'mktemp -d failed'
  trap 'rm -rf "$mtw_home"' EXIT
  wrapper_managed_home "$mtw_home"
  sed '/^export NO_MISTAKES_TELEMETRY=0$/d' "$WRAPPER_SRC" > "$mtw_home/wrapper" || \
    bail 'wrapper mutation sed failed'
  cmp -s "$mtw_home/wrapper" "$WRAPPER_SRC" && \
    bail 'wrapper mutation did not change the script'
  mtw_out=$(env -i HOME="$mtw_home" PATH=/bin:/usr/bin \
    NO_MISTAKES_MANAGED_HOME="$mtw_home" \
    sh "$mtw_home/wrapper" exec /bin/sh -c \
    'printf "%s\n" "${NO_MISTAKES_TELEMETRY:-unset}"') || \
    bail 'mutated wrapper exec failed'
  [ "$mtw_out" = unset ] || \
    bail "telemetry export removed but value still set: $mtw_out — guard duplicated elsewhere; revise wrapper-exports"
}

# --- main -------------------------------------------------------------------

TOTAL_START=$(now_ms)

GAP_REASONS=
add_gap() {
  GAP_REASONS="$GAP_REASONS$1 "
}
for gap_cmd in tar awk sed git mktemp uname id cmp dd cp mv chmod kill; do
  command -v "$gap_cmd" >/dev/null 2>&1 || add_gap "missing command: $gap_cmd"
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  add_gap 'missing SHA-256 tool (sha256sum or shasum)'
fi
detect_platform
[ -n "$SB_PLATFORM" ] || \
  add_gap "unsupported platform: $(uname -s 2>/dev/null)/$(uname -m 2>/dev/null) (installer supports darwin-arm64, linux-amd64)"
if [ -n "$REPO_ROOT" ]; then
  for gap_file in "$INSTALL_SRC" "$ROLLBACK_SRC" "$WRAPPER_SRC" "$FIXTURE_TARBALL_V1" "$FIXTURE_TARBALL_V2" "$FIXTURE_DIR/checksums.sha256"; do
    [ -f "$gap_file" ] || add_gap "missing file: $gap_file"
  done
else
  add_gap 'could not resolve the script directory'
fi

if [ -n "$GAP_REASONS" ]; then
  gap_status=SKIP
  [ "$STRICT" = 1 ] && gap_status=FAIL
  report "$gap_status" prerequisites suite "$GAP_REASONS" 0
  if [ "$gap_status" = FAIL ]; then
    exit 1
  fi
  printf 'default mode: prerequisites missing printed SKIP; set STRICT=1 to fail\n'
  exit 0
fi

FIXTURE_SHA_V1=$(sha256_file "$FIXTURE_TARBALL_V1") || bail 'SHA-256 tool failed'
FIXTURE_SHA_V2=$(sha256_file "$FIXTURE_TARBALL_V2") || bail 'SHA-256 tool failed'

echo "== no-mistakes installer/rollback/wrapper checks (STRICT=$STRICT) =="

run_check fixtures_checksums fixtures
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf 'fixture integrity failed; later checks would be noise. Stop here.\n'
  exit 1
fi
# B25 pin-drift tripwire: resolve an installed binary first. Absence is a
# SKIP (CI runners, fresh hosts), never a FAIL — only a mismatch is drift.
PD_BIN=$(command -v no-mistakes 2>/dev/null || true)
if [ -z "$PD_BIN" ] && [ -x "${HOME:-/nonexistent}/.local/bin/no-mistakes" ]; then
  PD_BIN=$HOME/.local/bin/no-mistakes
fi
if [ -n "$PD_BIN" ] && [ -x "$PD_BIN" ]; then
  run_check pin_drift pin
else
  report SKIP pin_drift pin 'no installed no-mistakes binary (absence is not drift)' 0
fi
run_check install_offline install
run_check install_idempotent install
run_check install_sha_mismatch install
run_check install_wrong_version install
run_check install_trap_cleanup install
run_check install_version_replacement install
run_check lock_live_owner lock
run_check lock_stale_reclaim lock
run_check rollback_history rollback
run_check rollback_missing rollback
run_check install_refusals install
run_check wrapper_exports wrapper
run_check wrapper_daemon_root wrapper
run_check wrapper_args wrapper
run_check wrapper_missing_binary wrapper
run_check mutation_sha_guard install
run_check mutation_version_guard install
run_check mutation_lock_guard lock
run_check mutation_trap install
run_check mutation_wrapper_telemetry wrapper

TOTAL_MS=$(( $(now_ms) - TOTAL_START ))
printf '\n%d pass, %d fail, %d skip in %d ms (SLA 30000 ms)\n' \
  "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT" "$TOTAL_MS"
[ "$TOTAL_MS" -lt 30000 ] || printf 'warning: suite exceeded the 30 s SLA\n'
[ "$FAIL_COUNT" -eq 0 ] || exit 1
exit 0
