# datacenter-redundancy — round 13 generation (viz-ds13-8)

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Skill `docs/visualize-eval/rounds/13/SKILL.md` (sha `65d826f0…`), renderer
`/tmp/visualize-eval/round-13/bin/rataflow-view` (sha `1f28d87d…`), rubric rev 11.

## Triage (annex `TRIAGE-datacenter-redundancy`)

Questions provoked: the four annex questions (audit target, bundle-or-not,
one-pane-or-canvas, dots) plus five the framing already answers (which layers
count, tier levels, ISP identities, arrow convention, ISPs per MUX). The annex
answers were used verbatim for Q1/Q2/Q4; Q3's preference ("one pane if the fabric
reads at natural zoom; a canvas if it truly needs it — no shrinking the text")
was settled by measurement, which is the generator's judgment under that answer.
Q7 (four ISP nodes, not folded into MUX labels) is `own judgment`, recorded with
its reason. Convergence: after the audit rule, the shape preference, the level
order and the no-dots answer, only "does the fabric read at natural zoom?" was
open; the recorded single-view probe (`extent=60x82` against 77×47) closed it.
Shape: **one canvas of three described concept-diagrams**.

`family: redundant-fabrics` — evidence: 18 nodes / 28 relations, four tiers that
each form a complete 2×2 cross-connect, and the source kills the dots outright
(line 134). Tie-breakers: service-meshes rejected (no anti-parallel pair),
placement-planes rejected (one connected fabric, buses forbidden), flow-chains
rejected (E ≫ N). Secondary recipe borrowed: identity-probe-maps' coverage
discipline (every identifier and qualifier is a ledger row first).

## Shape

Rung 1 was probed and rejected on measurement: all 28 relations in one tb graph
rank-pinned to the seven source tiers measured **60×82** cells — 35 rows over the
77×47 pane at 100% — with 31 near-miss cells, 4 ambiguous owners and the
18/28 readable-budget warning. The brief forbids shrinking to reach rung 1, so
rung 2: one canvas, three diagrams split on the source's own sections.

| diagram | title | nodes | edges | extent | origin |
|---|---|---|---|---|---|
| `uplinks` | ISP uplinks and core cross-connect | 8 | 8 | 49×30 | 0,3 |
| `security` | Active/standby firewall pair | 6 | 8 | 45×33 | 0,38 |
| `fabric` | Dual-spine fabric and dual-homed racks | 8 | 12 | 66×30 | 0,76 |

Whole canvas **71×106** at 100% natural zoom (`canvas 71x106` in the app header),
reader pans; nothing is zoomed out. 28/28 relations drawn exactly once, 24/24
labels placed.

## What the checks say (shipped spec `specs/canvas-3.json`)

- `labels: 24/24 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners`
- `trunks:` empty — no bus anywhere; no shared-run warning.
- `dots: 0 single-dot routes, 0 periodic routes, 0 violations`; `origins: 0/0`;
  `arrivals: 0/0`. Static: the pinned 12-frame dump has byte-identical frames.
- `crossings: 14 bridges, 9 touching bends`; 22 pinned nodes, 0 pin conflicts.
- `groups: isp(4) mux(2) core(4) firewall(2) border-leaf(4) spine(2) rack-leaf(2) rack(2)`
  — one hue family per tier, repeated across diagrams (captured: isp green, mux
  orange, core violet in `evidence/v1/v1-ansi.ansi`).
- **`passes-near-unrelated-node: 29`** on 4 routes — the remaining defect.

## Attempts (3 spec candidates per diagram, all recorded)

| label | change | near-miss cells | labels |
|---|---|---|---|
| `probe-single-view` | rung-1 probe, 7 tiers in one view | 31 | — (60×82 overflow) |
| `canvas-1` | baseline canvas, tb, short ids | 19 | 23/24, 1 skipped, 7 ambiguous |
| `canvas-2` | lr for uplinks + security | 16 | 24/24, 0 skipped, 8 ambiguous |
| `canvas-3` (shipped) | tb, source-backed full identifiers | 29 | 24/24, 0 skipped, 0 ambiguous |

Widening the node identities to the source's own words (`MUX appliance 1`,
`Core router 1`, `FW1 active`, `Border leaf 1`, `Rack leaf 1`) spread every
labelled fan enough that all 24 labels now read as their own route's label. It
did not fix routing: `fabric:e2 (bl2→sp1)` rides 22 cells inside Spine 2's
2-cell margin, because that one-rank back edge must re-enter the spine from below
(`sides_for`: within `NEAR_RANKS`, tb → (Top, Bottom)) and the sibling gap is
only 3 cells wide (`ACROSS_GAP_TB = 3`), where every cell is inside ring 2 of one
sibling or the other. The router paid `NEAR_BAND_COST` (8/cell) for 22 cells,
which it only does when no reachable corridor is clear. The budget is spent, so
this is reported, not hidden.

## Evidence

`evidence/v1/` — `check.txt`, `v1-text.txt`, `v1-ansi.ansi`, `v1-selected.ansi`,
`v1-frames.txt` (3 pane frames), `v1-77x47-frames.txt` (12 pinned frames at
exactly 77×47), `manifest.json` (binary path + sha, spec sha, pane `w7E:p08`,
`cleanup: confirmed_closed`). Pane measured 68×44 (`68x44 @100%`); the fit proof
for the canvas form is the check's whole-canvas + per-diagram extents plus the
pinned 77×47 dump.

`attempts.json`, `attempts-log.jsonl`, every probe's spec in `specs/` and its raw
stdout/stderr in `recorded/`.

## Validation

`scripts/viz-validate.py evidence/v1 --require-select --require-frames
--require-records --attempts attempts.json` → **38 PASS, 2 FAIL**
(`check_warnings_absent`, `routes_near_unrelated_nodes`), both caused by the same
29 near-miss cells. Full output in `validate-v1.txt`.

## Arrow convention

Arrows are physical connectivity, not proof of one-way traffic: every edge keeps
the source's endpoint order exactly (`bl1 → sp1`, `sp1 → leaf1`), so four fabric
relations point upward into the spines because the source puts the spines above
the leaves. No endpoint was reversed to force a layout.
