# Blind observation — datacenter-redundancy, round 10

Stage A only. I did not consult the source, expected data, rubric, other cases, or run the viewer. Coordinates below are **1-based viewport cells**, not file-line numbers: the first two lines of each pinned dump are metadata, and the viewport header is row 1. This explains the two-row offset from the generator's file-line coordinates. Text labels have height 1. Counts refer to visible node occurrences, not unique devices, unless stated otherwise.

## Binding and fit

Independent `shasum -a 256` results match the `views[].spec_sha256` fields in `generation.json`:
- v1 `specs/v1-uplinks-final2.json`: `7459a047230e9764e5afff7ed7a70f0105f2e9db35b6fa4ae1f0e4e2ed8687aa`
- v2 `specs/v2-security-final.json`: `da598580a3bc2114cc4db882741caf5d4143368850cf7c34df09ce0d75fafc5a`
- v3 `specs/v3-fabric-final3.json`: `8de42d11588f4a6cc0c2336fbe9901073e3cbd66df817932371ce793a4490f80`
- v4 `specs/v4-racks-final.json`: `6670a03bde4a80fe62651aff0d65cc1c9ecb67428107dce05868487f0567cd6d`

Each pinned capture says `viewport: 77x47 zoom: 1.00 natural`. The live ANSI/text headers say 82x51 @100%. Check extents: 48x29, 39x27, 48x16, 30x15 respectively. All graph boxes, route ends, and graph labels fit the pinned screen; no graph content is visibly clipped or requires pan/zoom. The v4 pinned header truncates its quit hint, not graph content. UI control legend and header are not graph labels. Captures do not prove what a user sees on a different pane size.

## Labels and boxes

Each label is followed by `[column,row,width,height]`; its enclosing node box is also given. Complete sides and rounded corners are visible on every listed node.

- v1: `ISP A` [22,11,5,1] box [21,10,7,4]; `ISP B` [32,11,5,1] box [31,10,7,4]; `ISP C` [42,11,5,1] box [41,10,7,4]; `ISP D` [52,11,5,1] box [51,10,7,4]; `MUX 1` [32,20,5,1] box [31,19,7,4]; `MUX 2` [42,20,5,1] box [41,19,7,4]; `Core 1` [31,36,6,1] box [30,35,8,4]; `Core 2` [42,36,6,1] box [41,35,8,4]; edge label `x-connect` [24,28,9,1].
- v2: `Core 1` [31,12,6,1] box [30,11,8,4]; `Core 2` [42,12,6,1] box [41,11,8,4]; `FW1 active` [26,26,10,1] box [25,25,12,4]; `FW2 standby` [41,26,11,1] box [40,25,13,4]; `BL 1` [33,35,4,1] box [32,34,6,4]; `BL 2` [42,35,4,1] box [41,34,6,4]; edge labels `active` [25,18,6,1] and `standby` [36,24,7,1].
- v3: `Spine 1` [30,18,7,1] box [29,17,9,4]; `Spine 2` [42,18,7,1] box [41,17,9,4]; `Leaf 1` [22,30,6,1] box [21,29,8,4]; `Leaf 2` [33,30,6,1] box [32,29,8,4]; `BL 1` [44,30,4,1] box [43,29,6,4]; `BL 2` [53,30,4,1] box [52,29,6,4]; edge labels `ECMP` [25,25,4,1] and `ECMP` [30,28,4,1].
- v4: `Leaf 1` [31,18,6,1] box [30,17,8,4]; `Leaf 2` [42,18,6,1] box [41,17,8,4]; `Rack 1` [31,29,6,1] box [30,28,8,4]; `Rack 2` [42,29,6,1] box [41,28,8,4]; edge labels `dual` [27,24,4,1] and `dual` [36,26,4,1].

There are 24 node-label occurrences and 7 edge-label occurrences, 31 total. The seven edge labels are all visibly placed off route cells. The closest local line association is clear for `x-connect`, `active`, the two `ECMP` labels and both `dual` labels; `standby` sits immediately left of the first of the two FW2 arrowheads and can be associated with that route, but the short approach and adjacent second head make the association less visually robust. I count zero definitively unassignable labels, with this caveat. Crucially, local ownership is not the same as tier-wide meaning: the picture does not explicitly say that the one `x-connect`, two `ECMP`, or two `dual` labels apply to the other unlabeled fan; nor does it label the BL-to-spine fan ECMP at all. The accompanying generation report states that scope, but an unaided diagram reader cannot establish it. Thus dedup preserves the qualifier words, not explicit per-link qualifier coverage; calling it lossless needs the external scope statement.

