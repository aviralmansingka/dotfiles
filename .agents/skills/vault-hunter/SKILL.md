---
name: vault-hunter
description: Guide work from the canonical Obsidian vault and write lifecycle, timeline, evidence, and completion checkpoints back to it. Use when invoked as /vault-hunter with a Feature, Task, Issue, checkbox, or Wayfinder reference and the work should run through Herdr-visible interactive Codex goals or agents in the owning Feature workspace.
---

# Vault Hunter

Act primarily as the vault guide and checkpoint writer for one vault-backed request. Use the vault note as the contract,
the implementation repository for code, and temporary `issues/` notes only for unresolved decisions. Keep one primary
Vault Hunter Codex session as the sole vault writer; execution agents return evidence to it instead of editing the
vault.

## Invocation

Accept `/vault-hunter <reference>`, where `<reference>` identifies a Feature, Task, or Issue by vault path, `path:line`,
or wikilink. Capture the local invocation date, time, and timezone once, then resolve the referenced note or checklist
line before routing.

Immediately after invocation, resolve only enough vault context to identify the referenced item, then:

1. Mark it in progress:
   - Feature → set its frontmatter to `status: in-progress`
   - Task → change its Feature checklist bullet to `[~]` and, when linked, set its note to `status: in-progress`
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
  - Invoked <human-readable local date and time with timezone> from `/vault-hunter <reference>`.
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
the exact `/vault-hunter <path:line>` form. Feature and Task rows use the feature workspace and feature worktree; Task
rows use a task-named tab. Issue references are accepted through the command even though the picker does not list
Issue rows.

## Herdr-visible Codex execution

After resolving the owning Feature, keep every goal and worker visible in that Feature's configured Herdr workspace:

- Reuse the `Project · Feature` workspace, `feature/<feature-slug>` worktree, and task-named tab created by the Neovim
  picker. If the invocation came from elsewhere, resolve or create that same scope before execution; never hardcode a
  workspace, tab, or pane ID.
- Run a goal in the primary interactive Codex session only while that session is attached to the owning Feature
  workspace and feature worktree.
- Run every separate implementation, verifier, research, or review role as an interactive Codex TUI through
  `herdr agent start`; do not use an invisible built-in subagent, `codex exec`, or a detached background process.
- Name agents `codex-<feature-slug>-<role>`, set `SIDEKICK_NAMED_SESSION=<feature-slug>-<role>`, use the feature
  worktree as `--cwd`, and place them in a task/role-labeled tab within the same Feature workspace.
- Give each agent bounded repository ownership and the exact Feature and Task paths. Tell it not to edit or commit the
  vault; it must report changed paths, commits, checks, and evidence to the primary Vault Hunter session.
- After launch, verify the agent's name, cwd, workspace, and tab with `herdr agent get`. Before accepting its result,
  inspect `herdr agent read`, repository status, commit, and checks.
- Keep the backlog timeline synchronized with active visible Codex work. Mark a stage settled only after its Herdr and
  repository evidence has been inspected and written back to the canonical Task note.

Launch a separate role with the resolved opaque IDs:

```sh
herdr agent start "codex-$feature_slug-$role" \
  --cwd "$feature_worktree" \
  --workspace "$workspace_id" \
  --tab "$task_role_tab_id" \
  --env "SIDEKICK_NAMED_SESSION=$feature_slug-$role" \
  --no-focus \
  -- codex "$prompt"
```

The primary Vault Hunter session owns lifecycle edits, backlog updates, Task evidence, both vault checkpoints, and the
completion report. This single-writer boundary applies even when multiple Codex agents run concurrently.

## Resolve the input

1. Use `$vault` to read, in order:
   - `~/vault/1_projects/projects.md`
   - the project `README.md`
   - the owning `theme.md`
   - the Feature
   - the selected Task note, when one exists
2. Resolve the implementation repository from the project and Feature sources. Read its `AGENTS.md` and live Git state.
3. Preserve unrelated user changes. Reuse the task's existing Herdr workspace, Neovim workspace tab, branch, or
   worktree when present; do not rename or reorganize unrelated state.
