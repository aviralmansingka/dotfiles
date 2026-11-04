# Stage A — blind observations: datacenter-redundancy, round 03

This record was made before receiving expectations. It uses only `specs/v1.json` through `specs/v4.json` and their existing text, ANSI, selected-ANSI, and frame captures under this case's `evidence/` directory. No source, expected data, rubric, dataset manifest, other case, earlier round, local attempt, validator, or generation script was read. No viewer was launched, and nothing was repaired.

## Measurement conventions

- All coordinates are **1-based terminal cells**. Rectangles use `[column,row,width,height]`; points use `[column,row]`.
- Counts are occurrences across the four final views, not deduplicated concepts. There are 24 node occurrences (18 distinct node names), 28 visible arrows, and 48 graph-label occurrences: 24 node labels and 24 edge-label words. The repeated edge words remain separate occurrences even when printed without a separating space. UI text is counted separately.
- A crossing is one cell where two routes cross. Every observed crossing has a visible `⌒` bridge. A route crossing another route twice counts twice. Mere adjacency of independent routes is not an additional crossing.
- “Traceable” means the captured glyphs support following the complete route from one source box to one arrowhead, using `⌒` as a nonjoining crossover. It does **not** mean that an adjacent edge label has a unique owner or that the route is easy to scan at a glance.
- An uncertain label owner means the local placement does not confidently identify exactly one of the nearby routes. This is a reader observation, not an owner assignment copied from the spec.

## Blind scorecard

```json
{
  "stage": "A",
  "case": "datacenter-redundancy",
  "round": "03",
  "coordinate_system": "1-based terminal cells",
  "count_basis": "occurrences across final views",
  "views": {
    "v1": {
      "columns": 77, "rows": 47,
      "visible_nodes": 8, "visible_edges": 8,
      "node_labels": 8, "edge_labels": 4, "visible_graph_labels": 12,
      "visible_ui_label_runs": 5,
      "crossings": 1, "bridge_glyphs": 1,
      "touching_bend_cell_pairs": 11,
      "explicit_route_junctions": 0,
      "uncertain_label_owners": 3,
      "fully_traceable_routes": 8,
      "clipped_items": 0,
      "complete_color_continuous_normal_borders": 8,
      "selected_border_coverage": {"captured": 8, "total": 8},
      "captured_frames": 11, "distinct_frame_buffers": 1,
      "dots_per_frame": [0,0,0,0,0,0,0,0,0,0,0],
      "dot_violations": 0, "motion_critical_violations": 0
    },
    "v2": {
      "columns": 77, "rows": 47,
      "visible_nodes": 6, "visible_edges": 8,
      "node_labels": 6, "edge_labels": 8, "visible_graph_labels": 14,
      "visible_ui_label_runs": 5,
      "crossings": 4, "bridge_glyphs": 4,
      "touching_bend_cell_pairs": 20,
      "explicit_route_junctions": 0,
      "uncertain_label_owners": 4,
      "fully_traceable_routes": 8,
      "clipped_items": 0,
      "complete_color_continuous_normal_borders": 6,
      "selected_border_coverage": {"captured": 6, "total": 6},
      "captured_frames": 11, "distinct_frame_buffers": 1,
      "dots_per_frame": [0,0,0,0,0,0,0,0,0,0,0],
      "dot_violations": 0, "motion_critical_violations": 0
    },
    "v3": {
      "columns": 77, "rows": 47,
      "visible_nodes": 6, "visible_edges": 8,
      "node_labels": 6, "edge_labels": 8, "visible_graph_labels": 14,
      "visible_ui_label_runs": 5,
      "crossings": 9, "bridge_glyphs": 9,
      "touching_bend_cell_pairs": 13,
      "explicit_route_junctions": 0,
      "uncertain_label_owners": 6,
      "fully_traceable_routes": 8,
      "clipped_items": 0,
      "complete_color_continuous_normal_borders": 6,
      "selected_border_coverage": {"captured": 6, "total": 6},
      "captured_frames": 11, "distinct_frame_buffers": 1,
      "dots_per_frame": [0,0,0,0,0,0,0,0,0,0,0],
      "dot_violations": 0, "motion_critical_violations": 0
    },
    "v4": {
      "columns": 77, "rows": 47,
      "visible_nodes": 4, "visible_edges": 4,
      "node_labels": 4, "edge_labels": 4, "visible_graph_labels": 8,
      "visible_ui_label_runs": 5,
      "crossings": 1, "bridge_glyphs": 1,
      "touching_bend_cell_pairs": 6,
      "explicit_route_junctions": 0,
      "uncertain_label_owners": 4,
      "fully_traceable_routes": 4,
      "clipped_items": 0,
      "complete_color_continuous_normal_borders": 4,
      "selected_border_coverage": {"captured": 4, "total": 4},
      "captured_frames": 11, "distinct_frame_buffers": 1,
      "dots_per_frame": [0,0,0,0,0,0,0,0,0,0,0],
      "dot_violations": 0, "motion_critical_violations": 0
    }
  },
  "totals": {
    "visible_nodes": 24, "distinct_node_names": 18,
    "visible_edges": 28,
    "node_labels": 24, "edge_labels": 24, "visible_graph_labels": 48,
    "visible_ui_label_runs": 20,
    "visible_labels_including_ui_runs": 68,
    "crossings": 15, "bridge_glyphs": 15,
    "touching_bend_cell_pairs": 50,
    "explicit_route_junctions": 0,
    "uncertain_label_owners": 17,
    "fully_traceable_routes": 28,
    "clipped_items": 0,
    "complete_color_continuous_normal_borders": 24,
    "selected_border_coverage": {"captured": 24, "total": 24},
    "captured_frames": 44,
    "dot_violations": 0, "motion_critical_violations": 0
  },
  "unreadable_evidence": [],
  "missing_evidence_qualifications": [
    "Selected evidence is simultaneous --select-all, not isolated one-node-at-a-time selection.",
    "Motion observations cover the supplied 11 samples per view at 200 ms intervals, not unsampled times."
  ]
}
```