## Relations, direction and traceability

All arrowheads are single head glyphs at targets, not bidirectional arrowheads. 'Double arrowhead' means two separate incoming single-headed routes per target. Lists below enumerate every declared relation visible in the respective captures. No edge is explicitly drawn in both directions between the same pair. All boxes have their attachments on top or bottom sides, not corners; paired attachments are offset around the middle, not always at the exact center cell.

- v1, downward: ISP A→MUX 1, ISP B→MUX 1, ISP C→MUX 2, ISP D→MUX 2; MUX 1→Core 1, MUX 1→Core 2, MUX 2→Core 1, MUX 2→Core 2. Every target has two heads. The straight first four routes are easy to follow. The four MUX/core routes are distinguishable with close tracking across the bridge and adjacent bend; the 1-to-2 and 2-to-1 routes are not instantly readable at that knot.
- v2, downward: Core 1→FW1 active, Core 1→FW2 standby, Core 2→FW1 active, Core 2→FW2 standby; FW1 active→BL 1, FW1 active→BL 2, FW2 standby→BL 1, FW2 standby→BL 2. Every target has two heads. Distinct ports and bridge glyphs support tracing, though the nearby bends and heads make the crossed routes slower to trace.
- v3, upward: BL 1→Spine 1, BL 1→Spine 2, BL 2→Spine 1, BL 2→Spine 2. Downward: Spine 1→Leaf 1, Spine 1→Leaf 2, Spine 2→Leaf 1, Spine 2→Leaf 2. Two up heads are under each spine and two down heads above each leaf. The BL→spine paths turn in the interior band; no exterior rail is visible. In the dense center, bridges, adjacent bends and close parallel verticals require deliberate cell-by-cell tracking; I cannot confidently determine all eight origin-to-target pairings from the image alone without using the declared spec as an aid. Heads and endpoints are present, but a blanket claim that every v3 route is traceable without guessing is not established.
- v4, downward: Leaf 1→Rack 1, Leaf 1→Rack 2, Leaf 2→Rack 1, Leaf 2→Rack 2. Both racks have two heads; the four routes can be followed with attention at the bridge and tightly adjacent bend.

This is 28 declared relations, with 24 occurrence boxes representing 18 distinct named components across the views. The shared Core, BL and Leaf nodes link the views conceptually; no drawn inter-view connector is provided. Each view is internally connected. The widest fan is two outgoing routes per MUX, core, firewall, border leaf, spine, or leaf; ISP nodes each have one. No reciprocal box pair is visible; targets repeatedly receive heads from two separate routes. Text is identifier-heavy and sparse in qualifiers; there are no IP addresses or ports. The page ranks read as connectivity tiers, not temporal phases.

## Crossings and close contacts

Bridge locations below are independently counted `⌒` cells in viewport coordinates. Each reported count matches `check.txt`. This glyph convention distinguishes crossing routes, not a junction. Adjacent bends can nevertheless look joined; there is no explicit branching glyph or declared trunk.

- v1: one bridge (35,31); check also reports one touching bend. This is in the MUX/core cross-fan. It corresponds to the two interleaving routes of a K2,2 with the two source and two target boxes in the same left-to-right tier order; one crossing is structurally expected under these tier/order/planar-side constraints.
- v2: bridges (34,21) and (35,31); check reports two touching bends. One lies in each of the two consecutive K2,2 fans. Each is consistent with the single crossed pair under the same fixed rank/order assumptions.
- v3: bridges (42,23), (44,23), (46,23), (42,24), (44,24), (32,26); check reports two touching bends. The bridge at (32,26) is in the spine/leaf K2,2 fan. The five concentrated at rows 23–24 mix inside-hop BL→spine paths and the spine/leaf band. Those five should not all be counted as independently unavoidable K2,2 crossings: two K2,2 fans alone suggest one crossing per fan under a simple separated two-rank arrangement, while the extra interactions depend on routing, port ordering and the unusual shared bottom rank. The fixed rank makes congestion credible, but this capture does not prove all six bridges minimal or unavoidable. The very close corner and straight cells at columns 40–46, rows 22–27 can resemble branches; the graphic provides no explicit branch node. I cannot independently localize both checker-reported touching bends with certainty, and do not equate them with the six bridges.
- v4: bridge (35,25); check also reports one touching bend. This is the K2,2 cross-fan, with the same qualified one-crossing explanation as v1.

Check reports 10 bridges and 6 touching bends in all. Exact touching-bend coordinates are not separately recorded in the evidence and I cannot establish all of them reliably from the render; hence they are not invented here. Tight bends around the bridge glyphs are visible in each cross-fan.

