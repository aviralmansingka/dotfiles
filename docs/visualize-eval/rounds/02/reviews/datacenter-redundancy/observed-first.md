# Datacenter redundancy — round 02, Stage A blind observation

## Scope and evidence

This is a capture-first record, made before receiving expectations. I read the Stage-A contract and only this case's supplied capture files. I did not read a source brief, expected relationships, rubric, dataset manifest, other cases, or earlier-round results. I did not use specs, check output, validation results, or generator claims as visual proof. I did not start a viewer, re-render, change a diagram, or delegate.

Evidence inspected for each of `v1`, `v2`, `v3`, and `v4`, under `docs/visualize-eval/rounds/02/datacenter-redundancy/evidence/<view>/`:

- `<view>-text.txt`: visible layout, words, borders, arrowheads, and crossing glyphs.
- `<view>-ansi.ansi`: actual foreground/background runs and border continuity.
- `<view>-selected.ansi`: all-selected border glyphs, color, and bold attributes.
- `<view>-frames.txt`: five timestamped frames, at 0, 100, 200, 300, and 400 ms.
- `<view>-frames.ansi`: the corresponding transcript. Its diagram frames contain plain characters without diagram foreground colors; ANSI styling is present in the shell transcript. It therefore does **not** establish timed-frame border colors. Normal and selected ANSI screen captures do establish border colors in those two states.

No required capture is missing or unreadable. Local, capture-only Python inspection used `uv`, decoded SGR attributes, enumerated cells, and followed visible line/corner/bridge glyphs. No renderer or skill source was consulted. The decoded normal ANSI screens match their text captures after trailing blank padding is disregarded.

## Coordinate and counting conventions

- Coordinates are 1-based terminal cells. `[column,row,width,height]` starts at the screen's first row, including its title row. Coordinates reset to the title row for each timestamped screen, not the beginning of its shell transcript.
- `(column,row)` denotes a single cell or turning point.
- Node/edge counts are occurrences across the four final views, not deduplicated conceptual entities. There are 24 node occurrences and 18 distinct node names.
- A visible label is a contiguous readable diagram text run. Thus `dualdual` counts as **one visible run**, not two separately delineated labels. There are 47 diagram label runs: 24 node labels and 23 edge-area label runs. Splitting the obvious repeated substring in `dualdual` would yield 48 lexical label units, but that split is not visibly delimited.
- UI title/control text is transcribed separately and excluded from diagram-label counts. Including it gives 67 text runs (47 diagram + 20 UI).
- An uncertain owner means I cannot confidently assign that occurrence of a label to one particular nearby route from the capture alone. This is a conservative spatial-readability judgment, not an assertion that the text is absent or its intended relationship is wrong. The specific occurrences are listed below.
- A crossing count counts a visible `⌒` cell once, not once per participating route. Touching but nonconnecting bends are recorded separately.

## Blind scorecard

| View | Visible nodes | Visible arrows/routes | Diagram label runs | Crossing/bridge cells | Uncertain label-owner runs | Fused runs | Clipped items observed | Selected coverage | Observed dot violations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 | 8 | 8 | 12 | 1 | 3 | 0 | 0 | 8/8 | 0 |
| v2 | 6 | 8 | 14 | 2 | 3 | 0 | 0 | 6/6 | 0 |
| v3 | 6 | 8 | 14 | 8 | 6 | 0 | 0 | 6/6 | 0 |
| v4 | 4 | 4 | 7 | 1 | 2 | 1 | 0 | 4/4 | 0 |
| **Total** | **24** | **28** | **47** | **12** | **14** | **1** | **0** | **24/24** | **0** |

The fused run contains two touching `dual` substrings. If counting those as two label units, uncertain ownership is 15 units instead of 14 runs. All 28 arrows have visible arrowheads and recoverable source-to-target routes when the corner orientations and bridge convention are followed carefully. This is not a claim that the dense areas are readable at a glance. There are seven pairs of edge-adjacent bends on different routes, plus bridge-to-bend contacts detailed below. No explicit junction glyph or unambiguous branching bus is visible.

Every view has a supplied measured token exactly `viewport: 77x47 zoom: 1.00 natural`. Each normal and selected ANSI screen contains 47 rows of 77 cells. All visible diagram content fits at the displayed 100%; no visible item needs pan or zoom. No capture establishes what might exist outside the captured frame, and I make no completeness claim against an unseen specification.

