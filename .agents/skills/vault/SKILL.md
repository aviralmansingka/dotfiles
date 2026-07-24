---
name: vault
description: "Access and maintain the Obsidian vault: search notes, read topics, create tasks, browse system cards, and manage the Project, Theme, Feature, and Task hierarchy. Use for /vault subcommands or edits under ~/vault/projects."
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

1. Find the latest `week_XXX` directory in `5_modal/logs/` (sort numerically, pick highest)
2. Read the `backlog.md` in that directory
3. Append `- [ ] <title>` at the end of the `## Backlog` section (before `## Log`)

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
- **Weekly logs**: `5_modal/logs/week_XXX/backlog.md` with `## Backlog` and `## Log` sections

### Project structure

```text
projects/<project>/README.md
projects/<project>/themes/<theme>/theme.md
projects/<project>/themes/<theme>/features/<feature>/feature.md
projects/<project>/themes/<theme>/features/<feature>/tasks/01-<task>.md
```

- Keep project, theme, and feature pages at or below 120 lines. Treat 80–120 as a useful target when the content
  warrants it; never pad a short page.
- Keep simple tasks as numbered checkboxes in `feature.md`. Create a task note when one checkbox plus three or four
  nested bullets cannot capture the implementation, or when the work is a spike, low-level design, or verifier setup.
- Give every task a stable `T01`, `T02`, … number. Never renumber existing tasks.
- Treat the feature checklist as authoritative. A linked task note must mirror `[ ]` as `pending-work`, `[~]` as
  `in-progress`, and `[x]` as `done` in its frontmatter.
- Derive feature status from its checklist: all complete is `done`; any in-progress or a mixture of complete and open
  is `in-progress`; all open is `pending-work`; no tasks on an implemented capability is `maintained`.
- Preserve useful completed designs and verifier evidence in completed task notes. Put bulky raw evidence in an
  `evidence/` subfolder when helpful; task notes have no hard line limit.
- After project-structure changes, run `~/vault/scripts/verify-project-structure`.

## Directory Layout

| Directory                | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `0_inbox/`               | Quick captures, personal tasks (`0.inbox.md`) |
| `1_wip/`                 | Work-in-progress research                     |
| `2_knowledge/`           | Finalized knowledge base and reference        |
| `3_log/`                 | Historical monthly logs                       |
| `4_misc/`                | Misc (interviews, projects)                   |
| `5_modal/logs/week_XXX/` | Weekly work logs and backlogs                 |
| `5_modal/system-cards/`  | System architecture documentation             |
| `journal/`               | Journal entries (weekly, not daily)           |
| `projects/`              | Project documentation                         |