## Groups, rank pins, borders, and selection

Groups are logical tags: no group box, title or enclosing border is drawn, correctly for this round. Ordinary ANSI borders show sibling shades within these hue families: v1 ISP pink (206,115,138; 219,153,170; 193,78,106; 231,187,198), MUX yellow-green (183,206,115; 203,219,153), core violet (138,115,206; 170,153,219); v2 core violet, firewall orange (206,161,115; 219,186,153), border teal (115,206,183; 153,219,203); v3 spine orange, border teal, leaf violet; v4 leaf violet, rack teal. These are per-view families: orange is reused for distinct groups in v2/v3, and violet/teal similarly. Tier identity is carried by names and hue family, not group titles or bands. Members keep sibling 1 before 2 left-to-right; ISP A–D are also in order. Core, BL and leaf keep order and colors in their repeated views. Every node has a complete rounded border; ANSI captures show continuous single-color border segments around each node, rather than a plain-text-only inference. Individual shades differ within a family.

Pins from `generation.json` and specs, confirmed in the visible ranks: v1 ISP A–D top, MUX 1/2 middle, Core 1/2 bottom (8 pinned); v2 Core 1/2 top, FW1/FW2 middle, BL 1/2 bottom (6); v3 Spine 1/2 top, BL 1/2 and Leaf 1/2 bottom (6), although actual automatic left-to-right order is Leaf 1, Leaf 2, BL 1, BL 2; v4 Leaf 1/2 top, Rack 1/2 bottom (4). `check.txt` reports zero pin conflicts in each.

The select-all pinned captures report 8, 6, 6, 4 selected respectively; selected ANSI top borders for all 24 node occurrences change to RGB (216,166,87), while each remains a complete box. Coverage is 24/24 in a simultaneous select-all state. This is not evidence of 24 separate single-node selection frames.

## Motion

No route is animated in the final captures. Every view has five pinned frames at 0, 100, 200, 300, 400 ms, with identical frame grids after removing timestamp delimiters; no flow dots are visible. Check reports 0 single-dot, 0 periodic, 0 violations; origins 0/0 and arrivals 0/0. Spacing, movement direction, corner/bridge/arrowhead occupation, origin and synchronized arrival are not applicable, not positive tests of animated paths. There is no observed violation of the no-motion request as reported in generation metadata.

## Generator's classification, quoted rather than adopted

`generation.md`, section `Step 0 — family`, says verbatim:

> family: redundant-fabrics  
> evidence: 18 nodes carry 28 links over six redundant tier transitions (E/N = 1.56),  
>           every tier target takes a double arrowhead — each core, each firewall, each  
>           border leaf, each spine, each rack leaf and each rack receives two separate  
>           links — and the user's own line 134 forbids motion ("remove the dots  
>           flowing for now"): dense, double-headed, static.

The `classification` object in `generation.json` also states the classification with slightly different prose. This is the generator's claim, not an independent source quotation verification.

## Blind scorecard

| View | Nodes | Edges (declared / heads visible) | Graph labels (node + edge) | Hue families | Pinned nodes / ranks | Bridges / touching bends (check) | Definitively uncertain edge owners | Graph items clipped | Selected occurrences | Dot violations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 | 8 | 8 / 8 | 8 + 1 | 3 | 8 / 3 | 1 / 1 | 0 | 0 | 8 / 8 | 0 |
| v2 | 6 | 8 / 8 | 6 + 2 | 3 | 6 / 3 | 2 / 2 | 0, standby visually close | 0 | 6 / 6 | 0 |
| v3 | 6 | 8 / 8 | 6 + 2 | 3 | 6 / 2 | 6 / 2 | 0 locally; tier scope unclear | 0 | 6 / 6 | 0 |
| v4 | 4 | 4 / 4 | 4 + 2 | 2 | 4 / 2 | 1 / 1 | 0 locally; tier scope unclear | 0 | 4 / 4 | 0 |
| Total | 24 occurrences / 18 distinct | 28 / 28 | 24 + 7 | 11 view-group occurrences | 24 / 10 view-ranks | 10 / 6 | 0 definitive | 0 graph items | 24 / 24 | 0 |

Missing or limited evidence: no unsupported capture format; ANSI, text and JSON are readable. The stage-A record does not independently establish all touching-bend locations, all v3 route pairings without spec assistance, per-edge qualifier scope from the diagram itself, or a proof that all six v3 crossings are unavoidable. The source's actual instructions and expectations are intentionally not read at this stage.