4. Route by input kind:
   - **Feature** → refine its executable task plan, then stop.
   - **Task** → execute the Task timeline below.
   - **Issue or Wayfinder effort** → resolve decisions into the owning Feature, then stop.

Ask only when ownership or intended behavior remains materially ambiguous after reading the hierarchy and source.

## Feature Run

1. Use `$grill-with-docs` and `$domain-modeling` against the Feature and relevant source.
2. Refine stable ordered `T01`, `T02`, … Tasks and their planned observable verifiers.
3. Update the canonical Feature and any affected domain language.
4. Stop before implementation. A Feature Run produces an executable plan, not code.

## Wayfinder Run

1. Use `$wayfinder` to map the effort into stable numbered decision tickets.
2. Store a known-owner effort at:

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

1. If the Task is only a checkbox, use `$grill-with-docs` with its checkbox and nested bullets and create a durable
   Task note.
2. Use `$to-spec` for structure and testing seams, but store the result only in the canonical vault Task note.
3. Draft every verifier before coding as stable `V01`, `V02`, … entries. Record for each:
   - externally observable behavior
   - exact command or manual observation
   - baseline-red evidence
   - latest result and evidence
4. Ask clarifying questions only for a genuine missing decision.
5. Use `$ponytail` throughout implementation and review.

## Execute the Task timeline

In the primary Herdr-visible interactive Codex session, run each stage below as an independent `/goal`. Use a separate
Herdr-visible interactive Codex agent only for a bounded role that benefits from isolation or safe parallelism. Present
the work as one continuous unnumbered timeline, not an ordinal goal queue. On resume, inspect the Task note, Herdr
agents, and live repository state, verify completed evidence, and continue at the first unfinished stage.

Write evidence into the local Task note as each stage settles. Keep the invocation backlog timeline synchronized, but
keep detailed evidence only in the Task note. Push the vault only at the two named checkpoints.

### Vault checkpoint one

- Store the Task Spec and complete verifier ledger.
- Commit any remaining checkpoint-one vault changes, then push the invocation lifecycle commit and Task Spec/verifier
  ledger commits together. Never open a vault PR.

### One goal per verifier

Activate one drafted verifier at a time:

1. Run it against the original baseline and prove the intended gap is red.
2. If it unexpectedly passes, repair the verifier until it detects the gap.
3. Run it against the current branch.
4. Update the verifier and write the minimum implementation until the complete active verifier set is green.
5. Record evidence, complete the goal, then activate the next verifier.

The first green may require both verifier refinement and implementation. If an independently baseline-red verifier
already passes on the current branch because an earlier slice fixed it, accept that green; never manufacture failure.

### Refactor Gate

Start only after every drafted verifier has reached green once.

- Freeze intended behavior and assertion strength.
- Refactor implementation and verifiers for clarity and duplication.
- Run the complete verifier set until green.

### Review Convergence

Repeat until no bug or major spec or architecture violation remains:

1. Run an independent local code review.
2. Fix/refactor every relevant finding.
3. Add a stable verifier when review exposes uncovered behavior; prove its baseline red.
4. Run the complete active verifier set.
5. Review again.

Defer optional polish. When useful, start separate Herdr-visible interactive Codex coding and review agents with
non-overlapping ownership. Give reviewers the raw diff, task contract, and verifier evidence rather than prior
conclusions.

### Open the implementation PR

- Run the final complete verifier set and capture final evidence. Do not create a separate final-evidence goal.
- Push implementation code.
- Open the implementation PR and link it from the Task note.
- Arm auto-merge using the repository's existing merge strategy and protections.

### CI and landing

Always run this goal, even when it completes immediately:

- Monitor required CI and approvals.
- Fix every CI failure in the same Task Run and rerun affected plus complete verifiers.
- Never bypass branch protection or required approval.
- With no CI, require a mergeable PR and complete local green suite.
- Allow auto-merge, then run post-merge checks against merged `main`.

### Workspace and vault cleanup

1. Close only the Herdr agents and tabs launched for this Task. Preserve other tabs in the shared Feature workspace.
2. Close only Neovim tool windows or tabs created for those task agents. Preserve the owning Feature workspace and
   unrelated Neovim Workspace Tabs.
3. Verify the captured task agent names and tab IDs are gone.
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
