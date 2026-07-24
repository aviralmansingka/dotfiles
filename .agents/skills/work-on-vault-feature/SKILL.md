---
name: work-on-vault-feature
description: Run a durable vault feature through discovery, isolated implementation, independent verification, Herdr and Sidekick review, landing, and evidence updates. Use only when the user explicitly invokes $work-on-vault-feature or asks to use the work-on-vault-feature skill; do not trigger automatically for ordinary vault feature work.
---

# Work on a Vault Feature

Treat the vault feature note as the durable owner of behavior and validation. Keep temporary investigation in issues;
keep implementation in its source repository.

Announce: "I'm using the work-on-vault-feature skill to carry this feature from its vault contract through verified
implementation."

## List and select the feature

Before starting work, print the complete canonical inventory as nested bullets:

- Project — read from `projects/<project>/README.md`.
  - Theme — read from every nested `theme.md` below that project.
    - Feature — read from the theme's `features/*/feature.md`.

For every project, theme, and feature:

- Use its `#` heading as the display name.
- Show its frontmatter `status` beside the name.
- Show `unspecified` when `status` is absent.
  - Do not infer completion from task checkboxes.
- Preserve nested-theme hierarchy in the output.
- Highlight the requested or selected feature.

If no feature was supplied, ask the user to choose after showing the inventory.
If project, theme, or feature text was supplied, use it to narrow and select the
matching branch; ask only when multiple matches remain.

## Load the contract

Read, in order:

1. `/Users/aviral/vault/AGENTS.md`
2. `/Users/aviral/vault/projects/projects.md`
3. The project `README.md`
4. The owning `theme.md`
5. The feature file

Read [vault-feature-model.md](references/vault-feature-model.md) every time. Read
[herdr-sidekick.md](references/herdr-sidekick.md) when implementation, worktrees, Herdr, Codex, or Neovim sessions are
in scope.

If the feature is ambiguous, search project README and theme wikilinks before creating anything. Preserve nested themes
such as `themes/code-editing/themes/language-support/`; do not flatten them into features.

## 1. Resolve ownership and live state

- Confirm the feature is a concrete independently validatable capability, not a task or temporary issue.
- Identify its implementation repository from `Sources`, the project README, and live files.
- Read the implementation and existing verifier before proposing changes.
- Check Git status in both the vault and implementation repository. Treat all unrelated changes as user-owned.
- Verify drift-prone claims from live config, running services, Herdr, or Neovim. Do not promote a note's stale
  `Current Behavior` as confirmed reality.
- Record the exact feature tasks and validation gaps the change must close.

## 2. Choose the smallest execution shape

- **Vault-only documentation change:** edit the canonical note in place; do not create worktrees or agents.
- **One implementation concern:** use one feature worktree and one interactive agent when isolation is useful.
- **Implementation plus independent verifier:** use one integration worktree and one task worktree per independent role,
  normally `code` and `verify`, in one Herdr feature tab.

Parallelize only paths with clear, non-overlapping ownership. Do not create a worker just to observe another worker.

Use this naming contract:

```text
Feature slug:  <project>-<task-name>
Tab:           Feature · <Human Task Name>
Agent:         codex-<feature-slug>-<role>
Session env:   <feature-slug>-<role>
Branch:        task/<feature-slug>-<role>
Worktree:      /Users/aviral/worktrees/<repo>/<feature-slug>-<role>
Integration:   feature/<feature-slug>
```

## 3. Create the review surface

Follow [herdr-sidekick.md](references/herdr-sidekick.md).

Hard requirements:

- Base every worktree on clean committed `main`; never copy the primary checkout's dirty prototype into it.
- Resolve the Herdr workspace dynamically from the implementation repository. Never hardcode `w15` or any other ID.
- Use one feature tab and side-by-side panes for related roles.
- Launch interactive `codex`, not `codex exec`; `exec` exposes headless event logs instead of the readable Codex TUI.
- Set `SIDEKICK_NAMED_SESSION` to the agent slug without the `codex-` prefix.
- Create panes with `--no-focus`, then focus the completed tab.
- Keep the feature tab open until every worker finishes and its evidence is captured.
- Then close the exact feature tab to terminate every launched worker session.
  - Do not leave completed Codex or Pi sessions running as `done` or `idle`.
  - Keep branches and worktrees until integration and landing finish.

