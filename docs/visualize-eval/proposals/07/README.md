# Proposal 07 — category-aware generation (round 09)

Built on proposal 06, byte-for-byte except for one new first step, one
per-family recipe block in the layout step, and one sentence in the
capture step.

## Driver

Round-07's pilot and the round-05 layout analysis agree on one cause: a
single layout recipe is applied to six structurally different sources.
Rank = graph depth flattens parallel planes; a mesh's anti-parallel pair
gets split across views; a fabric's independent redundancy gets bundled;
an identity-heavy source loses addresses while its geometry is clean. The
recorded taxonomy (`state.json`, `diagram_taxonomy_2026_11_02`) fixes the
six families and their signatures, and the per-family levers.

## What changes relative to proposal 06

| Change | Where |
|---|---|
| **Step 0 — classify first**: six families, signatures, frozen cases, tie-breakers, one required evidence line | new section before the meaning ledger |
| **Family recipes** replacing the generic placement guidance: chains → corridor widths; meshes → fan port order + anti-parallel pair co-viewed; fabrics → `layers` rank pins + parallel-link lanes, never trunks; lifecycles → phase-ordered ranks + one dot per line; planes → side-by-side subgraph regions + bus splits once; identity-maps → identifier/qualifier coverage rows before any spec | Step 7 |
| Family line recorded with the captures so `category_fit` is checkable | Step 8 |

Nothing is removed: the meaning ledger, relationship audit, conceptual
grouping, capability preflight, spec format, motion rules (constant
default, same-arrival opt-in, dots only where the source animates), sizing
and split coverage, evidence recipe with claims-cite-captures, independent
review, and repair rules all stay as in proposal 06.

## Rubric counterpart

Revision 7 adds `category_fit`: the chosen family must match the source's
structure (judged from captures plus the stated evidence line), and the
family's recipe must be applied. A wrong family, or a right family with an
unapplied recipe, fails that category.

## What this proposal does not do

- No renderer change. Every lever the recipes use (`trunks`, `dots`,
  `style`, `group`, `layers`, `direction`, splits) already exists in the
  frozen round-05 binary.
- No new evidence requirement; the standing capture recipe proves or
  refutes each recipe claim.
