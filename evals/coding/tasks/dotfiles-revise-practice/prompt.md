Build the revision mode. Work only in this worktree. Do not run live pi sessions and do not write to `~/vault`; this task is code, skill text, and tests only.

Repo worktree: `<repo>`.

The design is settled. Follow it exactly.

# A. New extension `pi/.pi/agent/extensions/practice.ts`

Register two tools, `problem` and `conclude`. Model them on `explain.ts` and `quiz.ts` for the TUI panel: an Editor in a framed panel, Enter submits, Esc cancels, `new Text(...)` results.

## Active-problem state
- Module-level `Map<string, ActiveProblem>` keyed by the session file from `ctx.sessionManager.getSessionFile()`, falling back to `ctx.cwd`, then `"anon"`. Reset per test.
- `ActiveProblem = { title, statement, modelSolution, targets: string[], mode, attempt: number }`.
- Export a `__resetPracticeState()` for tests.

## `problem` tool
Schema (typebox):
- `title: string` — short name of the target, for the panel and journal.
- `statement: string` — the situation. Markdown and LaTeX allowed.
- `modelSolution: string` — the committed worked solution. Hidden from the learner until `conclude`.
- `targets: string[]` — proposition slugs from the vault, at least one.
- `mode: "recall" | "discrimination" | "composition"`.

Behavior:
1. No active problem: store it, `attempt = 1`, show the panel.
2. Active problem with the same `statement`, `targets`, and `mode`: this is a new attempt. Increment `attempt`. If `modelSolution` differs from the stored one, reject with an error that the commitment cannot change; otherwise ignore the new value and use the stored one.
3. Active problem with different statement/targets/mode: reject with `A problem is already active (<title>). Call conclude before posing another.` Return it as an error result, per the repo's return-to-agent doctrine.

Panel: render the title, the statement, then an editor labelled `› your working`. Hints: `Enter submit · Esc close`. No solution, no verdict, no explanation anywhere.

Submit result:
- content: `Attempt ${n} — the learner's working:\n${text}` plus, when `targets` is non-empty, `Targets: ...`.
- details: `{ status: "submitted", title, statement, mode, targets, attempt, work }`.
Cancel result: content `The learner closed the problem without submitting. It is still active.`; details `{ status: "cancelled", title, attempt }`. The problem stays active.

Tool description: pose one practice demand; the learner's working returns as the tool result; the committed solution stays hidden until conclude; re-call with the same problem for the next attempt; call conclude before a different problem. One problem at a time.

## `conclude` tool
Schema:
- `outcome: "solved" | "unsolved" | "dismissed"`.
- `verdict: string` optional — the agent's short read of the work.

Behavior: reject when no problem is active. On success, clear the state and return:
- content: `Outcome: ${outcome}.\nModel solution (committed before posing):\n${modelSolution}` plus `Attempts: n` and the verdict when present.
- details: `{ status: "concluded", title, outcome, solution: modelSolution, attempts, targets, mode, verdict }`.
- Render the committed solution in the panel as a `Text` block, so the learner sees the reveal.

Tool description: end the active problem, reveal the committed solution, record the outcome. After it, stop and wait for the learner's explicit go-ahead before the next problem.

# B. Journal entries in `pi/.pi/agent/extensions/md-log.ts`

- Add `problem` and `conclude` to the journal tool set.
- On `problem` results with `status: "submitted"`, append an entry titled by `title` with the statement and the learner's working as a blockquote. Never write the model solution before conclude.
- On `conclude` results, append an entry with the outcome, the verdict, the attempt count, and the committed solution.
- Export `formatProblemEntry` and `formatConcludeEntry`, and keep the existing quiz/explain routing untouched. These are teaching-session entries; never route them to the probe log.
- Update the file's header comment and the `/extract` prompt only if it now needs to mention practice journals. If the extraction prompt already says "session journal", leave it.

# C. New skill `agents/.agents/skills/revise/SKILL.md`

Port the LearnHarness practice doctrine. Write it as the source of truth for the reviser, in the repo's skill voice. Include a launcher mode mirroring the professor skill: outside the `reviser` agent, call `subagent` with `agent: "reviser"` and stop; inside, never launch another.

Sections, all required:

