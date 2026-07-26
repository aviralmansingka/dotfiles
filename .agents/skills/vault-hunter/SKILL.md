---
name: vault-hunter
description: Guide work from the canonical Obsidian vault and write lifecycle, timeline, evidence, and completion checkpoints back to it. Use when invoked as $vault-hunter with a Feature, Task, Issue, checkbox, or Wayfinder reference; each Task Run owns a dedicated Herdr workspace and task worktree.
---

# Vault Hunter

Act as a deliberately context-efficient driver and the sole vault writer for one vault-backed request. Use the vault
note as the contract, the implementation repository for code, and temporary `issues/` notes only for unresolved
decisions. The driver intentionally performs no investigation, implementation, testing, or review itself. It dispatches
each substantive stage, consumes a concise handoff, decides the canonical lifecycle and evidence changes, and updates
the vault, backlog, and checkpoints only from those handoffs.

## Invocation

Accept `$vault-hunter <reference>`, where `<reference>` identifies a Feature, Task, or Issue by vault path, `path:line`,
or wikilink. Capture the local invocation date, time, and timezone once, then resolve the referenced note or checklist
line before routing.

Immediately after invocation, resolve only enough vault context to identify the referenced item, then:

1. Mark it in progress:
   - Feature → set its frontmatter to `status: in-progress`
   - Task → change its Feature checklist bullet to `[-]` and, when linked, set its note to `status: in-progress`
   - Issue or Wayfinder effort → set its note or map frontmatter to `status: in-progress`
2. Create the invocation backlog entry described below.
3. Commit the lifecycle transition and backlog entry together in the vault. Do not push them yet.
4. After the commit succeeds, mark the invocation timeline stage `Done`, activate the route's next stage, and continue.
5. Only after the commit succeeds, provide substantive user-facing content or continue with broader discovery.

Before this commit, send no plan, clarification, or progress detail beyond any minimal skill-use acknowledgment required
by the host. If the item cannot be resolved, logged, or committed safely, stop and report that blocker instead of
continuing.

### Invocation backlog entry

Use the captured invocation date—not the current date after a restart—to choose the ISO-week file
`~/vault/3_logs/YYYY-WW/backlog.md` and its `### Weekday, YYYY-MM-DD` heading. Follow `~/vault/AGENTS.md`; create missing
weekly scaffolding and reuse an existing date heading.

Add exactly one entry for the run:

```md
- [-] Vault Hunter — [[<vault-relative-target>|<label>]]
  - Invoked <human-readable local date and time with timezone> from `$vault-hunter <reference>`.
  - Recap: <optional one-sentence outcome or current frontier>
  - Timeline
    - Done — Invocation lifecycle committed
    - Active — <current stage>
    - Pending — <later stage>
```

- Use one root checkbox only. Keep the timeline as nested bullets with `Done`, `Active`, `Pending`, or `Blocked`; nested
  unchecked checkboxes would create duplicate active-task picker entries.
- Omit `Recap` when the title and timeline are already sufficient. Otherwise keep it to one sentence and refresh it
  when the outcome or frontier materially changes.
- Seed the timeline from the applicable Feature, Task, or Wayfinder stages below. For a Task Run, add one nested row
  per drafted verifier once its stable `V01`, `V02`, … identity exists.
- Update the same entry in place as stages settle. Keep one `Active` stage, mark settled stages `Done`, and use
  `Blocked` for the current stage when progress requires outside action.
- On resume, find the newest unfinished Vault Hunter entry for the same target and continue updating it under its
  original invocation date. Do not create a duplicate or move it to the resume date.
- Commit backlog updates with the existing invocation and vault checkpoint commits; do not create backlog-only commits.
- At successful completion, set every stage to `Done`, optionally refresh the recap, and change the root state to
  `[x]`.

The bundled Neovim picker action is `<C-a>` **(Vault hunter) Action**. It accepts Feature and Task rows and launches
the exact `$vault-hunter <path:line>` form. A Task row creates or reuses one dedicated Herdr workspace named exactly
after the displayed Task name, plus its `task/<task-slug>` worktree and task-named driver tab. Never place two
Task drivers in the same workspace or run a Task driver from the Feature worktree. Feature rows remain in their
Feature workspace and worktree. Issue references are accepted through the command even though the picker does not
list Issue rows.

## Herdr-visible Codex execution

After resolving the owning route, dispatch every research, specification, implementation, verifier, test, and review
stage through native Codex subagent capabilities. For a Task Run, a dispatch is valid only when it is materialized as
a full interactive Codex session wrapped by Herdr in that Task's dedicated workspace and task worktree. Feature and
Issue routes keep their Feature scope. A background or inherited-pane subagent is invalid and must be replaced before
work begins.

For each dispatched role:

- For a Task Run, reuse only its Task-named workspace and `task/<task-slug>` worktree. For other routes,
  reuse the owning Feature workspace and worktree. Never hardcode opaque IDs.
