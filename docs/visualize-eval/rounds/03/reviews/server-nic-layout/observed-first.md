# Blind observation — round 03 / server-nic-layout / stage A

This record describes the three final views only. No source, expectations, rubric, dataset manifest, other case, or earlier round was consulted. No viewer was started and nothing was fixed. The rejected v3 capture and nonfinal attempts were not used to judge the finals.

## Evidence and coordinate convention

Read the final specs `v1-attempt3.json`, `v2-attempt2.json`, `v3-attempt1.json` and each final evidence directory's `check.txt`, text, ordinary ANSI, selected ANSI, text frames, and ANSI frames. Coordinates below are 1-based terminal cells, including the status row as row 1. Rectangles use `[column,row,width,height]`; points use `(column,row)`. Label rectangles contain the actual text, not padding. All observed characters occupy one cell.

ANSI supplies 47 rows of 77 cells in every ordinary and selected capture. Text exports omit the final blank row and trailing row padding; their visible cells agree with ANSI. Frame captures provide three 47-row grids at 0, 100, and 200 ms. Within each view, all three text grids are identical and all three full ANSI grids are identical. The frame grids agree with the ordinary text export after trailing whitespace normalization.

## View v1 — hardware and shared bus

### Visible graph labels

| Kind | Verbatim label | Rectangle |
|---|---|---|
| Node | `7 ports dark` | [14,12,12,1] |
| Node | `server1 R7725` | [13,20,13,1] |
| Node | `server2 .59` | [14,28,11,1] |
| Node | `eno16595np0 25G` | [32,28,15,1] |
| Node | `.60-.62 free` | [53,28,12,1] |
| Node | `Arista .57` | [15,35,10,1] |
| Route | `no cable` | [16,16,8,1] |
| Route | `only uplink` | [17,24,11,1] |
| Trunk | `.58/29 no NAT` | [31,34,13,1] |

### Visible arrows and complete route tracing

There are five visible arrowheads, not merely the two edges reported by the status row. Three belong to the shared bus and its spurs.

| Source box | Target box | Trace, in travel order | Arrowhead | Whole route traceable? |
|---|---|---|---|---|
| `7 ports dark` | `server1 R7725` | Leaves bottom at column 14; dashed vertical through rows 15–16; touching turns `(14,17) ╯` and `(13,17) ╭`; downward to target top | Intact `▼` at (13,18) | Yes |
| `server1 R7725` | `eno16595np0 25G` | Leaves bottom at column 13; down through rows 23–24; `(13,25) ╰`, right to `(32,25) ╮`, down | Intact `▼` at (32,26) | Yes |
| `Arista .57` | `server2 .59` | Leaves right at (26,35); shared horizontal bus to junction (28,35); spur up column 28 to `(28,28) ╮`, then left | Intact `◀` at (26,28) | Yes, including the explicit branch |
| `Arista .57` | `eno16595np0 25G` | Same bus continues right to `(49,35) ╯`, then up column 49 through the junction at (49,29) to `(49,28) ╮`, then left | Intact `◀` at (48,28) | Yes |
| `Arista .57` | `.60-.62 free` | Same bus and column-49 run to junction (49,29); right to `(50,29) ╯`, up to `(50,28) ╭`, then right | Intact `▶` at (51,28) | Yes |

The `no cable` route visibly uses dashed vertical glyphs; its short turns and arrowhead are solid glyphs. The other routes are solid. Arrowheads are adjacent to, rather than replacements for, the target borders.

### Junctions, crossings, touching bends, and label ownership

The bus is one connected horizontal corridor on row 35, not several separately drawn parallel corridors. Two explicit junctions are visible: `┴` at (28,35), branching up toward `server2 .59`, and `├` at (49,29), branching right toward `.60-.62 free` while continuing up toward the NIC. The shared corridor is intentional and has no independent crossing bridge.

All route bends are enumerated in the tracing table. Especially tight cells are `(49,28) ╮` beside `(50,28) ╭`, and `(49,29) ├` beside `(50,29) ╯`. These form the compact NIC/spare fork; they do not look like an extra unrelated edge. The two adjacent bends at (13,17) and (14,17) are a one-cell lateral dogleg on one route.

Visible independent-route crossings: **0**. Visible explicit branch junctions: **2**. `check.txt` reports `crossings: 2`; that number must not be mistaken for two visibly bridged independent crossings. No bridge glyph occurs here.

