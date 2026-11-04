# Blind observation — server-nic-layout, round 02, stage A

This record was written before receipt of the source brief, expectations, or rubric. It describes the two final captured views, not whether their content satisfies an unseen brief. Coordinates are 1-based terminal cells: `[column,row,width,height]`, measured from the captured viewer's upper-left corner, including its header row. Point coordinates below are `(column,row)`.

## Evidence and method

Read `judge-blind-task.md` in full. Inspected the final `evidence/v1/v1-{text.txt,ansi.ansi,selected.ansi,frames.txt,frames.ansi}` and corresponding final v2 files. Parsed the existing ANSI captures into cells to verify border foreground colors, bold selection, coordinates, and frame dot positions. Read `v1.json` and `v2.json` only for intended route identities; visible routes and labels below are grounded in captures. Manifest metadata was inspected but is not proof of visual quality. No checks, validation results, or generator claims are used as proof. Superseded attempts are not counted as final views.

No new viewer session, rendering, fix, install, subagent, or commit was performed. No source, expected data, rubric, dataset manifest, other case, or earlier-round result was read.

## Blind scorecard

Counts sum occurrences across final views, not inferred unique real-world entities. Diagram labels include node and edge text; viewer chrome is counted separately.

```json
{
  "case": "server-nic-layout",
  "stage": "A",
  "views": {
    "v1": {
      "visible_nodes": 6,
      "visible_edges": 5,
      "visible_diagram_labels": 11,
      "crossings": 0,
      "uncertain_label_owners": 1,
      "fused_labels": 0,
      "clipped_items": 0,
      "selected_state_coverage": {"captured": 6, "total": 6},
      "dot_count_or_forbidden_cell_violations_observed": 0,
      "animated_routes_with_two_position_alternation": 2,
      "viewport": "77x47 @100%"
    },
    "v2": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_diagram_labels": 9,
      "crossings": 0,
      "uncertain_label_owners": 0,
      "fused_labels": 0,
      "clipped_items": 0,
      "selected_state_coverage": {"captured": 5, "total": 5},
      "dot_count_or_forbidden_cell_violations_observed": 0,
      "animated_routes_with_two_position_alternation": 4,
      "viewport": "77x47 @100%"
    }
  },
  "total": {
    "visible_nodes": 11,
    "visible_edges": 9,
    "visible_diagram_labels": 20,
    "visible_chrome_labels": 10,
    "crossings": 0,
    "bridge_glyphs": 0,
    "interedge_touching_bends": 0,
    "route_junctions": 0,
    "apparent_route_branches": 0,
    "uncertain_label_owners": 1,
    "fused_labels": 0,
    "labels_touching_node_borders": 1,
    "clipped_items": 0,
    "selected_state_coverage": {"captured": 11, "total": 11},
    "complete_color_continuous_normal_borders": 11,
    "complete_color_continuous_selected_borders": 11,
    "node_occurrences_with_uncheckable_borders": 0,
    "animated_routes": 6,
    "timestamped_frames_per_view": 5,
    "dot_count_or_forbidden_cell_violations_observed": 0,
    "animated_routes_with_two_position_alternation": 6
  }
}
```

Zero observed dot count/forbidden-cell violations is not a claim of smooth motion. All six animated routes alternate between two sampled positions; forward traversal and slow cadence are not established. See the motion section.

## View v1 — labels

Every diagram label is single-line and legible.

| Kind | Verbatim visible label | Bounds |
|---|---|---|
| Node | `7 of 8 ports dark` | `[29,12,17,1]` |
| Node | `server1 R7725 .58` | `[29,20,17,1]` |
| Node | `eno16595np0 25GbE` | `[29,28,17,1]` |
| Node | `server2 .59` | `[12,36,11,1]` |
| Node | `Arista .57 L3` | `[31,36,13,1]` |
| Node | `.60-.62 (free?)` | `[52,36,15,1]` |
| Edge-area text | `no link seen` | `[31,16,12,1]` |
| Edge-area text | `only uplink` | `[31,24,11,1]` |
| Edge-area text | `def gw 0.1ms` | `[31,32,12,1]` |
| Edge-area text, owner uncertain | `same /29` | `[22,34,8,1]` |
| Edge-area text | `free?` | `[46,35,5,1]` |

