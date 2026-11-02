# Stage A — blind observation: modal-runtime, round 03

This record describes the final single-view artifact, not the generator's process. No source, expectations, rubric, dataset manifest, other case, or earlier round was read. No viewer was launched and no artifact was changed.

## Evidence examined and coordinate convention

Examined `specs/v1.json` and the existing `evidence/v1/` text, normal ANSI, selected ANSI, text/ANSI frame captures, check output, capture manifest, and validator report. The final spec was used to identify declared IDs and to compare declarations with the capture; it was not used as proof that an item was visible.

All coordinates below are **1-based terminal cells**, `[column,row,width,height]`, in the final 77-column, 47-row ANSI capture. Row 1 includes the viewer header. A point is `[column,row]`. Captured frame bodies have the same coordinates when their own header is treated as row 1; shell transcript lines are not part of the diagram.

Normal and selected ANSI captures each contain 47 rows of 77 cells. There were no unreadable or unsupported evidence files among those examined. No raw cell-buffer export was supplied; foreground color and selected bold state are supported by the ANSI SGR sequences. The frame ANSI file is a terminal transcript, not five independent, fully styled cell buffers; its graph text is readable.

## Every visible graph label

### Node labels (8)

| Verbatim label | Bounds |
|---|---|
| `modal-worker` | `[21,8,12,1]` |
| `modal-runtime` | `[20,16,13,1]` |
| `Task engine` | `[21,24,11,1]` |
| `modal-daemon` | `[45,24,12,1]` |
| `Container backend` | `[18,32,17,1]` |
| `Filesystem + volumes` | `[41,32,20,1]` |
| `Task container` | `[20,40,14,1]` |
| `Blobnet` | `[48,40,7,1]` |

### Route labels (8)

| Verbatim label | Bounds | Apparent owner / placement |
|---|---|---|
| `task+ctrl RPC` | `[23,12,13,1]` | Between the two opposite worker/runtime routes. Its start is right of the downward route at column 21, but its last character at column 35 directly abuts the upward route at column 36. Ownership is crowded/uncertain on position alone. |
| `events+mgmt RPC` | `[38,12,15,1]` | Clearly right of the runtime-to-worker return route at column 36. |
| `task dispatch` | `[23,22,13,1]` | Starts two columns right of the engine-bound arrow at `[21,22]`, but the entire label sits immediately below the daemon-bound horizontal run on row 21. Uncertain owner; can be read as labeling the wrong, daemon-bound route. |
| `HTTP over UDS` | `[27,20,13,1]` | Above the long runtime-to-daemon horizontal run on row 21. Readable, complete, and naturally associated with that route. |
| `starts/manages` | `[20,30,14,1]` | Starts two columns right of the backend-bound arrow at `[18,30]`, but columns 23–33 also sit immediately below the filesystem-bound horizontal run on row 29. This repeats the task-dispatch placement ambiguity. |
| `mount+snapshot` | `[25,28,14,1]` | Above the engine-to-filesystem horizontal run on row 29. |
| `user process` | `[20,36,12,1]` | Right of the backend-to-container vertical run at column 18. |
| `image+vol data` | `[34,38,14,1]` | Immediately left of the Blobnet-bound arrow at `[48,38]`; last character directly touches the arrow cell. The route owner remains identifiable. |

All eight route labels and eight node labels are visible in full. None overwrites a route cell. **Three label owners are flagged as uncertain**: `task+ctrl RPC`, `task dispatch`, and `starts/manages`. This is a perceptual ownership flag, not a claim that the JSON attaches them incorrectly. The final spec assigns these respectively to worker→runtime, runtime→engine, and engine→backend. There is no label leader or enclosing label background that independently resolves the crowded assignments.

### Viewer chrome (not graph labels)

| Verbatim text | Bounds |
|---|---|
| `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 8 edges · q quit` | `[2,1,66,1]` |
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

The control legend border occupies `[2,41,9,6]`; it is not a ninth graph node. Its four sides and four square corners are complete, with continuous RGB `(168,153,104)` in both normal and selected evidence. Spaces around control texts are padding, not additional labels. There are 16 graph labels, 4 control labels, and 1 header text block: 21 text blocks if chrome is included.

