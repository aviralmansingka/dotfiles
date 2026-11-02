# modal-runtime — round 04, stage A blind observation

Judge: independent Sol. This record precedes any expectations reveal. Only the designated final spec and captured text/ANSI evidence were read. No source, expected data, rubric, manifest, check logs, renderer code, other cases, or earlier rounds were read. No viewer was launched and nothing was fixed.

## Evidence and coordinate convention

- Final spec: `specs/v1-b.json`.
- Verified SHA-256: `5048cd78f17c25d03b40df241f04c8d17bf0459b0f2dd67e7f5d740614d293c9`.
- Read: `evidence/v1/v1-text.txt`, `v1-ansi.ansi`, `v1-selected.ansi`, `v1-frames.txt`, and `v1-frames.ansi`.
- All coordinates below are **1-based [column,row]**, including the status row. Rectangles are `[column,row,width,height]`. The request's zero-based `(36,20)` is `[37,21]`; `(9,40)/(9,41)` are `[10,41]/[10,42]`.
- Static ANSI and selected ANSI each contain exactly 47 rows of 77 cells. The trimmed plain text has 46 rows and maximum width 70; it omits right padding and the last blank row.
- Both frame files contain 1,000 lines. Their opening is truncated: the frame-0 header and viewer rows 1–11 are absent. The initial fragment starts at viewer row 12, identified by its labels and geometry matching subsequent frames. All eight frame-0 dots survive below that cut. Frames 1–20 have explicit headers at 100 ms intervals and 47 viewer rows each. The final shell prompt is capture residue, not a viewer label. The animation `.ansi` contains no diagram color styling (its escapes belong to the shell residue); static ANSI does supply color evidence.

## Visible labels, verbatim

| Kind | Label | Rectangle |
|---|---|---|
| Node | `modal-worker` | [36,8,12,1] |
| Node | `modal-daemon` | [58,24,12,1] |
| Node | `modal-runtime` | [36,16,13,1] |
| Node | `Task engine` | [37,24,11,1] |
| Node | `Container backend` | [9,32,17,1] |
| Node | `Task container` | [11,40,14,1] |
| Node | `Filesystem + volumes` | [32,32,20,1] |
| Node | `Blobnet` | [39,40,7,1] |
| Edge e1 | `task+ctrl RPC` | [38,12,13,1] |
| Edge e2 | `events+mgmt RPC` | [18,12,15,1] |
| Edge e3 | `task dispatch` | [23,20,13,1] |
| Edge e4 | `HTTP over UDS` | [42,20,13,1] |
| Edge e5 | `starts/manages` | [16,27,14,1] |
| Edge e6 | `mounts/snapshots` | [34,30,16,1] |
| Edge e7 | `runs process` | [11,36,12,1] |
| Edge e8 | `image+volume data` | [34,36,17,1] |
| Control | `+ [+]` | [4,42,5,1] |
| Control | `− [-]` | [4,43,5,1] |
| Control | `⊡ [f]` | [4,44,5,1] |
| Control | `□ [i]` | [4,45,5,1] |
| Status | `rataflow-view · 77x47 @100% · v1-b.json · 8 nodes · 8 edges · q quit` | [2,1,68,1] |

All 16 diagram labels are fully visible. No label owner is uncertain. Some labels abut their edge stem, particularly `events+mgmt RPC` and `task dispatch`; this is tight spacing rather than a lost owner. The HTTP label is above the rightward route, and the two Task engine outputs remain distinguishable despite adjacent horizontal runs.

## Visible arrows and routes

Edge numbers follow the final spec's order. A source-border coordinate is the adjacent box border; the outside source port is the first drawn cell outside it. Listed polylines start at that outside port and end at the arrowhead. Intermediate vertices are every visible bend.