1. **What you run.** Practice, not review and not teaching. The target must be inactive when the demand arrives. No lesson, and never show the note's statement before a demand. Not an exam, not a teaching session, not search training. Teaching's product is the click; practice's product is quiet availability.
2. **The loop.** Perceive, select the move, discriminate which proposition, run it, check. Trained operations: retrieve, run, check.
3. **Decision points.** Retrieval yield is decision points, not moves. A linear chain has one. Never pose blocks of same-target problems; interleave.
4. **Three modes, prerequisite order.** recall (weak cue, 1-2 decisions), discrimination (near-twin situations, the separating feature carries the signal), composition (the chain runs whole under load). Recall before discrimination before composition. When a later layer fails, drop back and test the earlier one.
5. **Selection.** Cheapest demand that maximally strengthens or resolves the most uncertainty about the weakest undemonstrated capability. Weakest first, premises that feed many chains first, least-recently-active first. The note fields `demonstrated` and `last_rung` are the record; what the session has not shown is undemonstrated.
6. **Difficulty.** About 85% success per retrieval event, not per problem. From the last rung: R0-R1 means a notch up, a miss means a notch down, two consecutive missed concludes on one target means switch targets. Never leave an active problem because of attempts.
7. **Posing.** Target, mode, difficulty, a fresh cue class for this target, commit the worked solution, then solve and shortcut-hunt it before posing. Never pose what you have not solved. Never announce the target. A problem solvable by a route that skips the target is unsound.
8. **Hints, ladder R0-R5.** attention redirect; pattern re-description; candidate class; the proposition named; the move outlined; the worked step. One rung per request. Repair the statement freely when the learner says they cannot parse it. The stall is not always where attention is: a verification nudge before a correction.
9. **Claimed answers.** Extract moves, not a grade. Localize the first break without giving the correction. Smallest nudge, then wait. Classify: cue miss, discrimination error, execution slip, careless, structural. A structural miss gets surgical nudges and sets `needs_teach`.
10. **Progression and the pause law.** A claimed answer is not a progress signal. Conclude when solved or on an explicit request. After conclude, stop; the next problem waits for an explicit go-ahead. A clarification question is not a go-ahead.
11. **The arc.** One to three warm recall demands, an interleaved main body, then retests of every miss and every hint-heavy item in a fresh surface. Nothing that failed ends the session unretested.
12. **Standing prohibitions.** The list: no unsolved problem, nothing beyond the material, no target announcement, no reveal while the learner can still generate, no same-surface re-ask, no teaching beyond a surgical line, no softened or inflated verdict.
13. **Vault mechanics.** Targets live in `<vault>/2_knowledge/propositions/*.md`. Read the note to build the demand; never show it. Update only these frontmatter keys after a problem concludes: `review_due`, `review_last`, `review_streak`, `review_result`, `demonstrated`, `last_rung`, `needs_teach`. Ladder 1 / 3 / 7 / 16 / 35 / 70 days: solved advances one step, unsolved sets tomorrow and resets the streak, dismissed holds the due date. `demonstrated` gains the mode only on a clean solve. Never change id, name, statement, aliases, tags, or sources.
14. **Session opening.** Read the due list (`review_due <= today`) and the topic filter if the learner named one. One orientation line naming the count, then the first demand. If nothing is due, say so in one line and offer a topic session using the lowest streaks and oldest reviews. No warm-up interview.

# D. New agent profile `pi/.pi/agent/extensions/interactive-subagents/agents/reviser.md`

Frontmatter:

```
---
name: reviser
description: Practice and revision — retrieval demands over earned propositions, with hints and retests
tools: read, grep, find, ls, write, edit, ask_user_question, problem, conclude
skills: revise
thinking: high
system-prompt: append
session-mode: lineage-only
auto-exit: false
---
```

There must be no `lesson`, `quiz`, `explain`, or `plan_init` tool. The body should be short: you are the reviser, follow the `revise` skill, the professor's teaching tools are deliberately absent, and at the end of a session report what was demonstrated and what needs teaching. Use the professor profile's tone and structure as the model.

# E. Tests

New `pi/.pi/agent/extensions/practice.test.mjs`, using the same jiti stub harness as `quiz-result.test.mjs`. Cover:
- first pose stores the problem and the panel shows the statement but not the solution;
- a second pose with the same problem increments the attempt and keeps the original commitment;
- a changed commitment is rejected;
- a different problem while one is active is rejected;
- conclude reveals the solution, clears the state, and reports attempts;
- conclude with nothing active is rejected;
- cancel keeps the problem active;
- details shapes for submitted, cancelled, and concluded.

Add journal formatting cases in `pi/.pi/agent/extensions/md-log.test.mjs` for `formatProblemEntry` and `formatConcludeEntry`, including that the solution never appears before conclude.

Add `docs/ci-tests/practice.md` as a short `/simple` suite doc, and one row in the per-component coverage table of `docs/ci-tests/README.md`. Follow the shape of an existing row.

If `scripts/test-extension-loader.mjs` pins an extension factory count, update the count by one and confirm the loader passes.

# Gates and commit

- Run the new suite exactly as `scripts/nm-test.sh` runs extension suites (read the script), plus `md-log.test.mjs`, plus `bash scripts/nm-lint.sh`.
- `bash scripts/nm-test.sh`: the repo has known baseline failures (nvim suites, ghostty, nm-install, repo-parity, interactive-subagents rex lookup). Do not fix those. Confirm no new failures.
- `grep -rn "fix-code" . --exclude-dir=.git` stays empty.
- Commit once: `Add revise practice mode with problem and conclude tools`.
- Report: files added and edited, the tool contract as built, test results, and anything unverified.
