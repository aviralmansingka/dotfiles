# modal-runtime — round 02, stage A, blind observation

This record precedes disclosure of the source, expected relationships, or rubric. It records the three final captured views, not semantic correctness against an undisclosed brief. No viewer was launched, no rendering was generated, and no spec or renderer was changed. No other case or earlier-round material was consulted.

## Evidence and coordinate convention

Read in full: the stage-A judge contract; `modal-runtime/evidence/v{1,2,3}/v*-text.txt`, `v*-ansi.ansi`, `v*-selected.ansi`, `v*-frames.txt`, and `v*-frames.ansi`. The evidence manifests were inspected for measurement availability, not for visual correctness. Specs, generator reports, check output, and validation output were not needed to establish these observations and were not used as proof.

All paths below are relative to `docs/visualize-eval/rounds/02/`. Coordinates are 1-based terminal cells, with the status header at row 1. A label rectangle is `[column,row,width,height]`, excluding border glyphs and padding. A box rectangle includes its border. Counts refer to occurrences across final views; repetitions across views are not additional distinct concepts. Selected and motion copies do not increase the occurrence count.

All three ANSI still captures contain 47 rows of 77 cells. The plain-text still captures omit the final blank row and trim trailing spaces; their nonblank content agrees with the ANSI captures. Motion text and ANSI captures also agree after stripping SGR and trailing spaces. Their diagram portions are plain glyph text: ANSI color escapes in `*-frames.ansi` belong to the surrounding shell transcript, not to the printed diagram frames. Thus motion positions are inspectable, but temporal border-color continuity is not proved by those files.

## 1. Visible labels, verbatim

### v1 — overview

| Kind / owning route | Visible label | Rectangle |
|---|---|---|
| Node | `modal-worker` | [21,8,12,1] |
| Node | `modal-runtime` | [20,16,13,1] |
| Node | `Task engine` | [21,24,11,1] |
| Node | `modal-daemon` | [45,24,12,1] |
| Node | `Container backend` | [18,32,17,1] |
| Node | `Filesystem + volumes` | [41,32,20,1] |
| Node | `Task container` | [20,40,14,1] |
| Node | `Blobnet` | [48,40,7,1] |
| v1-A | `task+ctrl` | [23,12,9,1] |
| v1-B | `events+mgmt` | [37,12,11,1] |
| v1-C | `dispatches` | [22,21,10,1] |
| v1-D | `fs HTTP/UDS` | [28,19,11,1] |
| v1-E | `starts/manages` | [20,30,14,1] |
| v1-F | `mounts/snapshots` | [24,28,16,1] |
| v1-G | `runs user proc` | [20,36,14,1] |
| v1-H | `image+vol data` | [34,38,14,1] |

### v2 — upper portion

| Kind / owning route | Visible label | Rectangle |
|---|---|---|
| Node | `modal-worker` | [25,16,12,1] |
| Node | `modal-runtime` | [24,24,13,1] |
| Node | `Task engine` | [25,32,11,1] |
| Node | `modal-daemon` | [43,32,12,1] |
| v2-A | `gRPC call` | [27,20,9,1] |
| v2-B | `gRPC events` | [41,20,11,1] |
| v2-C | `dispatch` | [26,29,8,1] |
| v2-D | `HTTP over UDS` | [28,27,13,1] |

### v3 — lower portion

| Kind / owning route | Visible label | Rectangle |
|---|---|---|
| Node | `Task engine` | [21,16,11,1] |
| Node | `Container backend` | [18,24,17,1] |
| Node | `Filesystem + volumes` | [41,24,20,1] |
| Node | `Task container` | [20,32,14,1] |
| Node | `Blobnet` | [48,32,7,1] |
| v3-A | `starts / manages` | [20,22,16,1] |
| v3-B | `mounts / snapshots` | [24,20,18,1] |
| v3-C | `runs user process` | [20,28,17,1] |
| v3-D | `image + volume data` | [22,27,19,1] |

