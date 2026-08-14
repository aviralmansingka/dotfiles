---
name: vault
description: "Navigate and explain the Obsidian vault at ~/vault. Use for finding information, reading or summarizing notes, producing project and Wayfinder overviews, creating tasks, logging work, and maintaining the Project → Theme → Feature → Task hierarchy."
---

# Vault Access

The vault is at `~/vault`. It is an Obsidian vault with a fixed top-level structure.

## Directory layout

| Directory | Purpose |
|---|---|
| `0_inbox/` | Quick captures, personal tasks (`0.inbox.md`) |
| `1_projects/` | Project documentation (Project → Theme → Feature → Task) |
| `1_wip/` | Work-in-progress research |
| `2_knowledge/` | Finalized knowledge base and reference |
| `3_logs/` | Weekly work logs and backlogs (`YYYY-WW/backlog.md`) |
| `4_misc/` | Misc (interviews, events, projects) |
| `5_modal/system-cards/` | System architecture documentation |
| `templates/` | Note templates (`daily.md`, `weekly-backlog.md`) |

Treat `journal/`, `3_log/`, and `5_modal/logs/` as legacy locations. Do not write to them unless the user explicitly asks.

## Searching notes

1. Search file names first: `fd '<query>' --extension md` under `~/vault`
2. Search frontmatter, headings, aliases, and content: `rg '<query>' --type md` under `~/vault`
3. Follow relevant wikilinks and backlinks only after locating the likely canonical note.
4. Return matching paths and short snippets unless the user asked for the note itself or a synthesis.

Choose authority by the question instead of using one global directory order:

- Project questions: project `CONTEXT.md`, relevant ADRs, README, theme, feature, task, then issues.
- System questions: `5_modal/system-cards/`, then `2_knowledge/` and `1_wip/`.
- Recent activity: `3_logs/`, then the canonical project notes linked from those entries.
- General knowledge: `2_knowledge/`, then `1_wip/`, project reference notes, and logs.

Treat logs and issue comments as time-stamped evidence, not automatically as the latest canonical state. When sources
disagree, say which note is canonical and identify the conflicting or stale source.

## Reading a note

1. Find by name or content (above).
2. Read and output the full note. Do not summarize unless asked.
3. If multiple matches, prefer the order above and list the candidates.

## Summaries and overviews

When the user asks for a summary, overview, status, or "what do I know about" a topic:

1. Resolve the canonical owner first; do not summarize search snippets in isolation.
2. Read the owner plus directly relevant context, decisions, active work, and recent evidence.
3. Separate settled facts, current state, open questions, and historical context.
4. Cite vault-relative paths or wikilinks for every material conclusion. Include heading names when useful.
5. State when a conclusion is inferred or when a note's status may be stale.

For a project overview, read `1_projects/projects.md`, the project `CONTEXT.md` or `CONTEXT-MAP.md`, README, relevant
ADRs, and active theme/feature/task notes. Summarize:

- purpose and vocabulary;
- current state and recent evidence;
- settled decisions;
- active features and tasks;
- open issues and risks;
- canonical source notes.

Do not turn an overview request into edits, task creation, a worktree, or an execution workflow.

## Weekly backlog logging

Use `3_logs/YYYY-WW/backlog.md` as the default work log. Derive `YYYY-WW` from the ISO year and ISO week number for the note date.

If the week directory or file does not exist, create it from `templates/weekly-backlog.md`. Required frontmatter:

```yaml
---
id: backlog
aliases: []
tags: []
---
```

Top-level structure:

```md
# YYYY-WW: Backlog

## Log

### Monday, YYYY-MM-DD

- item
```

Reuse the existing day heading when logging more work for the same date. If the file already has a `## Backlog` section, preserve it and append new dated notes under `## Log`.

Keep additional files in the same `YYYY-WW/` directory for focused deep dives or reference material. Keep the backlog file as the canonical entry point for the week.

## Creating a task

**Work tasks** (default when working in a code repository or when the task is clearly work-related):

1. Derive the current ISO `YYYY-WW`.
2. Read or create `3_logs/YYYY-WW/backlog.md`.
3. Append `- [ ] <title>` under today's heading in `## Log`, reusing the heading when it exists.

**Personal tasks** (when the task is clearly personal, or when invoked with `/vault task personal <title>`):

1. Read `0_inbox/0.inbox.md`.
2. Append `- [ ] <title>` under the most relevant existing section.
3. If no section fits, append under a new `## Tasks` section at the bottom.

If it is ambiguous whether a task is work or personal, ask the user.

Task format: `- [ ]` open, `- [x]` closed, `- [~]` in-progress.

## Project hierarchy

