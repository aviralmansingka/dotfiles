# Pipeline — round 04, stage A blind observation

This record uses only the final spec and saved text/ANSI captures. No source, expectations, rubric, other cases, prior rounds, viewer implementation, or new viewer session was consulted. No fixes were made. Coordinates are 1-based `[column,row,width,height]`; route points are `(column,row)`. Rows begin at the viewer header, not at the frame/time wrapper.

## Inputs and identity

- `pipeline/specs/v1-final.json`
- Verified spec SHA-256: `fd8c35436a83da8412417e3a72037092fa4800d17ed6eced13779290979159ad`.
- `pipeline/captures/v1-frames-direct.txt`: complete saved frames 0–20, timestamps 0–2000 ms.
- `pipeline/evidence/v1/v1-text.txt`
- `pipeline/evidence/v1/v1-ansi.ansi`
- `pipeline/evidence/v1/v1-selected.ansi`
- `pipeline/evidence/v1/v1-frames.txt`
- `pipeline/evidence/v1/v1-frames.ansi`

The final spec declares six nodes and six animated edges, each with `flow: true` and `dots: 1`. Those declarations are not substitutes for the observations below. Other spec attempts were not needed to judge the final view.

## Visible labels, verbatim

| Kind | Label | Bounding box |
|---|---|---|
| Node | `CLI` | `[37,8,3,1]` |
| Node | `API gateway` | `[37,16,11,1]` |
| Node | `Job queue` | `[24,24,9,1]` |
| Node | `Auth` | `[50,24,4,1]` |
| Node | `Worker pool` | `[24,32,11,1]` |
| Node | `Postgres` | `[37,40,8,1]` |
| Edge | `enqueue` | `[28,20,7,1]` |
| Edge | `verify` | `[41,20,6,1]` |
| Edge | `write` | `[28,36,5,1]` |
| Edge | `read` | `[43,36,4,1]` |
| UI | `rataflow-view · 77x47 @100% · v1-final.json · 6 nodes · 6 edges · q quit` | `[2,1,72,1]` |
| UI | `+ [+]` | `[4,42,5,1]` |
| UI | `− [-]` | `[4,43,5,1]` |
| UI | `⊡ [f]` | `[4,44,5,1]` |
| UI | `□ [i]` | `[4,45,5,1]` |

There are 10 graph labels: six node labels and four edge labels. There are five additional viewer UI text runs. The frame/time headings and `viewport:` line are capture metadata, not labels inside the view. The shell prompt after the evidence frame capture is not viewer content.

All four edge-label owners are visually clear: `enqueue` belongs to the left API branch, `verify` to the right API branch, `write` to the left lower approach to Postgres, and `read` to the right lower approach. No label has an uncertain owner. No label occupies an edge cell.

## Nodes and border evidence

| Node | Outer box | Normal border RGB | Border cells |
|---|---|---|---:|
| CLI | `[36,7,5,4]` | `(216,166,87)` | 14 |
| API gateway | `[36,15,13,4]` | `(125,174,163)` | 30 |
| Job queue | `[23,23,11,4]` | `(169,182,101)` | 26 |
| Auth | `[49,23,6,4]` | `(211,134,155)` | 16 |
| Worker pool | `[23,31,13,4]` | `(189,201,124)` | 30 |
| Postgres | `[36,39,10,4]` | `(125,160,184)` | 24 |

Every node has a complete top, bottom, left, and right side and all four rounded corners (`╭ ╮ ╰ ╯`). No source or target route overwrites a node border. Every normal border is color-continuous, proven by ANSI foreground attributes across every perimeter cell, not inferred from plain text. Job queue and Worker pool have related green hues but different exact RGB values. No enclosing group boxes or group labels are visible.

The selected ANSI capture contains all six node occurrences, each with its entire own perimeter bold and RGB `(216,166,87)`. Selected coverage is therefore **6/6 unique node occurrences in the single final graph view**, captured together in an all-selected view. This does not demonstrate six separately operated single-node selection interactions. CLI's normal border already has the selected hue; its selected state is distinguished by bold. All 140 node perimeter cells are bold in the selected capture.

The controls box at `[2,41,9,6]` is also complete, with square corners and RGB `(168,153,104)`. It is viewer chrome, not a seventh graph node, and does not touch Postgres.

## Visible arrows and full routes