`no cable` sits to the right of the dark-to-server1 vertical. `only uplink` is just above the long server1-to-NIC horizontal run. `.58/29 no NAT` sits immediately above the bus, between its spurs. All three owners are recoverable; uncertain label owners: **0**. No label occupies a visible route cell.

### Node borders and color

For every row below, top, bottom, left, and right sides are complete, all four rounded corners `╭╮╰╯` are present, and no route erases a border cell. ANSI confirms one continuous normal foreground RGB on the entire perimeter. The selected capture includes that node's entire perimeter in bold RGB (216,166,87), again continuous on all sides and corners.

| Node | Border rectangle | Normal border RGB | Selected complete |
|---|---|---|---|
| `7 ports dark` | [13,11,14,4] | (216,166,87) | Yes |
| `server1 R7725` | [12,19,15,4] | (228,184,111) | Yes |
| `server2 .59` | [13,27,13,4] | (125,174,163) | Yes |
| `eno16595np0 25G` | [31,27,17,4] | (200,147,68) | Yes |
| `.60-.62 free` | [52,27,14,4] | (211,134,155) | Yes |
| `Arista .57` | [14,34,12,4] | (169,182,101) | Yes |

### Fit and motion

Measured capture: **77 × 47**, status `@100%`. Captured runtime line: `viewport: 77x47 zoom: 1.00 natural`. Check-only line: `viewport: unknown zoom: 1.00 natural`; check extent is `55x28 cells`. Actual nonblank graph rectangle, including labels and borders but excluding UI, is [12,11,54,27]. All six boxes, five arrowheads, routes, and labels are visible without pan or zoom. No clipping or UI occlusion is visible.

Frames 0/100/200 ms contain **0 dots each** and show **no motion**. There are no animated routes. Dot spacing, motion direction, corner/bridge/arrowhead occupancy, frame-0 origin, and synchronized arrival are not applicable. Observed dot violations: **0**.

## View v2 — downward chain

### Visible graph labels

| Kind | Verbatim label | Rectangle |
|---|---|---|
| Node | `103.19.91.58 v4-only` | [29,8,20,1] |
| Node | `Arista ToR 103.19.91.57 AS132717` | [23,16,32,1] |
| Node | `Airtel 14.143.x, no ECMP` | [27,24,24,1] |
| Node | `Airtel bb 14.141.x` | [30,32,18,1] |
| Node | `Cloudflare 1.1.1.1 AS13335` | [26,40,26,1] |
| Route | `0.1 ms` | [23,12,6,1] |
| Route | `1.8 ms` | [24,20,6,1] |
| Route | `7.1 ms` | [24,30,6,1] |
| Route | `8.3-8.6 ms` | [32,36,10,1] |

### Visible arrows and complete route tracing

All four routes are solid, directed downward, individually traceable without guessing, and have intact `▼` heads outside complete target borders.

| Source | Target | Source exit and bends | Arrowhead |
|---|---|---|---|
| `103.19.91.58 v4-only` | `Arista ToR 103.19.91.57 AS132717` | Bottom column 29; `(29,13) ╯` left to `(23,13) ╭`, then down | (23,14) |
| `Arista ToR 103.19.91.57 AS132717` | `Airtel 14.143.x, no ECMP` | Bottom column 23; `(23,21) ╰` right to `(27,21) ╮`, then down | (27,22) |
| `Airtel 14.143.x, no ECMP` | `Airtel bb 14.141.x` | Bottom column 27; `(27,29) ╰` right to `(30,29) ╮`, then down | (30,30) |
| `Airtel bb 14.141.x` | `Cloudflare 1.1.1.1 AS13335` | Bottom column 30; `(30,37) ╯` left to `(26,37) ╭`, then down | (26,38) |

There are no crossings, junctions, bridges, shared runs, or apparent branches. The listed bends belong to their own isolated connectors and do not touch other connectors.

`0.1 ms` is left of the first connector's column-29 vertical, with its final character immediately beside the line. `1.8 ms` is immediately right of the second connector's column-23 vertical. `7.1 ms` ends at column 29 on row 30, immediately left of the column-30 arrowhead; it is not a label for the next outgoing route. `8.3-8.6 ms` is right of the fourth connector's column-30 vertical. All four owners are identifiable; uncertain owners: **0**. The tight label-to-line or label-to-arrow adjacency does not erase any glyph.

