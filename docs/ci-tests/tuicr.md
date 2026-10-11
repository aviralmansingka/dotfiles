# tuicr — CI test doc

## Purpose

This suite guards the tuicr extension files under `pi/.pi/agent/extensions/`.
They open reviews, steer user comments into the session, and post replies.

## What the suite covers

- Reply-loop prevention (#246). `newComments` removes comments by the
  `pi-agent` author and replies tracked by id, so the watcher never steers
  its own reply back. `collectSeenKeys` keeps the baseline;
  `firstNonEmptyLine` shows only the leading reply line.
- Command grammar. `parseTuicrCommandArgs` accepts `pr N`, `-r revset`,
  `--revset`, `-w`, `watch`, and `stop`; a bare call carries no scope, so
  the default rule applies, and bad tokens raise usage errors.
- Target resolution (#289). `resolveTargetSession` honors the explicit
  target: a `pr 287` request never attaches to the session for PR 288.
  An explicit pr attaches on an exact match, else it launches for that
  PR; an explicit working tree or revset always launches; an explicit
  slug attaches active-or-not. A bare call resolves the current branch's
  open PR: one → match-or-launch, none → working tree, several → an
  error that asks for `pr`. Merge note: two fixes of this bug met in
  the merge; the one API keeps our name and main's matrix.
- Classification units. `classifyReviewRequest` maps every request form;
  `prSessionNumber` reads the PR suffix with no prefix confusion;
  `resolveLaunchedSession` resolves by PR suffix or baseline diff.
- The subagent flow. The subagent owns the pane: a launch task opens the
  pane in its own tab; an attach task passes `sessionSlug` plus
  `attachOnly`; the parent opens no pane in the review flow. One reviewer
  runs per target; different targets run concurrently.
- The watcher loop. New comments steer in as `tuicr_review_comments` with
  `triggerTurn`; review end, CLI failure, ambiguity, and a dead launch
  window each send one final steer and stop the watcher.
- Reply anchors. `postTuicrReply` accepts `file:line`, `replyTo`, and the
  `Re: review comments` fallback; it refuses empty messages and bad anchors.
- Keep-open slot contract (#286/C28). `tuicr.ts` and `no-mistakes-pane.ts`
  both publish their open-session counts through the shared
  `keep-open-slot.mjs` module under
  `Symbol.for("pi-subagents/keep-open-count")`: keyed per-owner entries in
  one null-prototype holder, summed by a single reader. The suite asserts
  the add, the release, and repeated-load idempotence; a broken or
  non-function previous owner counts as zero; and cross-load-order tests
  drive a real watcher plus the real pane count in one process, both orders.

## How to run

```
npm install --prefix /tmp/tc-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/tc-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/tc-jiti/node_modules
cd pi/.pi/agent/extensions && node tuicr.test.mjs
```

The suite stays offline and deterministic. Fake `tuicr`, `git`, and `gh`
binaries go on `PATH` before the import; a fake wrapper logs argv and
opens no pane. The fakes serve the staged branch and open-PR list. Env
restores in `finally`; no sleep exceeds 100 ms.

## Runtime and SLA

The suite runs in about 1.9 s; the budget is 5 s. The watcher polls at 20 ms.

## Coverage result

`c8` reports (run from the repo root; the jiti line map is fuzzy):
statements 94.8 percent (merge baseline 92.5), branches 79.5, functions 95.2.

```
/tmp/tc-cov/node_modules/.bin/c8 --reporter=text \
  --include='pi/.pi/agent/extensions/tuicr-core.mjs' \
  --include='pi/.pi/agent/extensions/tuicr.ts' \
  node pi/.pi/agent/extensions/tuicr.test.mjs
```

## Known gaps

- The thin `renderCall`/`renderResult` wrappers in `tuicr.ts` stay untested;
  the pure formatters in `tuicr-core.mjs` carry the load.
- The real wrapper scripts and panes need live tmux or Herdr (manual tier).
- A revset launch resolves its session by baseline diff, not slug text.
- The poll loop uses real 20 ms timers; intra-window races stay unasserted.