### Viewer chrome — not diagram-label counts

Each still also contains the following labels. These are recorded separately so that UI text is not mistaken for graph content.

| View | Visible label | Rectangle |
|---|---|---|
| v1 | `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 8 edges · q quit` | [2,1,66,1] |
| v2 | `rataflow-view · 77x47 @100% · v2.json · 4 nodes · 4 edges · q quit` | [2,1,66,1] |
| v3 | `rataflow-view · 77x47 @100% · v3.json · 5 nodes · 4 edges · q quit` | [2,1,66,1] |
| Each view | `+ [+]` | [4,42,5,1] |
| Each view | `− [-]` | [4,43,5,1] |
| Each view | `⊡ [f]` | [4,44,5,1] |
| Each view | `□ [i]` | [4,45,5,1] |

There are 33 diagram-label occurrences (17 node titles and 16 edge captions), plus 15 chrome-label occurrences. No two diagram labels fuse into one word or continuous text run. Internal plus signs and slashes above are literal visible text, not inferred separators between different labels.

## 2. Every visible arrow and its route

The following traces come from the captured cells. Coordinates in the trace are the first outside-box route cell, each bend, and the terminal arrowhead. Straight segments between listed cells are visible, except that one live dot can replace a straight-segment glyph. Every listed arrow has a visible arrowhead and is followable end to end without guessing its endpoints. Arrowheads point into the adjacent target box; the border glyph beneath or beside the head is retained rather than replaced with a port glyph.

### v1 — eight arrows

| ID | Source box → target box | Visible path / direction | Arrowhead | Whole route traceable? |
|---|---|---|---|---|
| v1-A | modal-worker → modal-runtime | From (21,11) down; bends `╯` (21,13), `╭` (20,13); then down | `▼` (20,14) | Yes |
| v1-B | modal-runtime → modal-worker | From (34,16) right; `╯` (35,16); up column 35; `╮` (35,8); left | `◀` (34,8) | Yes |
| v1-C | modal-runtime → Task engine | From (20,19) down; `╰` (20,21), `╮` (21,21); then down | `▼` (21,22) | Yes |
| v1-D | modal-runtime → modal-daemon | From (22,19) down; `╰` (22,20); right; `╮` (45,20); down | `▼` (45,22) | Yes |
| v1-E | Task engine → Container backend | From (21,27) down; `╯` (21,29); left; `╭` (18,29); down | `▼` (18,30) | Yes |
| v1-F | Task engine → Filesystem + volumes | From (23,27) down; `╰` (23,29); right; `╮` (41,29); down | `▼` (41,30) | Yes |
| v1-G | Container backend → Task container | From (18,35) down; `╰` (18,37); right; `╮` (20,37); down | `▼` (20,38) | Yes |
| v1-H | Filesystem + volumes → Blobnet | From (41,35) down; `╰` (41,37); right; `╮` (48,37); down | `▼` (48,38) | Yes |

### v2 — four arrows

| ID | Source box → target box | Visible path / direction | Arrowhead | Whole route traceable? |
|---|---|---|---|---|
| v2-A | modal-worker → modal-runtime | From (25,19) down; `╯` (25,21), `╭` (24,21); down | `▼` (24,22) | Yes |
| v2-B | modal-runtime → modal-worker | From (38,24) right; `╯` (39,24); up column 39; `╮` (39,16); left | `◀` (38,16) | Yes |
| v2-C | modal-runtime → Task engine | From (24,27) down; `╰` (24,29), `╮` (25,29); down | `▼` (25,30) | Yes |
| v2-D | modal-runtime → modal-daemon | From (26,27) down; `╰` (26,28); right; `╮` (43,28); down | `▼` (43,30) | Yes |

### v3 — four arrows

