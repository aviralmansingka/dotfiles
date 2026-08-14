# Repository Agent Instructions

## Python packaging

- Use `uv` for every Python project and command.
- Every `pyproject.toml` build system must use `requires = ["uv_build"]` and `build-backend = "uv_build"`.
- Do not introduce Hatch or Hatchling.

## Sidekick and Herdr session invariants

Treat repository, worktree, and session identity as three distinct concepts:

- A Git repository owns exactly one Herdr Workspace. Resolve repository identity from Git's shared common directory,
  so the primary checkout and every linked worktree reuse that same Herdr Workspace.
- A Git worktree owns at most one durable Sidekick session. The session runs with that worktree as its cwd, inside the
  repository's Herdr Workspace.
- If a user asks to launch a session in a worktree that already owns one, focus and reuse the existing session. Do not
  create a differently named duplicate.
- If a user needs another durable session, create or select a different worktree first. Short-lived subagents may run
  beneath the owning session, but they do not become additional durable Sidekick picker sessions for that worktree.
- Do not create one Herdr Workspace per worktree, branch, feature, task, backend, or session label.
- Keep internal Herdr agent names available for routing and lifecycle operations, but do not use them as the primary
  picker identity.

## Sidekick picker presentation

- Group durable sessions as `repository -> worktree`.
- Render one worktree row for its one durable session; do not repeat a session name that restates the worktree name.
- Prefix every non-`main` Git branch row with `` and color both the marker and branch name with the existing Gruvbox
  pink `SidekickBranch` highlight; do not color non-`main` branch identity by agent backend. Retain the Herdr status
  glyph.
- Treat a `main` branch row as the neutral checkout: retain its agent backend chrome, but render it without the branch
  marker and without line-diff totals. Non-Git session rows also retain their agent backend chrome.
- For non-`main` branches, show tracked line additions and removals against local `main` as `+<added> −<removed>`;
  show `clean` when both are zero.
- Keep the current-worktree row in the picker alongside the repository hierarchy. Selection, preview, rename, kill,
  and focus actions must continue to target the exact underlying Herdr agent identity.
- Preserve exact cwd behavior for non-Git directories instead of inventing repository identity.
