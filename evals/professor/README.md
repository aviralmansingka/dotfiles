# Professor evals

A headless harness that runs the `professor` skill against a simulated learner.
It answers the question a transcript review cannot: **does a skill change make
the teaching loop better?**

The harness replaces the interactive instruments with deterministic stubs. The
learner knows what the scenario says it knows, holds one planted misconception,
and changes its mind only when a `lesson` body carries the correcting claim. No
panes, no TUI, no human in the loop.

## Run

```bash
evals/professor/run.sh <scenario> <skill-dir> [model]
```

```bash
# the current skill
evals/professor/run.sh cuda-event-timing agents/.agents/skills/professor

# an A/B against main
evals/professor/variant.sh main /tmp/prof-old
evals/professor/run.sh cuda-event-timing /tmp/prof-old
```

Every run writes `evals/professor/runs/<stamp>-<scenario>-<tag>/`:

| File | Holds |
|---|---|
| `professor/` | the exact skill variant that ran |
| `scenario.json` | the learner profile |
| `calls.jsonl` | one row per instrument call |
| `state.json` | the learner's final state |
| `stdout.txt` | the professor's visible transcript |
| `sessions/` | the pi session file |
| `score.txt`, `score.json` | the metrics |

Cost: one model run per invocation, about 3–8 minutes.

## What the score measures

Five policy checks, not taste:

1. **contractBeforeProbe** — an `ask_user_question` happens before the first
   quiz. The goal contract comes first.
2. **probeBeforeTeach** — a question happens before the first `lesson`.
3. **taughtCorrection** — a lesson body carries the planted correction.
4. **verifiedAfterTeach** — a question after that lesson is answered right.
5. **questionRunOk** — no more than two non-probe questions in a row without a
   lesson.

The report also prints title coverage, `contextFiles` coverage, and the count of
questions the learner could not place. Those are adherence signals, not scores.

## Add a scenario

Copy `scenarios/cuda-event-timing.json` and edit:

- `known` — facts the learner holds, with keywords that identify a question
  about them.
- `gap` — the misconception (`wrong`), the correction (`right`), and the
  keywords that identify a question about it.
- `teachGroups` — keyword groups for the correction. A lesson flips the learner
  when every group matches at least one word.
- `grill` — the learner's answers to the goal-grill questions, in order.

## Current results

Split skill, `anthropic/claude-sonnet-4-5`, 2026-11-02, three runs per scenario:

| Scenario | Scores | Median | Notes |
|---|---|---|---|
| cuda-event-timing | 5, 5, 5 | 5/5 | all five checks 3/3 |
| mtu-blackhole | 5, 4, 3 | 4/5 | correction taught 3/3; verify 1/3; question run 2/3 |

Across both scenarios the three structural checks — contract before probe,
probe before teach, correction taught — pass 18 of 18. Completion is the weak
point. Treat the MTU verify failures with care: the one-gap learner answers
later nodes with the planted correction, so a follow-up question about a
different node reads as wrong even when the professor taught it.

## Honest limits

- **Policy, not learning.** The checks measure whether the professor follows the
  loop. They do not measure whether a human would learn more.
- **Keyword learner.** The stub matches questions by keyword. A question phrased
  outside the scenario vocabulary is answered from the misconception and logged
  as unrecognised. Read that count before you trust a score.
- **One model.** Scores move with the model. Compare variants on the same model,
  never across models.
- **Not in CI.** A run calls a paid model and takes minutes. Keep it manual.

## Fixtures with source files

`contextFiles` is only testable when the workspace holds the file a question
drills. Add the file under the scenario directory and copy it into the run
workspace when you need that check.