| ID | Source box → target box | Visible path / direction | Arrowhead | Whole route traceable? |
|---|---|---|---|---|
| v3-A | Task engine → Container backend | From (21,19) down; `╯` (21,21); left; `╭` (18,21); down | `▼` (18,22) | Yes |
| v3-B | Task engine → Filesystem + volumes | From (23,19) down; `╰` (23,21); right; `╮` (41,21); down | `▼` (41,22) | Yes |
| v3-C | Container backend → Task container | From (18,27) down; `╰` (18,29); right; `╮` (20,29); down | `▼` (20,30) | Yes |
| v3-D | Filesystem + volumes → Blobnet | From (41,27) down; `╰` (41,29); right; `╮` (48,29); down | `▼` (48,30) | Yes |

The view-to-view repeated endpoint pairs account for eight distinct visible directed relationships. This is not a claim that these exhaust an undisclosed source.

## 3. Crossings, bends, branches, and label ownership

- **Crossings: 0.** No two different edge routes visibly cross or occupy a shared cell/run.
- **Bridge glyphs: 0.** Rounded corner glyphs are turns, not crossing bridges.
- **Wire junctions: 0.** No T/cross junction and no shared-wire split is visible.
- **Touching same-route bend pairs: 4.** v1-A has adjacent `╭╯` at (20,13)/(21,13); v1-C has adjacent `╰╮` at (20,21)/(21,21). v2-A repeats that compact left offset at (24,21)/(25,21), and v2-C repeats the compact right offset at (24,29)/(25,29). These are tight S turns on one route, not contacts between unrelated routes. All other bends are explicitly enumerated in the route tables.
- **Node fan-outs: 4 occurrences.** v1 modal-runtime and Task engine each have two separate downward departures. v2 modal-runtime and v3 Task engine each do likewise. These are branches at a source box, not buses or junctions in a wire. v1/v2 also show the runtime's separate right-side return route to the worker.
- **Uncertain label owners: 0 in my reading.** Each caption can be associated with the corresponding route in the tables by its position beside that route. No spec was needed to assign these owners.
- **Crowded adjacency, not fused labels:** v1 `dispatches` starts immediately after its bend at (21,21); v2 `dispatch` similarly follows (25,29). v1 `mounts/snapshots` directly follows the vertical route at (23,28); v3 `mounts / snapshots` similarly follows (23,20). At frame 0 those vertical cells contain dots, leaving the dot directly beside the caption. The labels remain legible.
- v1 `image+vol data` ends at column 47 on row 38, immediately beside its own `▼` at (48,38). v3 `image + volume data` spans columns 22–40 on row 27 and abuts the right-hand route at (41,27). The latter caption begins beneath the left box and spans much of the gap, so its placement can invite an initial left-side reading; its direct right-edge adjacency identifies the Filesystem + volumes → Blobnet route in my reading. It does not touch the left route at column 18. This is a placement caveat, not a counted uncertain owner.
- Node titles occupy the full inner label width, touching the inner faces of their own side borders. Their enclosing borders keep titles distinct; no pair of node titles touches.

## 4. Borders and selected state

For **each** box below, both still captures show all four corners, uninterrupted top and bottom sides, and both vertical sides (two interior rows). I checked the actual perimeter glyphs and ANSI foreground attributes, not just the plain text. The `Normal RGB` value is uniform across that box's complete perimeter; normal perimeter cells are not bold. Background is RGB (40,40,40).