### Node borders and color

Every listed node has complete top/bottom/left/right sides and all four rounded corners. Normal border color is continuous over its entire perimeter. Every selected perimeter is complete, bold, and continuously RGB (216,166,87).

| Node | Border rectangle | Normal border RGB | Selected complete |
|---|---|---|---|
| `103.19.91.58 v4-only` | [28,7,22,4] | (216,166,87) | Yes |
| `Arista ToR 103.19.91.57 AS132717` | [22,15,34,4] | (125,174,163) | Yes |
| `Airtel 14.143.x, no ECMP` | [26,23,26,4] | (211,134,155) | Yes |
| `Airtel bb 14.141.x` | [29,31,20,4] | (226,156,175) | Yes |
| `Cloudflare 1.1.1.1 AS13335` | [25,39,28,4] | (169,182,101) | Yes |

### Fit and motion

Measured capture: **77 × 47**, `@100%`. Runtime: `viewport: 77x47 zoom: 1.00 natural`. Check: `viewport: unknown zoom: 1.00 natural`, extent `35x37 cells`, `crossings: 0`. Observed graph rectangle: [22,7,34,36]. Cloudflare's bottom border is on row 42; the lower-left controls on rows 41–46 do not overlap it. All five nodes and four routes/labels are visible without pan or zoom. Clipped or hidden items: **0**.

Frames 0/100/200 ms each show **0 dots**, with no motion. No animated routes; all per-dot motion criteria are not applicable. Observed dot violations: **0**.

## View v3 — qualified links to an unproven claim

### Visible graph labels

| Kind | Verbatim label | Rectangle |
|---|---|---|
| Node | `Arista OUI .57` | [14,17,14,1] |
| Node | `7 ports dark` | [14,24,12,1] |
| Node | `.60-.62 quiet` | [14,29,13,1] |
| Node | `hops 3,6 quiet, 5@80%` | [14,34,21,1] |
| Node | `still unproven` | [50,17,14,1] |
| Route | `ToR role?` | [33,16,9,1] |
| Route | `no cable?` | [32,23,9,1] |
| Route | `free?` | [35,28,5,1] |
| Route | `layer 2?` | [49,27,8,1] |

All four route labels retain their question marks. All four connectors visibly use `╌` horizontally and `╎` vertically. Corners, bridges, and arrowheads are solid special glyphs, rather than dash glyphs. The fourth connector's final one-cell turn-to-head has no room for an additional horizontal dash, but its long horizontal and vertical runs are dashed.

### Visible arrows and complete route tracing

All four arrows point right into distinct ports on the left side of the tall `still unproven` box. No reverse arrowheads are visible.

| Source | Target | Trace and bends | Arrowhead | Whole route traceable? |
|---|---|---|---|---|
| `Arista OUI .57` | `still unproven` | Exits right at (29,17), travels right across bridge (45,17), turns at `(46,17) ╯`, travels up across bridge (46,16) to `(46,14) ╭`, then right | Intact `▶` at (48,14) | Yes, with careful use of the bridge convention in the compact crossing pair |
| `7 ports dark` | `still unproven` | Exits right at (27,24), travels to `(45,24) ╯`, goes up column 45 through crossing (45,17) to `(45,16) ╭`, then right across crossing (46,16) | Intact `▶` at (48,16) | Yes, with the same close bridge/corner reading |
| `.60-.62 quiet` | `still unproven` | Exits right at (28,29), turns up at `(46,29) ╯`, travels up column 46 to `(46,18) ╭`, then right | Intact `▶` at (48,18) | Yes |
| `hops 3,6 quiet, 5@80%` | `still unproven` | Exits right at (36,34), turns up at `(47,34) ╯`, travels up column 47 to `(47,20) ╭`, then right | Intact `▶` at (48,20) | Yes |

### Crossings, touching bends, apparent branches, and label ownership

There are **two visible independent-route crossings**, both between the OUI route and the dark-ports route:

1. `(45,17) ⌒`: OUI's horizontal run crosses the dark-ports vertical.
2. `(46,16) ⌒`: dark-ports' horizontal run crosses the OUI vertical.