All six arrowheads are intact downward `▼` glyphs in every direct frame. Every route is continuously traceable from its source box to its target box without guessing. Dots replace straight route cells but do not obscure an endpoint or change apparent connectivity. The first route cell is immediately outside the source border; arrowheads are immediately above the target border.

| ID | Source → target | Visible route from first drawn cell through bends to head | Direction / label |
|---|---|---|---|
| E1 | CLI → API gateway | `(37,11)` → `(37,14)` | Down; no edge label; head `(37,14)` |
| E2 | API gateway → Auth | `(39,19)` → `(39,21)` → `(50,21)` → `(50,22)` | Down, right, down; `verify`; head `(50,22)` |
| E3 | API gateway → Job queue | `(37,19)` → `(37,21)` → `(24,21)` → `(24,22)` | Down, left, down; `enqueue`; head `(24,22)` |
| E4 | Job queue → Worker pool | `(24,27)` → `(24,30)` | Down; no edge label; head `(24,30)` |
| E5 | Worker pool → Postgres | `(24,35)` → `(24,37)` → `(37,37)` → `(37,38)` | Down, right, down; `write`; head `(37,38)` |
| E6 | Auth → Postgres | `(50,27)` → `(50,37)` → `(39,37)` → `(39,38)` | Down, left, down; `read`; head `(39,38)` |

## Crossings, bends, branches, and detours

- Visible crossings: **0**. Visible bridge glyphs: **0**. Touching bends: **0**. Shared route runs: **0**. Route-to-node collisions: **0**.
- All eight route corners are ordinary rounded bends, not junctions: `(37,21)` `╯`, `(24,21)` `╭`, `(39,21)` `╰`, `(50,21)` `╮`, `(24,37)` `╰`, `(37,37)` `╮`, `(50,37)` `╯`, `(39,37)` `╭`.
- The two API routes leave different ports. Their near-source stems and corners at columns 37 and 39 have a blank column between them; they do not form an on-route split junction. The API box visibly branches into two outgoing arrows.
- The two Postgres approaches likewise retain separate ports at columns 37 and 39, with a blank column between them. They converge on the box, not on a shared route junction.
- There are no T, cross, or bus junctions. No third branch can be read from any bend.
- The Auth → Postgres route is conspicuously taller than the Worker pool → Postgres route, running down the right side of the Worker pool, but it never doubles back. All routes are coordinate-monotone from their visible source stems to their heads. No loops or conspicuous avoidable detours are visible.
- The inspected captures contain no `crossings: N bridges, M touching bends` or `routes: N/M near-minimal` diagnostic line. Thus the visible zero crossings and lack of loops can be stated, but comparison with those reported counters is unavailable under the capture/spec-only restriction. No check report was read to fill that gap.

## Motion: measured rather than assumed

### Frame-zero origin test

| Edge | Source-border port position | First drawn cell outside box | Dot at frame 0 |
|---|---|---|---|
| E1 | `(37,10)` | `(37,11)` | `(37,12)` |
| E2 | `(39,18)` | `(39,19)` | `(39,20)` |
| E3 | `(37,18)` | `(37,19)` | `(37,20)` |
| E4 | `(24,26)` | `(24,27)` | `(24,28)` |
| E5 | `(24,34)` | `(24,35)` | `(24,36)` |
| E6 | `(50,26)` | `(50,27)` | `(50,28)` |

**None of the six frame-zero dots sits on the first drawn cell.** Each starts two rows below its source border, leaving one visible straight stem cell between the box and dot. The claim that it is one cell past the port stem matches these coordinates, but it does not make that cell the reader-visible route origin. The reader sees an already-departed dot, not one appearing at the box/first route cell.

### All direct-capture dot positions

The paired frames have exactly identical positions. Each row below lists E1 through E6 in the same order as the arrow table. Every frame has six dots, exactly one on each of the six routes: 126 observed dot instances across 21 frames.

