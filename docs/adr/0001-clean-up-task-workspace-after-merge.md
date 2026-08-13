---
status: superseded by ADR-0002
---

# Clean up the task workspace after merge

After merged-main checks pass, Vault Hunter closes every Herdr tab in the task's Herdr Workspace and every Neovim
Workspace Tab bound to it, then verifies the workspace has no remaining tabs on either surface. This deliberately
trades resumable task UI state for a clean post-completion environment; unrelated Herdr Workspaces and Unbound Neovim
Tabs remain untouched.
