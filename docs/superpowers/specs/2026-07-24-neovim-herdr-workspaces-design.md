# Neovim–Herdr Workspace Integration — Design

**Date:** 2026-07-24
**Status:** Superseded in part by ADR-0002 repository-scoped Herdr workspaces
**Scope:** Personal Neovim configuration in `~/dotfiles`; workspace selection and lifecycle through `<leader>fw`.

## Goal

Make Neovim an external control surface for all live Herdr workspaces. `<leader>fw` must query Herdr on demand, present a workspace picker that visually matches Herdr, and represent each opened Herdr workspace with one Neovim tab.

Herdr remains the sole authority for workspace identity, aggregate agent state, focus, and lifecycle. Neovim does not manage Git worktrees directly.

## Terminology

The canonical terms are defined in [`CONTEXT.md`](../../../CONTEXT.md):

- **Herdr Workspace** — the Herdr-owned project context, keyed by workspace ID.
- **Workspace Tab** — a Neovim tab bound at runtime to one Herdr Workspace.
- **Unbound Tab** — an ordinary Neovim tab with no Herdr identity.
- **Workspace State** — Herdr's reported aggregate agent state.
- **Worktree** — a Git checkout whose lifecycle is owned entirely by Herdr.

A Herdr Workspace may correspond to a primary checkout, a linked worktree, or a non-Git directory. “Workspace” in this feature always means **Herdr Workspace**, not worktree or repository.

## Existing System

The repository already has the required building blocks:

- `nvim/.config/nvim/lua/plugins/tabline.lua` uses Tabby and native Neovim tabs.
- `nvim/.config/nvim/lua/plugins/project.lua` configures `project.nvim`, currently with its default global cwd scope.
- `nvim/.config/nvim/lua/plugins/sidekick/herdr.lua` is the existing synchronous Herdr JSON CLI adapter.
- `nvim/.config/nvim/lua/plugins/sidekick/herdr_backend.lua` already maps Sidekick agents into Herdr workspaces.
- Snacks provides the established picker UI.
- Herdr 0.7.1 exposes `workspace list/create/focus/rename/close` and `pane list` over its CLI/socket API.

Neovim is normally launched outside Herdr. It can therefore focus a Herdr workspace without hiding the Neovim process that initiated the action.

## Core Decisions

| Axis | Decision |
|---|---|
| Source of truth | Query Herdr CLI; no independently maintained workspace model |
| Picker scope | Every live Herdr workspace across repositories |
| Neovim representation | At most one runtime Workspace Tab per Herdr workspace ID |
| Tab creation | Lazy; reuse an empty initial tab, otherwise create a tab |
| Focus direction | Neovim tab entry focuses Herdr; no Herdr-to-Neovim subscription |
| Cwd | Initialize from Herdr pane `cwd`; preserve later tab-local changes |
| Buffer model | Native global Neovim buffers; no per-tab buffer isolation |
| Tab title | Herdr workspace label only |
| Persistence | Runtime only; mappings do not survive Neovim session restore |
| Worktrees | No Neovim worktree actions or direct `git worktree` commands |
| Picker refresh | Fresh snapshot on open and after explicit picker mutations |
| Live updates | No polling or event subscription while the picker is open |
| Preview | None |

## User Experience

### Open the picker

Pressing `<leader>fw` runs fresh Herdr queries and opens a compact Snacks picker titled `spaces`.

The picker lists all Herdr workspaces in Herdr's own workspace-number order. The row styling mirrors Herdr's workspace picker:

```text
· ~                         ~/
● vault                     ~/vault
● dotfiles                  ~/dotfiles
● Wayfinder · Specify …     ~/vault
```

The primary row consists of Herdr's status glyph, semantic status color, and workspace label. The stable workspace cwd appears as subdued secondary context, shortened with `~`. Git branch, ahead/behind state, and worktree metadata are intentionally omitted.

The row glyph and color come only from `workspace.agent_status` returned by Herdr:

| Herdr state | Marker | Presentation |
|---|---:|---|
| `blocked` | `●` | Herdr blocked/error color |
| `working` | `●` | Herdr working/yellow color |
| `done` | `●` | Herdr done/green color |
| `idle` | `·` | Herdr inactive/muted color |
| `unknown` or future state | `·` | Herdr unknown/muted color |

The selected row uses the same emphasis as Herdr: selected background, bold label, and unchanged semantic state color. Color is not used as the only state signal because active states use `●` and inactive/unknown states use `·`.

The row reported as `focused` by Herdr is initially selected. If none is focused, the first row is selected.

The picker has fuzzy input and a compact list. It has no preview pane.

### Select a workspace

Pressing `<CR>`:

1. Closes the picker.
2. Finds an existing Workspace Tab by exact Herdr workspace ID.
3. Reuses that tab, or creates one lazily if none exists.
4. Reuses the initial tab only when it has one empty, unmodified buffer and no meaningful layout.
5. Initializes a new tab with `:tcd` set to the workspace cwd.
6. Sets the tab title to the Herdr workspace label.
7. Enters the tab and calls `herdr workspace focus <workspace-id>`.

A first-time tab shows a normal empty buffer. It does not automatically open a picker, explorer, dashboard, or corresponding file from another checkout.

Returning to an existing Workspace Tab preserves its windows, buffers, and current tab-local cwd.

### Tab-driven Herdr focus

Entering any bound Workspace Tab—through `<leader>fw`, `gt`, mouse selection, or another native tab command—calls:

```text
herdr workspace focus <workspace-id>
```

Entering an Unbound Tab does nothing to Herdr.

This synchronization is intentionally one-way. Workspace changes made directly in Herdr do not switch Neovim tabs automatically. The next `<leader>fw` invocation queries Herdr again and reflects its current focused workspace and lifecycle state.

### Workspace lifecycle actions

The workspace picker exposes exactly three lifecycle actions in addition to `<CR>` selection:

| Key | Action | Herdr ownership |
|---|---|---|
| `<C-n>` | Create workspace | `herdr workspace create` |
| `<C-r>` | Rename selected workspace | `herdr workspace rename` |
| `<C-x>` | Close selected workspace after confirmation | `herdr workspace close` |

All actions are available from picker normal and input modes where Snacks supports them.

#### Create

`<C-n>` prompts only for a workspace label. An empty or cancelled label performs no action.

Creation uses the active Neovim tab's cwd:

```text
herdr workspace create --cwd <tab-cwd> --label <label> --no-focus
```

On success, Neovim closes the picker, binds the returned workspace to a new or reusable empty tab, enters it, and lets normal `TabEnter` behavior focus Herdr.

No cwd prompt and no worktree prompt are shown.

#### Rename

`<C-r>` prompts with the selected workspace's current label. On success:

- Herdr remains authoritative for the new label.
- Every runtime Workspace Tab bound to that ID updates its label immediately.
- The picker refreshes from fresh Herdr output and preserves the selected workspace when possible.

#### Close

`<C-x>` shows a Herdr-style `Close workspace?` confirmation identifying the label and warning that Herdr panes/processes will exit.

On confirmation:

1. Call `herdr workspace close <workspace-id>`.
2. Only after success, close the mapped Neovim tab if one exists.
3. Refresh the picker from Herdr.

Neovim buffers remain globally loaded, including modified buffers. The workspace tab's window layout is discarded. If Herdr rejects the close, Neovim keeps both the picker entry and tab unchanged.

Manual `:tabclose` has different semantics: it removes only the Neovim view and runtime binding. It never closes the Herdr workspace. Selecting that workspace later creates a fresh Workspace Tab.

## State and Identity Model

### Runtime tab identity

Each bound tab stores the exact Herdr workspace ID in a tab-scoped variable. Labels and cwd values are presentation and navigation metadata, never identity.

This permits duplicate workspace labels. Duplicate labels may produce identical tab titles; the picker cwd disambiguates them.

The runtime invariant is:

```text
one Herdr workspace ID -> zero or one bound Neovim tab
one bound Neovim tab   -> exactly one Herdr workspace ID
```

Unbound tabs coexist normally and are excluded from the invariant.

### No persisted mapping

Workspace bindings are not written to disk and are not integrated with `persistence.nvim`. After a Neovim restart or session restore, `<leader>fw` lazily creates fresh bindings.

Restored ordinary tabs remain Unbound Tabs. The feature does not infer identity from label or cwd because neither is unique.

### Detached tabs

If Herdr closes a workspace externally, a previously bound Neovim tab is not auto-closed. On the next fresh picker query, the missing ID is marked detached internally and omitted from picker results. Its title remains label-only and its local contents remain usable.

Entering a detached tab attempts the normal Herdr focus, warns once when the workspace is missing, and otherwise leaves the tab usable. Neovim never discards a tab because remote state disappeared.

## Cwd Model

`herdr workspace list` does not include cwd, so `<leader>fw` also queries `herdr pane list`.

For each workspace, Neovim uses the first matching pane's stable `cwd`. It deliberately ignores `foreground_cwd`, which may drift when a shell temporarily changes directories. If no pane cwd exists, the workspace remains selectable, but a new tab keeps the current cwd and shows a warning.

A Workspace Tab receives this cwd only when first bound. Subsequent local navigation is preserved.

`project.nvim` must use:

```lua
scope_chdir = "tab"
```

This allows existing nested project-root detection while preventing one workspace from changing another workspace tab's cwd.