| Frames | Times (ms) | E1 | E2 | E3 | E4 | E5 | E6 |
|---|---|---|---|---|---|---|---|
| 0, 1 | 0, 100 | `(37,12)` | `(39,20)` | `(37,20)` | `(24,28)` | `(24,36)` | `(50,28)` |
| 2, 3 | 200, 300 | `(37,13)` | `(40,21)` | `(36,21)` | `(24,29)` | `(25,37)` | `(50,29)` |
| 4, 5 | 400, 500 | `(37,12)` | `(41,21)` | `(35,21)` | `(24,28)` | `(26,37)` | `(50,30)` |
| 6, 7 | 600, 700 | `(37,13)` | `(42,21)` | `(34,21)` | `(24,29)` | `(27,37)` | `(50,31)` |
| 8, 9 | 800, 900 | `(37,12)` | `(43,21)` | `(33,21)` | `(24,28)` | `(28,37)` | `(50,32)` |
| 10, 11 | 1000, 1100 | `(37,13)` | `(44,21)` | `(32,21)` | `(24,29)` | `(29,37)` | `(50,33)` |
| 12, 13 | 1200, 1300 | `(37,12)` | `(45,21)` | `(31,21)` | `(24,28)` | `(30,37)` | `(50,34)` |
| 14, 15 | 1400, 1500 | `(37,13)` | `(46,21)` | `(30,21)` | `(24,29)` | `(31,37)` | `(50,35)` |
| 16, 17 | 1600, 1700 | `(37,12)` | `(47,21)` | `(29,21)` | `(24,28)` | `(32,37)` | `(50,36)` |
| 18, 19 | 1800, 1900 | `(37,13)` | `(48,21)` | `(28,21)` | `(24,29)` | `(33,37)` | `(49,37)` |
| 20 | 2000 | `(37,12)` | `(49,21)` | `(27,21)` | `(24,28)` | `(34,37)` | `(48,37)` |

### Rate, direction, spacing, and endpoint findings

- All routes share a temporal cadence: no movement between frames 0 and 1, then a position update at frame 2, and so on every 200 ms. This is consistent with a quantized nominal 0.5 eligible-position step per 100 ms, not literal visible movement every 100 ms.
- Four longer routes advance forward along the arrow direction, with no backward movement or wrap observed in this window. There is only one dot per route, so within-route inter-dot spacing is not applicable. The spacing between dots on different routes is not uniform and does not need to be inferred as a shared train or bus.
- **Strict character-grid speed is not identical at every update.** At frames 1→2, E2 jumps `(39,20)` → `(40,21)`, E3 jumps `(37,20)` → `(36,21)`, and E5 jumps `(24,36)` → `(25,37)`. At frames 17→18, E6 jumps `(50,36)` → `(49,37)`. Each transition skips an intervening corner cell: two Manhattan grid steps in one 200 ms update instead of the normal one. The dots share the same eligible-slot cadence, but the capture does not support unqualified constant geometric speed in drawn cells. Each longer route travels 11 Manhattan steps in the measured 2 s; each short route accumulates 10 absolute steps while repeatedly returning.
- No dot rests on any of the eight corner cells, a bridge, a label, a node box/border, or an arrowhead in the inspected captures. The saved normal and selected static ANSI views also show dots on straight cells only. The corner skips above preserve bend glyphs but cause diagonal visual jumps.
- E1 and E4 are the two very short hop routes. E1 alternates only `(37,12)` ↔ `(37,13)`; E4 alternates only `(24,28)` ↔ `(24,29)`. Each position lasts 200 ms, and the two-state cycle repeats every 400 ms. Over 0–2000 ms each completes five cycles and ends where it began.
- Those short routes **do show a changing dot position**, but not convincing sustained source-to-target travel: the viewer sees a two-cell bobble/oscillation, with a return jump visually indistinguishable from reverse travel. Neither starts on its first stem cell nor ever covers its arrowhead. Direction is communicated by the stationary arrow, not reliably by that oscillation. Count two short-route motion-legibility concerns; do not call them static or absent.
- Zero dots visibly reach an arrowhead, in the same frame or otherwise. Every `▼` remains present throughout. The short routes reach the cell just before their heads at frames 2, 6, 10, 14, and 18, then return. The longer routes do not complete their routes in the supplied 2 s window. Therefore synchronized arrowhead arrival is **not demonstrated**, not an observed successful synchronization.
- Although there are 21 complete direct frames, they are not a complete animation cycle for the four long routes: their dots have not returned to their starts or reached the destination ends by frame 20. Their full-cycle duration, wrapping behavior, and eventual near-head timing are not observable here. No extrapolated later frames are treated as evidence.

## Fit and evidence limits

