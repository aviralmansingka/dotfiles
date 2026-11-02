# Professor evals

A headless harness that runs the `professor` skill against a **user simulator**.
Each harness invocation is a **rollout**; the rollout produces one
**trajectory** — every user turn, agent turn, tool call, and result. The harness
scores that trajectory against policy checks.

The user simulator replaces the interactive instruments with deterministic
stubs. It holds a set of facts. Each fact is known from the start or unlocked
when a lesson carries its teach keywords. A fact may carry a wrong claim, which
the simulator asserts until the fact unlocks. Questions are matched against fact
keywords, so the simulator can answer about any node it holds.

## Terms

| Term | Meaning | Here |
|---|---|---|
| **Trajectory** | one complete run: user turns, agent turns, tool calls, results | `calls.jsonl`, `sessions/*.jsonl` |
| **Task instance** | the specification the rollout starts from | `scenarios/<id>.json` (directory name kept) |
| **User simulator** | the scripted party that answers the professor | `stubs.ts` |
| **Environment** | what the agent can touch besides the tools | workspace, private vault |
| **Failure case** | one real moment from a past trajectory, worth reproducing | `EXAMPLES.md` |
| **Policy check** | a rule asserted over the produced trajectory | `score.mjs` |

## Run

```bash
evals/professor/run.sh <task-instance> <skill-dir> [model]
```

```bash
# the current skill
evals/professor/run.sh cuda-event-timing agents/.agents/skills/professor

# an A/B against main: three rollouts per arm, interleaved
evals/professor/variant.sh main /tmp/prof-old
evals/professor/compare.sh cuda-event-timing 3 agents/.agents/skills/professor /tmp/prof-old
```

Each rollout writes `evals/professor/runs/<stamp>-<instance>-<tag>/`:

| File | Holds |
|---|---|
| `professor/` | the exact skill variant under test |
| `scenario.json` | the task instance |
| `calls.jsonl` | the step log, one row per instrument call |
| `state.json` | the user simulator's final state |
| `meta.json` | model, skill hash, git commit, date |
| `stdout.txt` | the professor's visible text |
| `sessions/` | the pi session file |
| `score.txt`, `score.json` | the scorecards |

Cost: one model rollout per invocation, about 5–10 minutes.
`summarize.mjs` prints a table for a set of rollouts.

## What the checks measure

**Policy** — five checks on the produced trajectory:

1. **contractBeforeProbe** — an `ask_user_question` happens before the first
   quiz.
2. **probeBeforeTeach** — a question happens before the first `lesson`.
3. **taughtCorrection** — a lesson body carries the planted correction.
4. **verifiedAfterTeach** — a question about the target fact, asked after the
   correction, is answered right. Unrelated nodes cannot fail this check.
5. **questionRunOk** — no more than two non-probe questions in a row without a
   lesson.

The `already-known` task instance adds **noUnneededTeaching**: the professor
must not teach a fact the simulator already holds. It replaces
`taughtCorrection` with `targetHeld` and `verifiedAfterTeach` with
`verifiedOnTarget`, because nothing has to be taught.

**Metadata** — instrument hygiene, reported beside the policy score:

- every quiz and explain carries a `title`;
- every quiz carries `contextFiles`;
- every explain carries `expected`.

Metadata does not enter the policy score. It moves too much between rollouts to
mix with the loop checks.

## Add a task instance

Copy `scenarios/cuda-event-timing.json` and edit:

- `facts` — claims, keywords that identify a question about them, and `known`
  for facts the simulator holds at the start.
- `target` — the fact under test. Its `wrong` claim is the planted
  misconception; its `teachGroups` are the keyword groups a lesson must carry to
  unlock it. A lesson unlocks the fact when every group matches a word.
- `grill` — the simulator's answers to the goal-grill questions, in order.
- `mode` — set `already-known` to check that the professor teaches nothing the
  simulator holds.

## Current results

Same model on both arms (`fireworks/glm-5p3-fast`), 2026-11-02, one rollout per
cell. Before is commit `f67576e5^`; after is this harness.

| Task instance | Before | After |
|---|---|---|
| mtu-blackhole | 5/5 | 5/5 |
| cuda-event-timing | 2/5, cut at the 900 s cap | 4/5 |
| already-known | not measurable | 5/6, max question run 10 |

The harness change moved validity, not the score. On MTU both versions pass. On
CUDA the old simulator could not answer a later node, so it never flipped and
the rollout hit the cap; the new simulator flips and the loop completes. The
already-known instance is new, and it found a real failure: ten questions in a
row without a lesson.

A sonnet batch before these changes scored CUDA 5, 5, 5 and MTU 5, 4, 3. Those
MTU failures came from the single-fact simulator, not from the skill.

## Honest limits

- **Policy, not learning.** The checks measure whether the professor follows the
  loop. They do not measure whether a human would learn more.
- **Keyword simulator.** The simulator matches questions by keyword. A question
  phrased outside the instance vocabulary falls back to the target fact and is
  counted as unrecognised. Read that count before you trust a score.
- **One model.** Scores move with the model. Compare variants on the same model,
  never across models.
- **Not in CI.** A rollout calls a paid model and takes minutes. Keep it manual.
