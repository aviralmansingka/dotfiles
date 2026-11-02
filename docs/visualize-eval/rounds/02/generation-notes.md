# Round 02 generation notes

Generator self-reports only. These are **not** verdicts; the eight Sol judges
decide. Recorded here so a blocker is not lost between arrival and aggregation.

## Capability use

| Case | group | trunks | dots: 1 | dashed | Views |
|---|---|---|---|---|---|
| pipeline | yes, 4 families | not needed (no shared bus) | yes, 6 routes | not needed | 1 |
| network | yes | not needed | yes, 7 routes | not needed | 2 |
| server-nic-layout | yes, 4 families per view | attempted, **routing refused** | yes | yes, 2 edges in v1 | 2 |
| gb300-rack-software | yes, 4 families | yes, `oob_lan` with 2 branch spurs | yes, 11 routes | yes, `drvk → fm` | 2 |
| modal-runtime | yes, 5 families | not needed (two independent relations) | yes, 16 route-instances | not needed | 3 |
| modal-machine-manager | yes, 5–6 families per view | not needed | yes, 8 routes | yes, qualified edge | 4 |
| datacenter-redundancy | yes, 6 families | not needed (independent links must not merge) | yes, 28 routes | yes, 4 standby paths | 4 |

Pending: homelab-nic-trace.

- **modal-machine-manager — v2 fails three harness checks.** `boot server → machines`
  renders route, arrowhead and dot, but its label has no legal cell, so
  `labels: 4/5 placed, 1 skipped` and the bundle fails `check_warnings_absent`,
  `labels_complete` and `labels_not_skipped`. The worker kept the honest result
  at its third attempt instead of spending a fourth. **Captain-verified**: a
  minimal two-node, two-opposite-edge spec in `tb` skips **both** labels
  (`labels: 0/2 placed`), while the same spec in `lr` places **2/2**. This is a
  real label-placement defect in the frozen baseline, not a width problem, and
  it is a round-03 renderer fix. The baseline stays frozen for this round.
- **modal-machine-manager — backward edge across a skipped layer** in `lr`
  hard-fails with `no obstacle-safe route for mch -> s3`; the sample therefore
  runs all-forward in `tb`.

## Generator-reported gaps and defects

- **datacenter — two labels fused into one word.** Compact variants rendered
  `activeactive`, two `active` labels adjoining on one band. `--check` cannot
  see it: neither label is on a route cell and neither is skipped. The worker
  rejected those variants and re-laid them out, but the defect is real and only
  a reader or a judge catches it.
- **datacenter — perimeter detour.** v3's border-leaf cross-connect takes a
  long perimeter route, and its ECMP labels sit in the densest band.
- **server-nic-layout — trunk routing failure.** The only candidate bus
  (`nic → s2`, `nic → spare`) was refused with `no obstacle-safe route`. A trunk
  whose branch nodes sit close together can therefore be unimplementable even
  when the schema accepts it. Recorded as a renderer gap, not a skill defect.
- **server-nic-layout — trunk spurs carry no label or style.** `SpecTrunk`
  branches are bare node ids, so a qualifier that belongs to one branch cannot be
  expressed. Same root cause as the `/29` qualifiers.
- **server-nic-layout — families are positional.** Two views with disjoint group
  sets reuse the same two hue families, so a concept's color is not stable across
  views. The skill never promised global stability; noted for round 03.
- **modal-runtime — long seam phrases do not fit.** 25–32 character labels have
  no legal cell beside parallel worker↔runtime corridors at 77 columns, so the
  meaning was split across views instead of skipped.
- **gb300 — no negative-link field.** "OOB does not reach DCGM" can only be
  shown by absence plus prose; the renderer has no way to draw a stated
  non-connection.
- **gb300 — zero margin.** v1 extent is exactly 77 columns, the full pane width.
- **gb300 — trunk splits twice.** Three destinations (compute BMC, NVSwitch BMC,
  power shelf) produced two junctions. The source asks for one split; the judges
  must decide whether two junctions satisfy it.
- **network / others — `pane_cols: null`.** Harness limitation. The app's own
  `77x47 @100%` token and `viewport:` line remain the authority.

## Contrast with round 01 on the same cases

Round 01 recorded skipped labels in machine-manager, label-covered routes in
datacenter, geometry-derived color in five cases, and multi-dot motion in all
three animated cases. Every round-02 sample so far reports 0 skipped labels,
0 labels on route cells, 0 dot violations, and semantic groups. Whether that
survives a judge reading the captures is the open question.
