# datacenter-redundancy — round-10 generation report

Generator `viz-ds10-5`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Frozen inputs: candidate skill `docs/visualize-eval/rounds/10/SKILL.md`
(sha256 `9c1256791069e272…f77e56d`), renderer `/tmp/visualize-eval/round-10/bin/rataflow-view`
(sha256 `db70722b92777467…4cb0dfb92df8`). Every command below used that absolute path.

## Step 0 — family

```
family: redundant-fabrics
evidence: 18 nodes carry 28 links over six redundant tier transitions (E/N = 1.56),
          every tier target takes a double arrowhead — each core, each firewall, each
          border leaf, each spine, each rack leaf and each rack receives two separate
          links — and the user's own line 134 forbids motion ("remove the dots
          flowing for now"): dense, double-headed, static.
```

Tie-breakers rejected: flow-chains (E/N ≫ 1), service-meshes (no anti-parallel pair;
the constraints call these physical connectivity links), lifecycle-machines (no phase
order, no animation), placement-planes (no weakly-connected worlds, no source-named
bus), identity-probe-maps (device names only, no addresses/ports/qualifiers).
Secondary recipe: none — the source does not straddle a second family.

## Views (4 of 4 used)

| view | spec | carries | nodes × edges | extent | bridges | dots |
|---|---|---|---|---|---|---|
| v1 uplinks | `specs/v1-uplinks-final2.json` | ispA–D → mux1/2 → core1/2 | 8 × 8 | 48×29 | 1 | 0 |
| v2 security | `specs/v2-security-final.json` | core1/2 → fw1/2 → bl1/2 | 6 × 8 | 39×27 | 2 | 0 |
| v3 fabric | `specs/v3-fabric-final3.json` | bl1/2 ↔ sp1/2 → leaf1/2 | 6 × 8 | 48×16 | 6 | 0 |
| v4 racks | `specs/v4-racks-final.json` | leaf1/2 → rack1/2 | 4 × 4 | 30×15 | 1 | 0 |

Coverage: 8 + 8 + 8 + 4 = 28 links, all 18 nodes. Shared nodes (core, BL, leaf) keep the
same group and the same sibling order in every view.

## Recipe applied

Fabric recipe levers only: `layers` pins for the source's tiers in all four views,
independent parallel lanes (no trunk anywhere, line 270), two separate arrowheads per
target from two separate ports, and zero dots (line 134). v3 puts both spines above and
the border leaves at the *same* rank row as the rack leaves (line 248); the BL→spine
links are inside-hop back edges that turn inside the fabric band (glyphs `⌒` at rows
25–26, cols 42–46) instead of running on an outer rail.

## Recipe yield (measured, recorded)

The fabric recipe wants each redundant lane separately labelled (x-connect ×4,
active/standby ×8, ECMP ×8, dual ×4). Measured with the round-10 router:

* 4 duplicate labels on a cross → 2 ambiguous owners (v1-a1); a bare 4-node K2,2 with
  the same labels is worse: 1 label skipped, 2 ambiguous (`probe-cross-isolated`).
* 8 active/standby labels → 2 ambiguous (v2-a1); same in `lr` → 4 ambiguous (v2-a3-lr).
* 8 ECMP labels → 2 ambiguous (`probe-fabric-ab`); `label_slot` does not change it
  (`probe-fabric-ab-labelslot`).
* 4 dual labels → 1 ambiguous (`probe-racks`).

Calibration: **one** label, or the **two** labels of a single source fan, place with
0 ambiguous owners (`probe-racks-1label`, `probe-racks-2same-fan`). The shipped views
therefore print each uniform tier qualifier on one fan — v1 `x-connect` (1), v2
`active`/`standby` (2, plus the FW1 active / FW2 standby appliance text), v3 `ECMP` (2),
v4 `dual` (2) — and state the qualifier's tier scope here instead of repeating it on
lanes the router then reports as ambiguous. No link, node or qualifier is removed.

## Evidence

Per view: `evidence/<view>/` holds `check.txt`, `<view>-text.txt`, `<view>-ansi.ansi`,
`<view>-selected.ansi`, `<view>-frames.txt` (+ ansi), the pinned
`<view>-pinned-77x47-plain.txt` / `-frames.txt` / `-selected.txt` dumps, and
`manifest.json`. Live pane measured **82x51 @100%** in every view (tab half-pane), so
fit is proven per the pinned ruling by a `COLUMNS=77 LINES=47` direct dump of that
view's final spec (`viewport: 77x47 zoom: 1.00 natural`, no overflow banner).

Claims and the capture cells that show them:

* v1 — both cores take two independent arrowheads at two ports: (32,36) and (34,36) for
  Core 1, (43,36) and (45,36) for Core 2; MUX fan ports row 29–30, cols 32/34 and
  43/45; `x-connect` at (24,30).
* v2 — FW1 active [25,27,12,4] and FW2 standby [40,27,13,4]; `active` at (25,20),
  `standby` at (36,26); BL 1 two heads at (33,35),(35,35), BL 2 at (42,35),(44,35).
* v3 — spines above (rows 19–22), BL 1 [43,31,6,4] and Leaf 1 [21,31,8,4] on one rank
  row; up-heads (34,23),(36,23),(46,23),(48,23); inside-hop corners (36,24),(40,24),
  (42–46,25),(42,44 & 26); `ECMP` at (25,27) and (30,30).
* v4 — `dual` at (27,26) and (36,28); Rack 1 heads (32,29),(34,29), Rack 2 (43,29),(45,29).
* Static everywhere: the five pinned frames per view are byte-identical
  (`evidence/<view>/<view>-pinned-77x47-frames.txt`).

## Checks and validation

All four `--check` runs: 0 warnings, labels fully placed with **0 ambiguous owners**, 0
skipped, dots `0 single-dot / 0 periodic / 0 violations`, `origins: 0/0`,
`arrivals: 0/0`, empty `trunks:` line, `layers` pinned with 0 conflicts.

`scripts/viz-validate.py … --require-select --require-frames --require-records
--attempts attempts.json` passes **all checks** for v1–v4 (outputs in
`validator-output/<view>.txt`, embedded in `generation.json`).

## Attempts

`attempts.json` lists three candidates per view plus nine `abandoned_shapes` entries.
Every one of the 21 recorded `--check` runs is in `attempts-log.jsonl` (command, exit
status, raw stdout/stderr with sha256s, spec sha256), verified by
`--require-records`. Process note: the label-placement search produced more than three
`--check` runs on the uplinks/security coverage before the split settled; all of them are
recorded, and the ones that are not view candidates appear as abandoned shapes rather
than being trimmed.

## Defects / caveats

* v3 keeps 6 bridges (inside-hop congestion between the BL fan and the leaf fan); the
  tier order is fixed by line 248, so the crossings are structural, reported and kept.
  v2 keeps 2, v1 and v4 keep 1 each — one crossing is unavoidable for a two-layer K2,2.
* Tier qualifier text is printed once per tier fan, not on every lane (yield above).
* Live pane size is 82x51; the 77x47 proof is a pinned dump, not a pane.
* No blockers. Cleanup: panes `w7E:pQY`, `w7E:pQZ`, `w7E:pQ0`, `w7E:pR2` opened by
  `scripts/viz-evidence.sh` and each manifest reports `confirmed_closed`.
* No judge was spawned; no renderer, skill, rubric or expected data was touched.
