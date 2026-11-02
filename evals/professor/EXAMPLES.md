# Eval examples, explained

Each example is a **failure case**: one real moment from a past trajectory,
written down so a change to the professor skill either keeps the behavior or
breaks it. The point is not to replay the whole trajectory. The point is to pin
one behavior.

Read an example in five parts:

- **Evaluates** — the behavior under test.
- **Failure case** — the evidence, with the trajectory file.
- **Expected** — what the professor should do.
- **Check** — the machine test.
- **Good for / not for** — the scope of the claim it supports.

All source trajectories live in `~/.pi/agent/sessions` on the MacBook or on the
homelab. Dates are UTC. The harness terms are defined in `README.md`: a
**trajectory** is one full run, a **task instance** is what a rollout starts
from, and the **user simulator** answers the professor. The **learner** in these
write-ups is the real person in the recorded trajectory; the simulator stands
in for that learner during a rollout.

---

## E1 — Dead start

**Evaluates** whether the professor begins on the first turn. Nothing tests
teaching quality here; it tests that the pane is alive.

**Failure case** — `2026-09-30T16:54:05`, homelab, `~/mohzi-deal`. The learner typed
`hi`. The pane produced no output. The next message was the learner prodding it:
"You have not produced any output since launch — the learner is waiting."

**Expected** — the first turn greets the learner and asks the first Phase 0
question. The launcher contract says the professor must not sit silent.

**Check** — the first assistant tool call is `ask_user_question`.

**Good for** — entry-protocol regressions, launcher wiring, and the effect of a
skill edit on the very first turn.

**Not for** — greeting quality, warmth, or whether the first question is a good
one.

**Runs as** — a task instance, one simulator turn (`hi`), empty vault. Ready today.

---

## E2 — A framing complaint answered with more questions

**Evaluates** the response to a comprehension complaint. When the learner says
the question was unclear, the next move is repair, not volume.

**Failure case** — `2026-09-24T20:52:53`, MacBook, `~/kimi-endpoint`. The learner said
"I didn't understand your question. It wasn't framed very well." The next six
calls were questions: one explain and five quizzes. None re-framed the original
question.

**Expected** — one re-framed question with a concrete entry point, or a short
lesson that supplies the missing term. Never a stack of new questions.

**Check** — after the complaint, at most one question before a `lesson`, and the
question text must change materially.

**Good for** — the repair loop. It catches the failure where the professor reads
"unclear" as "needs more practice".

**Not for** — judging whether the new framing is clearer. That needs a reader or
a judge model.

**Runs as** — `framing-complaint`: a task instance with a scripted interjection.
The `repairNotVolume` check requires one question at most before a lesson.

---

## E3 — Goal drift

**Evaluates** whether teaching stays inside the approved goal contract.

**Failure case** — `2026-09-18T19:50:35`, homelab, `~/vault/lab-transpose`. The learner
said "restart this quiz. I think we're veering far from the course of what we're
trying to teach."

**Expected** — stop, restate the goal contract in one line, drop the off-goal
node, and ask which direction to take.

**Check** — the next lesson or question references the goal wording, and no new
quiz runs on the off-goal node.

**Good for** — goal boundedness. It is the guard for "goal before curriculum".

**Not for** — deciding whether a detour would have been valuable. Some detours
are good; this check only catches the unannounced ones.

**Runs as** — `goal-drift`: a task instance with a scripted interjection and the
`goalAnchored` check. After the complaint the next call must ask direction or
teach.

---

## E4 — Unexplained constant

**Evaluates** derivation versus assertion. Every number in a lesson must come
from the model, not from nowhere.

**Failure case** — the same trajectory. The learner asked "where did 16Kb apart
come from? again, you're not explaining enough here." The number was used as a
fact, not derived.

**Expected** — derive the constant on the spot: the row length, the element
size, the stride, the product.

**Check** — the next lesson body contains the source numbers and their
arithmetic.

**Good for** — catching magic numbers, which is the "no faith facts" rule in a
form a machine can test.