## Fit, static state, and shared UI

All four normal ANSI buffers measure **77 columns × 47 rows**, including a blank final row. The standalone text serializations omit that final empty row (46 `splitlines()` rows); their drawn cells otherwise agree with the ANSI buffers. Each view's frame transcript contains the exact line:

`viewport: 77x47 zoom: 1.00 natural`

It occurs for the normal, `--select-all`, and `--frames 11 --step-ms 200` captures. Each title also reports `77x47 @100%`. No graph touches the viewport boundary, no label is truncated, and no visible item requires pan or zoom. These conclusions apply to what is captured, not to hypothetical uncaptured content.

| View | Graph-only occupied rectangle | Crossings visible |
|---|---|---:|
| v1 | `[18,14,42,22]` | 1 |
| v2 | `[25,14,29,22]` | 4 |
| v3 | `[13,14,49,20]` | 9 |
| v4 | `[29,18,20,13]` | 1 |

### Every UI label

The following title is a single run at `[2,1,66,1]` in each corresponding view:

- v1: `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 8 edges · q quit`
- v2: `rataflow-view · 77x47 @100% · v2.json · 6 nodes · 8 edges · q quit`
- v3: `rataflow-view · 77x47 @100% · v3.json · 6 nodes · 8 edges · q quit`
- v4: `rataflow-view · 77x47 @100% · v4.json · 4 nodes · 4 edges · q quit`

All four views also show:

| Verbatim label | Rectangle |
|---|---|
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

Their rectangular control border is `[2,41,9,6]`, with complete `┌ ┐ └ ┘` corners and complete sides; its ANSI foreground is continuously RGB `(168,153,104)`. It is UI, not a graph node or route junction. The title's middle-dot separators are not flow dots. Shell prompts, commands, frame markers, and viewport lines surrounding the frame transcript are process text, not labels inside the graph view.

### Static requirement and frame-by-frame observations

For **each** view the supplied frame indices and times are:

`0:0ms, 1:200ms, 2:400ms, 3:600ms, 4:800ms, 5:1000ms, 6:1200ms, 7:1400ms, 8:1600ms, 9:1800ms, 10:2000ms`.

All eleven raw frame bodies are identical within each text transcript and within each ANSI transcript, after excluding the changing frame marker. Their drawn cells match the normal buffer, accounting for trailing blank-cell serialization. Every route listed below has **zero dots in each of the eleven frames**. There is no changed position, dot, glyph, or captured frame-body color sequence. Thus no motion is observed, and there is **no critical static-motion violation** in the supplied evidence.