The two crossings sit diagonally adjacent within a compact 2×2 cluster: row 16 has `(45,16) ╭` then `(46,16) ⌒`; row 17 has `(45,17) ⌒` then `(46,17) ╯`. Thus each bridge touches a corner horizontally and another route's corner vertically. This is the densest and least effortless portion of the case. The explicit bridge glyphs permit an over/under trace rather than requiring an invented junction, but a casual reader could mistake the cluster for a knot or branch. No `├`, `┴`, or `┼` branch glyph is present; I count **0 explicit junctions** and **0 actual additional branches** in this view.

Columns 45, 46, and 47 form immediately adjacent vertical lanes where their ranges overlap. At row 18, the column-46 corner is next to column 45's vertical; at row 20, the column-47 corner is next to column 46's vertical, with column 45's vertical next to that. At row 24 the dark route's corner is immediately beside the pool/hops verticals; at row 29 the pool corner is immediately beside the hops vertical. These are close parallel routes, not a drawn shared trunk. The route table enumerates every actual bend. The four arrowheads are separated vertically by one row and do not erase the hub's border.

`ToR role?` lies one row above OUI's long horizontal, not beside the dark route's upper head. `no cable?` lies one row above the dark-ports horizontal. `free?` lies one row above the pool horizontal. `layer 2?` lies to the right of the rightmost vertical, the hops route at column 47; the pool route at column 46 is also close, but the nearest rightmost lane is traceable down to the hops box. I can assign all four labels from the capture; uncertain label owners: **0**. The final label is a crowded placement worth noting, not a proven misassignment. No label overwrites a route cell.

Check output also reports `crossings: 2`, matching the two visible bridge locations.

### Node borders and color

Each node below has complete top/bottom/left/right sides and all four rounded corners, including the tall hub's left side behind the four incoming ports. No arrowhead substitutes for a border cell. ANSI confirms color continuity across every normal perimeter. All selected perimeters are complete, bold, and continuously RGB (216,166,87).

| Node | Border rectangle | Normal border RGB | Selected complete |
|---|---|---|---|
| `Arista OUI .57` | [13,16,16,4] | (216,166,87) | Yes |
| `7 ports dark` | [13,23,14,4] | (228,184,111) | Yes |
| `.60-.62 quiet` | [13,28,15,4] | (200,147,68) | Yes |
| `hops 3,6 quiet, 5@80%` | [13,33,23,4] | (239,202,138) | Yes |
| `still unproven` | [49,13,16,9] | (125,174,163) | Yes |

### Fit and motion

Measured capture: **77 × 47**, `@100%`. Runtime: `viewport: 77x47 zoom: 1.00 natural`. Check: `viewport: unknown zoom: 1.00 natural`, extent `53x25 cells`. Observed graph rectangle: [13,13,52,24]. All five boxes, four qualified labels, four arrowheads, and full routes are visible without pan or zoom. Clipped or hidden items: **0**.

Frames 0/100/200 ms each contain **0 dots**, and there is no motion. No animated routes; dot spacing/direction/forbidden-cell occupancy/origin/synchronized-arrival criteria are not applicable. Observed dot violations: **0**.

## UI labels and UI border, all three views

For completeness, the status label in each view is at [2,1,75,1], verbatim:

- v1: `rataflow-view · 77x47 @100% · v1-attempt3.json · 6 nodes · 2 edges · q quit`
- v2: `rataflow-view · 77x47 @100% · v2-attempt2.json · 5 nodes · 4 edges · q quit`
- v3: `rataflow-view · 77x47 @100% · v3-attempt1.json · 5 nodes · 4 edges · q quit`

Each view has these four additional visible control labels:

| Verbatim label | Rectangle |
|---|---|
| `+ [+]` | [4,42,5,1] |
| `− [-]` | [4,43,5,1] |
| `⊡ [f]` | [4,44,5,1] |
| `□ [i]` | [4,45,5,1] |

Their common enclosing border is [2,41,9,6], with complete square corners `┌┐└┘` and all four sides, continuously RGB (168,153,104), unchanged in the selected captures. This UI border is not a graph node. Ordinary routes and arrowheads are muted RGB (124,111,100). Graph and control text is RGB (235,219,178); status text is RGB (102,92,84); background is RGB (40,40,40).

## Selected-state coverage and limitations