```text
1_projects/projects.md
1_projects/<project>/README.md
1_projects/<project>/epic.md
1_projects/<project>/issues/<issue>.md
1_projects/<project>/themes/<theme>/theme.md
1_projects/<project>/themes/<theme>/features/<feature>/feature.md
1_projects/<project>/themes/<theme>/features/<feature>/tasks/<NN>-<task>.md
1_projects/<project>/themes/<theme>/features/<feature>/issues/<issue>.md
```

When gathering project context, start at `1_projects/projects.md`, then read the project README, theme, feature, and task notes in that order.

### Reading project docs

When working inside a project, always read its domain docs alongside the hierarchy:

- **`CONTEXT.md`** (project root) — the project's ubiquitous language. Read it first to load the vocabulary before touching features or tasks. When a `CONTEXT-MAP.md` exists, it points to multiple per-context `CONTEXT.md` files; read the one(s) relevant to the current work.
- **`docs/adr/`** (project root) — numbered ADRs (`NNNN-<slug>.md`) recording hard-to-reverse architectural decisions. Read the ADRs that relate to the current feature or task before proposing changes that might contradict a settled decision.

These docs are the project's durable memory. Cite them when a decision in a feature or task depends on or specializes an ADR. Do not create a new ADR when an existing one already covers the ground; specialize it instead.

### Note types and their markdown structure

Each note type uses a fixed frontmatter shape and body section order so the vault can be searched semantically by type, not just by keyword.

**Project** (`README.md`) — frontmatter `id: project-<name>`, `tags: [project]`. Body: prose intro, `## Themes` (wikilinks to each theme), `## Current Work`, `## Implementation Context` (paths, repos, related projects).

**Theme** (`theme.md`) — frontmatter `id: <project>-theme-<theme>`, `tags: [project, theme]`. Body: `## Features` (wikilinks), `## Out Of Scope`.

**Feature** (`feature.md`) — frontmatter `id: <project>-feature-<feature>`, `tags: [project, feature]`, `status: pending-work|in-progress|done|maintained`. Body: `## Purpose`, `## Current Behavior`, `## Rendering Contract` (when UI), `## Tasks` (numbered checkboxes `- [ ] [[tasks/01-...|T01 ...]]`), `## Open Issues`, `## Resolved Issues`, `## Validation`, `## Sources`.

**Task** (`tasks/<NN>-<task>.md`) — frontmatter `id: <project>-<feature>-task-<NN>`, `tags: [project, task]`, `status: pending-work|in-progress|done`. Body sections in order: `## Intent`, `## Decisions and boundaries`, `## Verifiers`, `## Unresolved decisions`, `## Evidence`. Do not add user stories or broader spec sections.

**Issue** (`issues/<issue>.md`) — frontmatter `id: <project>-issue-<slug>`, `tags: [project, issue]`, `status: proposed|open|resolved`. Body: `## Problem`, `## Destination`, `## Decisions Already Made`, `## Settled Decisions` (checkboxes), `## Constraints`, `## Proposed Task`, `## Related`. Issues are temporary: an issue is resolved by reaching a decision, not by completing work. A resolved issue that produced a durable change should be absorbed into the owning feature or task note and the issue closed.

**Decision** — the unit of resolution inside a research effort. A decision answers one bounded question. Decisions are recorded as numbered tickets inside a research folder (see Research below) and linked from the effort's `map.md`. A decision is either:
- a **grilling** — an interview-style question whose answer resolves an ambiguity; or
- a **prototype** — a throwaway artifact that answers a design question by demonstrating it. A prototype lives in a `docs/` subfolder next to its decision ticket and is referenced from the ticket's `## Prototype` section. Prototypes are disposable evidence, not shipping code.

**Architectural Decision Record (ADR)** — a durable, hard-to-reverse design decision recorded under a project's `docs/adr/` as `NNNN-<slug>.md`. ADRs are created sparingly (only when hard to reverse, surprising without context, and the result of a real trade-off) and are the output of `domain-modeling` sessions, not research tickets. See `docs/adr/ADR-FORMAT.md` for the format.

**Glossary** — a project's ubiquitous language, recorded in `CONTEXT.md` at the project root (or per-context when a `CONTEXT-MAP.md` exists). The glossary is pure vocabulary — no implementation details. `grill-with-docs` updates it inline as terms crystallize.

**Wayfinder effort** — a project-scale decision map. The current local-markdown layout is:

- `1_projects/<project>/map.md` — frontmatter `status: open|done`, `epic: <project>`, and tags containing `wayfinder` and
  `map`. Body: `## Destination`, `## Notes`, `## Decisions so far`, `## Not yet specified`, `## Out of scope`.
- `1_projects/<project>/issues/<NN>-<decision>.md` — frontmatter `status: proposed|in-progress|resolved|wontfix`,
  `type: research|prototype|grilling|task`, `epic: <project>`, optional `blocked_by: [NN, ...]`, and a `wayfinder` tag.
  Body: `## Question`, then `## Answer` when resolved; prototypes may link supporting artifacts.
