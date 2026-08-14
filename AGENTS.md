# Repository Agent Instructions

## Python packaging

- Use `uv` for every Python project and command.
- Every `pyproject.toml` build system must use `requires = ["uv_build"]` and `build-backend = "uv_build"`.
- Do not introduce Hatch or Hatchling.

## Sidekick and Herdr session invariants

Treat repository, worktree, and session identity as three distinct concepts:

- For Herdr server replacement from Codex, follow the
  [color-safe live handoff procedure](README.md#herdr-server-handoff).
- A Git repository owns exactly one Herdr Workspace. Resolve repository identity from Git's shared common directory,
  so the primary checkout and every linked worktree reuse that same Herdr Workspace.
- A non-`main` Git worktree owns at most one durable Sidekick session. The session runs with that worktree as its cwd,
  inside the repository's Herdr Workspace. The `main` checkout may own multiple named durable sessions.
- If a user asks to launch a session in a non-`main` worktree that already owns one, focus and reuse the existing
  session. On `main`, reuse only an exact session-name match.
- If a user needs another durable session from a non-`main` worktree, create or select a different worktree first.
  Short-lived subagents may run beneath the owning session, but they do not become additional durable Sidekick picker
  sessions for that worktree.
- Do not create one Herdr Workspace per worktree, branch, feature, task, backend, or session label.
- Keep internal Herdr agent names available for routing and lifecycle operations, but do not use them as the primary
  picker identity.

## Sidekick picker presentation

- Group durable sessions as `repository -> worktree`.
- Render one row per durable session. Non-`main` worktrees have one row; `main` may have multiple session-named rows.
  Do not repeat a session name that restates a non-`main` worktree name.
- Prefix every non-`main` Git branch row with `` and color both the marker and branch name with the existing Gruvbox
  pink `SidekickBranch` highlight; do not color non-`main` branch identity by agent backend. Retain the Herdr status
  glyph.
- Treat a `main` branch row as the neutral checkout: show its durable Sidekick session name with agent backend chrome,
  but render it without the branch marker and without line-diff totals. Non-Git session rows also retain their agent
  backend chrome.
- For non-`main` branches, show tracked line additions and removals against local `main` as `+<added> −<removed>`;
  show `clean` when both are zero.
- Keep the current-worktree session rows in the picker alongside the repository hierarchy. Selection, preview, rename,
  kill, and focus actions must continue to target the exact underlying Herdr agent identity.
- Preserve exact cwd behavior for non-Git directories instead of inventing repository identity.