Tool-usable summary:

```json
{
  "stage": "A",
  "case": "datacenter-redundancy",
  "views": 4,
  "visible_node_occurrences": 24,
  "visible_edges": 28,
  "visible_arrowheads": 28,
  "visible_diagram_label_runs": 47,
  "node_label_runs": 24,
  "edge_area_label_runs": 23,
  "ui_text_runs": 20,
  "crossings": 12,
  "bridge_glyphs": 12,
  "uncertain_label_owner_runs": 14,
  "uncertain_label_units_if_fused_substrings_split": 15,
  "fused_label_runs": 1,
  "touching_distinct_route_bend_pairs": 7,
  "explicit_junction_glyphs": 0,
  "unambiguous_branch_junctions": 0,
  "clipped_items_observed": 0,
  "selected_state_covered": 24,
  "selected_state_total": 24,
  "normal_border_color_checked": 24,
  "selected_border_color_checked": 24,
  "node_borders_uncheckable_in_normal_or_selected_capture": 0,
  "animated_routes": 28,
  "timestamped_frames_per_view": 5,
  "timestamped_route_dot_observations": 140,
  "dot_count_violations_observed": 0,
  "dots_on_corners_bridges_junctions_or_arrowheads_observed": 0,
  "dot_violations_observed": 0,
  "measured_viewport": "77x47",
  "viewport_token": "viewport: 77x47 zoom: 1.00 natural",
  "unreadable_or_missing_required_capture_files": 0,
  "timed_frame_color_evidence": false
}
```

## UI text, all views

These strings and coordinates are the same in normal, selected, and timestamped screens, apart from the view identifier and counts in the title.

| View | Verbatim title | Bounds |
|---|---|---|
| v1 | `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 8 edges · q quit` | [2,1,66,1] |
| v2 | `rataflow-view · 77x47 @100% · v2.json · 6 nodes · 8 edges · q quit` | [2,1,66,1] |
| v3 | `rataflow-view · 77x47 @100% · v3.json · 6 nodes · 8 edges · q quit` | [2,1,66,1] |
| v4 | `rataflow-view · 77x47 @100% · v4.json · 4 nodes · 4 edges · q quit` | [2,1,66,1] |