| View | Node occurrence | Box rectangle | Normal RGB | Complete normal / selected perimeter? |
|---|---|---|---|---|
| v1 | modal-worker | [20,7,14,4] | (216,166,87) | Yes / Yes |
| v1 | modal-runtime | [19,15,15,4] | (125,174,163) | Yes / Yes |
| v1 | Task engine | [20,23,13,4] | (147,194,183) | Yes / Yes |
| v1 | modal-daemon | [44,23,14,4] | (211,134,155) | Yes / Yes |
| v1 | Container backend | [17,31,19,4] | (169,182,101) | Yes / Yes |
| v1 | Filesystem + volumes | [40,31,22,4] | (125,160,184) | Yes / Yes |
| v1 | Task container | [19,39,16,4] | (189,201,124) | Yes / Yes |
| v1 | Blobnet | [47,39,9,4] | (151,184,206) | Yes / Yes |
| v2 | modal-worker | [24,15,14,4] | (216,166,87) | Yes / Yes |
| v2 | modal-runtime | [23,23,15,4] | (125,174,163) | Yes / Yes |
| v2 | Task engine | [24,31,13,4] | (147,194,183) | Yes / Yes |
| v2 | modal-daemon | [42,31,14,4] | (211,134,155) | Yes / Yes |
| v3 | Task engine | [20,15,13,4] | (216,166,87) | Yes / Yes |
| v3 | Container backend | [17,23,19,4] | (125,174,163) | Yes / Yes |
| v3 | Filesystem + volumes | [40,23,22,4] | (211,134,155) | Yes / Yes |
| v3 | Task container | [19,31,16,4] | (147,194,183) | Yes / Yes |
| v3 | Blobnet | [47,31,9,4] | (226,156,175) | Yes / Yes |

In each `*-selected.ansi`, **every cell of every node perimeter** is RGB (216,166,87) with SGR bold enabled, including all four corners. Titles stay at their recorded positions. Thus selected-state coverage is **8/8 + 4/4 + 5/5 = 17/17 node occurrences**. These are simultaneous all-selected captures, not separate isolated selections. The first node of each view is already gold in the normal frame, but its selected frame adds bold, so there is a captured attribute distinction.

Normal-border completeness/color continuity checkable: **17/17**; uncheckable: **0**. Selected-border completeness/color continuity checkable: **17/17**; uncheckable: **0**. This does not extend color-continuity proof through motion time: all 17 occurrences lack colored timestamped diagram frames.

The cream titles/captions use RGB (235,219,178); static route segments and arrowheads use muted RGB (124,111,100). Visible dots in the ANSI stills use gold RGB (216,166,87). The zoom-control box [2,41,9,6] has complete square corners and sides in RGB (168,153,104); it is UI, not a ninth/sixth graph node.

## 5. Motion, route by route

Each view has five timestamped diagram frames: **0, 100, 200, 300, 400 ms**. In every frame there is exactly **one visible dot on each route**, giving 8/4/4 dots per frame and 80 route-dot observations across the 15 frames. There is no within-route inter-dot spacing to measure because there is only one dot per route. Nearby dots belong to different routes; no dots share a cell.

Coordinates below are ordered by those five timestamps. The tables record positions, not a presumed continuous trajectory between samples.

### v1 motion

| Route | Dots visible in frames 0–4 | Dot coordinates in frames 0–4 | Direction and sampled cadence |
|---|---|---|---|
| v1-A | 1,1,1,1,1 | (21,12); (21,12); (21,12); (21,12); (21,12) | Appears stationary at all samples. Motion direction/cadence cannot be determined. Arrow points toward runtime. |
| v1-B | 1,1,1,1,1 | (35,15); (35,14); (35,13); (35,12); (35,11) | Upward toward worker, one row per 100 ms. Final left turn is not sampled. |
| v1-C | 1,1,1,1,1 | (20,20); (20,20); (20,20); (20,20); (20,20) | Appears stationary at all samples. Motion direction/cadence cannot be determined. Arrow points toward Task engine. |
| v1-D | 1,1,1,1,1 | (23,20); (24,20); (25,20); (26,20); (27,20) | Rightward toward daemon, one column per 100 ms on the horizontal run. Downward arrival is not sampled. |
| v1-E | 1,1,1,1,1 | (21,28); (20,29); (19,29); (21,28); (20,29) | Down/left progression through three positions, then restart near source; visible position cycle 300 ms. Corner cells are skipped. No final down-step into target is sampled. |
| v1-F | 1,1,1,1,1 | (23,28); (24,29); (25,29); (26,29); (27,29) | Down/right across the initial turn, then right by one column per 100 ms. Corner is skipped. Arrival is not sampled. |
| v1-G | 1,1,1,1,1 | (18,36); (19,37); (18,36); (19,37); (18,36) | Alternates between pre-turn and horizontal positions every 100 ms; visible cycle 200 ms, returning near source. Only the local down/right progression is supported, not a complete transit. |
| v1-H | 1,1,1,1,1 | (41,36); (42,37); (43,37); (44,37); (45,37) | Down/right across the initial turn, then right by one column per 100 ms; corner skipped. Arrival is not sampled. |

