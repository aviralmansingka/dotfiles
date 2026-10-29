# practice (problem / conclude) — CI test doc

## Purpose

This suite guards the revision-mode instrument pair — `practice.ts` under
`pi/.pi/agent/extensions/`. It checks the demand contract: one active
problem per session, an attempt counter, a commitment that never changes,
and a model solution that stays hidden until `conclude`.

## Overview

The `problem` tool poses one practice demand and returns the learner's
working. The `conclude` tool ends the problem and reveals the committed
solution. The active problem lives in a module-level map, keyed by the
session file, then the cwd, then `"anon"`. The suite resets that map with
`__resetPracticeState()`.

The test uses the same jiti stub harness as `quiz-result.test.mjs`. The
`ui.custom` stub renders each panel before it sends scripted keystrokes, so
the suite can assert what the learner saw when the panel opened.

## What the suite covers

- **First pose.** The problem is stored with `attempt: 1`. The panel shows
  the title and the statement. The panel never shows the model solution.
- **Next attempt.** A second pose with the same statement, targets, and
  mode increments the attempt. The stored commitment stays in force, and a
  later conclude returns the original solution.
- **Changed commitment.** A re-pose with a different `modelSolution` is an
  error result, and no panel opens.
- **Different problem while one is active.** The error text is exact:
  `A problem is already active (<title>). Call conclude before posing another.`
- **Conclude.** The result reveals the committed solution, reports the
  attempt count, and renders the solution in the reveal panel. The state is
  cleared, so the next problem starts at attempt 1.
- **Nothing active.** `conclude` is an error result.
- **Cancel.** Esc keeps the problem active. Another problem stays refused,
  and `conclude` still closes it.
- **Details shapes.** The suite asserts the exact `details` object for
  `submitted`, `cancelled`, and `concluded`.
- **Guard paths.** Empty `title`, `statement`, `modelSolution`, and
  `targets` are errors. A call without UI is an error. An already-aborted
  turn poses nothing.
- **Session keying.** A problem in one session is not active in another. A
  problem keyed by cwd concludes under the same cwd.
- **Transcript renders.** `renderCall` never leaks the model solution.
  `renderResult` shows the solution only for a concluded problem.

Journal formatting for the same entries lives in the journal domain:
`formatProblemEntry` and `formatConcludeEntry` are covered by
`md-log.test.mjs`.

## How to run

```sh
npm install --prefix /tmp/pr-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/pr-jiti/node_modules/jiti/lib/jiti.cjs \
       NODE_PATH=/tmp/pr-jiti/node_modules
node pi/.pi/agent/extensions/practice.test.mjs
```

## Runtime and SLA

| File | Typical runtime | Budget |
|------|-----------------|--------|
| `practice.test.mjs` | ~0.05 s | < 5 s |

The suite is offline and hermetic. It writes only to a temp dir, and it
removes that dir at the end.

## Coverage result

The suite drives every decision in `practice.ts`: the first pose, the repeat
pose, the changed-commitment guard, the different-problem guard, submit,
cancel, conclude, and the no-active-problem guard. It also calls both
`renderCall` and `renderResult` on both tools.

## Known gaps

- The panel frame is asserted through the stub renderer, not through a real
  terminal. Column-exact frame geometry is not covered here.
- The reveal panel's behaviour on a UI failure is guarded in the source but
  not asserted, because the harness cannot make `ui.custom` fail after a
  successful pose.