Dot spacing, travel direction, dot-on-corner/bridge/arrowhead, frame-0 origin placement, and synchronized arrowhead arrival are **not applicable** to these static routes. They are not failures for absent animation. There are no observed dot violations anywhere in the captured graphs. This does not claim continuous recording between samples.

## Border and selection observations

Every node in the following tables has four complete sides and all four rounded corners `╭ ╮ ╰ ╯`. The exact perimeter glyphs were checked against the captured box rectangles, including the taller `Spine 1` and `BL 2` boxes in v3. No route overwrites a border cell. Each normal border has one continuous foreground RGB value, shown per node below; this is supported by ANSI cells, not inferred from plain text.

All 24 occurrences also have their own complete border visibly selected in the corresponding `vN-selected.ansi` capture. Every selected perimeter cell is bold and RGB `(216,166,87)`, continuously around its box. Coverage is **8/8 + 6/6 + 6/6 + 4/4 = 24/24**. These are simultaneous `--select-all` views; isolated single-node selection behavior was not captured. Text labels remain legible. In the normal views, routes and arrowheads are muted RGB `(124,111,100)` and graph text is RGB `(235,219,178)`.

The same repeated concept does not necessarily retain its normal border hue across views: for example `Core 1` is pink in v1 and gold in v2, while `Leaf 1` is pink in v3 and gold in v4. This is an observation, not a stage-B judgment about a requested palette.

## v1 — ISP, MUX, and core view

### All node labels and borders

| Verbatim label | Label rectangle | Box rectangle | Continuous normal border RGB |
|---|---|---|---|
| `ISP A` | `[20,15,5,1]` | `[19,14,7,4]` | `(216,166,87)` |
| `ISP B` | `[32,15,5,1]` | `[31,14,7,4]` | `(228,184,111)` |
| `ISP C` | `[43,15,5,1]` | `[42,14,7,4]` | `(200,147,68)` |
| `ISP D` | `[54,15,5,1]` | `[53,14,7,4]` | `(239,202,138)` |
| `MUX 1` | `[20,24,5,1]` | `[19,23,7,4]` | `(125,174,163)` |
| `MUX 2` | `[32,24,5,1]` | `[31,23,7,4]` | `(147,194,183)` |
| `Core 1` | `[19,33,6,1]` | `[18,32,8,4]` | `(211,134,155)` |
| `Core 2` | `[31,33,6,1]` | `[30,32,8,4]` | `(226,156,175)` |

### All edge-label occurrences

| Verbatim label | Rectangle | Owner observation |
|---|---|---|
| `x-connect` | `[23,27,9,1]` | Uncertain: crowded between the outgoing MUX paths. |
| `x-connect` | `[23,28,9,1]` | Uncertain: stacked immediately below the previous identical label, with the same neighboring vertical paths. |
| `x-connect` | `[36,28,9,1]` | Relatively clear placement beside the rightmost MUX 2 → Core 2 path. |
| `x-connect` | `[22,31,9,1]` | Uncertain: squeezed between Core 1's second arrow and Core 2's first arrow, below the crossing region. |

The four words are present in full. The stacked pair is not a uniquely readable assignment of one word to each independent link. Uncertain-owner count: **3**.

### Every visible arrow and complete route

Every arrow is an intact, single `▼`, directed downward into its target box. Every route is solid, fully visible, and traceable. The polyline lists the first route cell outside the source, every bend in source-to-target order, then the arrowhead cell. Straight runs connect successive points. A bridge on a run is listed separately below.

| ID | Source → target | Source-to-head polyline | Head state / traceability |
|---|---|---|---|
| A1 | ISP A → MUX 1 | `[20,18] → [20,22]` | `▼` intact; yes |
| A2 | ISP B → MUX 1 | `[32,18] → [32,20] → [22,20] → [22,22]` | `▼` intact; yes |
| A3 | ISP C → MUX 2 | `[43,18] → [43,20] → [33,20] → [33,21] → [32,21] → [32,22]` | `▼` intact; yes |
| A4 | ISP D → MUX 2 | `[54,18] → [54,21] → [34,21] → [34,22]` | `▼` intact; yes |
| A5 | MUX 1 → Core 1 | `[20,27] → [20,30] → [19,30] → [19,31]` | `▼` intact; yes |
| A6 | MUX 2 → Core 1 | `[32,27] → [32,29] → [21,29] → [21,31]` | `▼` intact; yes |
| A7 | MUX 1 → Core 2 | `[22,27] → [22,30] → [31,30] → [31,31]` | `▼` intact; yes |
| A8 | MUX 2 → Core 2 | `[34,27] → [34,30] → [33,30] → [33,31]` | `▼` intact; yes |