- Name the Herdr agent `codex-<feature-slug>-<run-key>-<role>` and set
  `SIDEKICK_NAMED_SESSION=<feature-slug>-<run-key>-<role>`, where `run-key` is the Task ID, `feature`, or Issue slug.
- Give it a distinct `<run label> · <role>` Herdr tab containing exactly one full Codex pane. Start the agent as that
  tab's only pane; do not precreate a blank root pane and then split a worker beside it. Verify `pane_count=1`.
- Treat the Herdr wrapper as one named tuple: owning route workspace, distinct tab label, full Codex pane under the
  agent name, and distinct Sidekick session. Capture every returned opaque ID instead of deriving one.
- Use the Task worktree as `--cwd` for Task Runs and the Feature worktree for other routes. Give bounded repository
  ownership plus exact Feature and Task paths, and forbid vault edits or commits.
- Monitor native subagent status plus `herdr agent get` and `herdr agent read`. If name, cwd, workspace, tab, session,
  or one-pane placement is wrong, replace the dispatch before accepting work.
- Require one concise final handoff containing outcome, changed paths and commit, exact checks and evidence, and
  residual risks or blockers. If it is incomplete, follow up with that same subagent; the driver does not investigate
  or rerun its work.
- Record every worker's exact agent, session, tab, and pane IDs for cleanup.

Launch a separate role without precreating its tab, then rename the returned one-pane tab:

```sh
herdr agent start "codex-$feature_slug-$run_key-$role" \
  --cwd "$run_worktree" \
  --workspace "$workspace_id" \
  --env "SIDEKICK_NAMED_SESSION=$feature_slug-$run_key-$role" \
  --no-focus \
  -- codex "$prompt"
herdr tab rename "$returned_tab_id" "$run_label · $role"
```

The driver consumes only the resulting concise handoffs. It alone chooses and writes lifecycle edits, backlog status,
Task evidence, both vault checkpoints, and the completion report. This single-writer boundary applies even when
multiple Codex subagents run concurrently.

## Resolve the input

The routes and stages below describe work the driver dispatches. Apart from the minimal invocation resolution and its
canonical vault writes, the driver never performs their investigation, implementation, testing, or review.

1. Dispatch a full Codex context subagent to use `$vault` and read, in order:
   - `~/vault/1_projects/projects.md`
   - the project `README.md`
   - the owning `theme.md`
   - the Feature
   - the selected Task note, when one exists
2. Require a concise context handoff containing ownership, route, implementation repository, applicable `AGENTS.md`,
   live Git state, and reusable Herdr/worktree state.
3. Preserve every unrelated user change named in the handoff. Reuse the Task's existing Herdr workspace, Neovim
   workspace tab, branch, or worktree when present; do not rename or reorganize unrelated state.
4. The driver routes by input kind:
   - **Feature** → refine its executable task plan, then stop.
   - **Task** → execute the Task timeline below.
   - **Issue or Wayfinder effort** → resolve decisions into the owning Feature, then stop.

Ask only when ownership or intended behavior remains materially ambiguous after the context handoff.

## Feature Run

1. Dispatch a full Codex specification subagent to use `$grill-with-docs` and `$domain-modeling` against the Feature
   and relevant source.
2. Have it return stable ordered `T01`, `T02`, … Tasks and their planned observable verifiers.
3. Apply the accepted handoff to the canonical Feature and any affected domain language.
4. Stop before implementation. A Feature Run produces an executable plan, not code.

## Wayfinder Run

1. Dispatch a full Codex Wayfinder subagent to use `$wayfinder` and map the effort into stable numbered decision
   tickets.
2. Have it return a known-owner effort for the driver to store at:

   ```text
   <feature>/issues/<effort>/map.md
   <feature>/issues/<effort>/01-<decision>.md
   ```

3. When ownership is unknown, start under the project's `issues/`, then move the entire effort beneath the selected
   Feature once ownership resolves.
4. Promote durable decisions into the Feature's Tasks and verifier plan.
5. Stop before implementation.

Wayfinder tickets are temporary issues, never implementation Tasks.

## Prepare a Task Run

1. Dispatch a full Codex specification subagent. If the Task is only a checkbox, it uses `$grill-with-docs` with its
   checkbox and nested bullets and returns a durable Task-note proposal.
2. The subagent uses `$to-spec` for structure and testing seams; only the driver stores the accepted result in the
   canonical vault Task note.
3. Draft every verifier before coding as stable `V01`, `V02`, … entries. Record for each:
   - externally observable behavior
   - exact command or manual observation
   - baseline-red evidence
   - latest result and evidence
4. Ask clarifying questions only for a genuine missing decision.
5. Require implementation and review subagents to use `$ponytail`.

## Execute the Task timeline

In the primary Herdr-visible driver session, activate each stage below and dispatch it to a full Codex subagent. The
driver performs no stage work itself. Present the work as one continuous unnumbered timeline, not an ordinal goal
queue. On resume, use the canonical Task note, Herdr state, and concise subagent handoffs to continue at the first
unfinished stage.

