---
name: gwt
description: "Use the gwt helper to clone repositories as bare ghq repos with git worktrees. Use when the user wants to clone a repo into the bare-repo plus worktree layout, bootstrap a new worktree-based checkout, or create a feature worktree with the standard local structure."
allowed-tools: Bash
---

# Git Worktree Bootstrap

Use `gwt` instead of manually composing `ghq get --bare` and `git worktree add` commands when setting up a new repository in the standard local layout.

## Command

`gwt` is available on `PATH` and wraps `~/dotfiles/scripts/ghq-worktree-clone.sh`.

Examples:

```sh
gwt modal-labs/modal-client
gwt --branch feat/login modal-labs/modal-client
gwt --worktrees-root ~/src/worktrees git@github.com:modal-labs/modal-client.git
```

## When To Use

- New repository bootstrap into the `ghq --bare` + worktree layout
- Creating a stable main worktree for a freshly cloned repo
- Creating an initial feature worktree at clone time

## Workflow

1. If the user is cloning a new repo, run `gwt ...`.
2. Report the resulting bare repo path, main worktree path, and the current-directory symlink path.
3. If Sidecar is relevant, point it at the main worktree path, not the bare repo.

## Default Layout

- Bare repo: managed by `ghq`
- Main worktree: `~/worktrees/<repo>/main`
- Convenience symlink: `./<repo>` -> `~/worktrees/<repo>/main`

## Do Not Use

- For existing non-bare clones that need migration. Inspect the current repo first and propose or perform a migration plan.
- When the user wants a custom git layout that differs from the standard `ghq` bare repo plus checked-out worktrees flow.