### Crossings, bridges, touching bends, apparent branches

One crossing and one `⌒` bridge: **`[22,29]`, A6 × A7**. No unbridged crossing, shared run, or explicit T/four-way route-junction glyph is visible.

Every orthogonally adjacent cell pair on different routes involving at least one bend is recorded below. These are proximity contacts, not additional crossing counts; some sit beside a bridge:

```text
[20,29]│ — [21,29]╭
[20,30]╯ — [21,30]│
[21,29]╭ — [22,29]⌒
[21,30]│ — [22,30]╰
[22,29]⌒ — [22,30]╰
[31,29]─ — [31,30]╮
[32,20]╯ — [32,21]╭
[32,20]╯ — [33,20]╭
[33,21]╯ — [34,21]╭
[34,20]─ — [34,21]╭
[43,20]╯ — [43,21]─
```

The compact stepping corners in the ISP section and `[20..22,29..30]` cluster can initially look like branches. Reading corner orientation and the bridge separates them. Both MUX boxes visibly originate two independent paths, and each core has two independent incoming heads. Those links stay separately traceable despite the uncertain repeated-label ownership.

## v2 — core, firewall, and BL view

### All node labels and borders

| Verbatim label | Label rectangle | Box rectangle | Continuous normal border RGB |
|---|---|---|---|
| `Core 1` | `[28,15,6,1]` | `[27,14,8,4]` | `(216,166,87)` |
| `Core 2` | `[45,15,6,1]` | `[44,14,8,4]` | `(228,184,111)` |
| `FW1 active` | `[26,24,10,1]` | `[25,23,12,4]` | `(125,174,163)` |
| `FW2 standby` | `[42,24,11,1]` | `[41,23,13,4]` | `(147,194,183)` |
| `BL 1` | `[29,33,4,1]` | `[28,32,6,4]` | `(211,134,155)` |
| `BL 2` | `[46,33,4,1]` | `[45,32,6,4]` | `(226,156,175)` |

The substring `active` inside `FW1 active` is part of that node label, not another edge-label occurrence.

### All edge-label occurrences

| Verbatim label | Rectangle | Owner observation |
|---|---|---|
| `active` | `[31,18,6,1]` | Uncertain: directly fused with `standby?`, beside the Core 1 dashed port. |
| `standby?` | `[37,18,8,1]` | Uncertain: second part of the same fused run, ending beside Core 2's solid path. |
| `active` | `[34,20,6,1]` | Relatively clear below the raised solid Core 2 → FW1 active path. |
| `standby?` | `[32,22,8,1]` | Relatively clear below the dashed Core 1 → FW2 standby horizontal run. |
| `standby?` | `[34,27,8,1]` | Relatively clear immediately beside FW2 standby's left outgoing dashed path. |
| `active` | `[29,28,6,1]` | Uncertain: fused with a second `active`, beside the same FW1 outgoing vertical path. |
| `active` | `[35,28,6,1]` | Uncertain: second half of `activeactive`, above a long solid run crossed by several dashed paths. |
| `standby?` | `[33,31,8,1]` | Relatively clear below the dashed FW2 standby → BL 1 horizontal run. |

The two problematic literal runs are `activestandby?` at `[31,18,14,1]` and **`activeactive` at `[29,28,12,1]`**. They are readable characters but do not unambiguously assign the individual words to individual links. Uncertain-owner count: **4**.

### Every visible arrow and complete route

All eight heads are intact `▼`, directed downward into their target. Solid and dashed paths remain visually distinct; all complete routes can be followed, though the lower-right double crossover requires care.

