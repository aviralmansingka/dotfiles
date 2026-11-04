# Datacenter redundancy — blind Stage A observations

This is an evidence-only first reading, not a comparison with an expected graph and not a full verdict. No specs, renderer code, checks, generation reports, source briefs, previous rounds, audits, or helpers were read. No pane/session operations were performed. Only the authorized final raw captures were inspected; a standalone `/tmp` Python SGR parser was run with `uv` to count cells, inspect colors, and compare captures.

## Evidence and coordinates

All capture paths below are relative to `docs/visualize-eval/rounds/01/datacenter-redundancy/captures/`.

- **V1**: `final-view1-20261102T083328Z-{visible.txt,visible.ansi,selected.txt,selected.ansi,frame2.txt}`.
- **V2**: `final-view2-20261102T083335Z-{visible.txt,visible.ansi,selected.txt,selected.ansi,frame2.txt}`.
- **V3**: `final-view3-20261102T083341Z-{visible.txt,visible.ansi,selected.txt,selected.ansi,frame2.txt}`.
- **V4**: `final-view4-20261102T083348Z-{visible.txt,visible.ansi,selected.txt,selected.ansi,frame2.txt}`.
- **V1c**: `final-view1c-20261102T083435Z-{visible.txt,visible.ansi,selected2.txt,selected2.ansi}`; additional selection evidence only.

Every rectangle is **1-based [column,row,width,height]**, including the header row. A route's waypoint `(column,row)` identifies the unit rectangle `[column,row,1,1]`. Waypoints describe visible runs and bends, not an inferred physical network. Bridge glyph `⌒` is interpreted as a crossing with separate horizontal and vertical continuations, not as a branch. Text-covered continuations are explicitly qualified below.

All ten inspected ANSI files contain 47 rows of 77 character cells. No non-SGR cursor controls were needed to interpret them. Plain-text files contain 46 rows, omit trailing spaces and the final blank row, and agree with their ANSI glyph grids after trailing-whitespace normalization. For V1–V4, `selected.txt` and `frame2.txt` are identical to `visible.txt`. V1c's visible text is identical to V1. Thus the second-frame evidence shows no glyph movement; it does not establish animation. The visible headers say `0 flows`.

The 77×47 target is supported by the raw ANSI grid. Natural 100% scale is **not independently established** by these captures: the visible UI does not show a zoom percentage. All graph content fits in the observed grid without apparent node-label cropping. No dimension-probe file was needed or inspected.

## Shared UI, fit, and text treatment

Each view has a header beginning at cell `[2,1,1,1]` with `rataflow-view`, its filename, counts, `0 flows`, and `drag pan`. The filenames visible in that UI are `view1-isp-mux.json`, `view2-mux-core.json`, `view3-fw-ha.json`, and `view4-fabric.json`; these files were **not** opened. Header node/edge counts respectively read 6/4, 4/4, 6/8, and 8/12. These are visible UI statements, not independent proof of graph completeness. V3's header ends in an additional `·`.

The complete control box is `[2,41,9,6]`, with `┌ ┐ └ ┘` corners, top/bottom horizontal sides, and uninterrupted vertical sides. Its four strings are `+ [+]` `[4,42,5,1]`, `− [-]` `[4,43,5,1]`, `⊡ [f]` `[4,44,5,1]`, and `□ [i]` `[4,45,5,1]`. No graph overlaps this box.

Graph extents, excluding UI: V1 `[17,18,44,13]`; V2 `[17,19,44,11]`; V3 `[6,19,66,11]`; V4 `[8,10,62,28]`. V4 is much denser, but remains inside the viewport. V1–V3 have substantial blank vertical space. All visible node labels are complete, single-line strings. No ellipsized node label is visible.

ANSI common colors: background RGB `(40,40,40)`; node/edge-label text `(235,219,178)`; route strokes, crossing humps and arrowheads `(124,111,100)`; header `(102,92,84)`; control border `(168,153,104)`. Edge color does not distinguish individual paths. Node text uses the shared text color rather than the node's border hue.

