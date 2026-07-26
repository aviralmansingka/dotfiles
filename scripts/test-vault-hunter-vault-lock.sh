#!/usr/bin/env bash
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/vault-hunter-vault-lock
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q repo
git -C "$tmp/repo" config user.name test
git -C "$tmp/repo" config user.email test@example.com
printf 'base\n' >"$tmp/repo/file"
git -C "$tmp/repo" add file
git -C "$tmp/repo" commit -qm base
git -C "$tmp/repo" worktree add -q "$tmp/worker" -b worker

"$script" acquire "$tmp/repo" run-a task.md backlog.md >/dev/null
"$script" acquire "$tmp/worker" run-a backlog.md task.md >/dev/null
if "$script" acquire "$tmp/worker" run-b other.md >/dev/null 2>&1; then
  echo "second worker acquired a shared Git lock" >&2
  exit 1
fi
if "$script" release "$tmp/worker" run-b >/dev/null 2>&1; then
  echo "non-owner released the lock" >&2
  exit 1
fi
"$script" release "$tmp/repo" run-a >/dev/null
"$script" acquire "$tmp/worker" run-b other.md >/dev/null
"$script" release "$tmp/worker" run-b >/dev/null

echo "vault-hunter vault lock: PASS"
