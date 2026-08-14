---
status: accepted
---

# Share one Herdr workspace per repository

All primary checkouts and linked worktrees from one Git repository share one Herdr Workspace, while each worktree owns
at most one durable Sidekick session. This removes redundant repository/worktree/session names and keeps repository
runtime identity stable; durable parallel sessions require separate worktrees, while transient child agents remain
beneath the owning session.

Task cleanup therefore closes task-owned tabs, panes, bindings, and worktree views without closing a repository's
shared Herdr Workspace while other worktree sessions remain. The Sidekick picker presents repository headings and
Gruvbox-pink `` branch rows with tracked line additions and removals against `main`; the neutral `main` checkout shows
its durable Sidekick session name with backend chrome but neither marker nor diff totals. Non-Git sessions also retain
backend chrome. Internal Herdr agent names remain routing identities rather than display identities.
