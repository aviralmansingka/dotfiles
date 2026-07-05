#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/auto-git-sync"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

git_config() {
  git -C "$1" config user.email "auto-sync-test@example.com"
  git -C "$1" config user.name "Auto Sync Test"
}

make_repo_pair() {
  local root="$1"
  local remote="$root/remote.git"
  local local_repo="$root/local"
  local peer_repo="$root/peer"

  git init --bare "$remote" >/dev/null
  git clone "$remote" "$local_repo" >/dev/null
  git clone "$remote" "$peer_repo" >/dev/null
  git_config "$local_repo"
  git_config "$peer_repo"
  git -C "$local_repo" checkout -b main >/dev/null

  printf 'base\n' >"$local_repo/note.txt"
  git -C "$local_repo" add note.txt
  git -C "$local_repo" commit -m "base" >/dev/null
  git -C "$local_repo" push origin main >/dev/null
  git -C "$peer_repo" fetch origin main >/dev/null
  git -C "$peer_repo" checkout main >/dev/null
}

test_pulls_before_committing() {
  local root="$1/pull-before-commit"
  mkdir -p "$root"
  make_repo_pair "$root"

  printf 'remote\n' >"$root/peer/remote.txt"
  git -C "$root/peer" add remote.txt
  git -C "$root/peer" commit -m "remote update" >/dev/null
  git -C "$root/peer" push origin main >/dev/null

  printf 'local\n' >"$root/local/local.txt"

  REPO_DIR="$root/local" \
    STATE_DIR="$root/state" \
    LOG_FILE="$root/sync.log" \
    "$SYNC_SCRIPT" --once

  test -f "$root/local/remote.txt" || fail "remote change was not pulled"
  test -f "$root/local/local.txt" || fail "local change was not committed"

  local top_two
  top_two="$(git -C "$root/local" log --format=%s -2)"
  [[ "$top_two" == $'Auto-commit: '*$'\nremote update' ]] ||
    fail "expected auto commit on top of remote update, got: $top_two"
}

test_pi_resolves_conflicts() {
  local root="$1/pi-conflict"
  mkdir -p "$root"
  make_repo_pair "$root"

  printf 'remote\n' >"$root/peer/note.txt"
  git -C "$root/peer" add note.txt
  git -C "$root/peer" commit -m "remote conflict" >/dev/null
  git -C "$root/peer" push origin main >/dev/null

  printf 'local\n' >"$root/local/note.txt"

  local fake_pi="$root/fake-pi"
  cat >"$fake_pi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'remote\nlocal\n' >note.txt
git add note.txt
SH
  chmod +x "$fake_pi"

  REPO_DIR="$root/local" \
    STATE_DIR="$root/state" \
    LOG_FILE="$root/sync.log" \
    PI_BIN="$fake_pi" \
    "$SYNC_SCRIPT" --once

  cmp -s "$root/local/note.txt" <(printf 'remote\nlocal\n') ||
    fail "Pi-resolved file content was not committed"
  test -z "$(git -C "$root/local" diff --name-only --diff-filter=U)" ||
    fail "conflicts remained after Pi resolution"
  grep -q "Invoking Pi" "$root/sync.log" ||
    fail "Pi conflict hook was not invoked"
}

main() {
  test -x "$SYNC_SCRIPT" || fail "missing executable sync script: $SYNC_SCRIPT"

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:-}"' EXIT

  test_pulls_before_committing "$tmp"
  test_pi_resolves_conflicts "$tmp"
  echo "auto-git-sync tests passed"
}

main "$@"