## 4. Give workers bounded contracts

Format both initial worker prompts as compact Markdown outlines:

- Hard-wrap at 72 columns.
  - Keep indivisible paths and commands intact.
- Prefer short bullets over prose paragraphs.
  - Use nested bullets to reflect structure and dependencies.
- Give distinct items their own bullets.
  - Paths.
  - Checks.
  - Acceptance criteria.

Every worker prompt must name:

- Exact owned paths.
- Behavior and acceptance criteria.
- Checks it must run.
- Exact commit message when one is required.
- Shared-repository constraints.
  - Other workers share the repository.
  - Do not revert their work.

The verifier owns only the verifier and deterministic fixtures. It must not edit the implementation. Prefer a
deterministic offline default and gate live-model or live-UI smoke tests separately.

For regression work:

1. Commit the verifier.
2. Integrate it alone.
3. Prove it fails against the clean implementation for the intended defect.
4. Integrate the implementation.
5. Prove the same verifier passes.

## 5. Integrate from evidence

Before cherry-picking, inspect each agent's:

- Herdr status and recent visible output
- exact cwd
- Git status
- commit subject and changed paths

After every worker is complete and this evidence is captured:

- Close the exact Herdr feature tab to terminate all launched sessions.
- Verify each feature agent is absent from `herdr agent list`.
- Keep the worktrees and branches for integration.

Integrate into the feature branch in dependency order, normally verifier before implementation. Run:

- the smallest deterministic verifier
- any separately gated live smoke required by the feature
- `git diff --check main...HEAD`
- relevant persisted-session, reload, failure, and cleanup cases

For Neovim work, use the feature's documented `scripts/verify-nvim <case>` first. Use the `neovim-debugger` agent for
live integration evidence when available. Visible UI behavior also needs the Neovim-scoped evidence named by the
screen-evidence feature; headless checks alone cannot prove appearance.

Diagnose a failed live gate before changing implementation. Project trust prompts, unavailable providers, stale
sessions, and wrong cwd are environment failures, not renderer failures.

## 6. Update the feature note after checks pass

Only after validation succeeds:

- make `Current Behavior` describe the landed behavior
- move fixed defects to resolved status with a human-readable date
- check completed tasks
- add exact commands and outcomes under `Validation`
- add or correct implementation sources
- preserve frontmatter, wikilinks, surrounding structure, and explicit uncertainty

Do not call a feature current merely because code was written. The named validation must have run.

## 7. Land without disturbing the primary checkout

Before landing:

1. Save only overlapping primary-checkout diffs to `.git/<feature-slug>-prework.patch`.
2. Verify the patch is non-empty and readable.
3. Restore only the backed-up overlapping paths.
4. Fast-forward `main` to the feature branch.
5. Re-run the deterministic verifier from primary `main`.

Leave unrelated dirty files untouched. Do not push unless the user asked.

After the landed result is confirmed:

- confirm every launched worker session was terminated
- remove the exact clean worktrees without `--force`
- delete merged task branches with `git branch -d`
- if cherry-picking defeats the ancestry check, require `git cherry main <branch>` to mark every task commit
  patch-equivalent before deleting the exact ephemeral task ref
- report what was removed and how the work can be recovered

Keep the feature branch unless the user asks to delete it.

## Completion report

Always finish with a compact user-facing summary:

- **Feature:** owning feature name and vault note path or wikilink.
- **Related tasks:** exact feature checkbox text or bounded worker task.
- **Completed:** high-level behavior and work completed.
- **Verification:** results grouped at a high level.
  - Deterministic verifier groups or named harness cases.
  - Regression red/green evidence when applicable.
  - Live integration or smoke checks when applicable.
  - Visual evidence when applicable.
  - Mark blocked, failed, or not-run groups explicitly.

Then include the operational handoff:

- Landed commit or remaining branch.
- Vault note commit state.
- Backup patch path.
- Session, worktree, and branch cleanup state.
- Unrelated dirty state preserved.
- Whether anything was pushed.