**Not for** — judging whether the derivation is clear or complete.

**Runs as** — `derivation-gap`: a task instance with `bodyChecks`. A lesson body
must carry the arithmetic that produces the constant.

---

## E5 — Teaching that disappears

**Evaluates** the delivery channel. Teaching belongs in `lesson`, not in chat
text that scrolls away.

**Failure case** — `2026-09-30T16:54:05`, homelab, `~/mohzi-deal`. The learner said
"it's really irritating me how you teach me something in an output and it
disappears before I can read it."

**Expected** — teachable content in a `lesson` call. Assistant text stays
connective: one line before the question.

**Check** — teachable content appears in `lesson` calls; assistant text stays
short.

**Good for** — the console-versus-lesson rule, and the buffer contract.

**Not for** — whether the lesson is readable or well ordered.

**Runs as** — `lesson-channel`: a task instance with `channelCheck`. Visible text
beside a question must stay under the limit.

---

## E6 — Resume repeats a cancelled quiz

**Evaluates** resume discipline. A cancelled question is not a queued question.

**Failure case** — `2026-10-09T20:17:13` and `2026-10-09T20:20:41`, homelab,
`~/rack-bench`. Two rollouts three minutes apart re-posed the same
`N2 — Upload windows…` quiz. Neither got a learner answer. Both ended with no
teaching.

**Expected** — on resume, re-present the node with `lesson` first, then ask
once. The cancelled wording must not return verbatim.

**Check** — the first instrument after a resume is `lesson`, and no quiz repeats
the cancelled title.

**Good for** — the resume and handoff path, which is common across hosts.

**Not for** — long-arc retention. It says nothing about what the learner
remembered.

**Runs as** — `resume-cancel`: a task instance whose workspace holds `session.md`,
a delivered node, and a cancelled quiz. The checks require a lesson first and no
repeated cancelled title.

---

## E7 — Questions instead of teaching

**Evaluates** pacing: at most two questions in a row without a lesson.

**Failure case** — `2026-10-04T22:26:08`, homelab, `~/dotfiles/fix-pi-update`. Nine
calls with one lesson and a run of five questions. The same pattern appeared in
the harness: the `already-known` run asked ten questions in a row.

**Expected** — two questions, then a lesson that delivers the corrected model.

**Check** — the longest run of non-probe questions is two or less.