| ID | Source → target | Style | Source-to-head polyline | Head / traceability |
|---|---|---|---|---|
| B1 | Core 1 → FW1 active | solid | `[28,18] → [28,20] → [26,20] → [26,22]` | `▼` intact; yes |
| B2 | Core 2 → FW1 active | solid | `[45,18] → [45,20] → [43,20] → [43,19] → [31,19] → [31,20] → [29,20] → [29,21] → [28,21] → [28,22]` | `▼` intact; yes |
| B3 | Core 1 → FW2 standby | dashed | `[30,18] → [30,21] → [42,21] → [42,22]` | `▼` intact; yes |
| B4 | Core 2 → FW2 standby | dashed | `[47,18] → [47,21] → [44,21] → [44,22]` | `▼` intact; yes |
| B5 | FW1 active → BL 1 | solid | `[26,27] → [26,30] → [29,30] → [29,31]` | `▼` intact; yes |
| B6 | FW2 standby → BL 1 | dashed | `[42,27] → [42,30] → [31,30] → [31,31]` | `▼` intact; yes |
| B7 | FW1 active → BL 2 | solid | `[28,27] → [28,29] → [46,29] → [46,31]` | `▼` intact; yes |
| B8 | FW2 standby → BL 2 | dashed | `[44,27] → [44,30] → [45,30] → [45,28] → [48,28] → [48,31]` | `▼` intact; yes |

### Crossings, bridges, touching bends, apparent branches

Four crossing cells, all `⌒`:

| Coordinate | Routes |
|---|---|
| `[30,20]` | B2 × B3 |
| `[42,29]` | B6 × B7 |
| `[44,29]` | B7 × B8 |
| `[45,29]` | B7 × B8 again, at the other side of B8's small detour |

The adjacent `⌒⌒` at columns 44 and 45 is a **double crossing of one independent dashed route with the solid route**, not a two-output junction. No explicit junction glyph or unbridged crossing is visible. The 20 touching-bend cell pairs are:

```text
[28,20]╯ — [28,21]╭
[28,20]╯ — [29,20]╭
[28,29]╰ — [28,30]─
[29,20]╭ — [30,20]⌒
[29,21]╯ — [30,21]╰
[29,29]─ — [29,30]╮
[30,19]╎ — [31,19]╭
[30,20]⌒ — [30,21]╰
[30,20]⌒ — [31,20]╯
[31,20]╯ — [31,21]╌
[31,29]─ — [31,30]╭
[42,29]⌒ — [42,30]╯
[44,20]─ — [44,21]╭
[44,29]⌒ — [44,30]╰
[45,20]╯ — [45,21]╌
[45,28]╭ — [45,29]⌒
[45,29]⌒ — [45,30]╯
[45,29]⌒ — [46,29]╮
[45,30]╯ — [46,30]│
[46,28]╌ — [46,29]╮
```

At a glance the lower-right cluster looks branch-like, especially where the long solid horizontal line passes three bridges, two adjacent. Glyph-by-glyph tracing preserves all eight independent paths and separate target heads. Labels do not provide equivalent certainty.

## v3 — BL, spine, and leaf view

### All node labels and borders

| Verbatim label | Label rectangle | Box rectangle | Continuous normal border RGB |
|---|---|---|---|
| `Spine 1` | `[17,18,7,1]` | `[16,16,9,5]` | `(216,166,87)` |
| `Spine 2` | `[30,17,7,1]` | `[29,16,9,4]` | `(228,184,111)` |
| `BL 1` | `[19,29,4,1]` | `[18,28,6,4]` | `(125,174,163)` |
| `BL 2` | `[32,30,4,1]` | `[31,28,6,5]` | `(147,194,183)` |
| `Leaf 1` | `[43,29,6,1]` | `[42,28,8,4]` | `(211,134,155)` |
| `Leaf 2` | `[55,29,6,1]` | `[54,28,8,4]` | `(226,156,175)` |

### All edge-label occurrences

