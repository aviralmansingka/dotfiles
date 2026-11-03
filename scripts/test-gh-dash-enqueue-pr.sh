#!/usr/bin/env bash
# Paths: gh-dash/* .mergify.yml
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
helper="$repo_root/gh-dash/.local/bin/gh-dash-enqueue-pr"
config="$repo_root/gh-dash/.config/gh-dash/config.yml"
mergify="$repo_root/.mergify.yml"
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
  sections = config.fetch("prSections").to_h { |s| [s.fetch("title"), s.fetch("filters")] }
  queue = sections.fetch("Merge Queue") { abort "Merge Queue section missing: #{sections.keys.inspect}" }
  abort "unexpected Merge Queue filter: #{queue.inspect}" unless queue == "is:open label:queue"
  mine = sections.fetch("My Pull Requests")
  abort "My Pull Requests must exclude queued pull requests: #{mine.inspect}" unless mine.split.include?("-label:queue")
  puts "CONFIG: M => #{binding.fetch("command")}; Merge Queue => #{queue}; My Pull Requests => #{mine}"

  mergify = YAML.safe_load(File.read(ARGV.fetch(1)))
  abort "merge_protections_settings must stay unset" if mergify.key?("merge_protections_settings")
  rule = mergify.fetch("pull_request_rules").first
  abort "the rule must queue: #{rule.inspect}" unless rule.fetch("actions").key?("queue")
  abort "the rule must gate on the label: #{rule.inspect}" unless rule.fetch("conditions").include?("label = queue")
  drop = mergify.fetch("pull_request_rules")[1]
  abort "a dropped entry must lose the submit label: #{drop.inspect}" unless drop && drop.fetch("conditions") == ["label = dequeued"]
  removed = drop.fetch("actions").fetch("label").fetch("remove")
  abort "a dropped entry must lose queue and dequeued: #{removed.inspect}" unless removed.sort == %w[dequeued queue]
  queue = mergify.fetch("queue_rules").first
  abort "the queue must accept the label: #{queue.inspect}" unless queue.fetch("queue_conditions").include?("label = queue")
  abort "unexpected merge_method: #{queue.inspect}" unless queue.fetch("merge_method") == "squash"
  abort "unexpected batch_size: #{queue.inspect}" unless queue.fetch("batch_size") == 1
  abort "unexpected checks_timeout: #{queue.inspect}" unless queue.fetch("checks_timeout") == "60 minutes"
  puts "MERGIFY: queue #{queue.fetch("name")} => squash, batch #{queue.fetch("batch_size")}, #{queue.fetch("checks_timeout")}, gated on the queue label; a dropped entry loses it"
' "$config" "$mergify"

bin="$test_dir/bin"
mkdir -p "$bin"
log="$test_dir/gh.log"
state_file="$test_dir/state"
stderr_file="$test_dir/stderr"
: > "$log"