Selected-state evidence covers **16 / 16 node occurrences** across the final views: v1 6/6, v2 5/5, v3 5/5. Each occurrence has its own complete selected border in its view's simultaneous `--select-all` capture. These are not isolated one-node-at-a-time screenshots; no such isolation is needed to inspect each perimeter here, but isolated focus/interaction behavior is not evidenced.

No required capture was missing or unreadable. ANSI was decoded as cell glyphs plus SGR truecolor/bold attributes; it is not merely inferred from plain text. Binary hashes and capture manifests were not needed for these visual observations. Rejected/nonfinal captures were deliberately not scored. The three short static frames prove no motion within their sampled interval, not arbitrary long-duration runtime behavior. The check-only viewport is explicitly unknown; the measured dimensions are supported by runtime captures instead.

## Tool-usable blind scorecard

Counts use occurrences across views. `visible_edges` means source-to-arrowhead connections: v1 includes all three bus destinations in addition to the two ordinary edges. Route/trunk labels are counted once per visible text occurrence, not once per bus destination. UI labels are kept separate. Explicit branch junctions are not counted as independent-route crossings. No expected-data or rubric score is asserted.

```json
{
  "stage": "A",
  "case": "server-nic-layout",
  "views": {
    "v1": {
      "visible_nodes": 6,
      "visible_edges": 5,
      "ordinary_spec_edges": 2,
      "visible_arrowheads": 5,
      "traceable_connections": 5,
      "visible_node_labels": 6,
      "visible_route_labels": 3,
      "visible_graph_labels": 9,
      "visible_ui_labels": 5,
      "visible_independent_crossings": 0,
      "check_reported_crossings": 2,
      "visible_bridge_glyphs": 0,
      "explicit_branch_junctions": 2,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_nodes_captured": 6,
      "selected_nodes_total": 6,
      "complete_color_continuous_node_borders": 6,
      "animated_routes_observed": 0,
      "dots_per_frame": [0, 0, 0],
      "dot_violations": 0,
      "motion_observed": false,
      "capture_columns": 77,
      "capture_rows": 47
    },
    "v2": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "ordinary_spec_edges": 4,
      "visible_arrowheads": 4,
      "traceable_connections": 4,
      "visible_node_labels": 5,
      "visible_route_labels": 4,
      "visible_graph_labels": 9,
      "visible_ui_labels": 5,
      "visible_independent_crossings": 0,
      "check_reported_crossings": 0,
      "visible_bridge_glyphs": 0,
      "explicit_branch_junctions": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_nodes_captured": 5,
      "selected_nodes_total": 5,
      "complete_color_continuous_node_borders": 5,
      "animated_routes_observed": 0,
      "dots_per_frame": [0, 0, 0],
      "dot_violations": 0,
      "motion_observed": false,
      "capture_columns": 77,
      "capture_rows": 47
    },
    "v3": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "ordinary_spec_edges": 4,
      "visible_arrowheads": 4,
      "traceable_connections": 4,
      "visible_node_labels": 5,
      "visible_route_labels": 4,
      "visible_graph_labels": 9,
      "visible_ui_labels": 5,
      "visible_independent_crossings": 2,
      "check_reported_crossings": 2,
      "visible_bridge_glyphs": 2,
      "explicit_branch_junctions": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_nodes_captured": 5,
      "selected_nodes_total": 5,
      "complete_color_continuous_node_borders": 5,
      "animated_routes_observed": 0,
      "dots_per_frame": [0, 0, 0],
      "dot_violations": 0,
      "motion_observed": false,
      "capture_columns": 77,
      "capture_rows": 47
    }
  },
  "totals": {
    "visible_nodes": 16,
    "visible_edges": 13,
    "visible_arrowheads": 13,
    "traceable_connections": 13,
    "visible_node_labels": 16,
    "visible_route_labels": 11,
    "visible_graph_labels": 27,
    "visible_ui_labels": 15,
    "visible_labels_including_ui": 42,
    "visible_independent_crossings": 2,
    "check_reported_crossings": 4,
    "explicit_branch_junctions": 2,
    "uncertain_label_owners": 0,
    "clipped_items": 0,
    "selected_nodes_captured": 16,
    "selected_nodes_total": 16,
    "complete_color_continuous_node_borders": 16,
    "dot_violations": 0,
    "motion_observed": false
  },
  "unreadable_required_evidence": []
}
```
