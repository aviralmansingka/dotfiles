# network — round 08 generation record

**Family:** `service-meshes`
**Evidence:** 6 nodes / 7 relations (E > N) around a core switch; the core fans to web and Redis,
web fans to Redis and DB, and the two relations into Redis (`core→cache` 25 GbE, `web→cache`
session) converge on one box — the family's converging pair. Motion is a source signature (live
dots on every link), which rules out redundant-fabrics.

Frozen inputs (verified with `shasum -a 256`):
`docs/visualize-eval/rounds/08/SKILL.md` = `b1bdb4d3d38336cb…`,
`/tmp/visualize-eval/round-08/bin/rataflow-view` = `ea24593b0f80c161…` (absolute path in every command).

## Views

| view | file | direction | extent | crossings | labels | origins | viewport |
|---|---|---|---|---|---|---|---|
| v1 WAN ingress path | `v1.json` | lr | 76x6 | 0 bridges | 3/3, 0 ambiguous | 3/3 | pane 83x51, pinned 77x47 |
| v2 tier mesh | `v2.json` | tb | 28x31 | 1 bridge | 4/4, 0 ambiguous | 4/4 | pane 83x51, pinned 77x47 |

Full `--check` lines live in `evidence/v1/check.txt` and `evidence/v2/check.txt`; every attempt's raw
output is in `attempts/`. No warnings in either final check.

## Why two views (blocker b3)

One 77x47 view of all six nodes does not fit: the tb overview measured `extent=34x69`
(`v1-attempt1.json`), and an lr six-rank layout needs ~95–110 columns once each hop label gets its
slot. The split follows the source's two relation families, and the round-07 requirement — the
front path stays whole in one view — is met by v1: `wan → fw → core → web` with `1 GbE`, `10 GbE`,
`10 GbE` all in one picture. `core` and `web` are the shared boundary nodes; `e3 (core→web)` is
carried once, in v1, so v2 stays a 3-rank mesh instead of a 4-rank chain.

## Relationship audit → visible relationship

| id | from → to | label | owner | view | visible at (capture) |
|---|---|---|---|---|---|
| e1 | wan → fw | 1 GbE | e1 | v1 | arrow row 22 cols 11-18, label row 21 |
| e2 | fw → core | 10 GbE | e2 | v1 | arrow row 22 cols 29-37 |
| e3 | core → web | 10 GbE | e3 | v1 | arrow row 22 cols 51-59 |
| e4 | core → cache | 25 GbE | e4 | v2 | col 26/29 rows 12-21, label row 16 |
| e5 | web → cache | session | e5 | v2 | col 42 rows 12-21, label row 19 |
| e6 | web → db | queries | e6 | v2 | col 44 rows 12-31, label row 26 |
| e7 | cache → db | fill | e7 | v2 | col 31 rows 26-32, label row 28 |

`e2`/`e3` share the source string `10 GbE` because the source repeats that speed on two hops; each
label sits on its own hop and `--check` reports 0 ambiguous owners. The fixed constraint that
`core→cache` and `web→cache` stay separate is met in v2: two edges, own ports, own labels, own dots.

## Structural levers (source-justified)

**v1** — region `network` = {wan, fw, core}: the three devices the source lists with link speeds;
renders as a titled bordered band (title row 20 cols 5-50) enclosing all three members. `layers`
omitted: the source states a traversal order, not a pinned rank geometry. `minlen` omitted: every
hop is between adjacent tiers. `trunks` omitted: no shared bus in the source.

**v2** — region `tiers` = {web, cache, db}: the three service tiers that carry the application
relations; renders titled (row 7 cols 29-51) with all three members inside. `layers` omitted (depth
is forced by the source's own relations); `minlen` omitted (the two stage-skipping hops already get
a 2-rank corridor); `trunks` omitted (a bus would fuse `core→cache` and `web→cache`, which the
source forbids).

**Motion (both views):** `flow: true` + `dots: 1` on all 7 routes, constant default 0.5 cells per
100 ms, no numeric rate — the source wants direction-of-flow dots and the fixed constraint forbids
reading motion speed as a measurement. Frame-0 → frame-5 → frame-10 dot positions in the pinned
dumps show every dot advancing equally (`v1`: cols 12/30/52 → 14/32/54 → 17/35/57).

## Honest defects

1. **v2 region overlaps an ungrouped node.** The `tiers` rectangle (rows 7-37, cols 29-51) covers
   part of the `Core switch` box (rows 8-11, cols 25-37), so the region's left wall only appears
   from row 12 and a non-member sits in its top-left corner. Removing the overlap needed a fourth
   rank (`v2-attempt3.json`), and the region-disjointness pass then rendered `tiers` as an **empty**
   column box (cols 46-49); attempt 1 lost the region title instead. Budget was spent.
2. **v2 has 1 bridge** where the two web-tier routes leave side by side (row 20, col 41 `⌒`).
3. **v1 is a wide thin strip** (76x6 on 77x47, one column of slack). Nothing clipped; the pane stays
   mostly empty because the engine centres it.
4. **Region borders break where a cross-region route crosses them** (v1 col 51; v2 row 20 col 29) —
   blank-cell-only border painting, not a missing edge.
5. **Dot-origin reading, open question.** `--check` reports `origins: 3/3` (v2 `4/4`) and the frame-0
   dots sit on the first route cell after the 1-cell port stub; if the stub itself counted as a drawn
   route cell, every frame-0 dot is one cell past it. Both readings recorded for the judge.

Blockers b1 (a one-member group's region detaches from its member), b2 (region titles are dropped
when a route runs along the top border row), b3 (no single-view fit) are recorded in
`generation.json`; the final views avoid b1/b2 rather than inventing groups around them.

## Verification

`scripts/viz-validate.py evidence/<view> --require-select --require-frames --attempts attempts.json`
→ **32/32 checks passed, 0 failed, "all checks passed"** for both views (`validator-v1.txt`,
`validator-v2.txt`). Fit at the target comes from the pinned `COLUMNS=77 LINES=47 --frames 21` dumps
of the final specs (`v1-77x47-frames.txt`, `v2-77x47-frames.txt`: 21 timestamped frames each,
`viewport: 77x47 zoom: 1.00 natural`, no overflow banner). Panes `w7E:pK7` / `w7E:pK8` closed,
cleanup `confirmed_closed` in both manifests.

No reviewer was spawned (round-08 reserves review for the captain's Sol judge).