### v2 motion

| Route | Dots visible in frames 0–4 | Dot coordinates in frames 0–4 | Direction and sampled cadence |
|---|---|---|---|
| v2-A | 1,1,1,1,1 | (25,20); (25,20); (25,20); (25,20); (25,20) | Appears stationary; direction/cadence unverified. Arrow points toward runtime. |
| v2-B | 1,1,1,1,1 | (39,23); (39,22); (39,21); (39,20); (39,19) | Upward toward worker, one row per 100 ms. Arrival turn not sampled. |
| v2-C | 1,1,1,1,1 | (24,28); (24,28); (24,28); (24,28); (24,28) | Appears stationary; direction/cadence unverified. Arrow points toward Task engine. |
| v2-D | 1,1,1,1,1 | (27,28); (28,28); (29,28); (30,28); (31,28) | Rightward toward daemon, one column per 100 ms. Arrival not sampled. |

### v3 motion

| Route | Dots visible in frames 0–4 | Dot coordinates in frames 0–4 | Direction and sampled cadence |
|---|---|---|---|
| v3-A | 1,1,1,1,1 | (21,20); (20,21); (19,21); (21,20); (20,21) | Down/left through three positions, then restart; visible cycle 300 ms. Corner skipped; arrival not sampled. |
| v3-B | 1,1,1,1,1 | (23,20); (24,21); (25,21); (26,21); (27,21) | Down/right across initial turn, then right by one column per 100 ms. Corner skipped; arrival not sampled. |
| v3-C | 1,1,1,1,1 | (18,28); (19,29); (18,28); (19,29); (18,28) | Alternates every 100 ms, visible cycle 200 ms. Local down/right progression followed by reset, not a demonstrated complete transit. |
| v3-D | 1,1,1,1,1 | (41,28); (42,29); (43,29); (44,29); (45,29) | Down/right across initial turn, then right by one column per 100 ms. Corner skipped; arrival not sampled. |

**Dot safety:** no dot occupies a bend/corner, arrowhead, bridge, junction, node-border cell, or label cell in any timestamped frame. No route has zero or multiple dots in a sampled frame. The untimestamped normal and selected stills likewise show no such collision. Some dots sit immediately next to bends or captions, but do not replace them.

**Motion limitations:** four route occurrences appear stationary (v1-A/C and v2-A/C). Four others visibly repeat very short local position cycles (v1-E/G and v3-A/C). The captures cannot distinguish true stationary motion from sampling aliasing on the fixed-position routes. They do not show a full end-to-end dot transit on any route. Without the undisclosed rubric, I separate these limitations from the zero observed prohibited-cell/multiplicity violations rather than silently calling all animation successful. The 100 ms sampling also cannot establish smoothness or actual live frame rate.

## 6. Fit and missing evidence

For **each** view, the visible status token is `77x47 @100%`. The corresponding shell transcript contains the exact line:

`viewport: 77x47 zoom: 1.00 natural`

The measured capture grid is **77 columns × 47 rows**. This is supported by the actual ANSI stills, not merely the header's node/edge totals. The manifests leave `pane_rect`, `pane_cols`, and `viewport_line` null, so an independent CLI pane-rectangle measurement is missing. Their `pane_rows` is 47, but the viewport line itself is available in the captured transcript as quoted above.