**Good for** — the most common real failure, and the one the professor feedback
file complains about directly ("at some point I need to actually acquire new
knowledge").

**Not for** — deciding the right number for a given learner. Two is a policy,
not a law of learning.

**Runs as** — a task instance; the `questionRunOk` policy check. Ready today.

---

## E8 — Diagnostic survey

**Evaluates** probe-only mode and the ranked-gap output.

**Failure case** — `2026-10-15T10:11:29`, homelab, `~/vault/lab-bmc-management`.
Seventeen explains and zero lessons. The learner said "Reciting the rubric is not
learning. I want to be probed to make sure I understand."

**Expected** — no teaching. A held list, ranked gaps, and one next move.

**Check** — zero lessons, and the answer names held items and ranked gaps.

**Good for** — the status and diagnosis path, which is the split skill's new
capability.

**Not for** — teaching quality, or whether the ranking is right.

**Runs as** — a task instance with a warm vault environment, so held items
come from the record. Needs vault seeding.

---

## E9 — Already held

**Evaluates** the rule "do not re-teach what the learner already holds."

**Failure case** — `~/vault/professor-lessons/ncp-diagnostic/gap-inventory.md`. The
inventory has a "what is already held (do not re-teach)" section. That section
exists because a real survey found the professor ready to re-teach it.

**Expected** — no lesson on a held fact. The professor confirms and moves to the
gap.

**Check** — no lesson body matches the held fact's keywords.

**Good for** — warm starts and the vault loop. It is the check that makes the
status read worth building.

**Not for** — whether the record is accurate. A wrong `demonstrated` field makes
this eval lie.

**Runs as** — a task instance with a warm vault holding real proposition
notes. Needs vault seeding.

---

## E10 — Lab grounding

**Evaluates** prediction before observation.

**Failure case** — `2026-09-04T14:49:12`, homelab, `~/vault/lab-cuda-mm`. Thirty-eight
run-command calls. The arc turned on one pair of numbers: host wall clock
0.42 ms against the CUDA event pair at 0.97 ms.

**Expected** — every command carries a prediction and the mechanism that
produces it. The result is compared against the prediction.

**Check** — every run-command call has a `prediction`, and a mismatch is named
as host drift, wrong model, or mistype.

**Good for** — the lab mode and the grounding rule.

**Not for** — whether the prediction was correct. The check tests the habit, not
the physics.

**Runs as** — a task instance with a canned command output. Ready today.

---

## E11 — Scope change on request

**Evaluates** replanning when the learner widens scope.

**Failure case** — `2026-10-08T17:08:32`, homelab,
`~/rack-bench/research-internet-performance`. The learner said "I don't really
understand BGP either. can you make sure you offer lessons on BGP in addition to
what you had planned."

**Expected** — add a BGP node to the DAG, show the plan change, and ask for
approval.

**Check** — the plan file gains the node and the learner is asked to approve the
change.

**Good for** — mid-trajectory replanning and the plan-approval gate.

**Not for** — judging whether the new scope is wise.

**Runs as** — `scope-change`: a task instance with `planContains`. The plan file
must gain the requested node.

---

## E12 — Handout never created

**Evaluates** artifact creation and self-check.

**Failure case** — `2026-09-04T19:48:14`, MacBook,
`~/dotfiles/audit-handout-generation`. The learner asked twice, then said "I'm
seeing errors where the handout is not actually getting created."

**Expected** — write `handout.md`, validate it, and name the path. A silent
success report with no file is the failure.

**Check** — the file exists in the workspace, parses, and the reply names it.

**Good for** — artifact contracts and the "never fail silently" rule.

**Not for** — handout quality or length.

**Runs as** — `handout-missing`: a task instance with `artifacts`. The handout
file must exist after the rollout.

---

## Coverage map

| Eval | Failure class | Check type | Task |
|---|---|---|---|
| E1 | entry | first instrument | `cold-start` |
| E2 | repair | question run | `framing-complaint` |
| E3 | goal drift | next instrument | `goal-drift` |
| E4 | assertion | lesson body groups | `derivation-gap` |
| E5 | channel | text versus lesson | `lesson-channel` |
| E6 | resume | first instrument | `resume-cancel` |
| E7 | pacing | question run | every default task |
| E8 | diagnosis | lesson count | `ncp-diagnostic` |
| E9 | warm start | lesson keywords | `already-known` |
| E10 | lab | prediction present | `cuda-event-timing`, `transpose-bandwidth` |
| E11 | replanning | plan diff | `scope-change` |
| E12 | artifacts | file exists | `handout-missing` |

All twelve failure cases now have a task. The checks differ by task: policy
checks run everywhere, and a task opts into the feature checks it can provoke.

## What this suite is good for

- **Regression.** A skill edit must not remove a step or a rule. These checks
  run over every produced trajectory and catch that.
- **Contract tests.** Each one maps to a line the skill promises: goal first,
  probe before teach, two questions then teach, teach in `lesson`, predict before
  commanding.
- **Model differences.** Run the same suite on two models and see which rules
  the model drops. The split skill keeps titles on one model and loses them on
  another; this suite surfaces that.

## What it cannot tell you

- **Whether a human learns more.** The user simulator is a stub. Success means
  the professor followed the loop, not that understanding formed.
- **Taste.** Pacing, depth, and clarity need a reader.
- **Retention.** Revision has no eval because no practice trajectory exists
  yet. Nothing in this suite tests whether knowledge survives a week.
- **Cost or speed.** A run takes minutes and dollars. Those numbers are real,
  but they are not learning outcomes.