## V1 — upper ISP row, lower MUX pair

### Nodes and borders

| Visible node | Box | Label | Border RGB |
|---|---|---|---|
| ISP A | [17,18,7,4] | [18,19,5,1] | 216,166,87 |
| ISP B | [28,18,7,4] | [29,19,5,1] | 228,184,111 |
| ISP C | [43,18,7,4] | [44,19,5,1] | 200,147,68 |
| ISP D | [54,18,7,4] | [55,19,5,1] | 239,202,138 |
| MUX 1 | [28,27,7,4] | [29,28,5,1] | 125,174,163 |
| MUX 2 | [54,27,7,4] | [55,28,5,1] | 147,194,183 |

Each box has all four corners `╭╮╰╯`, complete horizontal top/bottom sides, and both complete vertical sides. Each of its 18 perimeter cells has the same RGB. No edge replaces any border cell.

### Directly readable directed links

No edge labels are visible here. The following routes are separate throughout:

| Link | Source stem → bends → arrowhead |
|---|---|
| ISP A → MUX 1 | (18,22) → (18,25) → (29,25) → `▼` (29,26) |
| ISP B → MUX 1 | (29,22) → (29,24) → (31,24) → `▼` (31,26) |
| ISP C → MUX 2 | (44,22) → (44,25) → (55,25) → `▼` (55,26) |
| ISP D → MUX 2 | (55,22) → (55,24) → (57,24) → `▼` (57,26) |

Stems start immediately below the source bottom borders; arrowheads sit immediately above the destination top borders. Separate arrowheads enter each MUX at two columns. There is no shared source stem, merge, branch, or crossing. No other link is visible.

Apparent grouping: four related gold ISP boxes above two related teal MUX boxes; A/B lead to one MUX, C/D to the other. No enclosing group box or explicit group title exists.

Selection: V1 `selected.ansi` makes all 18 ISP A perimeter cells bold, without changing RGB (its ordinary color already equals the selection RGB). V1c `selected2.ansi` makes all 18 ISP B perimeter cells bold and changes them uniformly from `(228,184,111)` to `(216,166,87)`. Labels and geometry do not change. These are whole-border selections, not partial side recolors.

## V2 — MUX column to Core column

### Nodes and borders

| Node | Box | Label | Border RGB |
|---|---|---|---|
| MUX 1 | [17,19,7,5] | [18,21,5,1] | 216,166,87 |
| MUX 2 | [17,25,7,5] | [18,27,5,1] | 228,184,111 |
| Core 1 | [53,19,8,5] | [54,21,6,1] | 125,174,163 |
| Core 2 | [53,25,8,5] | [54,27,6,1] | 147,194,183 |

All four corners and all four sides are complete and uniformly colored on each box: 20 perimeter cells per MUX and 22 per Core. Ports are adjacent to, rather than replacements for, the border.

### Directed links and label association

| Link | Source stem → bends → arrowhead | Visible associated label |
|---|---|---|
| MUX 1 → Core 1 | (24,20) → `▶` (52,20) | `x-conn` [35,19,6,1] |
| MUX 1 → Core 2 | (24,22) → (50,22) → (50,26) → `▶` (52,26) | `x-conn` [34,21,6,1] |
| MUX 2 → Core 1 | (24,26) → (48,26) → (48,23) → (51,23) → (51,22) → `▶` (52,22) | `x-conn` [33,25,6,1] |
| MUX 2 → Core 2 | (24,28) → `▶` (52,28) | `x-conn` [35,27,6,1] |

The two bent links cross at `⌒` `[50,23,1,1]` within `[48,22,5,5]`. The vertical track at column 50 continues through the hump while the other route traverses row 23. This reads as two separate routes, not a junction. Adjacent bends at columns 50/51 on row 22 are crowded, but their distinct continuations are traceable. Labels are positioned above their source-side horizontal runs; all four say the same thing.