## Data Flow

```text
<leader>fw
  -> herdr workspace list
  -> herdr pane list
  -> join by workspace_id
  -> reconcile labels/detached runtime tabs
  -> render Herdr-styled Snacks rows

<CR>
  -> find tab by workspace_id
  -> reuse or create tab
  -> initialize tcd only for a new binding
  -> TabEnter
  -> herdr workspace focus <id>

<C-n>/<C-r>/<C-x>
  -> invoke matching Herdr workspace command
  -> mutate Neovim tab only after Herdr success
  -> rerun workspace list + pane list
  -> refresh picker
```

No background task, event subscription, filesystem cache, or local workspace database is introduced.

## Failure Handling

| Failure | Required behavior |
|---|---|
| Herdr executable/socket unavailable | Show one clear error; do not open a stale or fake-empty picker |
| Invalid Herdr JSON | Show one clear error; do not mutate tabs |
| `pane list` unavailable after workspace list succeeds | Treat the query as failed rather than invent cwd state |
| Workspace has no pane cwd | Keep it selectable; preserve current cwd and warn when creating its tab |
| Focus fails on a live-looking tab | Keep the Neovim tab active and warn |
| Focus fails because workspace disappeared | Mark binding detached and warn once |
| Create fails | Keep picker and tabs unchanged |
| Rename fails | Preserve old tab label and picker row |
| Close fails | Preserve workspace tab, picker row, buffers, and layout |
| Workspace disappears while picker is open | Confirm/focus fails safely; reopening obtains a fresh snapshot |
| Future unknown state | Render muted `·`; preserve Herdr ordering and label |

No cached picker result is used as a fallback.

## Architecture and Expected Files

Use the existing dependencies and adapter rather than introducing another workspace service.

| File | Change |
|---|---|
| `nvim/.config/nvim/lua/plugins/herdr-workspaces.lua` | New Lazy spec and `<leader>fw` binding |
| `nvim/.config/nvim/lua/plugins/herdr/workspaces.lua` | New picker, runtime tab mapping, lifecycle actions, and TabEnter focus |
| `nvim/.config/nvim/lua/plugins/sidekick/herdr.lua` | Reuse existing `call`; add only minimal named workspace helpers if they reduce duplication |
| `nvim/.config/nvim/lua/plugins/tabline.lua` | Render a bound tab using its Herdr label only |
| `nvim/.config/nvim/lua/plugins/project.lua` | Set `scope_chdir = "tab"` |
| `scripts/verify-nvim.lua` | Add deterministic workspace integration coverage |
| `docs/neovim-current-features.md` | Document `<leader>fw` and workspace-tab behavior |

Do not add a worktree module, state file, polling loop, event subscriber, or new plugin dependency.

## Verification

Extend the existing `scripts/verify-nvim` harness with mocked Herdr CLI results. At minimum, prove:

1. Every `open()` performs fresh `workspace list` and `pane list` calls.
2. Workspace rows preserve Herdr number order.
3. `blocked`, `working`, `done`, `idle`, and `unknown` use the Herdr marker vocabulary and semantic colors.
4. Herdr's focused workspace is initially selected.
5. Stable pane `cwd`, not `foreground_cwd`, initializes a new tab.
6. Selecting the same workspace twice reuses one tab.
7. An empty initial tab is reused; a non-empty tab is preserved.
8. Workspace identity uses ID, allowing duplicate labels.
9. Bound `TabEnter` calls `workspace focus`; Unbound Tab entry does not.
10. Existing tab-local cwd survives tab switching.
11. `<C-n>` passes active tab cwd, label, and `--no-focus`, then opens the returned workspace.
12. `<C-r>` updates the matching runtime tab only after Herdr success.
13. `<C-x>` requires confirmation, calls Herdr first, and closes the tab only after success.
14. Manual tab closure does not call Herdr.
15. Missing external workspaces leave their tabs usable and detached.
16. Herdr unavailability opens no picker and uses no stale data.
17. `project.nvim` uses tab-scoped cwd changes.

A manual smoke test should additionally verify the real visual match against Herdr's workspace picker and prove that `gt` changes the focused workspace in an independently running Herdr client.

## Out of Scope

- Direct `git worktree` commands from Neovim.
- Herdr `worktree list/create/open/remove` actions in Neovim.
- Repository-local filtering; the picker is global.
- Bidirectional focus synchronization.
- Polling or Herdr event subscriptions.
- Picker previews.
- Per-tab buffer isolation.
- Automatic file mirroring between worktrees.
- Automatic file picker or explorer launch.
- Persisting workspace-to-tab bindings.
- Automatically closing Neovim tabs when Herdr changes externally.
- Branch, dirty, ahead, or behind metadata in picker rows.
