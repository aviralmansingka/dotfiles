# Professor evals

A headless harness that runs the `professor` skill against a simulated learner.
It answers the question a transcript review cannot: **does a skill change make
the teaching loop better?**

The harness replaces the interactive instruments with deterministic stubs. The
learner holds a set of facts. Each fact is known from the start or unlocked when
a lesson carries its teach keywords. A fact may carry a wrong claim, which the
learner asserts until the fact unlocks. Questions are matched against fact
keywords, so the learner can answer about any node it holds. No panes, no TUI,
no human in the loop.

## Run

```bash
evals/professor/run.sh <scenario> <skill-dir> [model]
```

```bash
# the current skill
evals/professor/run.sh cuda-event-timing agents/.agents/skills/professor

# an A/B against main: three runs per arm, interleaved
evals/professor/variant.sh main /tmp/prof-old
evals/professor/compare.sh cuda-event-timing 3 agents/.agents/skills/professor /tmp/prof-old
```

Every run writes `evals/professor/runs/<stamp>-<scenario>-<tag>/`:

| File | Holds |
|---|---|
| `professor/` | the exact skill variant that ran |
| `scenario.json` | the learner profile |
| `calls.jsonl` | one row per instrument call |
| `state.json` | the learner's final state |
| `meta.json` | model, skill hash, git commit, date |
| `stdout.txt` | the professor's visible transcript |
| `sessions/` | the pi session file |
| `score.txt`, `score.json` | the scorecards |

Cost: one model run per invocation, about 5–10 minutes. `summarize.mjs` prints a
table for a set of runs.

## What the score measures

**Policy** — five checks on the teaching loop:

1. **contractBeforeProbe** — an `ask_user_question` happens before the first
   quiz.
2. **probeBeforeTeach** — a question happens before the first `lesson`.
3. **taughtCorrection** — a lesson body carries the planted correction.
4. **verifiedAfterTeach** — a question about the target fact, asked after the
   correction, is answered right. Unrelated nodes cannot fail this check.
5. **questionRunOk** — no more than two non-probe questions in a row without a
   lesson.

`already-known` scenarios add **noUnneededTeaching**: the professor must not
teach a fact the learner already holds.

**Metadata** — instrument hygiene, reported beside the policy score:

- every quiz and explain carries a `title`;
- every quiz carries `contextFiles`;
- every explain carries `expected`.

Metadata does not enter the policy score. It moves too much between runs to mix
with the loop checks.

## Add a scenario

Copy `scenarios/cuda-event-timing.json` and edit:

- `facts` — claims, keywords that identify a question about them, and `known`
  for facts the learner holds at the start.
- `target` — the fact under test. Its `wrong` claim is the planted
  misconception; its `teachGroups` are the keyword groups a lesson must carry to
  unlock it. A lesson unlocks the fact when every group matches a word.
- `grill` — the learner's answers to the goal-grill questions, in order.
- `mode` — set `already-known` to check that the professor teaches nothing the
  learner holds.

## Current results

Same model on both arms (`fireworks/glm-5p3-fast`), 2026-11-02, one run per
cell. Before is commit `f67576e5^`; after is this harness.

| Scenario | Before | After |
|---|---|---|
| mtu-blackhole | 5/5 | 5/5 |
| cuda-event-timing | 2/5, cut at the 900 s cap | 4/5 |
| already-known | not measurable | 5/6, max question run 10 |

The harness change moved validity, not the score. On MTU both versions pass.
On CUDA the old learner could not answer a later node, so it never flipped and
the run hit the cap; the new learner flips and the loop completes. The
already-known scenario is new, and it found a real failure: ten questions in a
row without a lesson.

A sonnet batch before these changes scored CUDA 5, 5, 5 and MTU 5, 4, 3. Those
MTU failures were the one-gap learner, not the skill.

## Honest limits

- **Policy, not learning.** The checks measure whether the professor follows the
  loop. They do not measure whether a human would learn more.
- **Keyword learner.** The stub matches questions by keyword. A question phrased
  outside the scenario vocabulary falls back to the target fact and is counted
  as unrecognised. Read that count before you trust a score.
- **One model.** Scores move with the model. Compare variants on the same model,
  never across models.
- **Not in CI.** A run calls a paid model and takes minutes. Keep it manual.