| Edge | Source → target | Source border; outside port | Visible polyline after outside port | Arrowhead | Traceable |
|---|---|---|---|---|---|
| e1 | modal-worker → modal-runtime | [36,10]; [36,11] | straight to [36,14] | `▼` [36,14], down | Yes |
| e2 | modal-runtime → modal-worker | [35,16]; [34,16] | [33,16] → [33,8] → [34,8] | `▶` [34,8], right, approaching worker's left side | Yes |
| e3 | modal-runtime → Task engine | [36,18]; [36,19] | [36,21] → [37,21] → [37,22] | `▼` [37,22], down | Yes across the captures; a dot repeatedly masks its final elbow |
| e4 | modal-runtime → modal-daemon | [38,18]; [38,19] | [38,21] → [58,21] → [58,22] | `▼` [58,22], down | Yes |
| e5 | Task engine → Container backend | [37,26]; [37,27] | [37,28] → [9,28] → [9,30] | `▼` [9,30], down | Yes |
| e6 | Task engine → Filesystem + volumes | [39,26]; [39,27] | [39,29] → [32,29] → [32,30] | `▼` [32,30], down | Yes |
| e7 | Container backend → Task container | [9,34]; [9,35] | [9,37] → [11,37] → [11,38] | `▼` [11,38], down | Yes |
| e8 | Filesystem + volumes → Blobnet | [32,34]; [32,35] | [32,37] → [39,37] → [39,38] | `▼` [39,38], down | Yes |

All eight heads remain present in the observed animation frames. No dot replaces an arrowhead.

### Bends, crossings, contacts, and branches

Every bend, with its unmasked glyph:

- e1: none.
- e2: `╰` [33,16], `╭` [33,8].
- e3: `╰` [36,21], `╮` [37,21].
- e4: `╰` [38,21], `╮` [58,21].
- e5: `╯` [37,28], `╭` [9,28].
- e6: `╯` [39,29], `╭` [32,29].
- e7: `╰` [9,37], `╮` [11,37].
- e8: `╰` [32,37], `╮` [39,37].

There are **zero actual edge crossings, zero bridge glyphs, zero explicit junctions, and zero shared route cells/runs** in this geometry. There are two close-contact zones:

1. e3's `╮` [37,21] directly adjoins e4's `╰` [38,21]. This is **one touching bend–bend pair**. The glyphs' connectors do not join, but the run of consecutive corners and the dot replacing e3's corner weaken the separation. This can suggest a branch at a glance; it is not a declared or visibly connected junction.
2. e5's horizontal run on row 28 and e6's run on row 29 are directly adjacent at columns 32–37: six orthogonally adjacent cell pairs. Two are bend–straight contacts: e5's `╯` [37,28] above e6's line [37,29], and e6's `╭` [32,29] below e5's line [32,28]. The other four are parallel straight–straight pairs. None shares a cell or has a connecting junction glyph.

Thus there are seven inter-route orthogonal adjacency pairs in total, but only one literal bend–bend pair. This distinction avoids inventing the checker's definition of “touching bends.” Runtime and Task engine each have separate outgoing ports; neither output uses a drawn shared trunk.

## Borders and selected-state evidence

Each box is four rows high: a top side, two side-wall rows, and a bottom side. For the seven intact boxes below, **all four sides and all four corners are complete**, with one consistent foreground RGB throughout their perimeter in the normal ANSI capture. Background is RGB (40,40,40). Labels use RGB (235,219,178); routes are muted RGB (124,111,100).

| Node | Box rectangle | Normal border RGB | Sides/corners |
|---|---|---|---|
| modal-worker | [35,7,14,4] | (216,166,87) | All complete and color-continuous |
| modal-runtime | [35,15,15,4] | (125,174,163) | All complete and color-continuous |
| Task engine | [36,23,13,4] | (147,194,183) | All complete and color-continuous |
| modal-daemon | [57,23,14,4] | (228,184,111) | All complete and color-continuous |
| Container backend | [8,31,19,4] | (211,134,155) | All complete and color-continuous |
| Filesystem + volumes | [31,31,22,4] | (169,182,101) | All complete and color-continuous |
| Task container | [10,39,16,4] | (226,156,175) on surviving cells | Top and right complete; left wall's lower interior cell overwritten; bottom-left corner overwritten; remaining bottom line complete. Not color-continuous. |
| Blobnet | [38,39,9,4] | (189,201,124) | All complete and color-continuous |

The control palette occupies [2,41,9,6]. Its complete rectangular border is RGB (168,153,104). It overwrites **exactly two Task container perimeter cells**:

