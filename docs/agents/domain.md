# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- Relevant ADRs under `docs/adr/`.

If either location does not exist, proceed silently. Domain documentation is created lazily when terminology or
architectural decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── ...
```

`CONTEXT.md` owns the shared domain language. `docs/adr/` contains repository-wide architectural decisions.

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, specification, refactor proposal, hypothesis, or test name—use
the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether the term belongs to the project. If it represents a real gap,
record it for the `/domain-modeling` workflow.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding the
decision.