There are no fused pairs of words from separate labels. `free?` ends at column 50, immediately touching the spare node's upper-left corner at `(51,35)` with no blank separator. This is label-to-border contact, not two fused text labels.

### Label ownership

- `no link seen` is beside the dashed vertical dark-ports → server1 route.
- `only uplink` is beside the server1 → NIC vertical route.
- `def gw 0.1ms` is beside the NIC → Arista route before its bend.
- `same /29` is uncertain from the capture alone: it is two rows above the server2 → Arista horizontal route, but immediately left of the different NIC → Arista downward arrowhead at `(31,34)`, separated by only column 30. It could be read as annotating that descending route instead. The spec assigns it to server2 → Arista; that assignment is intention, not visual proof.
- `free?` is directly above the dashed spare → Arista corridor. Its owner is reasonably identifiable, although the text touches the spare box's corner.

### Arrows and complete routes

Every listed arrowhead is visibly present. All five geometric source-to-target routes can be followed without guessing; the uncertainty above concerns a label, not the endpoints.

| Route | Source box → target box | Visible path and direction | Arrowhead |
|---|---|---|---|
| V1-A | `7 of 8 ports dark` → `server1 R7725 .58` | Down at column 29, dashed cells rows 15–17, between source bottom row 14 and target top row 19 | `▼` at `(29,18)` |
| V1-B | `server1 R7725 .58` → `eno16595np0 25GbE` | Down at column 29, rows 23–26, between box rows 22 and 27 | `▼` at `(29,26)` |
| V1-C | `eno16595np0 25GbE` → `Arista .57 L3` | Down from source bottom row 30 at column 29; rows 31–32, then right across row 33 from columns 29–31, then down toward target top row 35 | `▼` at `(31,34)` |
| V1-D | `server2 .59` → `Arista .57 L3` | Right along row 36, columns 24–29, between source right border column 23 and target left border column 30 | `▶` at `(29,36)` |
| V1-E | `.60-.62 (free?)` → `Arista .57 L3` | Left along row 36: dashed cells columns 46–50, from spare left border column 51 toward Arista right border column 44 | `◀` at `(45,36)` |

V1-C has two same-route rounded elbows: `╰` at `(29,33)` and `╮` at `(31,33)`, with a straight horizontal cell between. These form one dogleg, not a bridge or crossing. No other route touches either elbow. There are zero interedge crossings, bridge glyphs, shared runs, touching bends between different routes, route junctions, or apparent route branches. Three arrows converge on the Arista box at distinct top/left/right boundary locations; they do not join outside the box. All node borders remain continuous at attachments.

## View v2 — labels

| Kind | Verbatim visible label | Bounds |
|---|---|---|
| Node | `eno16595np0 .58` | `[30,8,15,1]` |
| Node | `Arista .57 AS132717` | `[30,16,19,1]` |
| Node | `Airtel 14.143.x` | `[30,24,15,1]` |
| Node | `AirtelBB 14.141.x` | `[30,32,17,1]` |
| Node | `CF 1.1.1.1 AS13335` | `[30,40,18,1]` |
| Edge | `no NAT, no v6` | `[32,12,13,1]` |
| Edge | `1.8 ms unseen` | `[32,20,13,1]` |
| Edge | `7.1 ms` | `[32,28,6,1]` |
| Edge | `8.3 ms` | `[32,36,6,1]` |

All four edge labels sit beside their respective isolated vertical gaps. No owning edge is uncertain. No labels fuse or touch node borders.

### Arrows and complete routes

All four routes are straight downward at column 30, with no guessing required. Arrowheads remain present in all sampled frames.

| Route | Source box → target box | Route cells outside boxes | Arrowhead |
|---|---|---|---|
| V2-A | `eno16595np0 .58` → `Arista .57 AS132717` | `(30,11)` through `(30,14)` | `▼` at `(30,14)` |
| V2-B | `Arista .57 AS132717` → `Airtel 14.143.x` | `(30,19)` through `(30,22)` | `▼` at `(30,22)` |
| V2-C | `Airtel 14.143.x` → `AirtelBB 14.141.x` | `(30,27)` through `(30,30)` | `▼` at `(30,30)` |
| V2-D | `AirtelBB 14.141.x` → `CF 1.1.1.1 AS13335` | `(30,35)` through `(30,38)` | `▼` at `(30,38)` |

