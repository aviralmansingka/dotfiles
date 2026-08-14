# Vault feature model

## Canonical hierarchy

```text
/Users/aviral/vault/projects/
  projects.md
  <project>/
    README.md
    themes/
      <theme>/
        theme.md
        features/
          <feature>.md
        themes/
          <nested-theme>/
            theme.md
            features/
              <feature>.md
    issues/
      <issue>.md
```

The active project roots currently include `projects/neovim/` and `projects/pi-agent/`. Discover current projects from
`projects/projects.md`; do not bake that inventory into new logic.

## Vocabulary and ownership

- **Project:** durable body of work with a stable purpose.
- **Theme:** project area grouping related user-facing workflows or capabilities.
- **Feature:** concrete capability that can change and be validated independently. This is the canonical
  project-management unit.
- **Task:** checkbox inside a feature.
- **Validation:** explicit evidence required before the feature is complete or considered working.
- **Issue:** temporary implementation or investigation record. Promote durable discoveries into the feature.
- **Source Inventory:** external or generated inventory of current behavior that the project should represent.

Use these terms. Avoid replacing them with epic, category, component, or checklist.

## Navigation

1. Read `projects/projects.md` for semantics.
2. Read the project README for themes, source inventory, implementation roots, and current work.
3. Read the owning `theme.md` for scope, feature links, exclusions, and neighboring owners.
4. Read the feature file for purpose, goal, behavior, tasks, validation, and sources.
5. Follow only directly relevant wikilinks.

Search by filename first:

```sh
rg --files /Users/aviral/vault/projects | rg '/features/[^/]+\.md$'
```

Then search feature content and parent links:

```sh
rg -n -i '<feature words>' /Users/aviral/vault/projects
```

## Boundary rules

- If a capability has independent behavior and validation, give it its own feature.
- Keep shared capabilities in the owning general theme; keep nested-theme feature files limited to variant-specific
  behavior and overrides.
- Split adjacent workflows when ownership differs. For example, editor Git support and PR code review are separate
  features.
- Keep context transfer, session lifecycle, backend behavior, and inline ask/edit in separate agent features.
- Put implementation orchestration in the project that owns the workflow. Document adapter behavior in the adapter's
  project without duplicating workflow ownership.
- Keep exploration in `issues/`; update features with durable conclusions only.

## Feature note contract

A feature file should contain enough of:

```markdown
# Feature Name

## Purpose

## Goal

## Current Behavior

## Keymaps

## Tasks

- [ ] Concrete completion task

## Validation

- Exact command or observable evidence

## Sources
```

Do not add empty sections merely for uniformity. Preserve the note's existing voice and structure.

`Purpose` explains why the capability exists. `Goal` describes the current-state user capability, preferably
`Users can...`; it is not roadmap prose.

## Evidence update

After implementation passes:

- revise `Current Behavior` from observed reality
- mark tasks complete or deliberately deferred
- retain unresolved bugs; do not bury them in a success summary
- move resolved bugs to a dated resolved section
- record deterministic and live validation separately
- include exact commands, terminal outcomes, commit/branch when useful, and any remaining gaps
- keep paths and wikilinks accurate

For UI-visible Neovim changes, distinguish:

- deterministic headless evidence
- live Neovim integration evidence
- Neovim-scoped visual evidence

For vault/Obsidian behavior, validate against the real vault rather than a synthetic repository.
