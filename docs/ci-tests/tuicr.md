# tuicr — CI test doc

## Purpose

This suite guards the tuicr extension: `tuicr.ts`, `tuicr-core.mjs`, and
`tuicr.test.mjs` under `pi/.pi/agent/extensions/`. It opens tuicr reviews,
steers user comments into the session, and posts agent replies in the TUI.

## What the suite covers

- Reply-loop prevention (#246). `newComments` removes comments that the
  `pi-agent` author wrote, and replies tracked by id. The watcher never
  steers its own reply back. `collectSeenKeys` keeps the old-comment
  baseline. `firstNonEmptyLine` shows only the leading reply line.
- Command grammar. `parseTuicrCommandArgs` accepts `pr N`, `-r revset`,
  `--revset`, `-w`, `watch`, and `stop` forms. Bad tokens and missing
  values raise usage errors. `scopeToTuicrArgs` and `buildWrapperArgs`
  map every scope into one wrapper argv.
- Target resolution (#289). `resolveTargetSession` uses the explicit
  target: a `pr 287` request never attaches to the session for PR 288.
  The suite asserts refusal on a wrong session, attach on an exact
  match, and duplicate-reviewer refusal per repo.
- The subagent flow. `buildReviewSubagentTask` names the session, the
  sweep of old comments, and the reply rule. The launch path spawns the
  wrapper with the exact scope argv. `attachOnly` never opens a pane.
- The watcher loop. New comments steer in as `tuicr_review_comments` with
  `triggerTurn`. The end of the review, CLI failure, ambiguity, and a
  dead launch window each send one final steer and stop the watcher.
- Reply anchors. `postTuicrReply` accepts `file:line`, `replyTo`, and the
  `Re: review comments` fallback. It refuses empty messages, bad line
  anchors, and preemptive self-review comments.
- Keep-open slot contract (#286). `tuicr.ts` publishes its open-session
  count under `Symbol.for("pi-subagents/keep-open-count")`. The slot is
  shared with `no-mistakes-pane.ts`, whose suite asserts its own side.
  Each writer must capture the previous function and add its own count.
  The suite asserts the add, the release, and the idempotence under
  repeated factory calls. A broken or non-function previous owner
  counts as zero.

## How to run

```
npm install --prefix /tmp/tc-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/tc-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/tc-jiti/node_modules
cd pi/.pi/agent/extensions && node tuicr.test.mjs
```

The suite stays offline and deterministic. Fake `tuicr` and `git` binaries
go on `PATH` before the import; a fake wrapper logs argv and opens no pane.
It stages fixtures, restores env in `finally`, and sleeps at most 100 ms.

## Runtime and SLA

The suite runs in about 1.7 s; the budget is 5 s. The watcher polls at 20 ms.

## Coverage result

`c8` reports the suite against both files: statements 92.5 percent
(baseline 88.3), branches 77.9 percent, functions 93.3 percent.

```
/tmp/tc-cov/node_modules/.bin/c8 --reporter=text \
  --include='pi/.pi/agent/extensions/tuicr-core.mjs' \
  --include='pi/.pi/agent/extensions/tuicr.ts' \
  node pi/.pi/agent/extensions/tuicr.test.mjs
```

Run `c8` from the repo root; the jiti line map for `tuicr.ts` is fuzzy.

## Known gaps

- The `renderCall` and `renderResult` wrappers in `tuicr.ts` stay thin
  and untested. The pure formatters in `tuicr-core.mjs` carry the load.
- The real wrapper scripts and real panes need live tmux or Herdr. They
  stay in the manual tier.
- Revset matching assumes a slug that ends in `/commits/<revset>`. A
  different slug format reads as a miss, and the tool refuses the attach.
- The poll loop uses real 20 ms timers. A timing race inside one poll
  window stays outside the assertions.