Apparent grouping: two gold MUX sources at left, two teal Core destinations at right. No group enclosure. No direct MUX–MUX or Core–Core connection is visible.

Selection: Core 1 `[53,19,8,5]` has all 22 perimeter cells changed from teal to `(216,166,87)` and bold; the other nodes and labels are unchanged.

## V3 — Core, firewall, and BL columns

### Nodes and borders

| Node (literal spelling) | Box | Label | Border RGB |
|---|---|---|---|
| Core 1 | [6,19,8,5] | [7,21,6,1] | 216,166,87 |
| Core 2 | [6,25,8,5] | [7,27,6,1] | 228,184,111 |
| FW1 active | [46,19,12,5] | [47,21,10,1] | 125,174,163 |
| FW2 stdby | [46,25,11,5] | [47,27,9,1] | 147,194,183 |
| BL 1 | [66,19,6,5] | [67,21,4,1] | 211,134,155 |
| BL 2 | [66,25,6,5] | [67,27,4,1] | 226,156,175 |

All corners and all four sides are complete. The perimeter counts are respectively 22, 22, 30, 28, 18, and 18; each entire perimeter has one RGB in the visible capture. Note the node spelling **`stdby`**, while the edge labels read **`stby`**.

### Directed links and labels

| Link | Source stem → bends → arrowhead | Label |
|---|---|---|
| Core 1 → FW1 active | (14,20) → `▶` (45,20) | `act` [28,19,3,1] |
| Core 1 → FW2 stdby | (14,22) → (41,22) → (41,25) → (44,25) → (44,26) → `▶` (45,26) | `stby` [25,21,4,1] |
| Core 2 → FW1 active | (14,26) → (43,26) → (43,22) → `▶` (45,22) | `act` [27,25,3,1] |
| Core 2 → FW2 stdby | (14,28) → `▶` (45,28) | `stby` [27,27,4,1] |
| FW1 active → BL 1 | (58,20) → `▶` (65,20) | `act` [60,19,3,1] |
| FW1 active → BL 2 | (58,22) → (63,22) → (63,26) → `▶` (65,26) | `act` [65,24,3,1], beside vertical run |
| FW2 stdby → BL 1 | (57,26) → (61,26) → (61,23) → (64,23) → (64,22) → `▶` (65,22) | `stby` [56,24,4,1], beside vertical run |
| FW2 stdby → BL 2 | (57,28) → `▶` (65,28) | `stby` [59,27,4,1] |

Crossings are `⌒` at `[43,25,1,1]` and `[63,23,1,1]`. Both have separate orthogonal continuations; neither shows a branch marker. The close bends at `[43,25,3,2]` and `[61,22,5,5]` can initially look joined, but their directions and separate arrows resolve the routes. Each source has two distinct stems and each target has two distinct arrowheads. No FW1–FW2 path is visible; the node words alone do not establish an HA link.

Apparent grouping: gold Core pair, teal firewall pair, pink BL pair, arranged left to right. The active/standby text distinguishes the firewall roles. There are no enclosing group boundaries.

Selection: BL 1 `[66,19,6,5]` has all 18 border cells changed from pink to `(216,166,87)` and bold. The label, ports, other borders, and all routes are unchanged.

## V4 — dense fabric view

### Nodes and borders

| Node | Box | Label | Border RGB |
|---|---|---|---|
| Spine 1 | [18,12,9,4] | [19,13,7,1] | 216,166,87 |
| Spine 2 | [45,12,9,5] | [46,14,7,1] | 228,184,111 |
| BL 1 | [8,24,6,5] | [9,26,4,1] | 125,174,163 |
| BL 2 | [31,24,6,4] | [32,25,4,1] | 147,194,183 |
| Leaf 1 | [46,24,8,4] | [47,25,6,1] | 99,151,141 |
| Leaf 2 | [62,24,8,4] | [63,25,6,1] | 168,211,200 |
| Rack 1 | [19,34,8,4] | [20,35,6,1] | 211,134,155 |
| Rack 2 | [46,34,8,4] | [47,35,6,1] | 226,156,175 |