- Capture metadata: `viewport: 77x47 zoom: 1.00 natural`.
- Header: `77x47 @100%`.
- Both normal and selected ANSI buffers measure **77 columns × 47 rows** exactly. Direct text frames trim right-side spaces and the last blank row: longest nonblank line is 73 characters, final nonblank row is 46. This is not a smaller viewport or clipped graph.
- The graph occupies columns 23–54 and rows 7–42, inclusive: 32 × 36 cells. Every node, label, route, and arrowhead is visible within the target frame at 100%. The control overlay occupies columns 2–10, rows 41–46, with no graph overlap. No content requires pan or zoom to read; zero observed clipped or hidden graph items.
- The terminal-captured evidence `v1-frames.txt` and `.ansi` start partway through frame 0: frame-0 heading, header, and top node rows are absent, and the initial visible dot belongs to viewer row 12. They also include a shell prompt after frame 20. Their complete frames 1–20 match the direct capture's dot coordinates. The direct capture supplies the missing full frame 0, so frame-zero conclusions above do not rely on guessing the truncated origin.
- No provided capture format was unreadable or unsupported. There is no interactive movie playback here; motion findings come from measured saved timestamps and cell positions. Live user selection interaction and long-route full cycles are not captured. Diagnostic crossing/near-minimal counters are absent from the captures inspected.

## Tool-usable blind scorecard

The dot-issue categories below describe observations, not a hidden rubric. `distinct_routes_with_observed_issues` is a union, not a sum. `route_criterion_issue_count` sums six frame-zero offsets, four corner-skipping geometric-step concerns, and two short-route legibility concerns; a route can contribute to multiple categories. Collision/count violations are zero.

```json
{
  "stage": "A",
  "case": "pipeline",
  "spec_sha256": "fd8c35436a83da8412417e3a72037092fa4800d17ed6eced13779290979159ad",
  "viewport": {"columns": 77, "rows": 47, "zoom": 1.0},
  "final_graph_views": 1,
  "visible_nodes": 6,
  "visible_edges": 6,
  "traceable_edges": 6,
  "intact_arrowheads": 6,
  "visible_labels": 10,
  "visible_node_labels": 6,
  "visible_edge_labels": 4,
  "viewer_ui_text_runs": 5,
  "all_visible_text_runs_including_ui": 15,
  "crossings": 0,
  "bridge_glyphs": 0,
  "touching_bends": 0,
  "ordinary_route_bends": 8,
  "on_route_junctions": 0,
  "branching_source_boxes": 1,
  "converging_target_boxes": 1,
  "shared_route_runs": 0,
  "uncertain_label_owners": 0,
  "clipped_items": 0,
  "hidden_graph_items_observed": 0,
  "complete_node_borders": 6,
  "color_continuous_node_borders": 6,
  "selected_state_coverage": {"captured": 6, "total": 6, "mode": "single all-selected capture"},
  "motion_frames": 21,
  "motion_window_ms": [0, 2000],
  "animated_routes_visible": 6,
  "dots_per_frame": 6,
  "dots_per_route_per_frame": 1,
  "dot_instances_observed": 126,
  "dot_violations": {
    "missing_or_excess_dot_instances": 0,
    "corner_occupancies": 0,
    "bridge_occupancies": 0,
    "label_occupancies": 0,
    "node_box_occupancies": 0,
    "arrowhead_occupancies": 0,
    "frame_zero_not_on_first_drawn_cell_routes": 6,
    "corner_skipping_nonuniform_geometric_step_routes": 4,
    "two_cell_oscillation_legibility_concern_routes": 2,
    "distinct_routes_with_observed_issues": 6,
    "route_criterion_issue_count": 12
  },
  "same_eligible_slot_cadence": true,
  "strict_uniform_character_grid_speed": false,
  "arrowhead_arrivals_observed": 0,
  "synchronized_arrowhead_arrival": "not demonstrated",
  "long_route_complete_cycles_captured": 0,
  "short_route_cycles_captured_each": 5,
  "capture_diagnostics": {"reported_crossings": null, "reported_near_minimal_routes": null},
  "unreadable_capture_files": [],
  "capture_limitations": [
    "terminal evidence frame zero is truncated; direct capture supplies the complete frame",
    "four long routes do not finish a cycle within frames 0 through 20",
    "crossings and near-minimal diagnostic counter lines are absent from inspected captures",
    "all-selected borders are captured, but separate interactive selections are not"
  ]
}
```

Stage A ends with this saved blind record. No expectation-dependent judgment is included.
