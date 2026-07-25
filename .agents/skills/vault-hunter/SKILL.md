---
name: vault-hunter
description: Guide work from the canonical Obsidian vault and write lifecycle, timeline, evidence, and completion checkpoints back to it. Use when invoked as $vault-hunter with a Feature, Task, Issue, checkbox, or Wayfinder reference and the work should run through Herdr-visible interactive Codex goals or agents in the owning Feature workspace.
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
the exact `$vault-hunter <path:line>` form. Feature and Task rows use the feature workspace and feature worktree; Task
rows use a task-named tab. Issue references are accepted through the command even though the picker does not list
Issue rows.

## Herdr-visible Codex execution

After resolving the owning Feature, dispatch every research, specification, implementation, verifier, test, and review
stage through native Codex subagent capabilities. A dispatch is valid only when it is materialized as a full interactive
Codex session wrapped by Herdr in the owning Feature workspace and feature worktree. A background or inherited-pane
subagent is invalid and must be replaced before work begins.

For each dispatched role:

- Reuse the `Project · Feature` workspace and `feature/<feature-slug>` worktree. Never hardcode opaque IDs.
- Name the Herdr agent `codex-<feature-slug>-<run-key>-<role>` and set
  `SIDEKICK_NAMED_SESSION=<feature-slug>-<run-key>-<role>`, where `run-key` is the Task ID, `feature`, or Issue slug.
- Give it a distinct `<run label> · <role>` Herdr tab containing exactly one full Codex pane. Start the agent as that
  tab's only pane; do not precreate a blank root pane and then split a worker beside it. Verify `pane_count=1`.
- Treat the Herdr wrapper as one named tuple: owning Feature workspace, distinct tab label, full Codex pane under the
  agent name, and distinct Sidekick session. Capture every returned opaque ID instead of deriving one.
- For a verifier-driven Task Run, immediately after capturing that native identity and before accepting the dispatch,
  register it against its owned goal with `vault-hunter-run participant`. Reject the dispatch if registration fails.
  Feature, Project, Issue, Wayfinder, and normal-agent dispatches never register as Run participants.
- Use the Feature worktree as `--cwd`, give bounded repository ownership plus exact Feature and Task paths, and forbid
  vault edits or commits.
- Monitor native subagent status plus `herdr agent get` and `herdr agent read`. If name, cwd, workspace, tab, session,
  or one-pane placement is wrong, replace the dispatch before accepting work. For a Task Run, also run
  `vault-hunter-run reconcile-workers --run-id "$run_id"` on each monitoring pass: replace `stale` launches with a
  newly captured launch, preserve their stale records, and stop on `unexpected` ownership.
- Require one concise final handoff containing outcome, changed paths and commit, exact checks and evidence, and
  residual risks or blockers. If it is incomplete, follow up with that same subagent; the driver does not investigate
  or rerun its work.
- Worker tabs never receive an Atlas companion. Record their exact agent, session, tab, and pane IDs for cleanup.

Launch a separate role without precreating its tab, then rename the returned one-pane tab:

```sh
herdr agent start "codex-$feature_slug-$run_key-$role" \
  --cwd "$feature_worktree" \
  --workspace "$workspace_id" \
  --env "SIDEKICK_NAMED_SESSION=$feature_slug-$run_key-$role" \
  --no-focus \
  -- codex "$prompt"
herdr tab rename "$returned_tab_id" "$run_label · $role"
vault-hunter-run participant \
  --run-id "$run_id" \
  --goal-id "$active_goal_id" \
  --role "$role" \
  --agent "$returned_agent_name" \
  --workspace-id "$returned_workspace_id" \
  --tab-id "$returned_tab_id" \
  --pane-id "$returned_pane_id" \
  --terminal-id "$returned_terminal_id" \
  --agent-session-source "$returned_session_source" \
  --agent-session-kind "$returned_session_kind" \
  --agent-session-value "$returned_session_value"
```

Run the `participant` command only for a verifier-driven Task Run, after the returned agent, workspace, tab, pane,
terminal, and native session IDs have all been captured and the named one-pane tab has been verified. Run it
immediately then; do not accept or begin consuming work from that dispatch until the command returns the
unchanged-or-appended Registry record successfully.

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

### Task-only Atlas activation

