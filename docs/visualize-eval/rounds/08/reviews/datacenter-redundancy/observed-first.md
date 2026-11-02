# Blind observation — datacenter-redundancy, round 08

Coordinate system: 1-based columns and rows of the 83×51 pane text capture, including the header. Label rectangles are [column,row,width,height]. Node border rectangles use the same convention. I have not consulted expectations, source, raw logs, or attempts. Where topology is stated from the JSON rather than independently readable on the screen, it is identified as declared topology. Counts are occurrences across views, not unique devices.

## Identity and capture integrity

Final spec SHA-256 calculated with `shasum -a 256`, matching the four evidence manifests:
- v1 `v1-uplink.json`: `e973aa007d70fecc8f6b530eeb85b8ec4436b2b934a730ae1fce9655582c6509`
- v2 `v2-security.json`: `7b226b5bbfa129c409866f65cf6e4dfe96ae37fafdb6928f8c693d1dd8fcd01d`
- v3 `v3-fabric.json`: `d151786d9d53a7346bf00495dc4d0dceb67e679d7ffa8717fe582afecb2b3212`
- v4 `v4-access.json`: `ab96ec5e04bbf79588e2d9ae3fa475010a24ad8a82e70e863de4a5e19a1bbf73`

The manifest for each reports binary SHA-256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`, five frames, select-all, and confirmed pane closure. The family evidence line requested by the task is **not present in the allowed spec or evidence files** (search for family/families); it cannot be recorded verbatim without consulting forbidden material. No family verdict is made.

## Visible labels

These are diagram labels, not the application header or control legend. Text at v3 row 30 is partially overwritten, so both its surviving fragment and the overlapping edge label are recorded rather than inventing a complete region title.

- v1: `wan` [26,11,3,1]; `ISP A` [25,13,5,1]; `ISP B` [35,13,5,1]; `ISP C` [45,13,5,1]; `ISP D` [55,13,5,1]; `MUX 1` [35,22,5,1]; `MUX 2` [45,22,5,1]; `x-connect` [48,29,9,1], [26,30,9,1], [49,30,9,1], [38,34,9,1]; `Core 1` [34,38,6,1]; `Core 2` [45,38,6,1].
- v2: `core` [34,9,4,1]; `Core 1` [33,11,6,1]; `Core 2` [44,11,6,1]; `active` [26,18,6,1], [36,20,6,1], [38,37,6,1], [29,39,6,1]; `standby?` [37,22,8,1], [35,24,8,1], [36,32,8,1], [36,33,8,1]; `FW1 active` [29,26,10,1]; `FW2 standby` [44,26,11,1]; `BL 1` [35,41,4,1]; `BL 2` [44,41,4,1].
- v3: `spine` [47,17,5,1]; `Spine 1` [33,20,7,1]; `Spine 2` [45,20,7,1]; `ECMP` [37,23,4,1], [36,24,4,1], [49,24,4,1], [27,27,4,1], [41,27,4,1], [48,29,4,1], [57,29,4,1], [29,30,4,1]; region title remnant `r`, `c`, `af` at [26,30,1,1], [28,30,1,1], [33,30,2,1], amid arrowheads and ECMP; `Leaf 1` [25,32,6,1]; `Leaf 2` [36,32,6,1]; `BL 1` [47,32,4,1]; `BL 2` [56,32,4,1].
- v4: `rack` [52,20,4,1]; `dual` [39,21,4,1], [37,25,4,1], [38,27,4,1], [39,31,4,1]; `Leaf 1` [27,23,6,1]; `Leaf 2` [27,29,6,1]; `Rack 1` [51,23,6,1]; `Rack 2` [51,29,6,1].

## Node borders and selected state

All 24 node rectangles have all four expected sides and all four rounded corners in the plain captures. An ANSI per-cell perimeter check finds each node's entire border in a single foreground color, including corners; selected capture gives every perimeter foreground RGB (216,166,87). This is simultaneous select-all evidence for 24/24 occurrences, not evidence of separately navigated single-node selections. Border rectangles:
- v1 ISP A [24,12,7,4], ISP B [34,12,7,4], ISP C [44,12,7,4], ISP D [54,12,7,4], MUX 1 [34,21,7,4], MUX 2 [44,21,7,4], Core 1 [33,37,8,4], Core 2 [44,37,8,4].
- v2 Core 1 [32,10,8,4], Core 2 [43,10,8,4], FW1 active [28,25,12,4], FW2 standby [43,25,13,4], BL 1 [34,40,6,4], BL 2 [43,40,6,4].
- v3 Spine 1 [32,18,9,5], Spine 2 [44,18,9,5], Leaf 1 [24,31,8,4], Leaf 2 [35,31,8,4], BL 1 [46,30,6,5], BL 2 [55,30,6,5].
- v4 Leaf 1 [26,21,8,5], Leaf 2 [26,27,8,5], Rack 1 [50,21,8,5], Rack 2 [50,27,8,5].

## Regions and pinned ranks

The check output says, verbatim, v1 `pins: 8 pinned, 0 conflict(s)`, v2 `pins: 6 pinned, 0 conflict(s)`, v3 `pins: 6 pinned, 0 conflict(s)`, v4 `pins: 4 pinned, 0 conflict(s)`; no `pins-conflict:` line appears. Actual pane coordinates support the tier ordering: in v3 the spine boxes occupy rows 18–22 and their labels row 20; all four leaf/BL labels are at row 32 (boxes start rows 30–31). Thus spines visibly sit above a common leaf label level. This does not establish that routes follow rank direction: four BL-to-spine routes go upward with extensive detours.

Only one complete member-wrapping region appears in each view: v1 wan outer bounds about [23,11,40,6] wraps four ISPs; v2 core [31,9,20,6] wraps two cores; v3 rack-leaf outer bounds [23,30,21,6] wraps Leaf 1 and Leaf 2 but its title is overwritten by arrowheads and `ECMP`; v4 rack [49,20,10,13] wraps both racks. v1 mux and core have collapsed to separate empty 3-column slivers at approximately [65,20,3,6] and [62,36,3,6]. v2 firewall and border-leaf have slivers at approximately [55,24,3,6] and [52,39,3,6]. In v3 spine is a narrow vertical sliver along column 53 beside, not around, the spines; border-leaf is similarly collapsed/overlaid around the BL boxes, rather than enclosing both. v4 rack-leaf appears as empty rectangle [25,33,10,3] below both leaves. These regions do not provide a stable sibling grouping. The visible region border segments are interrupted by paths; ANSI does not establish color continuity for a complete region in the interrupted cases.

v2 declares minlen 2 and has one empty rank between core/firewall and firewall/BL: boxes end at rows 13 and 28, next boxes start 25 and 40 respectively. v4 declares minlen 2 and has one empty rank: leaf right edge column 33, rack left edge column 50. v1/v3 final specs do not declare minlen.

## Arrows, crossings, and label ownership

Arrowheads visible are all present: v1 downward at (35,20), (37,20), (45,20), (47,20), (34,36), (36,36), (45,36), (47,36); v2 downward at (29,24), (31,24), (44,24), (46,24), (35,39), (37,39), (44,39), (46,39); v3 rightward at (31,19), (43,19), (31,21), (43,21), downward at (25,30), (27,30), (36,30), (38,30); v4 rightward at (49,22), (49,24), (49,28), (49,30).

Declared source→target pairs and direction (the declared pairs are not proof that every dense crossing is visually traceable):
- v1 ISP A→MUX 1, ISP B→MUX 1, ISP C→MUX 2, ISP D→MUX 2, all down; MUX 1→Core 1, MUX 1→Core 2, MUX 2→Core 1, MUX 2→Core 2, down. Upper four are readily traceable; lower four have adjacent lanes and a bridge/touch, so label-to-route ownership is not all obvious.
- v2 Core 1→FW1, Core 2→FW1, Core 1→FW2, Core 2→FW2; FW1→BL1, FW1→BL2, FW2→BL1, FW2→BL2, down. Solid `active` and dashed `standby?` paths are distinguishable, but paired lanes and crossing areas make not every route/label assignment unambiguous.
- v3 BL1→Spine 1, BL1→Spine 2, BL2→Spine 1, BL2→Spine 2 go upward around the drawing and enter from the left; Spine 1→Leaf 1, Spine 1→Leaf 2, Spine 2→Leaf 1, Spine 2→Leaf 2 go downward. All eight heads are visible, but many paths are not comfortably traceable without guessing through the dense crossing and region-border collisions. Long loops run above and below the node tiers.
- v4 Leaf 1→Rack 1, Leaf 2→Rack 1, Leaf 1→Rack 2, Leaf 2→Rack 2, left to right. All heads visible; paths are broadly traceable, with the two crossed paths requiring attention at the bridge.

Visible `⌒` bridge glyph coordinates: v1 (37,33); v2 (35,21), (37,36); v3 (54,16), (29,21), (33,25), (35,25), (45,25), (47,25), (53,25), (62,25), (40,26), (45,26), (35,28), (38,28), (40,28), (53,36); v4 (47,27). These agree in number with check `crossings: 1 bridges, 1 touching bends`, `2 bridges, 1 touching bends`, `14 bridges, 5 touching bends`, `1 bridges, 1 touching bends` respectively. Dense v3 rows 25–30 contain multiple adjacent bends, apparent junctions and crossings; route/border contacts occur on its row-30 region title. The checks provide counts but not coordinates for touching bends, so their exact individual locations cannot be established reliably from this capture. Paths also touch region borders in v1 row 16, v2 row 14, and v3 rows 17, 23 and 30–35; do not interpret those as real network branches.

The checks report v1/v2/v3 two ambiguous owners each, v4 zero, six total; they do not identify which exact labels. Repeated labels and 2-cell-spaced ports make individual pairings uncertain, especially v1 `x-connect` at rows 29–30 and 34; v2 `active` at rows 18/20 and `standby?` at rows 22/24 and 32/33; v3 the closely adjacent `ECMP` at rows 23–24 and 27–30. These are candidate uncertain labels, not a claimed exhaustive mapping of the six checker flags. In v4 four `dual` texts sit near the four paths; check reports no ambiguous owners.

## Fit and motion

Each pane capture header reads `83x51 @100%`; manifests record `viewport_line: null`, token `83x51 @100%`, and pane rows 51 with pane columns null. Each check's line is `viewport: unknown zoom: 1.00 natural`. Natural extents reported v1 45×31, v2 36×36, v3 53×25, v4 45×16. Supplied pinned dumps separately show `viewport: 77x47 zoom: 1.00 natural`; they capture the same diagram geometry at a smaller viewport. No node or edge is visibly clipped at either size, nor is pan/zoom visibly needed. The damaged v3 title is an overlap rather than an edge-of-viewport clip; the collapsed or missing region titles are not counted as viewport clipping.

A recursive literal scan of all evidence files found zero `●` glyphs. Each check reports `dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms`, `origins: 0/0 routes start at their arrow origin`, and `arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step`. No animated routes exist in these captures, so frame spacing, motion direction, origin, corners, bridges, arrowhead and synchronized arrivals are not applicable; five sampled frames cannot independently prove an unobserved time never contains a dot.

## Blind scorecard

| view | visible nodes | declared/heads visible edges | visible edge labels | region titles complete / partial | check bridges / touching bends | check ambiguous owners | viewport clipped | selected |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 | 8 | 8 / 8 | 4 | 1 / 0 | 1 / 1 | 2 | 0 | 8/8 |
| v2 | 6 | 8 / 8 | 8 | 1 / 0 | 2 / 1 | 2 | 0 | 6/6 |
| v3 | 6 | 8 / 8 | 8 | 1 / 1 | 14 / 5 | 2 | 0 | 6/6 |
| v4 | 4 | 4 / 4 | 4 | 1 / 0 | 1 / 1 | 0 | 0 | 4/4 |
| total | 24 | 28 / 28 | 24 | 4 / 1 | 18 / 8 | 6 | 0 | 24/24 |

Including node labels, edge labels, complete region titles and the one partial title, there are 53 diagram label occurrences; 52 are complete and 1 is partial. Dot glyphs/violations observed: 0 / 0. Selected coverage is simultaneous select-all, as above. The requested family evidence line is missing from allowed files; no other supplied evidence format was unreadable. Exact individual touching-bend positions and exact six flagged label identities are not supplied by the check and cannot all be independently assigned with confidence.
