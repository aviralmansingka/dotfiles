#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
helper="$repo_root/gh-dash/.local/bin/gh-dash-open-pr"
config="$repo_root/gh-dash/.config/gh-dash/config.yml"
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

ruby -ryaml -e '
  config = YAML.safe_load(File.read(ARGV.fetch(0)))
  binding = config.fetch("keybindings").fetch("prs").find { |item| item["key"] == "O" }
  expected = {
    "key" => "O",
    "name" => "review PR in Herdr worktree",
    "command" => "gh-dash-open-pr \"{{.RepoPath}}\" \"{{.RepoName}}\" \"{{.PrNumber}}\""
  }
  abort "unexpected O binding: #{binding.inspect}" unless binding == expected
  mapping = config.fetch("repoPaths").fetch(":owner/:repo")
  abort "unexpected repository mapping: #{mapping.inspect}" unless mapping == "/Users/aviral/:repo"
  puts "CONFIG: O => #{binding.fetch("command")}; :owner/:repo => #{mapping}"
' "$config"

bin="$test_dir/bin"
remote="$test_dir/remote.git"
seed="$test_dir/seed"
repo="$test_dir/repo"
worktree="$test_dir/pr-42"
herdr_log="$test_dir/herdr.log"
gh_log="$test_dir/gh.log"
tuicr_log="$test_dir/tuicr.log"
mkdir -p "$bin"

cat >"$bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$GH_TEST_LOG"
if [[ "$*" != "repo view owner/repo --json sshUrl --jq .sshUrl" ]]; then
  printf 'unexpected gh command: %s\n' "$*" >&2
  exit 1
fi
printf '%s\n' "$GH_TEST_REMOTE"
EOF

cat >"$bin/herdr" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1-} ${2-}" in
  'worktree create')
    shift 2
    printf 'create %s\n' "$*" >>"$HERDR_TEST_LOG"
    cwd=
    branch=
    base=
    while (( $# )); do
      case "$1" in
        --cwd) cwd=$2; shift 2 ;;
        --branch) branch=$2; shift 2 ;;
        --base) base=$2; shift 2 ;;
        --focus) shift ;;
        *) printf 'unexpected create argument: %s\n' "$1" >&2; exit 1 ;;
      esac
    done
    if [[ -n "$base" ]]; then
      git -C "$cwd" worktree add -q -b "$branch" "$HERDR_TEST_WORKTREE" "$base"
    else
      git -C "$cwd" worktree add -q "$HERDR_TEST_WORKTREE" "$branch"
    fi
    printf '{"result":{"root_pane":{"pane_id":"pane-test"}}}\n'
    ;;
  'worktree open')
    shift 2
    printf 'open %s\n' "$*" >>"$HERDR_TEST_LOG"
    ;;
  'pane run')
    shift 2
    printf 'pane-run %s\n' "$*" >>"$HERDR_TEST_LOG"
    (cd "$HERDR_TEST_WORKTREE" && /bin/sh -c "$2")
    ;;
  *)
    printf 'unexpected herdr command: %s\n' "$*" >&2
    exit 1
    ;;
esac
EOF

cat >"$bin/tuicr" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$PWD" "$*" >>"$TUICR_TEST_LOG"
EOF
chmod +x "$bin/gh" "$bin/herdr" "$bin/tuicr"

git init -q --bare "$remote"
git init -q "$seed"
git -C "$seed" config user.name Test
git -C "$seed" config user.email test@example.com
printf 'PR version A\n' >"$seed/change.txt"
git -C "$seed" add change.txt
git -C "$seed" commit -qm 'PR A'
oid_a=$(git -C "$seed" rev-parse HEAD)
git -C "$seed" push -q "$remote" "HEAD:refs/pull/42/head"

git init -q "$repo"
git -C "$repo" config user.name Test
git -C "$repo" config user.email test@example.com
printf 'base\n' >"$repo/base.txt"
git -C "$repo" add base.txt
git -C "$repo" commit -qm base

export PATH="$bin:$PATH"
export GH_TEST_LOG="$gh_log" GH_TEST_REMOTE="$remote"
export HERDR_TEST_LOG="$herdr_log" HERDR_TEST_WORKTREE="$worktree"
export TUICR_TEST_LOG="$tuicr_log"
: >"$gh_log"
: >"$herdr_log"
: >"$tuicr_log"

