# Round 02: one green case, and the failures narrowed to meaning and labels

**Result: 1/8 green (`modal-runtime`).** Round 01, on the same dataset, rubric,
and 77×47 target, was 0/8.

This round measured a **new baseline**: new renderer capabilities, a new skill
candidate, and a new judge model. It is not a skill-only improvement, and no
skill-only gain is claimed. What it does establish is that the four round-01
capability stops are gone: a skipped-label wall, geometry-derived color,
multi-dot motion, and unprovable selected borders.

## Final matrix

P = pass. F = fail. B = blocked. — = source-backed N/A.
A known failure still determines FAIL when another category is blocked.

| Case | Meaning | Arrows | Fit | Groups/color | Borders | Evidence | Animation | Overall |
|---|---|---|---|---|---|---|---|---|
| pipeline | P | P | P | P | P | P | **B** | **blocked** |
| network | **F** | P | P | P | P | P | **F** | **fail** |
| homelab-nic-trace | **F** | P | **F** | P | P | P | — | **fail** |
| server-nic-layout | **F** | P | **F** | P | P | P | — | **fail** |
| datacenter-redundancy | **F** | P | **F** | P | P | **B** | — | **fail** |
| modal-machine-manager | **F** | P | **F** | P | P | P | **F** | **fail** |
| modal-runtime | P | P | P | P | P | P | — | **pass** |
| gb300-rack-software | **F** | **F** | P | P | P | **B** | — | **fail** |

Of 51 applicable categories: **35 pass, 13 fail, 3 blocked** (round 01: 11 / 26
/ 14). Findings: **10 critical, 14 high, 2 medium** (round 01: 12 / 33 / 7).
450 evidence records were verified on disk by `scripts/viz-aggregate.py`, which
reported zero problems across all eight results.

## Category movement

| Category | Round 01 (P/F/B) | Round 02 (P/F/B) | Read |
|---|---|---|---|
| semantic_fidelity | 2 / 6 / 0 | 2 / 6 / 0 | **No change. This is now the whole problem.** |
| arrow_traceability | 4 / 4 / 0 | 7 / 1 / 0 | Routing work holds |
| layout_fit | 2 / 5 / 1 | 4 / 4 / 0 | Labels no longer on routes; coverage still fails |
| conceptual_grouping_color | 3 / 5 / 0 | 8 / 0 / 0 | Semantic groups work |
| border_integrity | 0 / 1 / 7 | 8 / 0 / 0 | `--select-all` closed the evidence gap |
| workflow_evidence | 0 / 2 / 6 | 6 / 0 / 2 | Harness binding works |
| animation | 0 / 3 / 0 | 0 / 2 / 1 | Evidence richer, motion still unprovable |

## What round 02 closed

- **Labels on routes: zero.** Every view in every case reports `0 on route
  cells`, and 20 of 21 views place every label. The single exception is
  machine-manager v2, and it fails loudly instead of drawing over a line.
- **Dot violations: zero.** One dot per route is now visible and countable.
- **Selected borders: complete.** 155 of 155 node occurrences across all cases
  have their own selected ANSI evidence, so the round-01 border blockers are
  gone rather than re-argued.
- **Color by concept: 8/8.** Groups are declared from the source, not derived
  from layout depth.
- **Crossings are crossings.** 12 datacenter and 13 gb300 crossings were all
  judged distinguishable from connections; no false junction was alleged.
- **Evidence binding: 6/8 pass.** Absolute binary hash, viewport token,
  timestamped frames, and proved pane closes are now routine.

## What still fails, and why

1. **Source-fact coverage across split views (6 cases).** Missing
   `100.113.153.49`, `172.18.2.1`, the `103.19.91` prefix, server2's R7725
   association, `boot.ipxe + S3 args`, `verify` inside `audit/verify reimage`,
   GB300 residency owners, and a reversed `deployed in`. The meaning ledger
   exists in the skill; the samples still drop rows.
2. **Label ownership (22 uncertain runs, 2 fused pairs).** `session` belongs to
   two candidate routes, `same /29` sits beside the wrong arrow, and `dualdual`
   is two labels with no separator. `--check` cannot see any of this: no label
   is on a route, none is skipped, and every hash matches.
3. **Animation direction (2 fail + 1 blocked).** On routes with two or three
   travel cells, dots alternate between sampled positions. Forward wrapping and
   back-and-forth are indistinguishable at 100 ms sampling. Four routes in
   machine-manager and four in runtime did not move at all across five frames.
4. **Trunk split point (gb300).** The trunk draws one bus with junctions, but
   each spur gets its own junction. The source asks for one split into three
   destinations, so the primitive is close but not sufficient.
5. **Explicit motion off (datacenter, critical).** The source said remove flowing
   dots; all 28 routes animate. One dot does not satisfy zero. This is an
   instruction-following defect, not a renderer gap.
6. **Reverse-label placement (machine-manager).** A `tb` route going back up
   skips its label. Captain-verified reproduction: two nodes, two opposite edges,
   `labels: 0/2 placed` in `tb`, `2/2` in `lr`.
7. **Evidence records (2 blockers).** Datacenter lost cleanup records for three
   claimed panes; gb300 lost rejected-check logs and probe closure.

## Attribution

| Change | Owner |
|---|---|
| Label cells reserved, no fusion detection | renderer + `--check` |
| One-dot count and cadence | renderer |
| Semantic group colors | renderer + skill declaration |
| Selected-border and motion evidence | harness |
| Meaning ledger not enforced at the end | skill |
| Explicit "no motion" ignored | skill |
| Trunk single split point | renderer |
| Label ownership and uniqueness | both |

## Next round, if one runs

1. **Renderer:** single split-point trunk mode; label uniqueness and
   adjacency-fusion diagnostics in `--check`; fix reverse/upward `tb` label
   placement; give `dots: 1` a direction-bearing path so 2-cell routes are
   provable, or refuse to animate routes shorter than four cells.
2. **Skill:** enforce the ledger as a completion gate, not an opening ritual;
   honor explicit "no dots"; one label string per edge, never two adjacent
   identical strings; carry identifiers into whatever view has room.
3. **Harness:** resolve the pane rectangle from the owned pane id; require
   cleanup records and rejected-check logs; add a label-ownership check.

## Cost

18 sessions: 8 DeepSeek generators **$1.64**, 8 Sol judges **$5.08**, renderer
worker **$0.48**, captain delta **$0.33** — **$7.54 total** (round 01: $89.73).

## Frozen identities

| Input | SHA-256 |
|---|---|
| Candidate skill | `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| Renderer binary | `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| Renderer source digest | `f01fdc7dc41eb26e56068353e0ef87a587f8813127f79c4af02bbb32cca65c26` |
| Rubric | `555e3b1d5881449b79eb1dc1d9538df2c4fe0880aa850becbf9060c1bf42f86f` |
| Dataset | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` (unchanged from round 01) |

Blind records are unchanged and hashed in `matrix.json`. No global skill install
occurred; the working-tree and globally installed skills still point at the
round-01 era. The candidate remains `proposals/03/SKILL.md`, tested via
`rounds/02/SKILL.md`.
