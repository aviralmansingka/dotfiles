# Development Workspace Context

Terms for coordinating Herdr and Neovim while keeping Herdr authoritative for terminal workspace state.

## Language

**Herdr Workspace**:
A project context owned by Herdr, identified by its Herdr workspace ID. It may represent a Git worktree, a primary checkout, or a non-Git directory.
_Avoid_: Neovim workspace, project, worktree when referring to the Herdr object

**Workspace Tab**:
A Neovim tab bound at runtime to exactly one Herdr Workspace. At most one Workspace Tab may be bound to a given Herdr Workspace in a Neovim process.
_Avoid_: project tab, worktree tab

**Unbound Tab**:
A normal Neovim tab with no Herdr Workspace identity. It never causes Herdr focus changes.
_Avoid_: workspace tab

**Workspace State**:
The aggregate agent state reported for a Herdr Workspace by Herdr itself. Neovim displays this state but never derives it from individual agents.
_Avoid_: Neovim status, inferred status

**Worktree**:
A Git checkout whose creation, opening, and removal are owned entirely by Herdr. Neovim does not expose or manage the worktree lifecycle.
_Avoid_: workspace
