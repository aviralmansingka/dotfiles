# Merge queue

`main` lands through a [Mergify](https://docs.mergify.com/merge-queue/) merge
queue: Mergify builds a temporary merge of the pull request on the current
tip of `main`, runs CI there, and squashes it onto `main` when the required
checks pass. Two green pull requests therefore cannot break each other on
landing. You submit; you stop watching.

Mergify owns the queue instead of GitHub's native one: GitHub's queue is
available only in a repository owned by an organization, and this one is
user-owned (`aviralmansingka/dotfiles`, owner type `User`). The native queue
is not enabled here, and no `merge queue` ruleset exists.

## Submit

A submit is a label. `gh-dash-enqueue-pr` adds `queue` to the pull request
with `gh pr edit`, and `.mergify.yml` queues it when the label appears.

- gh-dash: press `M` on a pull request (`submit to merge queue`).
- Shell: `gh-dash-enqueue-pr <owner>/<repo> <pr>`.

Both print the path they took. Submitting twice is a no-op: the helper reads
the labels first and reports that the pull request is already submitted.
Taking the label off is the un-submit; the pull request leaves the queue
because `queue_conditions` no longer match.

The helper is `gh-dash/.local/bin/gh-dash-enqueue-pr` (stowed to
`~/.local/bin`). Its suite is `scripts/test-gh-dash-enqueue-pr.sh`.

## What the queue does

1. The label appears, so the rule's `queue` action enters the pull request in
   the `main` queue.
2. Mergify builds a temporary merge of the pull request on the current tip of
   `main` and runs the required checks there. The branch protections are
   injected as queue and merge conditions, so `CI result` still gates the
   merge.
3. Green: Mergify squash-merges the pull request onto `main`. The `queue`
   label stays on the merged pull request.
4. Red: Mergify drops the pull request from the queue and marks it
   `dequeued`. A rule then takes both `queue` and `dequeued` off, so the
   pull request returns to My Pull Requests and leaves the Merge Queue section
   until someone fixes it and submits again.

An entry whose checks stay pending past the queue's `checks_timeout`
(60 minutes) is dropped the same way. So is one that conflicts with the base
branch, or with a pull request that has already merged.

## Watch

- gh-dash: the **Merge Queue** section (`is:open label:queue`). My Pull
  Requests excludes queued pull requests (`-label:queue`), so a submitted
  pull request lives in exactly one section.
- GitHub: the **Mergify Merge Queue** check run on the pull request, which
  reports its queue state, plus Mergify's status comments.
- Labels: Mergify adds `queued` while the pull request sits in the queue, and
  `dequeued` for the moment before the drop rule clears it with `queue`.
- Dashboard: <https://dashboard.mergify.com> shows the queue, its position,
  and its CI history.

## Configuration

`.mergify.yml` at the repository root is the whole configuration:

- one queue rule, `main`: `merge_method: squash`, `batch_size: 1`,
  `checks_timeout: 60 minutes`, and `queue_conditions` of `base = main` plus
  `label = queue`;
- one pull request rule that runs the `queue` action, gated on the same label
  and on `label != dequeued`, so a dropped entry cannot requeue itself;
- one pull request rule that strips `queue` and `dequeued` when Mergify marks
  a drop.

`merge_protections_settings.auto_merge_conditions` is deliberately unset: an
approval alone never submits, and never merges without the label. Mergify
validates the file on every push and reports problems in the Checks tab; the
suite also pins the queue settings and the label gate.

## Requirements

Three settings make the queue work.

1. The Mergify GitHub App is installed on this repository, with the merge
   queue enabled in the dashboard. Until it is, the label does nothing: no
   app, no queue.
2. `strict` ("Require branches to be up to date before merging") is off on
   `main`'s classic branch protection. The required check `CI result` stays.
   The queue tests each entry on the current tip, so a strict up-to-date gate
   would only add rebases and block entry.
3. No active ruleset on `main` gets in Mergify's way. The one ruleset this
   repository has (`main`, `deletion` and `non_fast_forward`) is disabled. If
   a ruleset is ever turned on for `main`, add Mergify to its bypass list with
   the `exempt` bypass mode.

`merge_group` in `.github/workflows/ci.yml` stays, even though Mergify never
uses GitHub's queue: it is the fallback. If this repository moves into an
organization and the native queue is enabled, an entry runs on the synthetic
`gh-readonly-queue/main/pr-<n>` ref, and the required `CI result` check must
report there or every entry waits until the queue times out.
`scripts/test-ci-self.mjs` guards the trigger, `merge_group:` must never be
dropped, and the trigger must not gain a `paths:` filter.

## Closeout

A pull request whose required `CI result` check is green is ready, so the
closeout adds the label (`M` in gh-dash, or `gh-dash-enqueue-pr`). The rule
lives in `AGENTS.md`.

## Failure modes

- Entry red in the queue: Mergify drops it and the label comes off. Fix,
  push, submit again.
- Entry times out at 60 minutes: dropped, same path. Raise `checks_timeout`
  if a lane gets slower than that.
- Mergify drops the entry, but the label stays: the removal rule did not run
  (workflow automation disabled, or a configuration error). Remove `queue` by
  hand; the helper also clears a stale `dequeued` mark on the next submit.
- Skipping the queue: `gh pr merge --admin` still works for an admin, because
  `enforce_admins` is off. It bypasses the queue entirely.