| Verbatim label | Rectangle | Owner observation |
|---|---|---|
| `ECMP` | `[43,20,4,1]` | Relatively clear above the long, far-right Spine 2 → Leaf 2 horizontal run. |
| `ECMP` | `[21,22,4,1]` | Relatively clear beside Spine 1's right outgoing vertical path, before it turns toward Leaf 2. |
| `ECMP` | `[35,23,4,1]` | Uncertain: fused with the next label between two horizontal routes. |
| `ECMP` | `[39,23,4,1]` | Uncertain: second half of the same `ECMPECMP` run. |
| `ECMP` | `[29,25,4,1]` | Uncertain: beside the BL 2 → Spine 2 vertical corridor and between leaf-bound horizontal runs. |
| `ECMP` | `[16,27,4,1]` | Uncertain: beside the lower BL 2 → Spine 1 return and immediately below a Spine 1 → Leaf 1 bend/run. |
| `ECMP` | `[30,27,4,1]` | Uncertain: next to the BL-to-spine vertical corridors and below the leaf-bound horizontal run. |
| `ECMP` | `[19,32,4,1]` | Uncertain: below BL 1 but inside/above the large BL 2 return loop; no direct leader identifies its owner. |

The exact fused run is **`ECMPECMP` at `[35,23,8,1]`**. All eight words exist, but six have uncertain owners by local placement. No word is clipped.

### Every visible arrow and complete route

The first four connections travel from the lower BL boxes toward the upper spine boxes. Their final arrow direction is sideways, not downward. The remaining four heads point down into the leaf boxes. All are intact and all routes can be traced with the crossover convention; this is the most crowded and least glance-readable view.

| ID | Source → target | Direction / head | Source-to-head polyline | Traceable |
|---|---|---|---|---|
| C1 | BL 1 → Spine 1 | upward overall; final right `▶` at `[15,17]` | `[17,29] → [13,29] → [13,17] → [15,17]` | yes |
| C2 | BL 1 → Spine 2 | upward overall; final left `◀` at `[38,17]` | `[24,29] → [26,29] → [26,14] → [39,14] → [39,17] → [38,17]` | yes |
| C3 | BL 2 → Spine 1 | upward overall with bottom detour; final right `▶` at `[15,19]` | `[30,29] → [27,29] → [27,33] → [15,33] → [15,22] → [14,22] → [14,19] → [15,19]` | yes |
| C4 | BL 2 → Spine 2 | upward overall; final right `▶` at `[28,17]` | `[30,31] → [28,31] → [28,21] → [27,21] → [27,17] → [28,17]` | yes |
| C5 | Spine 1 → Leaf 1 | down; `▼` at `[43,27]` | `[17,21] → [17,26] → [43,26] → [43,27]` | yes |
| C6 | Spine 1 → Leaf 2 | down; `▼` at `[55,27]` | `[19,21] → [19,24] → [55,24] → [55,27]` | yes |
| C7 | Spine 2 → Leaf 1 | down; `▼` at `[45,27]` | `[30,20] → [30,22] → [45,22] → [45,27]` | yes |
| C8 | Spine 2 → Leaf 2 | down; `▼` at `[57,27]` | `[32,20] → [32,23] → [33,23] → [33,21] → [57,21] → [57,27]` | yes |

All routes are solid. Each spine has two independent incoming heads on side ports and two outgoing paths below. Each leaf has two separate downward arrowheads. The BL 1 links leave opposite sides of its box; the two BL 2 links leave separate left-side positions. No shared corridor merges those independently traceable links.

### Crossings, bridges, touching bends, apparent branches

Nine crossing cells, all with `⌒`:

| Coordinate | Routes |
|---|---|
| `[32,22]` | C7 × C8 |
| `[33,22]` | C7 × C8 again |
| `[26,24]` | C2 × C6 |
| `[28,24]` | C4 × C6 |
| `[45,24]` | C7 × C6 |
| `[26,26]` | C2 × C5 |
| `[28,26]` | C4 × C5 |
| `[15,29]` | C1 × C3 |
| `[28,29]` | C4 × C3 |

No explicit T/four-way route junction or unbridged crossing is visible. The adjacent bridge pair `[32,22]`, `[33,22]` belongs to the same route pair crossing twice around a small detour; it is not a trunk split. The lower-left bridge `[15,29]` also prevents the horizontal BL 1 route from becoming an apparent branch of BL 2's vertical return.

All 13 orthogonal touching-bend cell pairs:

```text
[13,19]│ — [14,19]╭
[13,22]│ — [14,22]╰
[26,17]│ — [27,17]╭
[26,21]│ — [27,21]╰
[26,29]╯ — [27,29]╭
[27,29]╭ — [28,29]⌒
[27,31]│ — [28,31]╰
[32,22]⌒ — [32,23]╰
[32,23]╰ — [32,24]─
[33,21]╭ — [33,22]⌒
[33,22]⌒ — [33,23]╯
[33,23]╯ — [33,24]─
[45,21]─ — [45,22]╮
```