All eight nodes have complete top, bottom, left and right sides and all four rounded corners. Perimeter counts are 22, 24, 18, 16, 20, 20, 20, and 20, with a uniform RGB on each perimeter. In particular, both sides of BL 2 remain intact even though strokes emerge from both at row 25. Spine 1 has arrows immediately outside both side borders; its side cells remain `│`, not arrows.

### Continuous directed routes

These links can be traced through visible strokes and crossing humps without supplying a text-hidden run:

| Link | Source stem → principal bends → arrowhead |
|---|---|
| BL 1 → Spine 1 | (14,25) → (28,25) → (28,13) → `◀` (27,13) |
| BL 2 → Spine 2 | (37,25) → (44,25) → (44,21) → (55,21) → (55,15) → `◀` (54,15) |
| Spine 1 → Leaf 1 | (19,16) → (19,22) → (47,22) → `▼` (47,23) |
| Spine 1 → Leaf 2 | (21,16) → (21,20) → (63,20) → `▼` (63,23) |
| Spine 2 → Leaf 1 | (46,17) → (46,19) → (49,19) → `▼` (49,23) |
| Spine 2 → Leaf 2 | (48,17) → (48,18) → (65,18) → `▼` (65,23) |
| Leaf 1 → Rack 1 | (47,28) → (47,31) → (20,31) → `▼` (20,33) |
| Leaf 1 → Rack 2 | (49,28) → (49,31) → (48,31) → (48,32) → (47,32) → `▼` (47,33) |
| Leaf 2 → Rack 1 | (63,28) → (63,30) → (45,30) → (45,29) → (22,29) → `▼` (22,33) |
| Leaf 2 → Rack 2 | (65,28) → (65,32) → (49,32) → `▼` (49,33) |

### Two text-interrupted candidate routes — not promoted to certain links

- **Candidate BL 1 → Spine 2**: source stem `[14,27,1,1]` continues via `(16,27)` upward. Column 16 is visible on either side of row 21, but **`ECMP` `[14,21,4,1]` occupies the would-be vertical cell `[16,21,1,1]`**. Above that gap the route continues through `(16,14)`, `(15,14)`, `(15,10)`, `(55,10)`, `(55,13)` to `◀` `[54,13,1,1]`. This is a strong visual candidate, but the literal stroke at row 21 is absent. Its complete source-to-target association remains qualified/unknown at that text interruption.
- **Candidate BL 2 → Spine 1**: a leftward source stem `[30,25,1,1]` continues via `(29,25)`, `(29,23)` toward row 23. **`ECMP` `[20,23,4,1]` interrupts the horizontal run**; visible pieces resume at column 19 on its left and column 24 on its right. The left piece continues via `(15,23)`, `(15,22)`, `(13,22)`, `(13,13)` to `▶` `[17,13,1,1]`. Again, the likely association is stated as a candidate, not filled in from an assumed redundant topology.

All twelve arrowheads are visible: four into spines at `[17,13,1,1]`, `[27,13,1,1]`, `[54,13,1,1]`, `[54,15,1,1]`; four into leaves at `[47,23,1,1]`, `[49,23,1,1]`, `[63,23,1,1]`, `[65,23,1,1]`; four into racks at `[20,33,1,1]`, `[22,33,1,1]`, `[47,33,1,1]`, `[49,33,1,1]`. The presence of arrows alone does not remove the two source-association qualifications above.

### Crossing, false-branch and label hazards

Fourteen explicit hump cells are visible, each a unit rectangle:

`[15,13,1,1]`, `[55,18,1,1]`, `[28,20,1,1]`, `[49,20,1,1]`, `[55,20,1,1]`, `[49,21,1,1]`, `[28,22,1,1]`, `[44,22,1,1]`, `[16,23,1,1]`, `[28,23,1,1]`, `[16,25,1,1]`, `[47,30,1,1]`, `[49,30,1,1]`, `[22,31,1,1]`.