"$helper" "$repo" owner/repo 42
repo_id=$(printf '%s' owner/repo | git -C "$repo" hash-object --stdin)
pr_ref="refs/remotes/gh-dash/$repo_id/pull/42"
[[ $(git -C "$repo" rev-parse refs/heads/pr/42) == "$oid_a" ]]
[[ $(git -C "$repo" rev-parse "$pr_ref") == "$oid_a" ]]
[[ $(git -C "$worktree" rev-parse HEAD) == "$oid_a" ]]
[[ $(git -C "$repo" config --get branch.pr/42.ghDashPr) == owner/repo#42 ]]
[[ $(wc -l <"$herdr_log" | tr -d ' ') == 2 ]]
fresh_create=$(head -n 1 "$herdr_log")
fresh_run=$(tail -n 1 "$herdr_log")
[[ $fresh_create == "create --cwd $repo --branch pr/42 --base $pr_ref --focus" ]]
[[ $fresh_run == "pane-run pane-test tuicr pr 'owner/repo#42' --no-update-check" ]]
[[ $(cat "$tuicr_log") == "$worktree|pr owner/repo#42 --no-update-check" ]]
printf 'FRESH: branch=pr/42 head=%s; %s; then %s from cwd=%s\n' \
  "${oid_a:0:12}" "$fresh_create" "$fresh_run" "$worktree"

: >"$gh_log"
: >"$herdr_log"
: >"$tuicr_log"
"$helper" "$repo" owner/repo 42
[[ $(wc -l <"$herdr_log" | tr -d ' ') == 1 ]]
repeat_open=$(head -n 1 "$herdr_log")
[[ $repeat_open == "open --cwd $repo --branch pr/42 --focus" ]]
[[ ! -s "$gh_log" && ! -s "$tuicr_log" ]]
printf 'REPEAT: %s; no fetch or second tuicr launch\n' "$repeat_open"

git -C "$repo" worktree remove --force "$worktree"
printf 'PR version B\n' >"$seed/change.txt"
git -C "$seed" commit -qam 'PR B'
oid_b=$(git -C "$seed" rev-parse HEAD)
git -C "$seed" push -q --force "$remote" "HEAD:refs/pull/42/head"
: >"$herdr_log"
: >"$tuicr_log"
"$helper" "$repo" owner/repo 42
[[ $(git -C "$repo" rev-parse refs/heads/pr/42) == "$oid_b" ]]
[[ $(git -C "$repo" rev-parse "$pr_ref") == "$oid_b" ]]
[[ $(git -C "$worktree" rev-parse HEAD) == "$oid_b" ]]
[[ $(wc -l <"$herdr_log" | tr -d ' ') == 2 ]]
recreate_create=$(head -n 1 "$herdr_log")
recreate_run=$(tail -n 1 "$herdr_log")
[[ $recreate_create == "create --cwd $repo --branch pr/42 --focus" ]]
[[ $recreate_run == "pane-run pane-test tuicr pr 'owner/repo#42' --no-update-check" ]]
[[ $(cat "$tuicr_log") == "$worktree|pr owner/repo#42 --no-update-check" ]]
printf 'RECREATE: retained branch advanced %s -> %s; %s; then %s from cwd=%s\n' \
  "${oid_a:0:12}" "${oid_b:0:12}" "$recreate_create" "$recreate_run" "$worktree"

git -C "$repo" worktree remove --force "$worktree"
tree=$(git -C "$repo" rev-parse "$oid_b^{tree}")
local_oid=$(printf 'local work\n' | git -C "$repo" commit-tree "$tree" -p "$oid_b")
git -C "$repo" update-ref refs/heads/pr/42 "$local_oid" "$oid_b"
: >"$herdr_log"
if local_error=$("$helper" "$repo" owner/repo 42 2>&1); then
  echo 'expected local-commit collision' >&2
  exit 1
fi
[[ $local_error == 'Branch pr/42 has local commits; refusing to update it' ]]
[[ $(git -C "$repo" rev-parse refs/heads/pr/42) == "$local_oid" ]]
[[ ! -s "$herdr_log" ]]
printf 'LOCAL-COMMIT COLLISION: %s; branch preserved at %s\n' "$local_error" "${local_oid:0:12}"
git -C "$repo" update-ref refs/heads/pr/42 "$oid_b" "$local_oid"

: >"$gh_log"
git -C "$repo" config branch.pr/42.ghDashPr other/repo#42
if owner_error=$("$helper" "$repo" owner/repo 42 2>&1); then
  echo 'expected repository-owner collision' >&2
  exit 1
fi
[[ $owner_error == 'Branch pr/42 belongs to other/repo#42, not owner/repo#42' ]]
[[ ! -s "$gh_log" ]]
printf 'OWNER COLLISION: %s; no fetch or worktree action\n' "$owner_error"

git -C "$repo" config --unset branch.pr/42.ghDashPr
git -C "$repo" update-ref -d "$pr_ref"
git -C "$repo" worktree add -q "$worktree" pr/42
: >"$gh_log"
: >"$herdr_log"
if checked_out_error=$("$helper" "$repo" owner/repo 42 2>&1); then
  echo 'expected unowned checked-out collision' >&2
  exit 1
fi
[[ $checked_out_error == 'Branch pr/42 is checked out but is not owned by gh-dash' ]]
[[ ! -s "$gh_log" && ! -s "$herdr_log" ]]
printf 'CHECKED-OUT COLLISION: %s; no fetch or focus\n' "$checked_out_error"

git -C "$repo" worktree remove --force "$worktree"
if detached_error=$("$helper" "$repo" owner/repo 42 2>&1); then
  echo 'expected unowned retained-branch collision' >&2
  exit 1
fi
[[ $detached_error == 'Branch pr/42 already exists outside a worktree' ]]
printf 'RETAINED COLLISION: %s; branch preserved at %s\n' "$detached_error" "${oid_b:0:12}"