Zero crossings, bends, bridges, junctions, shared runs, touching routes, or apparent route branches are visible in v2. Alignment across intervening boxes does not create an outside-box shared corridor.

## Borders and selection — ANSI-grounded audit

For every node below, all four sides and all four rounded corners are present and complete in both the normal and selected ANSI captures. Each normal perimeter uses one continuous foreground color. Each selected perimeter uses bold (`SGR 1`) RGB `(216,166,87)` continuously, including all side and corner cells. No edge-colored interruption was found in a perimeter. The following are node box bounds, not label bounds.

| View | Node | Box bounds | Normal border RGB | Perimeter cells checked per state | Selected perimeter |
|---|---|---|---|---:|---|
| v1 | `7 of 8 ports dark` | `[28,11,19,4]` | `(216,166,87)` | 42 | Complete, continuous bold accent |
| v1 | `server1 R7725 .58` | `[28,19,19,4]` | `(125,174,163)` | 42 | Complete, continuous bold accent |
| v1 | `eno16595np0 25GbE` | `[28,27,19,4]` | `(228,184,111)` | 42 | Complete, continuous bold accent |
| v1 | `server2 .59` | `[11,35,13,4]` | `(147,194,183)` | 30 | Complete, continuous bold accent |
| v1 | `Arista .57 L3` | `[30,35,15,4]` | `(211,134,155)` | 34 | Complete, continuous bold accent |
| v1 | `.60-.62 (free?)` | `[51,35,17,4]` | `(169,182,101)` | 38 | Complete, continuous bold accent |
| v2 | `eno16595np0 .58` | `[29,7,17,4]` | `(216,166,87)` | 38 | Complete, continuous bold accent |
| v2 | `Arista .57 AS132717` | `[29,15,21,4]` | `(211,134,155)` | 46 | Complete, continuous bold accent |
| v2 | `Airtel 14.143.x` | `[29,23,17,4]` | `(125,174,163)` | 38 | Complete, continuous bold accent |
| v2 | `AirtelBB 14.141.x` | `[29,31,19,4]` | `(147,194,183)` | 42 | Complete, continuous bold accent |
| v2 | `CF 1.1.1.1 AS13335` | `[29,39,20,4]` | `(169,182,101)` | 44 | Complete, continuous bold accent |

Coverage: 11/11 normal node occurrences and 11/11 selected node occurrences can be checked; 0 cannot. Selection is simultaneous in each `selected.ansi`, not a separate solo selection for each node. Every node nevertheless has its own complete selected border visible. This does not prove single-selection interaction behavior.

The normal/selected ANSI evidence also shows labels in RGB `(235,219,178)`, routes and arrowheads in muted `(124,111,100)`, background `(40,40,40)`, and visible snapshot dots in `(216,166,87)`. The zoom-control border is complete in `(168,153,104)` in both views; it is UI, not a node. Thus there are also colored node borders in the unselected snapshots, including an accent-colored first node, not exclusively accent-colored selection/dots.

The files named `frames.ansi` retain ANSI in the surrounding shell transcript, but **none of the five diagram frame bodies in either view contains an SGR color sequence**. They are readable for glyphs and motion, not proof of animated-frame color continuity. Color during those timestamped frames is missing evidence, not inferred from the static snapshots.

## Motion — every timestamped route

Five frames per view are explicitly timestamped 0, 100, 200, 300, and 400 ms. Every animated route has exactly one visible dot in every frame. With only one dot per route, within-route inter-dot spacing is not applicable.

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms | Counts per frame |
|---|---|---|---|---|---|---|
| V1-B, server1 → NIC | `(29,24)` | `(29,25)` | `(29,24)` | `(29,25)` | `(29,24)` | `1,1,1,1,1` |
| V1-C, NIC → Arista | `(29,32)` | `(30,33)` | `(29,32)` | `(30,33)` | `(29,32)` | `1,1,1,1,1` |
| V2-A, NIC → Arista | `(30,12)` | `(30,13)` | `(30,12)` | `(30,13)` | `(30,12)` | `1,1,1,1,1` |
| V2-B, Arista → Airtel | `(30,20)` | `(30,21)` | `(30,20)` | `(30,21)` | `(30,20)` | `1,1,1,1,1` |
| V2-C, Airtel → AirtelBB | `(30,28)` | `(30,29)` | `(30,28)` | `(30,29)` | `(30,28)` | `1,1,1,1,1` |
| V2-D, AirtelBB → CF | `(30,36)` | `(30,37)` | `(30,36)` | `(30,37)` | `(30,36)` | `1,1,1,1,1` |

