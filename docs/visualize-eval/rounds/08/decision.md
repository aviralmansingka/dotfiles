# Round 08 decision

## Outcome

**0/8 green. 17 pass / 40 fail / 5 blocked of 62 applicable categories.
8 critical, 38 high, 10 medium.** Aggregation validated all eight
terra-judged results with zero problems. Frozen inputs: skill `b1bdb4d3…`
(category-aware proposal 07), binary `ea24593b…` (`/tmp/visualize-eval/round-08/bin/rataflow-view`
— the merged off-by-one + structural-merge baseline), rubric revision 8
`ef092e34…` (terra:high judges + category_fit), dataset unchanged.
Generators: DeepSeek (fireworks). Judges: **gpt-6.1-terra:high** — the
first terra-judged round, and the first with eight categories.

## Verdict matrix (P/F/B, — = source-backed N/A)

| Case | Sem | Arr | Fit | Grp | Brd | Wfl | Anim | CatFit | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| pipeline | P | F | B | F | P | B | F | P | FAIL |
| network | P | F | F | F | P | B | F | F | FAIL |
| homelab-nic-trace | F | P | F | F | P | F | — | F | FAIL |
| server-nic-layout | F | P | B | P | P | F | P | F | FAIL |
| datacenter-redundancy | F | F | F | F | P | B | **P** | F | FAIL |
| modal-machine-manager | F | F | F | F | F | F | F | F | FAIL |
| modal-runtime | F | P | F | F | P | F | — | F | FAIL |
| gb300-rack-software | F | F | F | F | P | F | P | F | FAIL |

## Movement against round 05 (0/8; 20/24/8 of 52)

- **Verdict-confirmed closures (the sprint's purpose):** datacenter's
  rank pins — spines above the common leaf row (round-05's hardest
  blocker); gb300's one-junction trunk (the split-once demand);
  datacenter's and gb300's animation passes (no-dots held); server's
  grouping pass (distinct region hues, the collision fixed in practice);
  pipeline's and machine-manager's category_fit passes (the family line
  works); machine-manager's carried labels all survive
  (`boot.ipxe + S3 args`, `reimage`, `pull image`).
- **Regression concentration:** the region-geometry family (slivers,
  corners, containment, glyphs overwriting titles) now fails grouping in
  five cases — the merge shipped regions whose box pass is broken for
  2+ groups and multi-rank shapes. The single-dot origin defect
  (frame-0 dots one cell late) is verdict-confirmed in pipeline,
  network, and machine-manager — the fix covered the train path and its
  own fixture, not the `dots: 1` drawing path.
- **New structural findings from the field:** in-band multi-edge fans
  cannot reach 0 ambiguous owners (ports 2–3 cells apart vs a label at
  `len/2+1+gap` — datacenter, machine-manager); label sizing makes
  one-view anti-parallel pairing impossible (runtime) and eats labels
  in tb rank gaps (shortenings in three cases); `EdgeSpec.label_slot`
  is dead code.
- **Recipe-vs-capability conflict:** the service-mesh recipe demands the
  anti-parallel pair in ONE view; the renderer cannot do it; round-07's
  judge ruled the split acceptable, round-08's failed it. Recipes must
  yield where the renderer is structurally incapable, or the sizing fix
  must land first.
- **Workflow remains the chronic gap:** no measured live 77×47 panes,
  missing probe/status bytes, an unproven fifth pane, frame-truncated
  pane captures. Same family as rounds 05–07.

## Root causes, ranked for round 09

1. **Region geometry** (five cases' grouping): the region box pass —
   slivers outside members for 2+ groups, cornerless outlines, glyphs
   overwriting titles, multi-rank containment. Highest verdict cost.
2. **Single-dot origin** (three cases' animation+arrows): wire the one
   shared origin definition into the `dots: 1` drawing path.
3. **Label slots/sizing**: wire the dead `label_slot` mechanism;
   horizontal gutter reservation instead of rank-row height; enables
   one-view pairing and un-shortened labels.
4. **Recipe yields + source-semantic shades**: recipes yield where
   the renderer is structurally incapable; shades required whenever
   the source names tiers (pipeline's grouping fail).
5. **Evidence recipe**: live-pane 77×47 proof (or an explicit
   harness rule that pinned dumps substitute), full probe/status bytes.

## Stop-rule assessment

Continue to round 09. This candidate moved real blockers (pins, trunk,
carried labels, no-dots) but regressed grouping through the broken
region pass — a bounded, well-understood fix list. No unsupported
capability blocks progress.

Manual human review of round 05 vs round 08 is open (seven tabs now;
machine-manager's joins on aggregation completion); revision work starts
after feedback lands in `rounds/08/human-review/feedback.md`.