The four control labels in **each** view are `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], and `□ [i]` [4,45,5,1]. The control box is [2,41,9,6], with complete square corners and sides in RGB (168,153,104). It is not a node. Label foreground is RGB (235,219,178); background is RGB (40,40,40). The title is muted RGB (102,92,84).

The timestamp metadata reads `frame 0 at 0ms`, `frame 1 at 100ms`, `frame 2 at 200ms`, `frame 3 at 300ms`, and `frame 4 at 400ms`. These are transcript metadata, not labels placed inside the diagram viewport. Shell prompts and launch commands are not diagram labels.

## v1

### Every diagram label

| Verbatim label | Bounds | Kind |
|---|---|---|
| `ISP A` | [20,6,5,1] | node |
| `ISP B` | [32,6,5,1] | node |
| `ISP C` | [43,6,5,1] | node |
| `ISP D` | [54,6,5,1] | node |
| `MUX 1` | [20,24,5,1] | node |
| `MUX 2` | [32,24,5,1] | node |
| `x-connect` | [23,33,9,1] | edge-area label; uncertain owner |
| `x-connect` | [36,33,9,1] | edge-area label; nearest MUX 2 → Core 2 |
| `x-connect` | [23,36,9,1] | edge-area label; uncertain owner |
| `x-connect` | [24,38,9,1] | edge-area label; uncertain owner |
| `Core 1` | [19,42,6,1] | node |
| `Core 2` | [31,42,6,1] | node |

No fused words are visible here. The two `x-connect` labels starting at column 23 extend between the route at column 22 and the route at column 32. Their identical placement beside the same pair of verticals does not give a clear one-label-per-route assignment. The label at [24,38,9,1] is between the crossing horizontal at row 37 and the lower return bend at row 39, near multiple verticals. Those three occurrences have uncertain owners. The label at [36,33,9,1] is outside the rightmost vertical (column 34) and has the clearest attachment.

### Borders and colors

Each listed node has all four corners and all four sides complete in both the normal and selected ANSI capture. Each perimeter is a single continuous foreground color. All selected perimeters are RGB (216,166,87), **bold on every border cell**. Normal perimeters are not bold. The first node's normal RGB already equals the selected RGB; bold still distinguishes its selected state.

| Node | Box bounds | Perimeter cells checked in each state | Normal border RGB |
|---|---|---:|---|
| ISP A | [19,5,7,4] | 18 | (216,166,87) |
| ISP B | [31,5,7,4] | 18 | (228,184,111) |
| ISP C | [42,5,7,4] | 18 | (200,147,68) |
| ISP D | [53,5,7,4] | 18 | (239,202,138) |
| MUX 1 | [19,23,7,4] | 18 | (125,174,163) |
| MUX 2 | [31,23,7,4] | 18 | (147,194,183) |
| Core 1 | [18,41,8,4] | 20 | (211,134,155) |
| Core 2 | [30,41,8,4] | 20 | (226,156,175) |

Coverage: normal 8/8, selected 8/8; uncheckable node occurrences 0. This is an all-selected capture, not evidence of eight separate interactive selection events.

### Every arrow and complete route

The table gives the first cell outside the source, every turning point in travel order, and the arrowhead cell. Straight segments connect successive points. Crossings do not turn a route. Every row has a visible `▼` and can be followed without inventing a connection, although the top center and lower bridge require careful reading. All routes are solid and muted RGB (124,111,100).

| ID | Source → target | Start; successive turns; arrowhead | Direction |
|---|---|---|---|
| 1A | ISP A → MUX 1 | (20,9); no turns; ▼(20,22) | down |
| 1B | ISP B → MUX 1 | (32,9); (32,20), (22,20); ▼(22,22) | down, left, down |
| 1C | ISP C → MUX 2 | (43,9); (43,20), (33,20), (33,21), (32,21); ▼(32,22) | down, left, down, left, down |
| 1D | ISP D → MUX 2 | (54,9); (54,21), (34,21); ▼(34,22) | down, left, down |
| 1E | MUX 1 → Core 1 | (20,27); (20,39), (19,39); ▼(19,40) | down, left, down |
| 1F | MUX 1 → Core 2 | (22,27); (22,39), (31,39); ▼(31,40) | down, right, down |
| 1G | MUX 2 → Core 1 | (32,27); (32,37), (21,37); ▼(21,40) | down, left, down |
| 1H | MUX 2 → Core 2 | (34,27); (34,39), (33,39); ▼(33,40) | down, left, down |

Crossing: `⌒` at (22,37), between vertical 1F and horizontal 1G. It is immediately right of 1G's bend at (21,37). It is not a junction or branch.

Touching distinct-route bend pairs:

1. 1B `╯`(32,20) is directly beside 1C `╭`(33,20).
2. 1B `╯`(32,20) is directly above 1C `╭`(32,21).
3. 1C `╯`(33,21) is directly beside 1D `╭`(34,21).

The center is a compact, branch-like knot at first glance, but the corner opening directions separate the paths. No `┬`, `┴`, `├`, `┤`, or `┼` junction is visible. The route table lists every non-node bend, including the adjacent bends belonging to the same route.

### Motion

Each table entry is the sole dot's coordinate. There is exactly one dot per route in every frame (eight dots per frame). There is no within-route inter-dot spacing to measure. All eight move down one cell per 100 ms over these samples.

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms |
|---|---|---|---|---|---|
| 1A | (20,10) | (20,11) | (20,12) | (20,13) | (20,14) |
| 1B | (32,10) | (32,11) | (32,12) | (32,13) | (32,14) |
| 1C | (43,10) | (43,11) | (43,12) | (43,13) | (43,14) |
| 1D | (54,10) | (54,11) | (54,12) | (54,13) | (54,14) |
| 1E | (20,28) | (20,29) | (20,30) | (20,31) | (20,32) |
| 1F | (22,28) | (22,29) | (22,30) | (22,31) | (22,32) |
| 1G | (32,28) | (32,29) | (32,30) | (32,31) | (32,32) |
| 1H | (34,28) | (34,29) | (34,30) | (34,31) | (34,32) |

No sampled dot is on a corner, bridge, junction, or arrowhead. These five frames do not show the dots reaching the lower bends, so they cannot prove safe placement for an entire cycle.

### Fit

Measured `77x47`, token `viewport: 77x47 zoom: 1.00 natural`; title says `@100%`. Diagram bounds, including labels and route cells, are within columns 18–59 and rows 5–44. No node, word, arrowhead, or route visibly clips. The lower nodes are to the right of the control box, not covered by it.

## v2

### Every diagram label

| Verbatim label | Bounds | Kind |
|---|---|---|
| `Core 1` | [28,6,6,1] | node |
| `Core 2` | [45,6,6,1] | node |
| `active` | [31,14,6,1] | edge-area label; uncertain owner |
| `standby` | [32,15,7,1] | edge-area label; nearest Core 1 → FW2 standby |
| `active` | [34,18,6,1] | edge-area label; above Core 2 → FW1 active horizontal |
| `standby` | [40,20,7,1] | edge-area label; uncertain owner |
| `FW1 active` | [26,24,10,1] | node |
| `FW2 standby` | [42,24,11,1] | node |
| `standby` | [46,31,7,1] | edge-area label; nearest FW2 standby → BL 2 |
| `standby` | [35,33,7,1] | edge-area label; immediately left of FW2 standby → BL 1 vertical |
| `active` | [34,36,6,1] | edge-area label; above FW1 active → BL 2 horizontal |
| `active` | [28,38,6,1] | edge-area label; uncertain owner |
| `BL 1` | [29,42,4,1] | node |
| `BL 2` | [46,42,4,1] | node |

No fused labels. Three owner uncertainties:

- `active` [31,14,6,1] starts immediately beside the **dashed** column-30 route, while the solid column-28 route is two columns farther left. The text's apparent proximity does not uniquely associate it with one of those paths.
- `standby` [40,20,7,1] sits below the solid upper horizontal's right bend and just left of the dashed column-47 route.
- `active` [28,38,6,1] sits directly below the column-28-to-46 solid horizontal and above the nearby lower return bend of another solid route.

These are spatial observations; I am not resolving them by the words `active` and `standby` alone.

### Borders and colors

All four sides/corners are complete and color-continuous for each node in normal and selected ANSI. Selected borders are uniformly bold RGB (216,166,87); normal borders are not bold.

| Node | Box bounds | Perimeter cells checked in each state | Normal border RGB |
|---|---|---:|---|
| Core 1 | [27,5,8,4] | 20 | (216,166,87) |
| Core 2 | [44,5,8,4] | 20 | (228,184,111) |
| FW1 active | [25,23,12,4] | 28 | (125,174,163) |
| FW2 standby | [41,23,13,4] | 30 | (147,194,183) |
| BL 1 | [28,41,6,4] | 16 | (211,134,155) |
| BL 2 | [45,41,6,4] | 16 | (226,156,175) |

Normal 6/6, selected 6/6, uncheckable 0. As above, these are simultaneous all-selected states.

### Every arrow and complete route

All arrowheads are visible `▼`; all eight full routes can be followed using the displayed glyphs, with extra attention needed at the upper close-packed bends. Lines/arrowheads are muted RGB (124,111,100).

| ID | Source → target | Start; successive turns; arrowhead | Direction and style |
|---|---|---|---|
| 2A | Core 1 → FW1 active | (28,9); (28,20), (26,20); ▼(26,22) | down, left, down; solid |
| 2B | Core 1 → FW2 standby | (30,9); (30,21), (42,21); ▼(42,22) | down, right, down; dashed |
| 2C | Core 2 → FW1 active | (45,9); (45,19), (29,19), (29,21), (28,21); ▼(28,22) | down, left, down, left, down; solid |
| 2D | Core 2 → FW2 standby | (47,9); (47,21), (44,21); ▼(44,22) | down, left, down; dashed |
| 2E | FW1 active → BL 1 | (26,27); (26,39), (29,39); ▼(29,40) | down, right, down; solid |
| 2F | FW1 active → BL 2 | (28,27); (28,37), (46,37); ▼(46,40) | down, right, down; solid |
| 2G | FW2 standby → BL 1 | (42,27); (42,39), (31,39); ▼(31,40) | down, left, down; dashed |
| 2H | FW2 standby → BL 2 | (44,27); (44,35), (48,35); ▼(48,40) | down, right, down; dashed |

Crossings:

- `⌒`(30,19): vertical dashed 2B crosses horizontal solid 2C. It directly abuts 2C's bend `╭`(29,19).
- `⌒`(42,37): horizontal solid 2F crosses vertical dashed 2G.

Touching distinct-route bend pairs:

1. 2A `╯`(28,20) directly above 2C `╭`(28,21).
2. 2C `╯`(29,21) directly beside 2B `╰`(30,21).

At the upper cluster the paths can look joined, but the corners separate them. There is no explicit junction glyph or true visible branch. Every non-node bend is in the route table.

### Motion

Exactly one dot on each route in every timestamped frame, eight total per frame. All sampled dots move down one cell each 100 ms, including those on dashed paths. There is no multiple-dot spacing on an individual route.

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms |
|---|---|---|---|---|---|
| 2A | (28,10) | (28,11) | (28,12) | (28,13) | (28,14) |
| 2B | (30,10) | (30,11) | (30,12) | (30,13) | (30,14) |
| 2C | (45,10) | (45,11) | (45,12) | (45,13) | (45,14) |
| 2D | (47,10) | (47,11) | (47,12) | (47,13) | (47,14) |
| 2E | (26,28) | (26,29) | (26,30) | (26,31) | (26,32) |
| 2F | (28,28) | (28,29) | (28,30) | (28,31) | (28,32) |
| 2G | (42,28) | (42,29) | (42,30) | (42,31) | (42,32) |
| 2H | (44,28) | (44,29) | (44,30) | (44,31) | (44,32) |

No sampled dot occupies a corner, bridge, junction, or arrowhead. The dots do not reach the relevant crossings during this sample window; a full-cycle guarantee is not available.

### Fit

Measured `77x47`; exact token `viewport: 77x47 zoom: 1.00 natural`; `@100%`. Diagram content is within columns 25–53 and rows 5–44. No visible clipping or control-box occlusion; no pan or zoom needed to read the captured diagram.

## v3

### Every diagram label

| Verbatim label | Bounds | Kind |
|---|---|---|
| `Spine 2` | [31,17,7,1] | node |
| `Spine 1` | [18,18,7,1] | node |
| `ECMP` | [36,20,4,1] | edge-area label; uncertain owner |
| `ECMP` | [35,22,4,1] | edge-area label; uncertain owner |
| `ECMP` | [54,22,4,1] | edge-area label; nearest outer BL 1 → Spine 1 route |
| `ECMP` | [23,25,4,1] | edge-area label; uncertain owner |
| `ECMP` | [30,25,4,1] | edge-area label; uncertain owner |
| `ECMP` | [36,25,4,1] | edge-area label; uncertain owner |
| `ECMP` | [17,27,4,1] | edge-area label; uncertain owner |
| `BL 2` | [20,29,4,1] | node |
| `Leaf 1` | [32,29,6,1] | node |
| `Leaf 2` | [44,29,6,1] | node |
| `BL 1` | [56,30,4,1] | node |
| `ECMP` | [38,32,4,1] | edge-area label; nearest bottom BL 1 → Spine 2 route |

No words fuse with each other, but labels frequently sit against route cells. Six uncertain owners:

- [36,20,4,1] ends against the column-40 vertical, while sitting above the Spine 2 → Leaf 2 horizontal at row 21.
- [35,22,4,1] is immediately right of a bend at (34,22), below one horizontal and above another. Multiple routes surround it.
- [23,25,4,1] is below the row-24 horizontal and ends next to the column-27 vertical.
- [30,25,4,1] fills the space directly between verticals at columns 29 and 34, with no blank cell between either end of the word and those lines.
- [36,25,4,1] is below the long row-24 horizontal and near the column-34 vertical. Its ownership is not uniquely indicated.
- [17,27,4,1] is both beside the left outer up-route and just below the row-26 horizontal.

The eight equal `ECMP` words remain readable as words. That does not make their individual edge assignments obvious.

### Borders and colors

Every node has complete sides/corners, a single continuous normal border RGB, and a complete uniformly bold selected RGB (216,166,87) perimeter. Normal perimeters are not bold. Side-attached edges meet the outside of boxes without replacing the actual side-border cells. The asymmetric box heights and the displaced BL boxes are visible facts, not inferred grouping.

| Node | Box bounds | Perimeter cells checked in each state | Normal border RGB |
|---|---|---:|---|
| Spine 1 | [17,16,9,5] | 24 | (216,166,87) |
| Spine 2 | [30,16,9,4] | 22 | (228,184,111) |
| BL 2 | [19,28,6,4] | 16 | (147,194,183) |
| Leaf 1 | [31,28,8,4] | 20 | (99,151,141) |
| Leaf 2 | [43,28,8,4] | 20 | (168,211,200) |
| BL 1 | [55,28,6,5] | 18 | (125,174,163) |

Normal 6/6, selected 6/6, uncheckable 0. Selection is shown simultaneously for all six.

### Every arrow and complete route

All routes are solid muted RGB (124,111,100). There are four down arrowheads entering Leaf boxes and four lateral arrowheads entering Spine boxes. A patient cell-by-cell trace is possible for all eight; the dense crossings and remote side-entry loops make the view much harder to scan than the word count suggests. The table uses the visible glyphs, not an expected topology.

| ID | Source → target | Start; successive turns; arrowhead | Direction |
|---|---|---|---|
| 3A | Spine 1 → Leaf 1 | (18,21); (18,26), (32,26); ▼(32,27) | down, right, down |
| 3B | Spine 1 → Leaf 2 | (20,21); (20,24), (44,24); ▼(44,27) | down, right, down |
| 3C | Spine 2 → Leaf 1 | (31,20); (31,22), (34,22); ▼(34,27) | down, right, down |
| 3D | Spine 2 → Leaf 2 | (33,20); (33,21), (46,21); ▼(46,27) | down, right, down |
| 3E | BL 2 → Spine 1 | (18,29); (15,29), (15,19); ▶(16,19) | left, up, right |
| 3F | BL 2 → Spine 2 | (25,29); (29,29), (29,23), (40,23), (40,17); ◀(39,17) | right, up, right, up, left |
| 3G | BL 1 → Spine 1 | (54,29); (52,29), (52,14), (15,14), (15,17); ▶(16,17) | left, up, left, down, right |
| 3H | BL 1 → Spine 2 | (54,31); (52,31), (52,33), (27,33), (27,17); ▶(29,17) | left, down, left, up, right |

All eight arrowheads are present. The Spine 2 box has an inward arrow on **both** its left and right sides; the right-side arrow at (39,17) points left, not away from the box. The Spine 1 box receives two right-pointing arrows at different side rows.

Every crossing/bridge cell:

| `⌒` cell | Horizontal route | Vertical route |
|---|---|---|
| (40,21) | 3D | 3F |
| (34,23) | 3F | 3C |
| (27,24) | 3B | 3H |
| (29,24) | 3B | 3F |
| (34,24) | 3B | 3C |
| (27,26) | 3A | 3H |
| (29,26) | 3A | 3F |
| (27,29) | 3F | 3H |

Dense contacts worth noting:

- The `⌒` cells at (34,23) and (34,24) are immediately one above the other, with the (34,22) bend directly above them. This looks like a small branch cluster, but the straight-through bridge convention preserves three separate routes.
- The bridge at (29,24) is directly below 3F's turn (29,23).
- At row 26, bridges (27,26) and (29,26) are separated by only one horizontal cell. The row-24 pair at columns 27 and 29 has the same spacing.
- The bridge at (27,29) is in the horizontal leaving BL 2, adjacent to the vertical looping up from the bottom. It does not show BL 2 feeding a shared bus.

There are no edge-adjacent **distinct-route bend-to-bend** pairs in this view, despite its many bend/bridge contacts. All non-node bends are enumerated in the route table. No explicit junction glyph, shared-run branch, or trunk label is visible. Spatial adjacency is not sufficient evidence of a junction.

### Motion

Each route has exactly one dot in each frame, eight dots total per timestamp. The entries are in travel order toward the arrowhead, including left/up motion on the BL routes. A single route never shows multiple dots, so within-route dot spacing is not applicable.

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms |
|---|---|---|---|---|---|
| 3A | (18,22) | (18,23) | (18,24) | (18,25) | (19,26) |
| 3B | (20,22) | (20,23) | (21,24) | (22,24) | (23,24) |
| 3C | (31,21) | (32,22) | (33,22) | (34,25) | (34,26) |
| 3D | (34,21) | (35,21) | (36,21) | (37,21) | (38,21) |
| 3E | (17,29) | (16,29) | (15,28) | (15,27) | (15,26) |
| 3F | (26,29) | (28,29) | (29,28) | (29,27) | (29,25) |
| 3G | (53,29) | (52,28) | (52,27) | (52,26) | (52,25) |
| 3H | (53,31) | (52,32) | (51,33) | (50,33) | (49,33) |

Cadence: samples are uniformly 100 ms apart, usually one straight cell of visible progress. Progress jumps across excluded corner/bridge cells:

- 3A crosses its (18,26) bend between 300 and 400 ms.
- 3B skips its (20,24) bend between 100 and 200 ms.
- 3C moves from (33,22) to (34,25) between 200 and 300 ms, skipping the bend and two consecutive bridge cells. This is a conspicuous multi-cell jump, not a dot shown at those intermediate cells.
- 3E skips the (15,29) bend between 100 and 200 ms.
- 3F skips the (27,29) bridge, its (29,29) bend, and later the (29,26) bridge in separate steps.
- 3G skips the (52,29) bend between 0 and 100 ms.
- 3H skips (52,31) and (52,33) bends in successive early transitions.

No sampled dot occupies a corner, bridge, junction, or arrowhead. Dot counts do not disappear during the jumps. The capture proves these five sampled placements, not every time instant or a full circuit.

### Fit

Measured `77x47`; exact token `viewport: 77x47 zoom: 1.00 natural`; `@100%`. All diagram content is within columns 15–60 and rows 14–33. The two long outside return routes, the BL boxes, and the far-right `ECMP` label are visible. Nothing visibly clips or needs pan/zoom. Ample blank screen area coexists with the dense central crossing region.

## v4

### Every diagram label

| Verbatim visible label | Bounds | Kind |
|---|---|---|
| `Leaf 1` | [30,19,6,1] | node |
| `Leaf 2` | [42,19,6,1] | node |
| `dualdual` | [33,22,8,1] | fused edge-area run; uncertain owner(s) |
| `dual` | [35,25,4,1] | edge-area label; uncertain owner |
| `dual` | [38,26,4,1] | edge-area label; immediately before Rack 2's left arrowhead |
| `Rack 1` | [30,28,6,1] | node |
| `Rack 2` | [42,28,6,1] | node |

The fused text is literally **`dualdual`**, in one continuous beige ANSI run with no blank, border, punctuation, or color separator between the two repeated substrings. For locating the fusion only, the substrings occupy [33,22,4,1] and [37,22,4,1]; they are not independently delineated labels in the capture.

The fused run lies between verticals at columns 32 and 42 and just above the upper cross-link horizontal, so its two putative owners are not separable visually. The `dual` at [35,25,4,1] lies below the row-24 cross-link horizontal and to the right of the other link's lower bends; this is the second uncertain visible run. The `dual` at [38,26,4,1] directly abuts the arrowhead at (42,26), making its local association clearer even though there is no separating blank before the arrow.

### Borders and colors

Every node perimeter has four complete sides/corners and continuous color in normal and selected ANSI. Selected borders are uniformly bold RGB (216,166,87), including the normal-gold Leaf 1 border; normal borders are not bold.

| Node | Box bounds | Perimeter cells checked in each state | Normal border RGB |
|---|---|---:|---|
| Leaf 1 | [29,18,8,4] | 20 | (216,166,87) |
| Leaf 2 | [41,18,8,4] | 20 | (228,184,111) |
| Rack 1 | [29,27,8,4] | 20 | (125,174,163) |
| Rack 2 | [41,27,8,4] | 20 | (147,194,183) |

Normal 4/4, selected 4/4, uncheckable 0; selection shown simultaneously.

### Every arrow and complete route

All four solid routes have visible `▼` arrowheads; muted RGB (124,111,100). All are recoverable end-to-end by following the corner and bridge orientations. The two crossing paths are especially tightly packed.

| ID | Source → target | Start; successive turns; arrowhead | Direction |
|---|---|---|---|
| 4A | Leaf 1 → Rack 1 | (30,22); no turns; ▼(30,26) | down |
| 4B | Leaf 1 → Rack 2 | (32,22); (32,24), (42,24); ▼(42,26) | down, right, down |
| 4C | Leaf 2 → Rack 1 | (42,22); (42,23), (33,23), (33,25), (32,25); ▼(32,26) | down, left, down, left, down |
| 4D | Leaf 2 → Rack 2 | (44,22); no turns; ▼(44,26) | down |

Crossing: `⌒`(33,24) carries horizontal 4B across vertical 4C. It directly abuts 4B's `╰`(32,24) on its left, 4C's `╭`(33,23) above, and 4C's `╯`(33,25) below. This is an apparent branch-like knot, but there is no junction glyph.

Touching distinct-route bend pairs:

1. 4B `╰`(32,24) directly above 4C `╭`(32,25).
2. 4C `╯`(42,23) directly above 4B `╮`(42,24).

The route table enumerates every non-node bend. The adjacent corners must not be read as additional connections.

### Motion

One dot per route per frame, four total at every timestamp. There is no within-route multiple-dot spacing.

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms |
|---|---|---|---|---|---|
| 4A | (30,23) | (30,24) | (30,25) | (30,23) | (30,24) |
| 4B | (32,23) | (34,24) | (35,24) | (36,24) | (37,24) |
| 4C | (41,23) | (40,23) | (39,23) | (38,23) | (37,23) |
| 4D | (44,23) | (44,24) | (44,25) | (44,23) | (44,24) |

4A and 4D move down one cell per 100 ms, then visibly wrap from row 25 back to row 23 at 300 ms; no dot appears on their row-26 arrowheads. The displayed short-route sequence repeats after 300 ms. 4B moves down/right and jumps from (32,23) to (34,24), skipping its bend (32,24) and the bridge (33,24); it then advances right one cell per 100 ms. 4C advances left one cell per 100 ms. At 400 ms the two cross-link dots lie directly above/below one another at (37,23) and (37,24); they remain distinct, not a junction.

No sampled dot is on a corner, bridge, junction, or arrowhead. Safe placement beyond these samples is not established.

### Fit

Measured `77x47`; exact token `viewport: 77x47 zoom: 1.00 natural`; `@100%`. All diagram content is within columns 29–48 and rows 18–30. Nothing visibly clips or requires pan or zoom. The fused `dualdual` is a label-separation problem, not viewport clipping.

## Evidence limits and blind conclusions

- **Borders:** 24/24 normal node occurrences and 24/24 selected node occurrences can be checked for complete sides, corners, and foreground continuity. None is uncheckable in those screen captures. Every selected perimeter carries the gold foreground plus bold. The timestamped frame transcripts lack colored diagram cells, so timed color continuity cannot be checked for any node from those frames alone.
- **Motion:** 28 routes × five sampled timestamps = 140 route-dot observations, with exactly one dot per route per sample and zero sampled placements on special route cells. The step cadence is 100 ms; spatial progress is not uniform where corners/bridges are skipped. Only v4's shortest paths visibly wrap in the sample window. No unsampled whole-cycle promise is made.
- **Topology:** 28 visible arrowheads, each on a route traceable through the displayed corner orientations. Twelve bridge cells are present, most concentrated in v3. Seven distinct-route bend pairs touch edge-to-edge. These contacts can look branch-like, but there is no explicit branch/junction glyph to justify adding a connection.
- **Labels:** all transcribed words can be read. Fourteen edge-area text runs have conservative owner uncertainty, especially in v3. One run in v4 is visibly fused. Reading the words is easier than uniquely assigning them to edges.
- **Fit:** all four supplied viewports measure 77×47 at 100%. There are no observed clipped diagram items or captured items requiring pan/zoom. This is not a comparison with unseen expected content.
- No missing file or unsupported capture format prevented observation. The one evidence limitation is missing **diagram color attributes in timestamped frames**, despite their `.ansi` filename; color conclusions above are deliberately limited to the normal and selected ANSI screens.

This record is frozen at Stage A. It contains no comparison with source requirements or scoring rubric.