## Every visible arrow and complete route

All eight routes are solid, muted RGB `(124,111,100)`. Each has one intact arrowhead at its target, no arrowhead at its source, and a whole route that can be traced between the boxes without guessing connectivity. Label ownership is assessed separately above. Points below enumerate bends and endpoints; consecutive points are joined by the visible straight cells between them.

| Source box → target box | Visible route, direction, and arrowhead |
|---|---|
| `modal-worker` → `modal-runtime` | Leaves the worker's bottom at column 21; `[21,11]` down to `[21,13]` (`╯`), left to `[20,13]` (`╭`), down to intact `▼` at `[20,14]`, directly above the runtime top border at row 15. Direction is downward. |
| `modal-runtime` → `modal-worker` | Leaves runtime's right side on row 16: `[34,16]` right through `[35,16]` to `[36,16]` (`╯`), up column 36 to `[36,8]` (`╮`), left through `[35,8]` to intact `◀` at `[34,8]`, directly beside the worker's right border at column 33. Direction is right, up, then left into worker. |
| `modal-runtime` → `Task engine` | Leaves runtime bottom at column 20; `[20,19]` down to `[20,21]` (`╰`), right to `[21,21]` (`╮`), down to intact `▼` at `[21,22]`, directly above engine top at row 23. |
| `modal-runtime` → `modal-daemon` | Separate bottom port at column 22; `[22,19]` down to `[22,21]` (`╰`), right along row 21 to `[45,21]` (`╮`), down to intact `▼` at `[45,22]`, directly above daemon top at row 23. |
| `Task engine` → `Container backend` | Leaves engine bottom at column 21; `[21,27]` down to `[21,29]` (`╯`), left along row 29 to `[18,29]` (`╭`), down to intact `▼` at `[18,30]`, directly above backend top at row 31. |
| `Task engine` → `Filesystem + volumes` | Separate bottom port at column 23; `[23,27]` down to `[23,29]` (`╰`), right along row 29 to `[41,29]` (`╮`), down to intact `▼` at `[41,30]`, directly above filesystem top at row 31. |
| `Container backend` → `Task container` | Leaves backend bottom at column 18; `[18,35]` down to `[18,37]` (`╰`), right along row 37 to `[20,37]` (`╮`), down to intact `▼` at `[20,38]`, directly above container top at row 39. |
| `Filesystem + volumes` → `Blobnet` | Leaves filesystem bottom at column 41; `[41,35]` down to `[41,37]` (`╰`), right along row 37 to `[48,37]` (`╮`), down to intact `▼` at `[48,38]`, directly above Blobnet top at row 39. |

**The two worker/runtime arrows both exist, on separate routes, with opposite directions.** This is not one bidirectional line: the worker-to-runtime route descends on columns 21/20, while the runtime-to-worker route returns on column 36 and enters the worker from the right. The seam strings `task+ctrl RPC`, `events+mgmt RPC`, and `HTTP over UDS` are all fully present, including their suffixes.

## Crossings, bends, bridges, junctions, and branches

- **Visible route crossings: 0.** No route passes through another route or a node interior. The check output also reports `crossings: 0`.
- **Bridge glyphs: 0. Junction glyphs: 0. Shared route runs: 0 observed.** No drawn trunk or bus junction connects different routes.
- All bends are enumerated in the route table: 17 corner cells in total (two on each route except the runtime-to-worker return, which has two, and the worker-to-runtime offset, which also has two; the total is 16). To remove any ambiguity in that arithmetic, the observed bend coordinates are: `[21,13]`, `[20,13]`, `[36,16]`, `[36,8]`, `[20,21]`, `[21,21]`, `[22,21]`, `[45,21]`, `[21,29]`, `[18,29]`, `[23,29]`, `[41,29]`, `[18,37]`, `[20,37]`, `[41,37]`, `[48,37]`. Thus the bend count is **16**.
- There is **one cross-route touching-bend pair**: engine-bound `╮` at `[21,21]` immediately beside daemon-bound `╰` at `[22,21]`. These are adjacent character cells, but their horizontal strokes point away from each other; no connecting horizontal stroke or junction is drawn between them. This tight `╮╰` seam can look like a continuous fan at a glance. It does not make the routes untraceable.
- The worker-to-runtime offset has its own adjacent `╭╯` bend pair at `[20,13]`/`[21,13]`; those two cells belong to the **same route**, not a crossing or cross-route touch. Other same-route bends and their intervening runs are listed above.
- There are two apparent node-level fans: runtime sends separate routes to engine and daemon, and engine sends separate routes to backend and filesystem. Each uses two distinct bottom ports separated by a blank column; neither has a shared branching point outside its source node. No other apparent route branch was observed.
- Route-to-box contacts are endpoint contacts only: arrowheads sit one cell outside target borders, and source strokes sit one cell outside source borders. Borders remain intact at all contacts.