Only verifier-driven Task Runs create Atlas state. Feature, Project, Issue, Wayfinder, normal agent, and participating
subagent invocations never call `ensure`, create a companion, or replace the default Sidekick preview.

After the specification handoff has produced the complete verifier ledger and the driver has stored it canonically,
call:

```sh
vault-hunter-run ensure \
  --task-id "$task_id" \
  --task-title "$task_title" \
  --task-path "$task_path" \
  --feature-path "$feature_path" \
  --invoked-at "$captured_invocation_rfc3339" \
  --orchestrator-pane "$HERDR_PANE_ID" \
  --goal "checkpoint=Vault checkpoint one=active" \
  --goal "cleanup=Workspace and vault cleanup=pending"
```

Add one `--goal "id=label=status"` for every drafted verifier and later stage in timeline order. Capture `run_id`; all
later Registry transitions and cleanup use it. `ensure` must create or reuse exactly one functioning Atlas companion
as the only right split in the active driver/orchestrator tab and immediately run Atlas in that pane. The driver tab
then contains exactly the driver pane plus its Atlas pane; an empty companion pane is invalid. On resume, reuse the
active Run and live companion. Stop if creation or Atlas startup fails; the failed partial split must be closed.

## Execute the Task timeline

In the primary Herdr-visible driver session, activate each stage below and dispatch it to a full Codex subagent. The
driver performs no stage work itself. Present the work as one continuous unnumbered timeline, not an ordinal goal
queue. On resume, use the canonical Task note, Run Registry, Herdr state, and concise subagent handoffs to continue at
the first unfinished stage.

Write accepted handoff evidence into the local Task note as each stage settles. Keep the invocation backlog timeline
synchronized, but keep detailed evidence only in the Task note. Push the vault only at the two named checkpoints.

### Vault checkpoint one

- Store the Task Spec and complete verifier ledger.
- Commit any remaining checkpoint-one vault changes, then push the invocation lifecycle commit and Task Spec/verifier
  ledger commits together. Never open a vault PR.

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
- Dispatch a release subagent to push implementation code, open the implementation PR, and arm auto-merge using the
  repository's existing merge strategy and protections.
- Consume its concise handoff and link the PR from the Task note.

### CI and landing

Always run this goal, even when it completes immediately:

- Dispatch a landing subagent to monitor required CI and approvals and return status.
- Dispatch fixes for every CI failure in the same Task Run, then have verifier subagents rerun affected plus complete
  verifiers.
- Never bypass branch protection or required approval.
- With no CI, require a mergeable PR and complete local green suite.
- Have the landing subagent allow auto-merge, then dispatch post-merge checks against merged `main`.

### Workspace and vault cleanup

1. Run `vault-hunter-run cleanup-workers --run-id "$run_id"` after every Run goal is done. It refuses unexpected
   ownership, closes only exact live task-owned worker tabs, clears stale references, verifies disappearance, and is
   safe to repeat.
2. Run `vault-hunter-run finish --run-id "$run_id"`. This closes only the companion pane recorded in the Registry and
   retires the Run; it never owns worker cleanup.
3. Preserve the driver/orchestrator tab, its primary Codex pane, the owning Feature workspace and worktree, other shared
   Feature tabs, and unrelated Neovim Workspace Tabs. `finish` closes the driver's owned Atlas pane, never the driver.
4. Verify the captured task agent, session, tab, and pane IDs are gone, the Atlas pane is gone, and the driver plus
   Feature workspace remain.
5. Add PR, merge, final verifier, post-merge, and cleanup evidence to the Task note.
6. Set the Task note frontmatter to `status: done`, change its authoritative Feature checklist bullet to `[x]`, and
   derive the Feature status from its complete checklist.
7. Complete the invocation backlog entry.
8. Commit vault checkpoint two on the vault's `main` branch and push `origin main`. If the update was prepared on
   another vault branch, merge it into vault `main` first. Never open a vault PR.
9. Run `git fetch origin main:refs/remotes/origin/main` in the vault and verify the checkpoint-two commit is an
   ancestor of `origin/main`. Cleanup is incomplete until this remote-main check passes.

## Completion

Report the Feature and Task links, implementation PR and merge state, final verifier evidence, backlog entry, vault
commits, remote-main verification, and workspace cleanup evidence. State any deferred optional polish or unrelated
dirty state preserved.