- Older feature-owned efforts may keep `map.md`, decision tickets, and optional `docs/` together under
  `themes/<theme>/features/<feature>/issues/<effort>/`. Read them in place; do not migrate them during lookup.

The map is the index, tickets own decision detail, `CONTEXT.md` owns durable vocabulary, and `docs/adr/` owns durable
architecture. Weekly backlogs record sessions and may link the effort, but they do not replace the map.

### Wayfinder overview

When asked to summarize or overview a Wayfinder session or effort:

1. Find candidate `map.md` files by name and then by `wayfinder`/`map` tags; list candidates if the title is ambiguous.
2. Read the map first, then resolve its decision wikilinks and scan the owning `issues/` directory for Wayfinder
   tickets whose `epic` matches.
3. Derive counts from frontmatter: resolved, in-progress, proposed, and wontfix. Do not infer status from prose.
4. Compute the frontier as proposed tickets whose `blocked_by` entries are all resolved or wontfix; list unresolved
   blockers separately.
5. Read linked prototype artifacts only when needed to explain a decision; otherwise cite the ticket that owns them.
6. Check the project's `CONTEXT.md` and relevant ADRs for durable outputs from resolved decisions.

Return: destination, effort status, decisions reached, current frontier/in-progress work, blocked work, remaining fog,
out-of-scope boundaries, durable outputs, and source links. If the user says "session," also search recent weekly
backlogs for activity linked to the map or its tickets and distinguish that activity log from the effort's canonical
state.

**Verifier** (inside a task's `## Verifiers` section, not a separate file) — stable `V01`, `V02`, … entries. Each entry: `### Vnn: <name>`, `- **Behavior:**`, `- **Observation:**` or `- **Command and manual observation:**`, `- **Baseline red:**`, `- **Latest:**`, `- **Evidence ID:**` `Tnn.Vnn.EX01` (immutable, one per verifier). Never renumber verifier entries or add `EX02`.

### Page conventions

- Keep project, theme, and feature pages at or below 120 lines. Treat 80–120 as a useful target; never pad a short page.
- Give every project README a `repository` front-matter field containing the Git checkout used for implementation.
- Frontmatter: YAML with `id`, `aliases`, `tags`.
- Use Obsidian wikilinks (`[[target]]`, `[[target|alias]]`, `[[target#Heading]]`, `[[target#^block-id]]`) to connect notes.

### Tasks

- Give every task a stable `T01`, `T02`, … number. Never renumber existing tasks.
- Task frontmatter `status`: `pending-work`, `in-progress`, `done`.
- Keep simple tasks as numbered checkboxes in `feature.md`. Create a task note when a checkbox plus a few nested bullets cannot capture the work, or when the work is a spike, low-level design, or verifier setup.
- Feature status is derived from its checklist: all done → `done`; any in-progress or mixed → `in-progress`; all open → `pending-work`; no tasks on an implemented capability → `maintained`.

### Issues

- An issue captures a question, gap, or ambiguity that needs resolution before work can proceed. It is resolved by reaching a decision, not by completing implementation.
- Create `issues/` under a feature lazily for temporary decisions and investigations with known ownership.
- Keep cross-feature or not-yet-owned issues under the project's `issues/`, then move them under the owning feature once ownership becomes clear.
- A resolved issue that produced a durable change should be absorbed into the owning feature or task note; close the issue once the decision is recorded elsewhere.
- Store new Wayfinder maps and numbered tickets in the current local-markdown layout above. Preserve older nested
  research efforts in place unless the user explicitly requests a migration.
- Durable vocabulary belongs in the project `CONTEXT.md`; durable architectural decisions belong in project ADRs.

### After structure changes

Run `~/vault/scripts/verify-project-structure` after any project-structure change.

## Scope boundary

This skill retrieves and edits vault content only. It never infers work from arbitrary prompts, creates worktrees,
moves panes, launches execution crews, or renames Herdr workspaces, tabs, or agents. Use ordinary repository workflows
when the user explicitly asks to implement something described by a vault note.

## System cards

Read system cards from `5_modal/system-cards/`:

1. Search: `fd '<topic>' 5_modal/system-cards --extension md`
2. If no match, search content: `rg '<topic>' 5_modal/system-cards --type md`
3. Read and output the matching card directly.

Categories: `cloud-capacity/`, `core-services/`, `infrastructure/`, `sandboxes/`, `workers/`, plus root-level cards.

## Coding mode

For all coding tasks in this vault, use Ponytail: choose the simplest solution that works, prefer deletion/reuse/stdlib/native features before new code or dependencies, avoid speculative abstractions, and fix bugs at the root shared path.
