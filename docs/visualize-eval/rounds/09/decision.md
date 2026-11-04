# Round 09 decision

## Outcome

**0/8 green. 20 pass / 33 fail / 7 blocked of 60 applicable categories
(8 critical, 28 high, 12 medium, 1 low).** Aggregation validated all eight
terra-judged results with zero problems. Frozen inputs: skill proposal-08
`ba2878c5…` (regionless, yields, label_slot), binary `405a61a6…`
(off-by-one + struct-merge + region-removal + dots-labels merged tree at
`0d2a454c`), rubric rev 9 `10590383…` (terra:high, records requirement,
pinned fit-proof ruling, recipe yields), dataset byte-identical to round 08
(24/24 per-file hashes). Generators: DeepSeek. Judges: gpt-6.1-terra:high.

## Movement against round 08 (categories P/F/B, 8 cases)

| Category | Round 08 | Round 09 | Movement |
|---|---|---|---|
| semantic_fidelity | 2/6/0 | 1/7/0 | −1 (repeated omissions) |
| arrow_traceability | 3/5/0 | 3/5/0 | flat (new cause: gutter ownership) |
| layout_fit | 0/6/2 | 2/6/0 | **+2P, blocks cleared** (pinned ruling) |
| grouping/color | 1/7/0 | 2/6/0 | +1 (regionless contract + no slivers) |
| border_integrity | 7/1/0 | 7/1/0 | flat (mm fail is clipping-driven) |
| workflow_evidence | 0/5/3 | 2/2/4 | **first workflow passes**; blocks → full-lap gap |
| animation | 3/3/0 | 1/0/3 | defects → evidence gaps (full-lap capture) |
| category_fit | 1/7/0 | 2/6/0 | +1 (one-view pair landed in runtime v3) |

Net: passes 17→20, fails 40→33, and every remaining failure now maps to a
named, evidence-backed fix rather than a mystery.

## What the round proved

- **Region removal worked**: zero region-geometry defects (round 08's
  biggest cluster — five grouping fails — reduced to zero box-related
  findings; grouping passes now hinge only on hue legibility and order).
- **The single-dot origin fix held everywhere**: no origin violations in
  any capture; independent blind judges verified frame-0 origins (network
  7/7). Round 08's verdict-confirmed defect is closed.
- **`label_slot` is decisive but two-faced**: it delivered the one-view
  anti-parallel pair (runtime v3, the round-08 recipe conflict — resolved)
  and 0-ambiguous layouts (network v3, server ×3), but four independent
  reports show it dead-ending ports on fans and adjacent same-rank targets.
- **The record wrapper works**: first-ever workflow passes (homelab,
  server); runtime's 40 raw hashes verified; datacenter's block is a
  discovered gap (executed spec not hash-bound), not missing discipline.
- **Pinned fit proof works**: layout blocks became passes (pipeline,
  network); the remaining fit fails are real overflows (mm v2 52×53, v3
  80×31), honestly bannered.

## The three defect clusters behind the remaining fails

1. **Gutter label ownership** (checker-vs-reader): labels in
   `label_slot` gutters sit nearer a parallel route than their own
   (network 4, runtime 2, homelab 1, server 1, mm several); the checker
   reports 0 ambiguous everywhere. Verdict-level in three cases.
2. **Repeated semantic omissions**: the same source facts lost across
   two consecutive rounds — homelab (router role, pool IP, "no committed
   rate"), server (gateway role, Dell/NxtGen), gb300 (direct RMS-to-device
   APIs), mm (humans/mmctl, web→wapi, pgrpc→db, pub→db). Generators
   disclose them as layout-driven drops; judges rule them required.
3. **Hue collisions from name-derived colors**: pipeline, network,
   runtime, mm (4 tags ≤3 hues). No collision-avoidance pass exists.

Plus: backward-edge lanes (datacenter, 2 rounds), the trunk-junction
shared-cell warning (gb300), full-lap frame budget (3 blocked), record
overwrite + spec-binding (harness), and the never-drop skill rule.

## Round-10 candidate list (evidence-backed)

Engine/checker: gutter-to-route association (per-route gutters or leader
ticks) + a reader-calibrated ownership metric; hue collision pass;
backward-edge lanes inside pinned ranks; trunk-junction exemption from the
shared-cell warning. Harness: record-mode spec-argument hashing + unique
raw filenames; full-lap frame formula (`ceil(len/0.5)` frames at constant
speed). Skill: never-drop rule for source-stated facts; coverage map must
name every source fact before layout.

## Stop-rule assessment

Continue to round 10. The failure surface shrank and sharpened: three
clusters plus two mechanical harness bugs account for nearly every
remaining category fail. No unsolved mystery remains; every item carries
coordinates and a reproducing case. Human review tabs (round 08 left vs
round 09 right) open next; feedback to `rounds/09/human-review/feedback.md`
before revision begins.
