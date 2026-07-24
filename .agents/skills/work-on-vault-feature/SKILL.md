---
name: work-on-vault-feature
description: Run a durable vault feature through discovery, isolated implementation, independent verification, Herdr and Sidekick review, landing, and evidence updates. Use when planning, implementing, fixing, validating, or landing a feature under the vault projects tree in a theme features directory, including nested themes, especially when implementation lives in another repository and should use Git worktrees plus named Codex panes in Herdr and Neovim.
---

# Work on a Vault Feature

Treat the vault feature note as the durable owner of behavior and validation. Keep temporary investigation in issues;
keep implementation in its source repository.

Announce: "I'm using the work-on-vault-feature skill to carry this feature from its vault contract through verified
implementation."

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
- Keep the feature tab open through integration and landing verification.

## 4. Give workers bounded contracts

Every worker prompt must name:

- its exact owned paths
- the behavior and acceptance criteria
- the checks it must run
- the exact commit message when one is required
- that other workers share the repository and it must not revert their work

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

- close the exact Herdr feature tab
- remove the exact clean worktrees without `--force`
- delete merged task branches with `git branch -d`
- if cherry-picking defeats the ancestry check, require `git cherry main <branch>` to mark every task commit
  patch-equivalent before deleting the exact ephemeral task ref
- report what was removed and how the work can be recovered

Keep the feature branch unless the user asks to delete it.

## Completion report

Lead with the outcome. Include:

- landed commit or remaining branch
- verifier results, including red/green evidence
- vault note path and whether it is committed
- backup patch path
- cleanup state
- any unrelated dirty state preserved
- whether anything was pushed
