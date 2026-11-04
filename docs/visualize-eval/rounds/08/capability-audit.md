# Round 08 capability audit — merged renderer baseline

Frozen binary: `/tmp/visualize-eval/round-08/bin/rataflow-view`
Binary sha256: `ea24593b0f80c161…` — source digest `a8c0207b41ba03fa…` (formula in metadata).
Candidate skill: `SKILL.md` sha256 `b1bdb4d3d38336cb…` (proposal 07 — category-aware:
classify-first Step 0 + per-family recipes). Rubric revision 8 sha256 `ef092e343d622654…`
(terra:high judges + category_fit). Dataset unchanged since round 02.

## What this baseline carries (merged from both parallel branches)

- **Off-by-one fix (feat/off-by-one):** ONE origin definition shared by
  render and check — the frame-0 dot sits exactly on the first drawn
  route cell after the border port, corner glyph included; `origins: N/N`
  measures that same cell. Render-level frame-zero test with a
  corner-first fixture, both timing modes.
- **Structural merge (feat/struct-merge):** groups as bordered, titled
  subgraph REGIONS (name-derived hues, compactness charge, blank-cell-only
  painting, region-disjointness pass giving siblings disjoint column
  ranges); `layers` as engine-honored rank pins with honest
  `pins-conflict:` reporting (barycenter still owns within-rank order);
  `minlen` 1..=8 edge rank gaps; one GLOBAL sibling block order so
  groups never swap sides across ranks.

## Gates (captain-verified on the merged tree)

89 tests passed / 0 failed (43 lib + 5 cli + 41 render — the five merge
fixtures plus the recovered frame-zero test); clippy `-D warnings` clean;
`fmt --check` clean; `--locked --release` build clean.

## Honest limits

- Region disjointness is column-range based; extremely asymmetric member
  spreads across ranks widen regions into blank space (extent grows
  honestly) rather than failing.
- A pins/minlen conflict is reported, never silently resolved.
