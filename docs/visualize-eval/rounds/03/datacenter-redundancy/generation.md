# datacenter-redundancy — round 03 generation report

Generator: fresh diagram generator worker `viz-ds03-5`, isolated worktree, no prior-round or other-case reads.
Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. No subagents, no judges.

| Frozen input | Value |
|---|---|
| candidate skill | `docs/visualize-eval/rounds/03/SKILL.md` — sha256 `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| renderer | `/tmp/visualize-eval/round-03/bin/rataflow-view` — sha256 `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` (absolute path only, not rebuilt) |
| target | 77 columns x 47 rows at natural 100% zoom |
| measured in every pane | 77x47 (header token `77x47 @100%`, frames line `viewport: 77x47 zoom: 1.00 natural`) |

## Arrow convention

Arrows show the direction of the audited physical link (producer -> consumer exactly as the source
states it). They are **not** proof of one-way traffic: every line is physical connectivity between
two ports. An upward arrow (`BL 1 -> Spine 1`) therefore means "this border leaf is cabled to that
spine", not "traffic only flows up". The frozen renderer has no caption/legend field, so the
convention lives here and in the reply, not inside the pane (recorded as a blocker).

## Coverage map (4 views, 28/28 relations, 18/18 nodes)

| view | carries | nodes | edges | extent | crossings | labels |
|---|---|---|---:|---|---:|---|
| v1 | 4 ISPs -> 2 MUXes (2 ISPs each) -> 2 cores, full cross-connect | ISP A–D, MUX 1–2, Core 1–2 (8) | e1–e8 (8) | 43x23 | 1 | 4/4 |
| v2 | cores -> active/standby firewalls -> border leaves | Core 1–2\*, FW1 active, FW2 standby, BL 1–2 (6) | e9–e16 (8) | 30x23 | 4 | 8/8 |
| v3 | border leaves **and** rack leaves on one level, both spines above, ECMP to both | BL 1–2\*, Spine 1–2, Leaf 1–2 (6) | e17–e24 (8) | 49x20 | 9 | 8/8 |
| v4 | both rack leaves dual-homed to both racks | Leaf 1–2\*, Rack 1–2 (4) | e25–e28 (4) | 21x14 | 1 | 4/4 |

`*` = boundary node repeated from the previous view, so every tier edge has both endpoints drawn.
No view uses a trunk: every redundant link is one independently traceable arrow (source correction,
line 270). Every edge is `"dots": 0` — no route animates anywhere (source line 134).

## Meaning ledger

| Fact | Kind | Fate | Detail |
|---|---|---|---|
| ISP A / B / C / D identities | identifier | drawn | nodes in v1 |
| 2 ISPs patched into each MUX | topology | drawn | e1, e2 -> MUX 1; e3, e4 -> MUX 2 |
| MUX 1 / MUX 2 | identifier | drawn | v1 |
| each MUX cross-connected to both cores | topology | drawn | e5–e8, label `x-connect` |
| Core 1 / Core 2 | identifier | drawn | v1 + v2 boundary |
| FW1 active / FW2 standby | role | drawn | node labels in v2 |
| cores into both firewalls | topology | drawn | e9–e10 `active` solid, e11–e12 `standby?` dashed |
| firewalls into both border leaves | topology | drawn | e13–e14 `active`, e15–e16 `standby?` dashed |
| BL 1 / BL 2 | identifier | drawn | v2 + v3 boundary |
| border leaves to both spines, ECMP | topology + protocol | drawn | e17–e20 |
| Spine 1 / Spine 2 | identifier | drawn | v3 |
| both spines to every rack leaf, ECMP | topology + protocol | drawn | e21–e24 |
| Leaf 1 / Leaf 2 | identifier | drawn | v3 + v4 boundary |
| each rack dual-homed to both leaves | topology | drawn | e25–e28, label `dual` |
| Rack 1 / Rack 2 | identifier | drawn | v4 |
| spines above the leaf level | placement | drawn | v3 layer 0 spines, layer 1 blades |
| border and rack leaves at one level | placement | drawn | v3 layer 1 = bl1, bl2, leaf1, leaf2 |
| do not merge mux/core arrows | human correction | drawn | one edge per link, `trunks:` empty |
| remove flowing dots | human correction | drawn | `dots: 0` everywhere, `flows=0` in every check |
| compact at default zoom | human correction | drawn | largest extent 49x20, all inside 77x47 |
| arrow convention | qualifier | dropped with reason | no caption surface in the renderer; stated here |
| active/passive pair | role | abbreviated | two nodes in one `fw` group + per-edge active/standby |
| standby links are historical/unconfirmed | qualifier | drawn | dashed + `standby?` on e11, e12, e15, e16 |

## Relationship audit

Label owner is the edge id that carries the text; `none` = the source gives no label and no protocol
was invented. Every row renders `dots: 0`, `flow` unset.

| id | from -> to | verb / tech | label | style | view |
|---|---|---|---|---|---|
| e1 | ispA -> mux1 | unlabeled historical relation | — | solid | v1 |
| e2 | ispB -> mux1 | unlabeled historical relation | — | solid | v1 |
| e3 | ispC -> mux2 | unlabeled historical relation | — | solid | v1 |
| e4 | ispD -> mux2 | unlabeled historical relation | — | solid | v1 |
| e5 | mux1 -> core1 | x-connect | `x-connect` | solid | v1 |
| e6 | mux1 -> core2 | x-connect | `x-connect` | solid | v1 |
| e7 | mux2 -> core1 | x-connect | `x-connect` | solid | v1 |
| e8 | mux2 -> core2 | x-connect | `x-connect` | solid | v1 |
| e9 | core1 -> fw1 | active | `active` | solid | v2 |
| e10 | core2 -> fw1 | active | `active` | solid | v2 |
| e11 | core1 -> fw2 | standby | `standby?` | dashed | v2 |
| e12 | core2 -> fw2 | standby | `standby?` | dashed | v2 |
| e13 | fw1 -> bl1 | active | `active` | solid | v2 |
| e14 | fw1 -> bl2 | active | `active` | solid | v2 |
| e15 | fw2 -> bl1 | standby | `standby?` | dashed | v2 |
| e16 | fw2 -> bl2 | standby | `standby?` | dashed | v2 |
| e17 | bl1 -> sp1 | ECMP | `ECMP` | solid | v3 |
| e18 | bl1 -> sp2 | ECMP | `ECMP` | solid | v3 |
| e19 | bl2 -> sp1 | ECMP | `ECMP` | solid | v3 |
| e20 | bl2 -> sp2 | ECMP | `ECMP` | solid | v3 |
| e21 | sp1 -> leaf1 | ECMP | `ECMP` | solid | v3 |
| e22 | sp1 -> leaf2 | ECMP | `ECMP` | solid | v3 |
| e23 | sp2 -> leaf1 | ECMP | `ECMP` | solid | v3 |
| e24 | sp2 -> leaf2 | ECMP | `ECMP` | solid | v3 |
| e25 | leaf1 -> rack1 | dual | `dual` | solid | v4 |
| e26 | leaf2 -> rack1 | dual | `dual` | solid | v4 |
| e27 | leaf1 -> rack2 | dual | `dual` | solid | v4 |
| e28 | leaf2 -> rack2 | dual | `dual` | solid | v4 |

Repeated strings (`ECMP` x8, `active` x4, `dual` x4, `x-connect` x4) are the source's own per-link
verbs repeated once per arrow — not one shared label: `--check` reports 0 labels on route cells and
0 shared corridors in every view.

## `--check` output (verbatim, all four final views)

```
v1: viewport: unknown zoom: 1.00 natural
    ok: nodes=8 edges=8 flows=0 direction=tb theme=gruvbox
    layers=3 (explicit placement, sugiyama skipped)
    extent=43x23 cells
    crossings: 1
    labels: 4/4 placed, 0 on route cells, 0 skipped
    groups: wan(4) mux(2) core(2)
    trunks:
    dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
    origins: 0/0 routes start at their arrow origin

