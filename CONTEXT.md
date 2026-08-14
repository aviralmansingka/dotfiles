# Development Workspace Context

Terms for coordinating Neovim workspace tabs with Herdr runtime state while keeping Neovim authoritative for interactive workspace identity.

## Language

**Workspace Tab**:
A Neovim tab that owns a folder identity and its Tab Buffers. It exists independently of Herdr and is the authority used when launching an agent.
_Avoid_: project tab, worktree tab

**Unbound Tab**:
A normal Neovim tab with no folder identity. It never creates or focuses Herdr state.
_Avoid_: workspace tab

**Tab Buffer**:
A normal listed buffer recorded as a member of a Workspace Tab. Membership is established by entering the buffer from that tab and remains until the buffer is deleted.
_Avoid_: global buffer, visible buffer

**Global Buffer**:
A normal listed buffer in Neovim's process-wide buffer registry, regardless of Workspace Tab membership.
_Avoid_: tab buffer

**Herdr Workspace**:
A repository-level runtime context identified by its Herdr workspace ID. Every Git repository has one shared Herdr Workspace across its primary checkout and linked worktrees; a non-Git folder may use its exact folder identity instead.
_Avoid_: Neovim workspace, workspace tab, worktree workspace, session workspace

**Herdr Binding**:
The optional runtime association from a Workspace Tab to its repository's Herdr Workspace. Multiple worktree-scoped Workspace Tabs may share one Herdr Binding target.
_Avoid_: workspace tab identity

**Workspace State**:
The aggregate agent state reported for a Herdr Workspace by Herdr itself. Neovim displays this state but never derives it from individual agents.
_Avoid_: Neovim status, inferred status

**Worktree**:
A Git checkout whose creation, opening, and removal are owned entirely by Herdr. A Worktree owns at most one Durable Sidekick Session.
_Avoid_: workspace

**Durable Sidekick Session**:
The one user-addressable Sidekick session owned by a Worktree and shown in session pickers. Short-lived child agents are not Durable Sidekick Sessions.
_Avoid_: workspace, spinoff session, picker child

## Agent Attachments

**Agent Session**:
A durable identity for one running agent whose conversation continues independently of any user-interface surface.
_Avoid_: Neovim session, terminal session, pane when referring to the agent

**Surface Attachment**:
A client's view of an Agent Session with a declared set of surface capabilities.
_Avoid_: attached session, client session

**Attachment Lease**:
Herdr's time-bounded grant giving one Surface Attachment exclusive authority for live input and interactive mouse routing.
_Avoid_: takeover

**Lease Holder**:
The Surface Attachment that currently holds the Attachment Lease. An Agent Session may have no Lease Holder.
_Avoid_: owner, active attachment

**Observer**:
A Surface Attachment that can read session status and history without authority for live input or interactive mouse routing.
_Avoid_: secondary attachment, passive holder

**Capability Plan**:
The inspectable assignment of session and surface capabilities to their canonical authorities for one Surface Attachment.
_Avoid_: profile, backend settings
