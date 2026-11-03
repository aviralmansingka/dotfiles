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
| **Task** (task instance) | the specification the rollout starts from | `tasks/<id>.json` |
| **User simulator** | the scripted party that answers the professor | `stubs.ts` |
| **Environment** | what the agent can touch besides the tools | workspace, private vault |
| **Failure case** | one real moment from a past trajectory, worth reproducing | `EXAMPLES.md` |
| **Policy check** | a rule asserted over the produced trajectory | `score.mjs` |

## Run

```bash
evals/professor/run.sh <task> <skill-dir> [model]
```

```bash
# the current skill
evals/professor/run.sh cuda-event-timing agents/.agents/skills/professor

# an A/B against main: three rollouts per arm, interleaved
evals/professor/variant.sh main /tmp/prof-old
evals/professor/compare.sh cuda-event-timing 3 agents/.agents/skills/professor /tmp/prof-old
```

Each rollout writes `evals/professor/runs/<stamp>-<task>-<tag>/`:

| File | Holds |
|---|---|
| `professor/` | the exact skill variant under test |
| `task.json` | the task definition |
| `calls.jsonl` | the step log, one row per instrument call |
| `state.json` | the user simulator's final state |
| `meta.json` | model, skill hash, git commit, date |
| `stdout.txt` | the professor's visible text |
| `sessions/` | the pi session file |
| `score.txt`, `score.json` | the scorecards |

Cost: one model rollout per invocation, about 5–10 minutes.
`summarize.mjs` prints a table for a set of rollouts.

## What the checks measure

**Policy** — four checks on the produced trajectory:

1. **contractBeforeProbe** — an `ask_user_question` happens before the first
   quiz.
2. **probeBeforeTeach** — a question happens before the first `lesson`.
3. **taughtCorrection** — a lesson body carries the planted correction.
4. **verifiedAfterTeach** — a question about the target fact, asked after the
   correction, is answered right. Unrelated nodes cannot fail this check.

Question runs are reported, not scored. Probing may run as long as a strand
needs; the report keeps the longest run and the unrecognised count as signals.

Task modes change the check set:

- **default** — the four checks above.
- **already-known** — `targetHeld` and `verifiedOnTarget` replace the teach and
  verify checks, and `noUnneededTeaching` is added.
- **diagnostic** — `noTeaching` (zero lessons) replaces the teach and verify
  checks. The session is a survey, not a lesson.
- **cold-start** — the learner's first message is `hi`, and `entryQuestion`
  checks that the first instrument call is `ask_user_question`.
- **resume** — the workspace holds an existing `session.md`. The checks drop
  the grill and probe rules, require a lesson first, and forbid repeating the
  cancelled quiz title.

**Metadata** — instrument hygiene, reported beside the policy score:

- every quiz and explain carries a `title`;
- every quiz carries `contextFiles`;
- every explain carries `expected`.

Metadata does not enter the policy score. It moves too much between rollouts to
mix with the loop checks.

## Tasks

| Task | Mode | Failure case |
|---|---|---|
| `cuda-event-timing` | default | timing boundary, E10 lab |
| `mtu-blackhole` | default | small packets pass, large packets drop |
| `bgp-route-selection` | default | local preference beats AS path |
| `fenwick-prefix-sums` | default | lowbit steps, O(log n) both ways |
| `transpose-bandwidth` | default | strided writes cost sectors |
| `blank-slate` | default | teach a new concept, no misconception |
| `already-known` | already-known | E9, no re-teach |
| `ncp-diagnostic` | diagnostic | E8, survey without lessons |
| `cold-start` | cold-start | E1, begin on the first turn |
| `framing-complaint` | default | E2, repair not volume |
| `goal-drift` | default | E3, re-anchor to the goal |
| `derivation-gap` | default | E4, derive the constant |
| `lesson-channel` | default | E5, teach through `lesson` |
| `resume-cancel` | resume | E6, do not re-pose a cancelled quiz |
| `scope-change` | default | E11, add a node on request |
| `handout-missing` | default | E12, artifact really written |

## Task fields

| Field | Effect |
|---|---|
| `facts`, `target`, `grill` | the simulator profile and the goal-grill answers |
| `mode` | `default`, `already-known`, `diagnostic`, `cold-start`, `resume` |
| `commandOutput` | canned output for run-command |
| `interjections` | `[{afterCall, text}]` — a real user turn at that call |
| `interjectionCheck` | `repair` (one question then a lesson) or `anchor` (next call is a question about direction or a lesson) |
| `bodyChecks` | `[{label, groups}]` — a lesson body must carry every group |
| `channelCheck`, `channelLimit` | visible text beside a question must stay short |
| `artifacts` | files that must exist in the workspace after the rollout |
| `planFile`, `planContains` | the plan file must gain the named content |
| `workspace` | fixture tree copied into the run workspace |
| `vault` | proposition notes copied into the run vault |
| `cancelledTitle` | a quiz title a resume must not repeat |

## Add a task

Copy `tasks/cuda-event-timing.json` and edit `facts`, `target`, `grill`, and
optionally the feature fields above. A task runs with the default check set
unless its mode or fields add more.

## Current results

Full sweep, 2026-11-03, `fireworks/glm-5p3-fast`, one rollout per task after the
survey, held-goal, and complaint fixes: **16 of 16 tasks at full score.**

| Task | Check set | Score |
|---|---|---|
| already-known | 5 | 5/5 |
| ncp-diagnostic | 3 | 3/3 |
| goal-drift, framing-complaint, lesson-channel, scope-change, derivation-gap, handout-missing, cold-start | 5 | 5/5 |
| cuda, mtu, bgp, fenwick, transpose, blank-slate, resume-cancel | 4 | 4/4 |

What moved the score:

- Putting the survey and held-goal stops in `SKILL.md` and the professor agent
  prompt, not in a phase file. Diagnostic 2/3 to 3/3, already-known 4/5 to 5/5.
- The complaint rule. Goal-drift 4/5 to 5/5.
- The plan check now reads any `session.md` the rollout writes, and
  `EVAL_TIMEOUT` lets a long task finish. Scope-change 2/5 to 5/5.
- Six `continue` follow-ups, so a parked professor can finish. Lesson-channel
  3/5 to 5/5.

Metadata is still reported, not scored. Titles and `contextFiles` vary by
model; the schema now requires them, so a real run rejects a bare call and
retries, but the stub scenario accepts it.

## Honest limits

- **Policy, not learning.** The checks measure whether the professor follows the
  loop. They do not measure whether a human would learn more.
- **Keyword simulator.** The simulator matches questions by keyword. A question
  phrased outside the instance vocabulary falls back to the target fact and is
  counted as unrecognised. Read that count before you trust a score.
- **One model.** Scores move with the model. Compare variants on the same model,
  never across models.
- **Not in CI.** A rollout calls a paid model and takes minutes. Keep it manual.