V1-A, V1-D, and V1-E have zero dots at all five timestamps. Total visible dots are two per v1 frame and four per v2 frame. The two v1 dots are separated by eight rows at even frames and by eight rows plus one column at odd frames. All four v2 dots move in phase and stay eight rows apart.

Observed direction and cadence:

- V1-B and all v2 routes move one cell downward from 0→100 ms, upward to the earlier location at 100→200 ms, downward again at 200→300 ms, and upward at 300→400 ms. A down arrow establishes intended direction, but the sampled dot sequence visibly alternates rather than establishing monotonic downward travel.
- V1-C moves from a vertical cell to the horizontal middle cell of its dogleg in the first interval: down/right along the route, skipping the intervening corner in the samples. It returns to the earlier vertical cell in the next interval. This repeats. Its sampled forward displacement spans two route steps, whereas the other animated routes span one.
- Every route has a repeating two-position pattern with a 200 ms sampled period, not evidence of a slow full-route traversal. It is not possible to decide from these samples whether the apparent returns are resets, temporal aliasing, or actual reversals. No intermediate state or continuous live observation is provided.
- No sampled dot occupies a corner, bridge, junction, or arrowhead. V1-C's odd-frame dot at `(30,33)` occupies the straight cell **between** the two elbows; neither elbow is overwritten. No sampled dot touches a box border or label. Arrowheads remain visible.

There are 30 animated-route/frame observations (6 routes × 5 frames), all with one dot, and zero observed forbidden-cell/count violations. There are six cadence/direction evidence concerns: all six routes show two-position alternation. Events between captured timestamps cannot be excluded, and a claim that a dot *never* occupies a forbidden cell over its entire animation is not proved by this finite sample.

## Viewer chrome — remaining visible labels

The same control labels occur at the same positions in both final views. Bounds exclude blank padding inside the control box.

| View | Verbatim label | Bounds |
|---|---|---|
| v1 | `rataflow-view · 77x47 @100% · v1.json · 6 nodes · 5 edges · q quit` | `[2,1,66,1]` |
| v2 | `rataflow-view · 77x47 @100% · v2.json · 5 nodes · 4 edges · q quit` | `[2,1,66,1]` |
| Both, once per view | `+ [+]` | `[4,42,5,1]` |
| Both, once per view | `− [-]` | `[4,43,5,1]` |
| Both, once per view | `⊡ [f]` | `[4,44,5,1]` |
| Both, once per view | `□ [i]` | `[4,45,5,1]` |

The control box occupies `[2,41,9,6]`. It obscures no diagram content. Shell commands/prompts surrounding the timestamped frame dump are capture scaffolding, not diagram labels; frame coordinates restart at each viewer header.

## Fit and evidence limits

Both normal ANSI captures have exactly 47 rows and 77 cells in every row after SGR removal. Both viewer headers show `77x47 @100%`. Both frame transcripts contain the literal measurement:

`viewport: 77x47 zoom: 1.00 natural`

That line appears for the normal, selected, and frame-dump invocations. This is actual transcript evidence even though the manifests' `viewport_line` and pane-column fields are null. The plain text snapshots have 46 stored lines because the trailing blank viewport row is absent; the colored captures retain all 47.

- V1's diagram boxes/routes/labels occupy columns 11–67 and rows 11–38. All are inside the viewport. The header and control box also fit.
- V2's diagram boxes/routes/labels occupy columns 29–49 and rows 7–42. Its final box bottom and the control label share row 42 but are horizontally separate. Neither obscures the other.
- Zero visible clipped items, cut-off labels, missing visible border sides, or oversize warnings. All captured diagram content is visible at 100%; nothing shown needs pan or zoom.
- No interactive pan/zoom behavior was tested. Absent expected content cannot be diagnosed as missing or hidden in this blind stage.
- All inspected capture formats were readable. Missing evidence is animated-frame color, continuous/intermediate animation, full-cycle monotonic traversal, and solo-selection behavior. The captures do not prove these properties. No visual claim is rescued by spec, `--check`, validator, or generator report.

This stage-A record is to remain unchanged after its SHA-256 is produced. Expectations and subsequent scoring belong in a separate stage-B record.