## Every graph-node border and selected-state coverage

Every node has four complete sides and all four rounded corners. For each rectangle `[x,y,w,4]` below: top is row `y`, bottom row `y+3`, left column `x`, right column `x+w-1`; corners are `╭`/`╮` on top and `╰`/`╯` on bottom. Horizontal spans and both interior vertical cells on each side are present without gaps, label overwrites, route overwrites, or color discontinuities. ANSI evidence, not plain text, supports the RGB and bold findings.

| Node | Border bounds | Complete top/bottom span; left/right columns | Normal border RGB | Selected perimeter cells |
|---|---|---|---|---|
| `modal-worker` | `[20,7,14,4]` | rows 7/10, columns 20–33; sides 20/33 | `(216,166,87)` | 32/32 bold gold |
| `modal-runtime` | `[19,15,15,4]` | rows 15/18, columns 19–33; sides 19/33 | `(125,174,163)` | 34/34 bold gold |
| `Task engine` | `[20,23,13,4]` | rows 23/26, columns 20–32; sides 20/32 | `(147,194,183)` | 30/30 bold gold |
| `modal-daemon` | `[44,23,14,4]` | rows 23/26, columns 44–57; sides 44/57 | `(211,134,155)` | 32/32 bold gold |
| `Container backend` | `[17,31,19,4]` | rows 31/34, columns 17–35; sides 17/35 | `(169,182,101)` | 42/42 bold gold |
| `Filesystem + volumes` | `[40,31,22,4]` | rows 31/34, columns 40–61; sides 40/61 | `(125,160,184)` | 48/48 bold gold |
| `Task container` | `[19,39,16,4]` | rows 39/42, columns 19–34; sides 19/34 | `(189,201,124)` | 36/36 bold gold |
| `Blobnet` | `[47,39,9,4]` | rows 39/42, columns 47–55; sides 47/55 | `(151,184,206)` | 22/22 bold gold |

Selected gold is RGB `(216,166,87)`. All 276 perimeter cells across all eight nodes carry that foreground plus bold in the selected capture. The worker's normal foreground already equals selected gold, but bold changes from off to on across its entire border, so its selected state is still evidenced. Node text remains RGB `(235,219,178)`, separate from border styling.

**Selected-state coverage: 8/8 node occurrences across 1 final view (100%).** This is one simultaneous select-all capture. It proves each node's own selected perimeter is captured; it does not prove separate interactive selection actions or keyboard navigation, which were not supplied or tested.

## Motion

This case is static. **No motion and no flow dots appear.** Saved text and ANSI transcripts contain frames 0–4 at 0, 100, 200, 300, and 400 ms. Each graph body is identical to the final normal capture after removing ANSI SGR and capture-only trailing whitespace. All five show the same labels, boxes, routes, and arrowheads.

| Route | Frame 0 | Frame 1 | Frame 2 | Frame 3 | Frame 4 |
|---|---:|---:|---:|---:|---:|
| worker → runtime | 0 | 0 | 0 | 0 | 0 |
| runtime → worker | 0 | 0 | 0 | 0 | 0 |
| runtime → engine | 0 | 0 | 0 | 0 | 0 |
| runtime → daemon | 0 | 0 | 0 | 0 | 0 |
| engine → backend | 0 | 0 | 0 | 0 | 0 |
| engine → filesystem | 0 | 0 | 0 | 0 | 0 |
| backend → container | 0 | 0 | 0 | 0 | 0 |
| filesystem → blobnet | 0 | 0 | 0 | 0 | 0 |

