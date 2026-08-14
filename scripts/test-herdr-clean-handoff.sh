#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
helper="$repo_root/herdr/.local/bin/herdr-clean-handoff"
test_dir=$(mktemp -d)
trap 'find "$test_dir" -depth -delete' EXIT

fake_herdr="$test_dir/herdr"
log="$test_dir/herdr.log"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s|%s\n" "${NO_COLOR-<unset>}" "$*" >> "$HERDR_TEST_LOG"' \
  > "$fake_herdr"
chmod 700 "$fake_herdr"

ZDOTDIR="$test_dir" PATH="$test_dir:$PATH" HERDR_TEST_LOG="$log" NO_COLOR=1 "$helper"
ZDOTDIR="$test_dir" PATH="$test_dir:$PATH" HERDR_TEST_LOG="$log" NO_COLOR=1 \
  "$helper" server --handoff-import socket token

grep -Fx "1|server live-handoff --import-exe $helper" "$log" >/dev/null
grep -Fx '<unset>|server --handoff-import socket token' "$log" >/dev/null
