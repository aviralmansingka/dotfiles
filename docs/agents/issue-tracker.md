# Issue Tracker: Local Obsidian Vault

Issues, specs, features, and tasks for this repo live in the local Obsidian vault under
`/Users/aviral/vault/1_projects/`. Do not use GitHub Issues.

Start with `/Users/aviral/vault/1_projects/projects.md`, which defines the canonical project-management model.

## Structure

Durable work uses this hierarchy:

```text
1_projects/<project>/
  README.md
  themes/<theme>/
    theme.md
    features/<feature>/
      feature.md
      tasks/<NN>-<task>.md
      issues/<issue>.md
```

- Feature files are the canonical project-management unit.
- Every task has a stable `T01`, `T02`, … identifier that is never renumbered.
- Simple tasks remain numbered checkboxes in `feature.md`.
- Complex tasks, spikes, low-level designs, and verifier work receive linked task notes.
- Issues are temporary problem, decision, or investigation records.
- Keep an issue under its owning feature when known. Use the project-level `issues/` directory only for cross-feature
  or not-yet-owned work.

For this repository, inspect the request to locate its owning vault project. Neovim work normally belongs under
`1_projects/neovim/`; Pi and agent-customization work normally belongs under `1_projects/pi-agent/`. If ownership is
ambiguous, confirm it before creating a new project or feature.

## When a Skill Says "Publish to the Issue Tracker"

- For durable capability or specification work, create or update the owning `feature.md`.
- For concrete implementation work, add the next stable `TNN` checkbox to the feature.
- Create a linked task note when the work needs more detail than one checkbox and a few nested bullets.
- For a temporary problem, decision, or investigation, create an issue note under the owning feature.
- If feature ownership is unknown, create the issue under the owning project's `issues/` directory.
- Never create a GitHub issue.

## When a Skill Says "Fetch the Relevant Ticket"

Read the referenced vault path directly. If given only a stable task number, start at the relevant feature checklist
and follow its linked task note. Read the project README, theme, and feature before acting.

## Status

Feature task checkboxes are authoritative:

- `[ ]` — pending
- `[-]` — in progress
- `[x]` — done

Keep linked task-note frontmatter synchronized with the feature checklist. Derive feature status using the rules in
`1_projects/projects.md`. Preserve existing issue-frontmatter vocabulary rather than translating it into GitHub
labels.

## Wayfinding Operations

A Wayfinder effort lives in one `issues/<effort>/` directory:

- `map.md` contains the effort map.
- Numbered child files such as `01-<decision>.md` contain individual decisions.
- Start at project level only when feature ownership is unknown.
- Move the complete effort directory beneath the selected feature when ownership becomes clear.

## Vault Rules

Follow the vault's own `AGENTS.md` and `CLAUDE.md`. Keep vault changes separate from this repository's Git history.
After structural project edits, run `/Users/aviral/vault/scripts/verify-project-structure`.