The long return routes, close central verticals, and two immediately adjacent bridges create branch-like visual clusters. They remain geometrically separable, but identifying each repeated `ECMP` word with one path is substantially less certain than identifying endpoints.

## v4 — leaf and rack view

### All node labels and borders

| Verbatim label | Label rectangle | Box rectangle | Continuous normal border RGB |
|---|---|---|---|
| `Leaf 1` | `[30,19,6,1]` | `[29,18,8,4]` | `(216,166,87)` |
| `Leaf 2` | `[42,19,6,1]` | `[41,18,8,4]` | `(228,184,111)` |
| `Rack 1` | `[30,28,6,1]` | `[29,27,8,4]` | `(125,174,163)` |
| `Rack 2` | `[42,28,6,1]` | `[41,27,8,4]` | `(147,194,183)` |

### All edge-label occurrences

| Verbatim label | Rectangle | Owner observation |
|---|---|---|
| `dual` | `[33,22,4,1]` | Uncertain: first part of the fused upper run next to Leaf 1's right outgoing port. |
| `dual` | `[37,22,4,1]` | Uncertain: second part of the fused run, still left of Leaf 2's outgoing paths. |
| `dual` | `[35,25,4,1]` | Uncertain: beneath the crossing horizontal line, beside the other cross-link's descending bend; no leader separates ownership. |
| `dual` | `[38,26,4,1]` | Uncertain: immediately left of Rack 2's first head and between the two racks; this does not uniquely label the rightmost straight link. |

The literal upper run is **`dualdual` at `[33,22,8,1]`**. All four words are present. Their placements do not supply a confident one-to-one assignment to the four separately traced routes. Uncertain-owner count: **4**.

### Every visible arrow and complete route

All four routes are solid, point downward overall, and end in an intact `▼`. Every route is completely visible and traceable.

| ID | Source → target | Source-to-head polyline | Head / traceability |
|---|---|---|---|
| D1 | Leaf 1 → Rack 1 | `[30,22] → [30,26]` | `▼` at `[30,26]`, intact; yes |
| D2 | Leaf 2 → Rack 1 | `[42,22] → [42,23] → [33,23] → [33,25] → [32,25] → [32,26]` | `▼` at `[32,26]`, intact; yes |
| D3 | Leaf 1 → Rack 2 | `[32,22] → [32,24] → [42,24] → [42,26]` | `▼` at `[42,26]`, intact; yes |
| D4 | Leaf 2 → Rack 2 | `[44,22] → [44,26]` | `▼` at `[44,26]`, intact; yes |

### Crossings, bridges, touching bends, apparent branches

One crossing and one `⌒` at **`[33,24]`, D2 × D3**. No shared run, unbridged crossing, or explicit route junction is visible. Each rack receives two separate heads, and each leaf uses two separate outgoing ports.

All six touching-bend cell pairs:

```text
[32,23]│ — [33,23]╭
[32,24]╰ — [32,25]╭
[32,24]╰ — [33,24]⌒
[33,23]╭ — [33,24]⌒
[33,24]⌒ — [33,25]╯
[42,23]╯ — [42,24]╮
```

The compact corner/bridge cluster at columns 32–33 and rows 23–25 looks branch-like initially, but the crossover and opposing corner orientations preserve the two independent cross-links. The straight outer paths are particularly easy to follow. The labels are less trustworthy than the route geometry.

## Evidence limits and blind conclusion

All supplied text and ANSI capture formats were readable. Selected ANSI was parsed over every node perimeter, and both frame formats were inspected over all 44 frame bodies. No unsupported capture or missing file blocked these observations. This record does not use `check.txt` or manifest claims as substitutes for captured appearance.

The captured views fit naturally at 100%, retain complete color-continuous normal and selected borders, show 28 intact and separately traceable arrows, and show no motion or flow dots. The visible weaknesses are repeated words with uncertain route ownership, tight touching bends, and 15 bridge-marked crossing cells, especially the nine in v3. The observed route geometry supports independent links; it does not resolve all 17 locally uncertain label assignments. No comparison with hidden expectations has been made.