Observed graph-content extents, including boxes, routes, captions, and arrowheads:

| View | Inclusive columns | Inclusive rows | Clipping / pan / zoom for observed content |
|---|---|---|---|
| v1 | 17–61 | 7–42 | No clipped item; all shown at 100%, no pan/zoom needed to inspect this content. |
| v2 | 23–55 | 15–34 | No clipped item; all shown at 100%, no pan/zoom needed. |
| v3 | 17–61 | 15–34 | No clipped item; all shown at 100%, no pan/zoom needed. |

The bottom-left zoom legend is separate from graph content, including in v1 where its rows overlap the bottom node rows without spatial overlap. No title, caption, arrowhead, or box side is cut off. No oversize/clipping warning is visible. Hidden semantic omissions cannot be assessed before expectations are disclosed.

No supplied visual capture was missing or unsupported. The limitations are: missing independent pane rectangle/column fields, no colored timestamped diagram output, no isolated one-node-at-a-time selected captures, and insufficient motion samples to resolve the fixed-position dots or prove complete transits. Passing check/validation results and generator self-reports are not evidence for any observation here.

## 7. Tool-usable blind scorecard

`visible_labels` counts graph titles plus graph edge captions, not viewer chrome. Counts are across the three final views, not across repeated selected/motion frames. Dot violations below have an explicit cell-safety/multiplicity definition; stationary/short-cycle observations are separately preserved.

```json
{
  "case": "modal-runtime",
  "round": "02",
  "stage": "A",
  "count_basis": "occurrences across final views; selected/motion copies excluded",
  "views": {
    "v1": {"visible_nodes": 8, "visible_edges": 8, "visible_labels": 16, "selected_nodes": 8, "viewport": "77x47 @100%"},
    "v2": {"visible_nodes": 4, "visible_edges": 4, "visible_labels": 8, "selected_nodes": 4, "viewport": "77x47 @100%"},
    "v3": {"visible_nodes": 5, "visible_edges": 4, "visible_labels": 9, "selected_nodes": 5, "viewport": "77x47 @100%"}
  },
  "visible_nodes": 17,
  "distinct_visible_node_titles": 8,
  "visible_edges": 16,
  "distinct_visible_directed_endpoint_pairs": 8,
  "visible_labels": 33,
  "viewer_chrome_label_occurrences": 15,
  "all_visible_label_occurrences_including_chrome": 48,
  "traceable_edges": 16,
  "visible_arrowheads": 16,
  "crossings": 0,
  "bridge_glyphs": 0,
  "wire_junctions": 0,
  "touching_same_route_bend_pairs": 4,
  "source_box_fanout_occurrences": 4,
  "uncertain_label_owners": 0,
  "fused_labels": 0,
  "clipped_items": 0,
  "normal_border_coverage": {"checkable_complete_color_continuous": 17, "uncheckable": 0, "total": 17},
  "selected_state_coverage": {"captured_complete_color_continuous": 17, "total": 17},
  "colored_timestamped_border_coverage": {"captured": 0, "total": 17},
  "animated_route_occurrences": 16,
  "timestamped_frames_per_view": 5,
  "timestamps_ms": [0, 100, 200, 300, 400],
  "route_dot_observations": 80,
  "dot_violations": 0,
  "dot_violation_definition": "observed zero/multiple dots per route or a dot occupying a corner, bridge, junction, arrowhead, node border, or label cell",
  "stationary_or_sampling_aliased_route_occurrences": 4,
  "short_repeating_local_cycle_route_occurrences": 4,
  "motion_direction_unverifiable_route_occurrences": 4,
  "complete_end_to_end_dot_transits_demonstrated": 0,
  "measured_viewport": {"columns": 77, "rows": 47, "zoom": 1.0, "views": 3},
  "viewport_line": "viewport: 77x47 zoom: 1.00 natural",
  "observed_content_requires_pan_or_zoom": false,
  "unreadable_or_missing_visual_capture_files": []
}
```
