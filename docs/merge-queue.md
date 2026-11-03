# Merge queue

`main` runs through GitHub's merge queue. The queue tests each PR on a
synthetic merge commit against the current tip, so two green PRs can
never break each other on landing. You submit; you stop watching.

## What a submit does

- Required checks already green: the PR enters the queue now.
- Required checks still running: auto-merge is enabled, and the PR
  enters the queue when they pass.

Both paths end in a merge with no further action. `gh-dash-enqueue-pr`
prints the path it took, and prints a no-op message when the PR is
already queued or already waiting on auto-merge.

## Submit

- gh-dash: press `M` on a PR (`submit to merge queue`).
- Shell: `gh-dash-enqueue-pr <owner>/<repo> <pr>`.
- Watch: the `Merge Queue` section in gh-dash (`is:open is:queued`).
  gh-dash shows the `Queued` state on the row.

A no-mistakes run that ends in `outcome: checks-passed` leaves a green
PR, so the closeout submits it. The rule lives in `AGENTS.md`.

The helper is `gh-dash/.local/bin/gh-dash-enqueue-pr` (stowed to
`~/.local/bin`). Its suite is `scripts/test-gh-dash-enqueue-pr.sh`. The
helper reads queue state from GraphQL, because `gh pr view` has no
merge-queue field.

## Requirements

Two settings make the queue work. Both are live on this repository.

1. `.github/workflows/ci.yml` triggers on `merge_group`. A queue entry
   runs on `gh-readonly-queue/main/pr-<n>`, and the required `CI result`
   check must report there. Without the trigger, every entry waits on a
   check that never arrives until the queue times out.
   `scripts/test-ci-self.mjs` guards the trigger.
2. The `merge queue` ruleset is active on the default branch, with method
   `SQUASH` and `ALLGREEN` grouping.

Required checks stay in classic branch protection: `CI result`, from the
workflow's aggregate `result` job. "Require branches to be up to date"
is off. The queue builds each entry on the current tip, so strictness
would only block entry and bring back manual rebases.

## Activate (once per repository)

Run this after the `merge_group` trigger lands on `main`. A queue enabled
first would hang until then.

```sh
gh api -X POST repos/aviralmansingka/dotfiles/rulesets --input - <<'JSON'
{
  "name": "merge queue",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"],
                                "exclude": [] } },
  "rules": [
    { "type": "merge_queue",
      "parameters": {
        "check_response_timeout_minutes": 60,
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 5,
        "max_entries_to_merge": 5,
        "merge_method": "SQUASH",
        "min_entries_to_merge": 1,
        "min_entries_to_merge_wait_minutes": 5
      } }
  ]
}
JSON

gh api -X PATCH \
repos/aviralmansingka/dotfiles/branches/main/protection/required_status_checks \
  -f strict=false -f 'contexts[]=CI result'
```

Check it with a GraphQL read. A non-null `mergeQueue` means the queue is
live.

```sh
gh api graphql -f query='{ repository(owner: "aviralmansingka",
  name: "dotfiles") { mergeQueue(branch: "main") { id } } }'
```

## Failure modes

- Entry fails its own checks: the queue drops it. The PR stays open and
  CI shows the red job, as it does today.
- Entry times out after 60 minutes: the queue drops it. Raise
  `check_response_timeout_minutes` if a lane gets slower.
- `CI result` missing on a queue entry: the `merge_group` trigger is
  not on the base branch yet. Land it, then submit again.
- A PR that must skip the queue: merging needs `--admin`, and admins are
  not exempt (`enforce_admins` is off, the ruleset applies to everyone).