# Fake `gh`: the external boundary. `pr view` serves the pull request state and
# applies the helper's own --jq filter to it; `pr edit` records and applies the
# label edit, so a second run reads what the first one wrote.
cat > "$bin/gh" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  "pr view")
    expr=""
    want=""
    for arg in "$@"; do
      case "$want" in
        --jq) expr=$arg; want="" ;;
        *) [ "$arg" = "--jq" ] && want=--jq ;;
      esac
    done
    if [ -n "$expr" ]; then jq -r "$expr" "$STATE_FILE"; else cat "$STATE_FILE"; fi
    ;;
  "pr edit")
    add=""
    remove=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --add-label) add=$2; shift 2 ;;
        --remove-label) remove=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    jq --arg add "$add" --arg remove "$remove" '
      (if $add == "" then . else .labels += [{"name": $add}] end)
      | (if $remove == "" then . else .labels |= map(select(.name != $remove)) end)
      | .labels |= unique_by(.name)' "$STATE_FILE" > "$STATE_FILE.next"
    mv "$STATE_FILE.next" "$STATE_FILE"
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
  out=$(PATH="$bin:$PATH" GH_LOG="$log" STATE_FILE="$state_file" \
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

expect_no_edit() {
  if grep -q '^pr edit' "$log"; then
    printf 'FAIL %s: helper edited labels when it should not\n' "$case_name"
    fail=1
  fi
}

expect_edit() { # assert the exact gh invocation that submits
  if ! grep -Fxq "$1" "$log"; then
    printf 'FAIL %s: no "%s" call\n' "$case_name" "$1"
    printf 'calls:\n%s\n' "$(cat "$log")"
    fail=1
  fi
}

expect_label() { # assert the served pull request carries the label
  if ! jq -e --arg l "$1" 'any(.labels[]; .name == $l)' "$state_file" >/dev/null; then
    printf 'FAIL %s: pull request does not carry %s: %s\n' "$case_name" "$1" "$(cat "$state_file")"
    fail=1
  fi
}

expect_no_label() {
  if jq -e --arg l "$1" 'any(.labels[]; .name == $l)' "$state_file" >/dev/null; then
    printf 'FAIL %s: pull request still carries %s: %s\n' "$case_name" "$1" "$(cat "$state_file")"
    fail=1
  fi
}

# Names every case in the output; a case that already failed stays unnamed
# behind its FAIL lines.
done_case() {
  if [ "$fail" -eq 0 ]; then printf 'PASS %s\n' "$case_name"; fi
}

reset() { : > "$log"; printf '%s\n' "$1" > "$state_file"; }

labels_json() { # a PR state with the given labels
  jq -n --args '{state: "OPEN", labels: [$ARGS.positional[] | {name: .}]}' "$@"
}

# 1. Argument validation never reaches gh.
case_name="usage"
reset '{"state":"OPEN","labels":[]}'
run
expect_status 2
expect_err "Usage: gh-dash-enqueue-pr REPO_NAME PR_NUMBER"
expect_no_edit
done_case

case_name="non-numeric pr"
run aviralmansingka/dotfiles 4x
expect_status 2
expect_err "Invalid pull request number: 4x"
done_case

case_name="repo without owner"
run dotfiles 42
expect_status 2
expect_err "Invalid repository name: dotfiles"
done_case

# 2. States that need no submit stay no-ops.
case_name="labelled pr is a no-op"
reset "$(labels_json queue)"
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "aviralmansingka/dotfiles#42 is already in the merge queue"
expect_no_edit
done_case

case_name="closed pr errors"
reset '{"state":"CLOSED","labels":[]}'
run aviralmansingka/dotfiles 42
expect_status 1
expect_err "is not open"
expect_no_edit
done_case

# 3. An unlabelled open PR gets the label, and a second submit is a no-op.
case_name="unlabelled pr gets the label"
reset '{"state":"OPEN","labels":[]}'
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "entered the merge queue"
expect_edit "pr edit 42 --repo aviralmansingka/dotfiles --add-label queue"
expect_label queue
done_case

case_name="second submit is a no-op"
: > "$log"
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "is already in the merge queue"
expect_no_edit
done_case

# Mergify's own `queued` label is not the submit, so it must not short-circuit one.
case_name="mergify queued label is not the submit"
reset "$(labels_json queued)"
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "entered the merge queue"
expect_edit "pr edit 42 --repo aviralmansingka/dotfiles --add-label queue"
expect_label queue
done_case

# 4. A dropped attempt is resubmitted: the stale mark comes off in the same edit.
case_name="dropped pr resubmitted"
reset "$(labels_json queue dequeued)"
run aviralmansingka/dotfiles 42
expect_status 0
expect_out "entered the merge queue"
expect_edit "pr edit 42 --repo aviralmansingka/dotfiles --remove-label dequeued --add-label queue"
expect_label queue
expect_no_label dequeued
done_case

if [ "$fail" -ne 0 ]; then
  exit 1
fi
printf 'PASS gh-dash-enqueue-pr: argument guards, labelled and closed no-ops, label submit, second run no-op, dropped resubmit, and the M binding\n'