- [10,41] (request's zero-based (9,40)): palette `┐`, where the node's left wall should be `│`.
- [10,42] (request's zero-based (9,41)): palette `│`, where the node's bottom-left corner should be `╰`.

The normal capture has 34 surviving node-colored perimeter cells and two palette-colored cells out of Task container's 36-cell perimeter. This is genuine border damage, not just a nearby palette. Its label remains intact.

Selected ANSI captures **all 8 of 8 node occurrences** with their own bold selected border, RGB (216,166,87), in the single final view. Seven have complete continuous selected borders. Task container still has the same two palette-colored overwritten cells (bold in this capture), so **complete selected-border coverage is 7/8**, while selected-state occurrence coverage is 8/8.

## Motion measurements

Eight dots are visible in every captured frame: exactly one per route, no multi-dot spacing to measure. The initial fragment is treated as frame 0 only by its position immediately before the explicit frame-1 header; its missing header is a limitation, not silently repaired evidence.

### Frame 0/1 origin measurements

Both the surviving frame-0 fragment and full frame 1 give identical dot positions:

| Edge | Outside source port (path index 0) | Dot in frames 0 and 1 (path index 1) |
|---|---|---|
| e1 | [36,11] | [36,12] |
| e2 | [34,16] | [33,16] |
| e3 | [36,19] | [36,20] |
| e4 | [38,19] | [38,20] |
| e5 | [37,27] | [37,28] |
| e6 | [39,27] | [39,28] |
| e7 | [9,35] | [9,36] |
| e8 | [32,35] | [32,36] |

**Confirmed with a precise definition:** frame 1 places all eight dots on the first drawn cell *after the outside source port*. The dots are two path steps from the adjacent source box border, not on the source border or on the outside port itself. Frame-0 origin occupancy is therefore **0/8** under either origin convention. e2 and e5 already start on corners.

### Rate, direction, wraps, and geometric skips

All route positions are unchanged on frame pairs 0/1, 2/3, …, 18/19. Movement occurs on the even-numbered frame transitions, at a common 200 ms update cadence. This supports a shared nominal 0.5-cell/100 ms progression, but **does not demonstrate one uniform physical cells-per-time speed**: some steps skip a corner cell, causing a two-cell path jump in the same update. For example, between frames 1 and 2 e1/e2/e5 move one path cell while e3/e4/e6/e7/e8 move two. Dots advance in the arrow direction before wrapping; no reverse traversal was observed.

The following are measured path indices at frames **0,2,4,6,8,10,12,14,16,18,20**. Index 0 is the outside source port, and the last path index is the arrowhead. Each intervening odd frame repeats the preceding even frame.

| Edge | Route cells including port/head | Measured indices |
|---|---|---|
| e1 | 4 | 1,2,1,2,1,2,1,2,1,2,1 |
| e2 | 11 | 1,2,3,4,5,6,7,8,9,1,2 |
| e3 | 5 | 1,3,1,3,1,3,1,3,1,3,1 |
| e4 | 24 | 1,3,4,5,6,7,8,9,10,11,12 |
| e5 | 32 | 1,2,3,4,5,6,7,8,9,10,11 |
| e6 | 11 | 1,3,4,5,6,7,8,9,1,3,4 |
| e7 | 6 | 1,3,4,1,3,4,1,3,4,1,3 |
| e8 | 11 | 1,3,4,5,6,7,8,9,1,3,4 |

No dot occupies an arrowhead in these frames. Short routes visibly wrap before drawing a dot on the arrowhead. e4/e5 do not complete their long traversals within the 2-second capture, so their full-cycle behavior is unproven. There is no observed common arrival frame; same-arrival is not imposed here, since the supplied task says these dots are flair and does not request it.

### Corner, bridge, and box occupancy

**Six routes have corner occupancy**, totaling **28 route-frame corner-hit observations** across the 21 sampled frame portions:

- e2: [33,16] `╰` on frames 0,1,18,19; [33,8] `╭` on frames 16,17 (6 hits).
- e3: [37,21] `╮` on frames 2,3,6,7,10,11,14,15,18,19 (10 hits).
- e5: [37,28] `╯` on frames 0,1 (2 hits).
- e6: [32,29] `╭` on frames 14,15 (2 hits).
- e7: [11,37] `╮` on frames 4,5,10,11,16,17 (6 hits).
- e8: [39,37] `╮` on frames 14,15 (2 hits).

The reported e3 elbow issue is confirmed at zero-based (36,20), i.e. [37,21]. It occurs on alternating movement steps (the odd-indexed steps if the initial state is step 0), **not merely on odd-numbered capture frames**: both frames of each listed pair show it. No bridge exists to be occupied. No dot was found inside or on a node box. No dot-count violation occurred. Motion color cannot be checked from the essentially uncolored frame capture; the static normal/selected ANSI show accent-colored dots.

## Fit and route economy

- Captured canvas: **77 columns × 47 rows at 100%**, directly supported by ANSI row widths/counts and the status label.
- Graph extent including node borders and routes: columns 8–70, rows 7–42, a 63×36 bounding rectangle. Controls extend down to row 46. No viewer-edge clipping is visible; no node/edge label is clipped, and no captured graph item needs pan/zoom to become visible. The palette nevertheless hides two node-border cells inside that fitted canvas.
- No literal `viewport:` line appears in the permitted captures. No `crossings: N bridges, M touching bends` or `routes: N/M near-minimal` line appears either. Their reported values cannot be compared without opening prohibited check logs. The visible bridge/crossing/contact inventory is recorded above instead.
- There are no conspicuous loops. e2 goes left one cell, up eight, and right one: a 10-step route between outside endpoints with Manhattan distance eight. This slight side-entry detour is the only excess versus a simple endpoint Manhattan calculation; the other seven polylines have monotone, Manhattan-length travel between their outside endpoints. That calculation is not asserted to equal the unavailable checker's near-minimal criterion.

## Tool-usable blind scorecard

```json
{
  "stage": "A",
  "case": "modal-runtime",
  "final_spec": "specs/v1-b.json",
  "spec_sha256": "5048cd78f17c25d03b40df241f04c8d17bf0459b0f2dd67e7f5d740614d293c9",
  "views": 1,
  "visible_nodes": 8,
  "visible_edges": 8,
  "traceable_edges_across_captures": 8,
  "visible_arrowheads": 8,
  "visible_node_labels": 8,
  "visible_edge_labels": 8,
  "visible_diagram_labels": 16,
  "visible_control_labels": 4,
  "visible_status_labels": 1,
  "uncertain_label_owners": 0,
  "crossings": 0,
  "bridges": 0,
  "junctions": 0,
  "shared_route_cells": 0,
  "touching_bend_bend_pairs": 1,
  "touching_bend_straight_pairs": 2,
  "inter_route_orthogonal_adjacency_pairs": 7,
  "viewport_clipped_items": 0,
  "occluded_node_occurrences": 1,
  "overwritten_node_border_cells": 2,
  "complete_color_continuous_node_borders": 7,
  "node_border_occurrences": 8,
  "selected_state_coverage": {"captured": 8, "total": 8},
  "complete_selected_border_coverage": {"captured": 7, "total": 8},
  "canvas": {"columns": 77, "rows": 47, "zoom_percent": 100},
  "viewport_line_available": false,
  "checker_crossings_and_route_statistics_available": false,
  "animation": {
    "frame_samples": 21,
    "complete_frames": 20,
    "partially_captured_frame": 0,
    "missing_frame0_viewer_rows": 11,
    "animated_routes": 8,
    "dots_per_route_per_sample": 1,
    "dot_count_violations": 0,
    "frame0_origin_misses": 8,
    "frame1_dots_at_first_cell_after_outside_port": 8,
    "common_update_cadence_ms": 200,
    "uniform_geometric_speed": false,
    "routes_with_corner_hits": 6,
    "corner_hit_route_frame_observations": 28,
    "bridge_hit_observations": 0,
    "arrowhead_hit_observations": 0,
    "node_box_hit_observations": 0,
    "observed_common_arrowhead_arrival_frame": null,
    "same_arrival_required": false
  },
  "unsupported_or_entirely_unreadable_capture_files": [],
  "evidence_limitations": [
    "Frame 0 header and first 11 viewer rows missing from both frame files; all eight dots survive",
    "Animation ANSI provides no diagram colors",
    "No literal viewport or checker statistics line in permitted captures",
    "Long routes e4/e5 do not complete a cycle within the capture"
  ]
}
```

This file is the saved blind record. It must not be edited after saving or after the expectations reveal.
