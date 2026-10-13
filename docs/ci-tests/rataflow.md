# rataflow-view — CI test suite

## Purpose

This suite guards the `rataflow-view` live node-graph viewer: the crate at
`rataflow/`, the ratatui `visualize` skill, the vendored `artifact` skill,
and the wiring that installs them. The Rust crate owns behavior (spec
parsing, graph building, headless rendering); this suite owns packaging
and wiring, so an offline CI runner can verify every change to those
paths.

## Overview

`rataflow-view` renders a JSON node/edge spec as a live, pannable node
graph in a herdr pane — the ratatui surface the mermaid skill cannot
serve — with gruvbox styling and animated flow dots on edges that carry
movement. The `visualize` skill documents it; the vendored `artifact` skill
(upstream careerhackeralex/visualize, renamed) routes graph-shaped
requests to it by default and builds single-file HTML for everything else.

## What the suite covers

- Example specs. Every file in `rataflow/examples/` (`pipeline.json`,
  `network.json`) parses as JSON and validates against the spec schema:
  known top-level fields only, `direction` in `{tb, lr}`, `theme` in
  `{gruvbox, dark, light}`, unique non-empty node ids, non-empty edge
  endpoints, at least one edge, and `flow` (when present) equal to `true`
  or a positive number.
- Skill spec block. The `json` block documented in the `visualize` skill's
  SKILL.md validates against the same schema, so the docs cannot drift
  from the format the binary accepts.
- Skill frontmatter. `name: visualize` and a non-empty description.
- Manifest. `Cargo.toml` parses; package `rataflow-view`; dependencies
  rataflow, ratatui, serde, serde_json, anyhow; edition 2024.
- Lockfile. `Cargo.lock` parses and pins rataflow 0.1.x and ratatui 0.30.x.
- Install wiring. `install.sh` builds the crate through
  `cargo install --path "$DOTFILES_DIR/rataflow"`.
- Gitignore. `/rataflow/target/` is ignored.
- Artifact customization. The vendored
  `agents/.agents/skills/artifact/SKILL.md` (upstream careerhackeralex/
  visualize, renamed to artifact) keeps its local changes: the
  "Pick the surface first" routing section with the visualize/rataflow
  default, the `terminal-browser open` step, the `artifact` frontmatter
  name, and the upstream provenance line. A plain re-vendor from upstream
  drops these; the check catches the drift.
- Cargo tests (opt-in). `RATAFLOW_BUILD=1` runs `cargo test --offline` in
  `rataflow/`: 30 tests — 16 spec/schema/theme/flow unit tests, 9 headless
  `TestBackend` render proofs (labels, plain canvas, node fills, gruvbox
  accent cycle, flow-dot motion), and 5 CLI tests exercising `--check`
  and `--help` through the real binary.

## How to run

    python3 scripts/test-rataflow.py

For the full local gate including the Rust tests (needs the cargo
registry cache from a prior build):

    RATAFLOW_BUILD=1 python3 scripts/test-rataflow.py

## Runtime and SLA

The offline checks complete in about 0.05 s. The opt-in cargo round adds
about 2 s after the first build (the first build of the dependency tree
takes minutes and needs the network). The suite writes nothing outside
`rataflow/target/` (cargo only).

## Coverage result

All offline checks pass on macOS python 3.9 (TOML checks SKIP) and on CI
python 3.12. `RATAFLOW_BUILD=1` passes with cargo 1.94 and a warm
registry cache: 16 lib + 9 render + 5 CLI tests, 0 failures.

## Known gaps

- The schema validator here mirrors `rataflow/src/lib.rs`; the Rust code
  is the source of truth. A rule change in Rust must be mirrored by hand
  in `ALLOWED_*`/`validate_spec` — the skill-block and example checks
  catch drift in the documented format, not in the enforcement.
- Rejection rules (unknown field, duplicate id, empty endpoint, unknown
  direction/theme, non-positive flow speed) are proven by the cargo
  tests, not by this suite.
- The live event loop (mouse, pan, zoom, quit, resize refit, flow-dot
  clock) has no automated test; it needs a real terminal. Verify it by
  hand after touching `src/main.rs`.