v2: viewport: unknown zoom: 1.00 natural
    ok: nodes=6 edges=8 flows=0 direction=tb theme=gruvbox
    layers=3 (explicit placement, sugiyama skipped)
    extent=30x23 cells
    crossings: 4
    labels: 8/8 placed, 0 on route cells, 0 skipped
    groups: core(2) fw(2) bl(2)
    trunks:
    dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
    origins: 0/0 routes start at their arrow origin

v3: viewport: unknown zoom: 1.00 natural
    ok: nodes=6 edges=8 flows=0 direction=tb theme=gruvbox
    layers=2 (explicit placement, sugiyama skipped)
    extent=49x20 cells
    crossings: 9
    labels: 8/8 placed, 0 on route cells, 0 skipped
    groups: spine(2) bl(2) leaf(2)
    trunks:
    dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
    origins: 0/0 routes start at their arrow origin

v4: viewport: unknown zoom: 1.00 natural
    ok: nodes=4 edges=4 flows=0 direction=tb theme=gruvbox
    layers=2 (explicit placement, sugiyama skipped)
    extent=21x14 cells
    crossings: 1
    labels: 4/4 placed, 0 on route cells, 0 skipped
    groups: leaf(2) rack(2)
    trunks:
    dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
    origins: 0/0 routes start at their arrow origin
