---
name: vault-hunter
description: Launch work from the canonical Obsidian vault. Use when invoked as /vault-hunter with a Feature, Task, Issue, checkbox, or Wayfinder reference and the user wants it planned or executed through verifier-first development, review convergence, implementation PR landing, evidence updates, and workspace cleanup.
---

# Vault Hunter

Route one vault-backed request without duplicating its durable state. Use the vault note as the contract, the
implementation repository for code, and temporary `issues/` notes only for unresolved decisions.

## Invocation

Accept `/vault-hunter <reference>`, where `<reference>` identifies a Feature, Task, or Issue by vault path, `path:line`,
or wikilink. Resolve the referenced note or checklist line before routing.

Immediately after invocation, resolve only enough vault context to identify the referenced item, then:

1. Mark it in progress:
   - Feature → set its frontmatter to `status: in-progress`
   - Task → change its Feature checklist bullet to `[~]` and, when linked, set its note to `status: in-progress`
   - Issue or Wayfinder effort → set its note or map frontmatter to `status: in-progress`
2. Commit that lifecycle transition in the vault. Do not push it yet.
3. Only after the commit succeeds, provide substantive user-facing content or continue with broader discovery.

Before this commit, send no plan, clarification, or progress detail beyond any minimal skill-use acknowledgment required
by the host. If the item cannot be resolved or committed safely, stop and report that blocker instead of continuing.

The bundled Neovim picker action is `<C-a>` **(Vault hunter) Action**. It accepts Feature and Task rows and launches
the exact `/vault-hunter <path:line>` form. Feature rows use the feature workspace without a task worktree; Task rows
retain isolated task-worktree routing. Issue references are accepted through the command even though the picker does
not list Issue rows.

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

In Codex, run each stage below as an independent `/goal`. Present them as one continuous unnumbered timeline, not an
ordinal goal queue. On resume, inspect the Task note and live repository state, verify completed evidence, and continue
at the first unfinished stage.

Write evidence into the local Task note as each stage settles. Push the vault only at the two named checkpoints.

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

Defer optional polish. When useful, use separate coding and reviewing subagents with non-overlapping ownership. Give
reviewers the raw diff, task contract, and verifier evidence rather than prior conclusions.

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

1. Close every tab in the Task's Herdr workspace.
2. Close every Neovim Workspace Tab bound to that workspace.
3. Verify those tabs are gone. Preserve other Herdr workspaces and Unbound Neovim Tabs.
4. Add PR, merge, final verifier, post-merge, and cleanup evidence to the Task note.
5. Set the Task note frontmatter to `status: done`, change its authoritative Feature checklist bullet to `[x]`, and
   derive the Feature status from its complete checklist.
6. Commit vault checkpoint two on the vault's `main` branch and push `origin main`. If the update was prepared on
   another vault branch, merge it into vault `main` first. Never open a vault PR.
7. Run `git fetch origin main:refs/remotes/origin/main` in the vault and verify the checkpoint-two commit is an
   ancestor of `origin/main`. Cleanup is incomplete until this remote-main check passes.

## Completion

Report the Feature and Task links, implementation PR and merge state, final verifier evidence, vault commits,
remote-main verification, and workspace cleanup evidence. State any deferred optional polish or unrelated dirty state
preserved.