There are no dot spacing, direction, corner, bridge, or arrowhead events to evaluate. Frame-0 origin placement and simultaneous arrowhead arrival are **not applicable**, not animation passes. No animated routes are observed or declared in the final spec. The check output reports `flows=0`, zero single-dot routes, zero periodic routes, and zero dot violations. Sampling covers only the supplied 0–400 ms interval, not arbitrary future time.

## Fit and capture limits

- Measured final normal/selected cell grid: **77 columns × 47 rows**.
- Header token: `77x47 @100%`.
- Runtime viewport line, present in saved frame transcripts: **`viewport: 77x47 zoom: 1.00 natural`**.
- The offline check instead says **`viewport: unknown zoom: 1.00 natural`**; it alone does not prove pane dimensions.
- The manifest has `pane_rect: null`, `pane_cols: null`, `pane_rows: 47`, `viewport_line: null`, and `viewport_token: "77x47 @100%"`. The existing ANSI grid and transcript viewport lines supply the missing width/viewport evidence, rather than inferring it from the spec.
- Visible graph bounds including all boxes, labels, and routes: columns **17–61**, rows **7–42**, i.e. `[17,7,45,36]`. The check reports `extent=46x37 cells`; that is its own extent report, not the exact nonblank bounding box measured here.
- No graph node, label, route, arrowhead, or border is clipped. All eight nodes and all eight routes fit in the one visible view at 100%. No observed content needs pan or zoom to read. No live navigation was tested, and no claim is made about undisclosed offscreen content.
- The control legend at columns 2–10, rows 41–46 does not overlap the graph. Header and legend are fully visible.
- Captured visible crossing count: **0**, with no crossing locations to enumerate. The one adjacent cross-route bend pair is not counted as a crossing.

## Tool-usable blind scorecard

Counts refer to the final single view, not repeated occurrences in animation samples. Uncertain ownership is intentionally stricter than mere text legibility.

```json
{
  "stage": "A",
  "case": "modal-runtime",
  "round": "03",
  "final_views": 1,
  "visible_nodes": 8,
  "visible_edges": 8,
  "traceable_edges": 8,
  "intact_target_arrowheads": 8,
  "visible_labels": 16,
  "visible_node_labels": 8,
  "visible_edge_labels": 8,
  "visible_chrome_text_blocks": 5,
  "visible_text_blocks_including_chrome": 21,
  "crossings": 0,
  "bridge_glyphs": 0,
  "junction_glyphs": 0,
  "shared_route_runs_observed": 0,
  "route_bend_cells": 16,
  "cross_route_touching_bend_pairs": 1,
  "apparent_node_level_fans": 2,
  "uncertain_label_owners": 3,
  "uncertain_labels": ["task+ctrl RPC", "task dispatch", "starts/manages"],
  "clipped_items": 0,
  "incomplete_node_borders": 0,
  "color_discontinuous_node_borders": 0,
  "selected_state_coverage": {
    "captured_node_occurrences": 8,
    "total_node_occurrences": 8,
    "fraction": 1.0,
    "selected_perimeter_cells": 276,
    "total_perimeter_cells": 276,
    "simultaneous_select_all": true
  },
  "viewport_columns": 77,
  "viewport_rows": 47,
  "zoom": 1.0,
  "frames_observed": 5,
  "frame_times_ms": [0, 100, 200, 300, 400],
  "animated_routes_observed": 0,
  "dots_per_frame": [0, 0, 0, 0, 0],
  "motion_observed": false,
  "dot_violations": 0,
  "dot_origin_check": "not_applicable_static",
  "dot_synchronized_arrival_check": "not_applicable_static",
  "unreadable_evidence_files": [],
  "missing_evidence": ["raw cell-buffer export", "non-null manifest pane_rect/pane_cols/viewport_line"],
  "missing_evidence_is_fatal_to_visible_grid_observations": false
}
```

This file is the saved blind record. Its SHA-256 is reported outside the file so that hashing does not require a later modification.
