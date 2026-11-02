# datacenter-redundancy — round 05 generation

Generator: fresh DeepSeek worker (`fireworks/accounts/fireworks/routers/deepseek-flash-latest`).
Candidate skill `docs/visualize-eval/rounds/05/SKILL.md` sha256 `ff4a9d3f…a949`.
Frozen binary `/tmp/visualize-eval/round-05/bin/rataflow-view` sha256 `b1ab9f2e…2404` (re-verified by `shasum` and re-recorded in every `evidence/<view>/bin.sha256`).

## What was built

Three engine-placed views, `lr`, no dots, no trunks, 28 links covered.

| view | carries | spec | nodes/edges | extent | crossings | labels |
|---|---|---|---|---|---|---|
| v1 | ISP tier → MUX tier → core tier (e1–e8) | `specs/v1-wan-mux-core.json` | 8 / 8 | 45×39 | 1 bridge, 1 touching bend | 4/4, 0 ambiguous |
| v2 | core → active/passive FW pair → border leaves → spines (e9–e20) | `specs/v2-fw-border-spine.json` | 8 / 12 | 68×20 | 3 bridges, 3 touching bends | 12/12, 0 ambiguous |
| v3 | spines → rack leaves → racks (e21–e28) | `specs/v3-fabric-leaves-racks.json` | 6 / 8 | 49×20 | 2 bridges, 2 touching bends | 8/8, 0 ambiguous |

Crossing counts are the structural minimum: one bridge per 2×2 cross-connect tier
(1 + 3 + 2 tiers), so there was nothing left to lower and the third attempt slot
per view was not spent.

## The one real finding: tb cannot route this topology

Attempt 1 of every view was `tb` (the orientation the skill recommends for 4-rank
chains) and the router refused it before printing a single check line:

```
checks/v1-a1-tb-check.txt: rataflow-view: no obstacle-safe route for mux2 -> core1; increase node/layer spacing
checks/v2-a1-tb-check.txt: rataflow-view: no obstacle-safe route for core2 -> fw2, fw1 -> bl1, bl2 -> sp2; increase node/layer spacing
checks/v3-a1-tb-check.txt: rataflow-view: no obstacle-safe route for sp2 -> leaf1, leaf2 -> rack2; increase node/layer spacing
```

Attempt 2 changed **only** `direction` (`tb` → `lr`); nodes, edges, labels and
groups are byte-identical otherwise. All three views routed. This is recorded as
blocker **B1** — a limitation of the frozen binary for a braided 2-source/2-target
tier, not a spec bug, and not something a different split fixes (every tier of
this topology is a 4-link braid).

The cost of the workaround is defect **D1**: `lr` cannot express the source's
"spine above the leaf, border leaf level with the rack leaf" correction, because
ranks follow the audited endpoint direction `bl → sp → leaf → rack`. Honoring it
would need reversed endpoints (forbidden by the case's fixed constraints) or
explicit placement (excluded by round-05's engine-owned placement rule).

## Case rules, checked

- **No dots anywhere** (source line 134 forbids them): `dots: 0` on all 28 edges,
  no `flow`, no `timing`. Every check line reads
  `0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step,
  0 same-arrival at 2000ms`, and `origins: 0/0` / `arrivals: 0/0`.
- **Frames for every view**: 5 timestamped frames per bundle; all five frame
  bodies are byte-identical (nothing moves). Pinned target-size dumps
  (`COLUMNS=77 LINES=47 … --frames 5`) ship alongside with the same property.
- **Redundant links stay individually traceable**: no `trunks` field in any spec
  (`trunks:` prints empty). Frame-0 audit of the pinned dumps counts arrowheads
  adjacent to each box border: every receiving box has exactly **two** heads at
  two different port rows (MUX 1 heads at (13,33),(15,33); Core 1 at
  (13,49),(15,49); FW1 at (27,24),(29,24); FW2 at (17,24),(19,24); BL 1 at
  (17,42),(19,42); Spine 1 at (27,60),(29,60); Leaf 1 at (17,33),(19,33);
  Rack 1 at (27,51),(29,51) …), totals 8 + 12 + 8 = 28 heads for 28 links.
- **Standby links dashed with uncertainty in the text**: the four
  active-passive links are `style: "dashed"` and labelled `standby?`. Dashed runs
  are visible in v2 frame 0 at row 17 cols 15–23 and cols 30–41, and as vertical
  `╎` runs at rows 21–25 cols 20 and 32; the active FW1 links are solid.
- **Repeated labels**: `x-connect` ×4, `active` ×4, `standby?` ×4, `ECMP` ×8,
  `dual` ×4 all read **0 ambiguous owners** — nothing had to be recorded as an
  ambiguous-owner defect.
- **Never merge mux1/mux2 or core1/core2 arrows**: one edge per link, separate
  arrowheads per receiving box, proven above.
- **Arrow convention**: arrows trace each link from the first-listed to the
  second-listed endpoint exactly as audited; they are physical links, not traffic
  direction, and no endpoint was reversed to fit the layout.

## Sizes, honestly

The harness half-pane measures **83×51** in this tab (`83x51 @100%` header token
in every `evidence/<view>/<view>-text.txt`), not 77×47. Every extent fits inside
77×47, and each view ships a pinned dump whose first line is
`viewport: 77x47 zoom: 1.00 natural` with no `overflows` badge, so fit at the
target is proven by the pinned dump and not by relabelling the pane (defect D4).
Extents: 45×39, 68×20, 49×20; the widest is v2 at 69 columns of drawn content.

`scripts/viz-validate.py … --require-select --require-frames --attempts attempts.json`
now reports **32 PASS / 0 FAIL** for each of v1, v2, v3
(`evidence/<view>/validate.txt`).

## Defects carried forward

- **D1** vertical elevation (spine above leaf) not expressible — see above.
- **D2** within-rank order flips between views: v2 draws Spine 2 above Spine 1
  (y=16 vs y=26), v3 draws Spine 1 above Spine 2. Engine barycenter order; not
  reordered by hand.
- **D3** corners/elbows (`╭ ╮ ⌒`) do not carry dash style, so "standby" is
  proven on straight runs and in the label text only.
- **D4** live pane measured 83×51; target-size fit rests on the pinned dumps.

## Unmet needs (blockers)

- **B1** tb orientation refused by this binary for every braided tier (raw
  refusals preserved in `checks/*-a1-tb-check.txt`); `lr` used as the workaround.
- **B2** no spec field controls node box height, so the source's "reduce the
  individual box height" (line 166) cannot be expressed; boxes stay 5 rows.

## Files

```
attempts.json                     two attempts per view, raw check per attempt
attempts/v1-a1-tb.json …          rejected tb specs (raw refusals in checks/)
attempts/v1-a2-lr.json …          routed lr specs (byte-identical to specs/*)
checks/v1-a1-tb-check.txt …       raw stderr of every rejected attempt
checks/v1-a2-lr-check.txt …       full --check stdout of every accepted attempt
specs/v1-wan-mux-core.json        final specs (sha recorded per view)
evidence/<view>/                  manifold: check.txt, text, ansi, selected ansi,
                                  frames, pinned 77x47 frames, manifest, validate
evidence/<view>-pin77/            original pinned dumps (copy inside bundle above)
generation.json                   machine-readable record of all of the above
```
