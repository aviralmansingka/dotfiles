#!/usr/bin/env bash
# Prepare one coding-eval task in a throwaway worktree and grade a checkout.
#
#   bash evals/coding/run-task.sh <task-id>            # worktree at base_commit, expect RED
#   bash evals/coding/run-task.sh <task-id> --final    # worktree at final_commit, expect GREEN
#   bash evals/coding/run-task.sh <task-id> --keep     # keep the worktree (prints its path)
#   bash evals/coding/run-task.sh --list              # list task ids
#
# The manifest is the single source of truth: repo, base_commit, final_commit,
# prompt_file and the verify commands all come from manifest.jsonl.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
manifest="$here/manifest.jsonl"

usage() { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }
[ $# -ge 1 ] || usage

if [ "$1" = "--list" ]; then
  node -e '
    const fs=require("fs");
    for (const line of fs.readFileSync(process.argv[1],"utf8").split("\n")) {
      if (!line.trim()) continue;
      const t=JSON.parse(line);
      console.log(`${t.id}\t${t.difficulty}\t${t.kind}\t${t.repo}`);
    }' "$manifest"
  exit 0
fi

task=$1; shift
mode=base; keep=0; dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --final) mode=final ;;
    --keep) keep=1 ;;
    --dir) shift; dir=${1:-} ;;
    *) usage ;;
  esac
  shift
done

field() { node -e 'const fs=require("fs");const id=process.argv[1],k=process.argv[2];
  for (const line of fs.readFileSync(process.argv[3],"utf8").split("\n")) {
    if (!line.trim()) continue; const t=JSON.parse(line);
    if (t.id===id) { const v=t[k]; console.log(Array.isArray(v)?v.join("\n"):v); process.exit(0); }
  }
  console.error("unknown task: "+id); process.exit(1);' "$task" "$1" "$manifest"; }

repo=$(field repo) || exit 1
base=$(field base_commit) || exit 1
final=$(field final_commit) || exit 1
prompt=$(field prompt_file) || exit 1

rev=$base
[ "$mode" = final ] && rev=$final

if [ -z "$dir" ]; then
  dir=$(mktemp -d "${TMPDIR:-/tmp}/coding-eval-${task}-XXXXXX")
  rmdir "$dir" || true
fi

cleanup() {
  if [ "$keep" = 1 ]; then
    echo "worktree kept at: $dir" >&2
  else
    git -C "$repo" worktree remove --force "$dir" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

git -C "$repo" worktree add --detach "$dir" "$rev" >/dev/null || exit 1

echo "task:      $task"
echo "repo:      $repo"
echo "checkout:  $dir  ($mode $rev)"
echo "prompt:    $here/$prompt"
echo "---"

( cd "$dir" && bash "$here/tasks/$task/verify.sh" )
rc=$?
if [ "$mode" = final ] && [ $rc -ne 0 ]; then
  echo "UNEXPECTED: final_commit is not green" >&2
elif [ "$mode" = base ] && [ $rc -eq 0 ]; then
  echo "UNEXPECTED: base_commit already passes (task does not discriminate)" >&2
fi
exit $rc
