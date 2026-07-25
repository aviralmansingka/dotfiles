---
name: vault
description: "Access and maintain the Obsidian vault: search notes, read topics, create tasks, browse system cards, and manage the Project, Theme, Feature, and Task hierarchy. Use for /vault subcommands or edits under ~/vault/1_projects."
allowed-tools: Glob, Grep, Read, Write, Edit
---

# Obsidian Vault Access

Interact with the personal Obsidian vault at `~/vault`.

## Subcommands

### `/vault search <query>`

Search for notes across the entire vault.

1. Search file names first with Glob: `**/*{query}*.md` under the vault base path
2. If no file name matches, fall back to Grep for content search across all `.md` files
3. Return matching file paths and relevant snippets

### `/vault read <topic>`

Find and read a note by topic.

1. Search file names with Glob: `**/*{topic}*.md`
2. If no match, search content with Grep
3. Read and output the most relevant match directly (do not summarize)
4. If multiple matches, prefer: system-cards > knowledge > wip > logs

### `/vault task <title>`

Append a task to the appropriate location. Two modes:

**Work tasks** (default when working in a code repository or when the task is clearly work-related):

1. Derive the current ISO `YYYY-WW` in the vault's timezone
2. Read or create `3_logs/YYYY-WW/backlog.md`
3. Append `- [ ] <title>` under today's heading in `## Log`, reusing the heading when it exists

**Personal tasks** (when the task is clearly personal, or when invoked with `/vault task personal <title>`):

1. Read `0_inbox/0.inbox.md`
2. Append `- [ ] <title>` under the most relevant existing section
3. If no section fits, append under a new `## Tasks` section at the bottom

If it's ambiguous whether a task is work or personal, ask the user.

### `/vault card <topic>`

Read a system card by topic from `5_modal/system-cards/`.

1. Search file names with Glob: `5_modal/system-cards/**/*{topic}*.md`
2. If no match, search content with Grep under `5_modal/system-cards/`
3. Read and output the matching system card directly

System card categories:
| Directory | Contents |
|-----------|----------|
| `cloud-capacity/` | scheduler, instance-manager, instance-launcher, resource-solver, capacity-prober, gang-scheduler, solver-pool |
| `core-services/` | active-function-tracker, fn-task-registry, change-notification-system |
| `infrastructure/` | machine-image-cd, machine-image-neocloud |
| `sandboxes/` | unary-object-backlog |
| `workers/` | worker, supervisor, relays, worker-health, worker-networking, worker-runtime, worker-task-execution, worker-binary-management |
| Root | invbook, modal-host-bench, \_index |

## Vault Conventions

- **Base path**: `~/vault`
- **Task format**: `- [ ]` open, `- [x]` closed, `- [~]` in-progress
- **Frontmatter**: YAML with `id`, `aliases`, `tags`
- **No daily notes** — weekly `backlog.md` is the central planning document
- **Weekly logs**: `3_logs/YYYY-WW/backlog.md`, with current activity under `## Log`

### Project structure

```text
1_projects/<project>/README.md
1_projects/<project>/themes/<theme>/theme.md
1_projects/<project>/themes/<theme>/features/<feature>/feature.md
1_projects/<project>/themes/<theme>/features/<feature>/tasks/01-<task>.md
```

- Keep project, theme, and feature pages at or below 120 lines. Treat 80–120 as a useful target when the content
  warrants it; never pad a short page.
- Give every project README a `repository` front-matter field containing the Git checkout used for implementation.
- Neovim's `<leader>vf` picker owns smart Herdr routing. Its task-local `<C-a>` action asks Herdr to create or reuse
  `feature/<feature-slug>` and `task/<task-slug>` worktrees, then launches the task in a named tab inside the feature
  workspace.
- Name worktree workspaces `Project · Theme` or `Project · Feature`. A task is represented only by its tab and is
  never included in the workspace name; the tab name reflects the selected task.
- The vault skill retrieves and edits vault content only. It never infers scope from arbitrary prompts, creates
  worktrees, moves panes, or renames Herdr workspaces, tabs, or agents.
- Keep simple tasks as numbered checkboxes in `feature.md`. Create a task note when one checkbox plus three or four
  nested bullets cannot capture the implementation, or when the work is a spike, low-level design, or verifier setup.
- Give every task a stable `T01`, `T02`, … number. Never renumber existing tasks.
- Treat the feature checklist as authoritative. A linked task note must mirror `[ ]` as `pending-work`, `[~]` as
  `in-progress`, and `[x]` as `done` in its frontmatter.
- Derive feature status from its checklist: all complete is `done`; any in-progress or a mixture of complete and open
  is `in-progress`; all open is `pending-work`; no tasks on an implemented capability is `maintained`.
- Preserve useful completed designs and verifier evidence in completed task notes. Put bulky raw evidence in an
  `evidence/` subfolder when helpful; task notes have no hard line limit.
- When gathering project context, start at `1_projects/projects.md`, then read the project README, theme, feature, and
  task notes in that order.
- After project-structure changes, run `~/vault/scripts/verify-project-structure`.

## Directory Layout

| Directory                | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `0_inbox/`               | Quick captures, personal tasks (`0.inbox.md`) |
| `1_wip/`                 | Work-in-progress research                     |
| `2_knowledge/`           | Finalized knowledge base and reference        |
| `3_logs/`                | Weekly work logs and backlogs                  |
| `4_misc/`                | Misc (interviews, projects)                   |
| `5_modal/system-cards/`  | System architecture documentation             |
| `journal/`               | Journal entries (weekly, not daily)           |
| `1_projects/`            | Project documentation                         |