These read as crossings, not shared junctions: the strokes continue independently along their axes. No explicit T or plus branch glyph appears. Particularly busy regions are `[13,20,17,6]` and `[44,18,12,8]`. The adjacent bends `[28,25,2,1]` (`╯╰`) separate two paths rather than join BL 1 directly to BL 2. The two adjacent verticals at `[28,24,2,1]` likewise do not constitute a shared run. The large top run `[15,10,41,1]` may initially resemble a group enclosure, but its side continuations terminate as a directed route, not a closed enclosing border.

Every visible edge-label instance:

| Text | Rectangle | Association visible from placement |
|---|---|---|
| ECMP | [56,17,4,1] | Beside column-55 run into Spine 2; strongly associated with BL 2 → Spine 2. |
| ECMP | [40,19,4,1] | Above the row-20 run, but also near the Spine 2 → Leaf 1 bend. Exact one-edge assignment is not certain. |
| ECMP | [51,19,4,1] | Between row-18 and row-20 horizontal runs and adjacent to column 55. Ambiguous among nearby routes. |
| ECMP | [14,21,4,1] | Overwrites the column-16 candidate BL 1 → Spine 2 run; also immediately right of column 13. Exact label ownership is ambiguous. |
| ECMP | [31,21,4,1] | Between long row-20 and row-22 runs; not uniquely assigned by position. |
| ECMP | [50,22,4,1] | Immediately right of column 49 leading to Leaf 1; strongest association is Spine 2 → Leaf 1, but no explicit leader. |
| ECMP | [20,23,4,1] | Inline in the interrupted candidate BL 2 → Spine 1 run; strongest local association is that candidate. |
| ECMP | [19,24,4,1] | Above BL 1's row-25 run and below the text-covered row-23 run. Ownership is not unique from placement alone. |
| dual | [32,28,4,1] | Above the row-29 run belonging to Leaf 2 → Rack 1. |
| dual | [51,29,4,1] | Near column 49 and above the row-30 run; ambiguous between nearby leaf-to-rack paths. |
| dual | [32,30,4,1] | Between row-29 and row-31 runs; ambiguous. |
| dual | [55,31,4,1] | Between row-30 and row-32 runs; ambiguous. |

All eight `ECMP` and four `dual` strings are legible and use the shared text color. Their count is not sufficient to assign one to each link. In particular, two labels occupy route cells, and several sit between parallel routes. ANSI color gives no extra ownership clue because all edge labels have the same color.

Apparent grouping: gold Spine pair across the top; teal BL 1, BL 2, Leaf 1, Leaf 2 across the middle; pink Rack pair at the bottom. BL boxes and leaf boxes share a hue family despite their different words and positions. There is no explicit enclosure or named group. Arrow direction, not vertical ordering, is needed to read BL-to-Spine paths because those routes go upward and around the layout.

Selection: BL 1 `[8,24,6,5]` changes all 18 perimeter cells from teal to `(216,166,87)` and bold. Its label and all surrounding routes remain unchanged.

## Cross-view color and evidence limits

Within each visible node, border RGB is consistent over every side and corner. Selection is a complete perimeter treatment, not a mixed-color edge. However, selection deliberately changes the hue to gold for ISP B, Core 1, and BL 1 in the inspected selections; it does not preserve their ordinary hue. ISP A's selection only changes bold because its ordinary hue already matches.

Repeated node names do **not** retain one global color across views: MUX nodes are teal in V1 and gold in V2; Core nodes are teal in V2 and gold in V3; BL nodes are pink in V3 and teal in V4. The observed color grouping therefore reads as view-local rather than a fixed identity color. No meaning beyond that observation is asserted.

The independently readable complete directed-link totals are 4 in V1, 4 in V2, 8 in V3, and 10 in V4, with two additional V4 text-interrupted candidates left qualified. These are observations, not expected-edge scores. No absent connection is supplied from datacenter conventions. Unknown label ownership remains unknown. No full verdict or Stage B comparison is made here.
