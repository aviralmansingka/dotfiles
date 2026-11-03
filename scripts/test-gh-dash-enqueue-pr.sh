#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
helper="$repo_root/gh-dash/.local/bin/gh-dash-enqueue-pr"
config="$repo_root/gh-dash/.config/gh-dash/config.yml"
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

ruby -ryaml -e '
  config = YAML.safe_load(File.read(ARGV.fetch(0)))
  bindings = config.fetch("keybindings").fetch("prs").to_h { |item| [item.fetch("key"), item] }
  binding = bindings.fetch("M")
  expected = {
    "key" => "M",
    "name" => "submit to merge queue",
    "command" => "gh-dash-enqueue-pr \"{{.RepoName}}\" \"{{.PrNumber}}\""
  }
  abort "unexpected M binding: #{binding.inspect}" unless binding == expected
  sections = config.fetch("prSections").map { |s| s.fetch("title") }
  abort "Merge Queue section missing: #{sections.inspect}" unless sections.include?("Merge Queue")
  queue = config.fetch("prSections").find { |s| s.fetch("title") == "Merge Queue" }
  abort "unexpected Merge Queue filter: #{queue.inspect}" unless queue.fetch("filters") == "is:open is:queued"
  puts "CONFIG: M => #{binding.fetch("command")}; Merge Queue => #{queue.fetch("filters")}"
' "$config"

bin="$test_dir/bin"
mkdir -p "$bin"
log="$test_dir/gh.log"
state_file="$test_dir/state"
after_file="$test_dir/after"
stderr_file="$test_dir/stderr"
: > "$log"

# Fake `gh`: the external boundary. It serves the queue-state token the helper
# asks GraphQL for, logs every call, and switches to the post-merge state when
# a merge is accepted.
cat > "$bin/gh" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  "api graphql") cat "$STATE_FILE" ;;
  "pr merge")
    printf 'merged\n'
    if [ -f "$AFTER_FILE" ]; then cp "$AFTER_FILE" "$STATE_FILE"; fi
    ;;
  *)
    printf 'unexpected gh call: %s\n' "$*" >&2
    exit 1
    ;;
esac
FAKE
chmod +x "$bin/gh"

fail=0
status=0
out=""
err=""

run() { # run the helper with the fake gh on PATH; capture status, stdout, stderr
  status=0
  out=$(PATH="$bin:$PATH" GH_LOG="$log" STATE_FILE="$state_file" AFTER_FILE="$after_file" \
    "$helper" "$@" 2>"$stderr_file") || status=$?
  err=$(cat "$stderr_file")
}

expect_status() {
  if [ "$status" -ne "$1" ]; then
    printf 'FAIL %s: expected exit %s, got %s (stderr: %s)\n' "$case_name" "$1" "$status" "$err"
    fail=1
  fi
}

expect_out() {
  case "$out" in
    *"$1"*) ;;
    *) printf 'FAIL %s: stdout %s does not contain %s\n' "$case_name" "$out" "$1"; fail=1 ;;
  esac
}

expect_err() {
  case "$err" in
    *"$1"*) ;;
    *) printf 'FAIL %s: stderr %s does not contain %s\n' "$case_name" "$err" "$1"; fail=1 ;;
  esac
}

expect_no_merge() {
  if grep -q '^pr merge' "$log"; then
    printf 'FAIL %s: helper called gh pr merge when it should not\n' "$case_name"
    fail=1
  fi
}

expect_merge() { # assert the exact merge invocation
  if ! grep -Fxq "pr merge --auto --repo aviralmansingka/dotfiles 42" "$log"; then
    printf 'FAIL %s: no "gh pr merge --auto --repo aviralmansingka/dotfiles 42" call\n' "$case_name"
    printf 'calls:\n%s\n' "$(cat "$log")"
    fail=1
  fi
}

reset() { : > "$log"; : > "$after_file"; printf '%s\n' "$1" > "$state_file"; }

# 1. Argument validation never reaches gh.
case_name="usage"
reset open
run
expect_status 2
expect_err "Usage: gh-dash-enqueue-pr REPO_NAME PR_NUMBER"
expect_no_merge

case_name="non-numeric pr"
run aviralmansingka/dotfiles 4x
expect_status 2
expect_err "Invalid pull request number: 4x"

case_name="repo without owner"
run dotfiles 42
expect_status 2
expect_err "Invalid repository name: dotfiles"

# 2. States that need no submit stay no-ops.
case_name="already queued"
reset queued
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "aviralmansingka/dotfiles#42 is already in the merge queue"
expect_no_merge

case_name="auto-merge already on"
reset auto
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "already has auto-merge enabled"
expect_no_merge

case_name="closed pr"
reset closed
run aviralmansingka/dotfiles 42
expect_status 1
expect_err "is not open"
expect_no_merge

# 3. An open PR submits once, then reports the state the submit landed in.
case_name="open pr enqueued"
reset open
printf 'queued\n' > "$after_file"
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "entered the merge queue"
expect_merge

case_name="open pr waiting on checks"
reset open
printf 'auto\n' > "$after_file"
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "enters the merge queue when required checks pass"
expect_merge

if [ "$fail" -ne 0 ]; then
  exit 1
fi
printf 'PASS gh-dash-enqueue-pr: argument guards, no-op states, submit states, and the M binding\n'
