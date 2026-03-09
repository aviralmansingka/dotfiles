---
name: vault
description: "Access the Obsidian vault: search notes, read topics, create tasks, and browse system cards."
---

# Obsidian Vault Access

Interact with the personal Obsidian vault at `~/vault`.

## Usage

Use this skill when the user wants to search notes, read vault content, append a task, or open a system card.

## Search Notes

1. Search file names first with Glob: `**/*{query}*.md` under the vault base path.
2. If no file name matches, fall back to Grep for content search across all `.md` files.
3. Return matching file paths and relevant snippets.

## Read Topic

1. Search file names with Glob: `**/*{topic}*.md`.
2. If no match, search content with Grep.
3. Read and output the most relevant match directly.
4. If multiple matches, prefer: system-cards > knowledge > wip > logs.

## Add Task

Work tasks:

1. Find the latest `week_XXX` directory in `5_modal/logs/` by sorting numerically and picking the highest.
2. Read the `backlog.md` in that directory.
3. Append `- [ ] <title>` at the end of the `## Backlog` section before `## Log`.

Personal tasks:

1. Read `0_inbox/0.inbox.md`.
2. Append `- [ ] <title>` under the most relevant existing section.
3. If no section fits, append under a new `## Tasks` section at the bottom.

If it is ambiguous whether a task is work or personal, ask the user.

## Read System Card

1. Search file names with Glob: `5_modal/system-cards/**/*{topic}*.md`.
2. If no match, search content with Grep under `5_modal/system-cards/`.
3. Read and output the matching system card directly.

System card categories:

| Directory | Contents |
|-----------|----------|
| `cloud-capacity/` | scheduler, instance-manager, instance-launcher, resource-solver, capacity-prober, gang-scheduler, solver-pool |
| `core-services/` | active-function-tracker, fn-task-registry, change-notification-system |
| `infrastructure/` | machine-image-cd, machine-image-neocloud |
| `sandboxes/` | unary-object-backlog |
| `workers/` | worker, supervisor, relays, worker-health, worker-networking, worker-runtime, worker-task-execution, worker-binary-management |
| Root | invbook, modal-host-bench, `_index` |

## Vault Conventions

- **Base path**: `~/vault`
- **Task format**: `- [ ]` open, `- [x]` closed, `- [~]` in-progress
- **Frontmatter**: YAML with `id`, `aliases`, `tags`
- **No daily notes**: weekly `backlog.md` is the central planning document
- **Weekly logs**: `5_modal/logs/week_XXX/backlog.md` with `## Backlog` and `## Log` sections

## Directory Layout

| Directory | Purpose |
|-----------|---------|
| `0_inbox/` | Quick captures, personal tasks (`0.inbox.md`) |
| `1_wip/` | Work-in-progress research |
| `2_knowledge/` | Finalized knowledge base and reference |
| `3_log/` | Historical monthly logs |
| `4_misc/` | Misc (interviews, projects) |
| `5_modal/logs/week_XXX/` | Weekly work logs and backlogs |
| `5_modal/system-cards/` | System architecture documentation |
| `journal/` | Journal entries (weekly, not daily) |
| `projects/` | Project documentation |