```

No `warning:` line in any view. `viewport: unknown` is the `--check` placeholder (no terminal);
the pane captures prove the real size.

## Crossing counts and layout choices

- **v1** — 1 attempt. 43x23, 1 crossing. The mux<->core K2,2 fabric is the crossing; removing it
  would drop a required link.
- **v2** — 3 attempts. attempt1 (`standby unconf`, 14 chars) skipped 3 labels → rejected.
  attempt2 (`standby?`) placed 8/8 at 30x23, crossings 4 → chosen. attempt3 reversed the
  within-layer order and stayed at 4 → rejected (no gain, loses source order).
- **v3** — 3 attempts. attempt1 (racks in the same view) 49x30, crossings 12 → rejected.
  attempt2 (fabric only) 49x20, crossings 9 → chosen. attempt3 (reserved slot between the BL pair
  and the Leaf pair) 53x20, crossings 9 → rejected (no gain, wider).
- **v4** — 1 attempt. 21x14, crossings 1 → chosen. Splittiing the racks out of v3 costs 1 crossing
  in v4 but saves 3 in v3 (13 → 10 total) and keeps the rack dual-homing readable.

No source group was reordered, no relation merged, no label dropped to lower a count.

## Validator

```
python3 scripts/viz-validate.py docs/visualize-eval/rounds/03/datacenter-redundancy/evidence/v1 \
  --require-select --require-frames --attempts docs/visualize-eval/rounds/03/datacenter-redundancy/attempts.json
→ all checks passed (28/28), exit 0
```
Same for v2, v3, v4 (full text in `validator/<view>.txt`). No failing check in any view.

## Evidence bundle

Per view: `bin.sha256`, `check.txt`, `<view>-text.txt`, `<view>-ansi.ansi`,
`<view>-selected.ansi`, `<view>-frames.txt`, `<view>-frames.ansi`, `manifest.json`.
Animation capture: 11 frames at 200 ms steps covering a whole 2000 ms cycle; because no route has
dots, every frame is identical, which is the proof that nothing flows.
Pane cleanup: all four capture panes report `confirmed_closed` in their manifests (one throwaway
probe split, `w7E:pBJ`, was also closed).

## Known defects (honest)

1. **v3 readability, 9 crossings on 8 edges.** The source requires spines above while border leaves
   and rack leaves share one level, so the upward `BL -> spine` fan and the downward `spine -> leaf`
   fan share one corridor band: bridges (`⌒`) and adjacent `ECMPECMP` labels appear. This was the
   best of three attempts.
2. **Adjacent repeated labels in v1/v2/v4** (`activestandby?`, `activeactive`, `dualdual`, stacked
   `x-connect`). All 24 labels are placed and none is on a route cell, but pairing each label to its
   own arrow needs tracing because the tiers are only two nodes wide.
3. **The four ISP→MUX arrows are unlabeled** — the source calls them unlabeled historical relations
   and forbids inventing a protocol.
4. **`manifest.pane_cols`/`pane_rect` are null** in all four bundles: `scripts/viz-evidence.sh`
   resolves the rect from `herdr pane layout` (globally focused tab), which is not this worker's tab.
   The app's own measured size is still captured twice per bundle (`77x47 @100%` header token and
   `viewport: 77x47 zoom: 1.00 natural` in the frames capture), and the split geometry (79x49 rect,
   giving 77x47 after Herdr's border) was probed once.
5. **No motion anywhere**, so `origins: 0/0` and `0 synchronized at 2000ms` are expected, not a
   motion failure.
6. **Small graphs leave empty pane space** (21x14 for v4) — readable, but not stretched to the pane.

## Blocker

`caption/legend` inside a view is unavailable in the frozen renderer (no spec field; the header
shows only the spec path). Impact: the arrow convention and each view's tier description are stated
in this document and the reply, not in the pane.

## Status

Self-checked only. This is not an independent review and does not claim a pass; the captain runs the
separate Sol judge.