Write accepted handoff evidence into the local Task note as each stage settles. Keep the invocation backlog timeline
synchronized, but keep detailed evidence only in the Task note. Push the vault only at the two named checkpoints.

### Vault checkpoint one

- Store the Task Spec and complete verifier ledger.
- Commit any remaining checkpoint-one vault changes, then push the invocation lifecycle commit and Task Spec/verifier
  ledger commits together. Never open a vault PR.
- Do not activate the first verifier or begin implementation after the push.
- Mark checkpoint one `Blocked — Awaiting human evaluation` in the invocation backlog timeline.
- Report the canonical Task link, verifier ledger, checkpoint commits, and the exact decision the human is being asked
  to approve, then stop the Run.
- Resume only after the human responds at checkpoint one. Follow up with the same specification subagent using the
  human's exact feedback plus the canonical Task, checkpoint evidence, and completion condition.
- Treat prompt delivery as `resuming`, not completion. Wait for that same agent's durable result and check it against
  the requested human evaluation.
- Mark the checkpoint and backlog stage `Done` only after the resumed result is accepted. If the thread cannot
  resume or the result is incomplete, preserve the feedback and keep the goal blocked with the actionable reason.
  Activate the first verifier only after accepted checkpoint completion.

### One goal per verifier

Activate one drafted verifier at a time by dispatching a bounded full Codex verifier subagent:

1. Require the subagent to run it against the original baseline and prove the intended gap is red.
2. If it unexpectedly passes, have the subagent repair the verifier until it detects the gap.
3. Have the subagent run it against the current branch.
4. Dispatch an implementation subagent for any required code, then have the verifier subagent rerun the check until
   the complete active verifier set is green.
5. Consume the handoff, write its evidence, complete the goal, then activate the next verifier.

The first green may require both verifier refinement and implementation. If an independently baseline-red verifier
already passes on the current branch because an earlier slice fixed it, accept that green; never manufacture failure.

### Refactor Gate

Dispatch a refactor subagent only after every drafted verifier has reached green once.

- Require the subagent to freeze intended behavior and assertion strength, refactor implementation and verifiers for
  clarity and duplication, and return complete-suite evidence.
- Accept the handoff only when the complete verifier set is green.

### Review Convergence

Repeat by dispatching independent full Codex review and implementation subagents until no bug or major spec or
architecture violation remains:

1. Dispatch an independent local code review and consume its handoff.
2. Dispatch implementation/refactor work for every relevant finding.
3. Have the owning verifier subagent add a stable verifier when review exposes uncovered behavior and prove its
   baseline red.
4. Have verifier subagents run the complete active verifier set.
5. Review again through a new or explicitly followed-up full Codex session.

Defer optional polish. When useful, start separate Herdr-visible interactive Codex coding and review agents with
non-overlapping ownership. Give reviewers the raw diff, task contract, and verifier evidence rather than prior
conclusions.

### Open the implementation PR

- Dispatch the final verifier subagent to run the complete verifier set and capture final evidence. Do not create a
  separate final-evidence goal.
- Dispatch a release subagent to push implementation code and open the implementation PR. Never arm auto-merge.
- Consume its concise handoff and link the PR from the Task note.

### CI and landing

Always run this goal, even when it completes immediately:

- Dispatch a landing subagent to monitor required CI and approvals and return status.
- Dispatch fixes for every CI failure in the same Task Run, then have verifier subagents rerun affected plus complete
  verifiers.
- Never bypass branch protection or required approval.
- With no CI, require a mergeable PR and complete local green suite.
- When CI and required approvals are green, report that the PR is ready and wait for an explicit human merge action.
- After the human merges it, dispatch post-merge checks against merged `main`.

### Workspace and vault cleanup

1. After every Task Run stage is done, close only the exact captured task-owned worker tabs. Stop instead of guessing
   when live ownership differs from the captured IDs.
2. Close the Task's Herdr workspace and bound Neovim Workspace Tab after final evidence is written. Preserve every
   unrelated Herdr workspace and Neovim Workspace Tab.
3. Verify the captured task agent, session, tab, pane, and workspace IDs are gone.
4. Add PR, merge, final verifier, post-merge, and cleanup evidence to the Task note.
5. Set the Task note frontmatter to `status: done`, change its authoritative Feature checklist bullet to `[x]`, and
   derive the Feature status from its complete checklist.
6. Complete the invocation backlog entry.
7. Commit vault checkpoint two on the vault's `main` branch and push `origin main`. If the update was prepared on
   another vault branch, merge it into vault `main` first. Never open a vault PR.
8. Run `git fetch origin main:refs/remotes/origin/main` in the vault and verify the checkpoint-two commit is an
   ancestor of `origin/main`. Cleanup is incomplete until this remote-main check passes.

## Completion

Report the Feature and Task links, implementation PR and merge state, final verifier evidence, backlog entry, vault
commits, remote-main verification, and workspace cleanup evidence. State any deferred optional polish or unrelated
dirty state preserved.
