# Pipeline — round 05, stage A blind observation

This record uses only the final JSON spec and saved captures under `pipeline/evidence/v1/` and `pipeline/motion/`. I did not read source, expectations, the rubric, other cases, previous rounds, attempts, generation records, or renderer code. No viewer was launched and nothing was repaired. Coordinates below are 1-based `[column,row,width,height]` within a captured viewport, not within the enclosing frame-dump file. Point coordinates are `(column,row)`; `lap-analysis.txt` instead lists `(row,column)`.

## Identity and evidence

- Independently verified final `spec-v1.json` SHA-256: `fdb8c42f6810b541b8a5367d9572d2d47ced3e756598658ff61f1c833a935f2f`.
- Manifest identifies binary SHA-256 `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`. I did not execute or inspect that binary.
- All seven artifact hashes listed in `evidence/v1/manifest.json` match the saved files.
- Read/measured the normal text/ANSI, selected ANSI, check, manifest, short frame dumps, pinned full-lap text dump, and supplied coordinate analysis. Independently parsed all 53 full-lap frames and reconstructed each route's ordered dot track rather than accepting the analysis's use of the word “origin.” Its coordinates and return periods agree with my measurements, but its frame-0 cells are NOT the pinned true origins.
- User disclosed that generation records were reconstructed by the captain after generator crashes on a full disk. Under this stage's capture/spec-only restriction I did not read those records or independently assess their reconstruction. Capture hashes do not establish the generation history.

## What is visible

One compact top-to-bottom graph: CLI above API gateway; API gateway sends separate routes to Job queue on the left and Auth on the right. Job queue feeds Worker pool. Worker pool and Auth send separate routes to Postgres below. Six distinct boxes and six distinct directed edges are visible. Four edge labels have clear owners. There is no enclosing group geometry or visible group-name label.

### Every graph label, verbatim

| Label | Kind / visible owner | Final 83×51 view | Pinned 77×47 motion view |
|---|---|---|---|
| CLI | node | [40,10,3,1] | [37,8,3,1] |
| API gateway | node | [40,18,11,1] | [37,16,11,1] |
| Job queue | node | [27,26,9,1] | [24,24,9,1] |
| Auth | node | [53,26,4,1] | [50,24,4,1] |
| Worker pool | node | [27,34,11,1] | [24,32,11,1] |
| Postgres | node | [40,42,8,1] | [37,40,8,1] |
| enqueue | API gateway → Job queue | [31,22,7,1] | [28,20,7,1] |
| verify | API gateway → Auth | [44,22,6,1] | [41,20,6,1] |
| write | Worker pool → Postgres | [31,38,5,1] | [28,36,5,1] |
| read | Auth → Postgres | [46,38,4,1] | [43,36,4,1] |

No graph label is clipped or overdrawn. No uncertain label owner. The labels sit beside/above their own routes; none occupies a drawn route cell.

Other visible text, not counted as graph labels:

- `rataflow-view · 83x51 @100% · spec-v1.json · 6 nodes · 6 edges · q quit` at [2,1,71,1]. The pinned view has the same full string with `77x47` replacing `83x51`, also [2,1,71,1].
- `+ [+]`: [4,46,5,1] final, [4,42,5,1] pinned.
- `− [-]`: [4,47,5,1] final, [4,43,5,1] pinned.
- `⊡ [f]`: [4,48,5,1] final, [4,44,5,1] pinned.
- `□ [i]`: [4,49,5,1] final, [4,45,5,1] pinned.

The controls have their own complete rectangular frame: [2,45,9,6] final and [2,41,9,6] pinned. They do not cover any graph content. The frame-dump wrapper contains viewport/frame/time annotations and terminal command/prompt text; those are not diagram labels.

## Borders and color

Each node has all four sides and all four rounded corners, with no gaps, broken corners, or border cells replaced by route glyphs. The following measurements check every perimeter cell in both the normal and selected ANSI captures.

| Node | Final box | Pinned box | Perimeter cells | Normal border RGB |
|---|---|---|---:|---|
| CLI | [39,9,5,4] | [36,7,5,4] | 14 | 125,174,163 |
| API gateway | [39,17,13,4] | [36,15,13,4] | 30 | 125,160,184 |
| Job queue | [26,25,11,4] | [23,23,11,4] | 26 | 211,134,155 |
| Auth | [52,25,6,4] | [49,23,6,4] | 16 | 151,184,206 |
| Worker pool | [26,33,13,4] | [23,31,13,4] | 30 | 226,156,175 |
| Postgres | [39,41,10,4] | [36,39,10,4] | 24 | 169,182,101 |

Every normal border is color-continuous in the 83×51 ANSI capture. API gateway/Auth share blue-family colors; Job queue/Worker pool share pink-family colors. These are hue relationships, not enclosing spatial groups. Labels are light cream, RGB 235,219,178. Routes and arrowheads are muted RGB 124,111,100. Dots use accent RGB 216,166,87, on background RGB 40,40,40.

In `v1-selected.ansi`, every perimeter cell of every one of the six boxes is bold accent RGB 216,166,87, including all sides/corners. Labels and route clarity survive. Selected-border coverage is 6/6 final-view node occurrences. This is one all-selected capture, not six independently demonstrated selection interactions. The alternate 77×47 motion view has no selected ANSI capture; if each viewport size is counted as a separate occurrence set, selected coverage is 6/12. Text-only pinned motion cannot independently prove its border colors.

## Every arrow and route

All six arrowheads are intact downward `▼` glyphs, never obscured by the dots. Every whole route can be traced without guessing. In the following table, coordinates are from the final 83×51 view. A route starts at the first drawn cell immediately below its source border and ends at its arrowhead immediately above its target border.

| Visible source → target | Ordered route geometry | Arrowhead | State / traceability |
|---|---|---|---|
| CLI → API gateway | (40,13) straight down | (40,16), down | intact, fully traceable |
| API gateway → Job queue | (40,21) down to (40,23), left to (27,23), down | (27,24), down | intact, fully traceable; enqueue |
| API gateway → Auth | (42,21) down to (42,23), right to (53,23), down | (53,24), down | intact, fully traceable; verify |
| Job queue → Worker pool | (27,29) straight down | (27,32), down | intact, fully traceable |
| Worker pool → Postgres | (27,37) down to (27,39), right to (40,39), down | (40,40), down | intact, fully traceable; write |
| Auth → Postgres | (53,29) down to (53,39), left to (42,39), down | (42,40), down | intact, fully traceable; read |

Pinned 77×47 graph coordinates are the final-view graph coordinates minus 3 columns and 2 rows.

### Crossings, bends, junctions, and apparent branches

- Zero crossings, zero bridge glyphs, zero touching bends, zero shared route runs, and zero drawn junction glyphs.
- Eight ordinary isolated route bends in the final view: (40,23) `╯`, (27,23) `╭`; (42,23) `╰`, (53,23) `╮`; (27,39) `╰`, (40,39) `╮`; (53,39) `╯`, (42,39) `╭`. All remain visible through the motion sequence. These are turns on single routes, not touching bends between routes.
- At API gateway, two distinct outgoing ports, columns 40 and 42, form a semantic two-way fan-out. There is a blank column between the routes, not a shared stem or bus junction.
- At Postgres, the write/read arrowheads arrive at separate columns 40 and 42. This is a semantic convergence into one box, not a route merge.
- No accidental apparent branch or ambiguous crossing is visible.

## Motion — direct coordinate audit

The spec declares `flow: true` and `dots: 1` on all six edges, with no speed override. The short 83×51 text/ANSI dumps contain frames 0–18 at 100 ms intervals: six dots in every frame. The pinned 77×47 dump contains frames 0–52, 0–5200 ms at 100 ms intervals: also exactly six dots in every frame, exactly one on each route. There is no intra-route dot spacing to assess because every route has only one dot. The shorter dump alone does not cover the longest lap; the pinned dump does.

### Pinned true origin versus frame 0

The origin rule used here is the FIRST drawn cell after the source border port, corner included; it is not the first cell the animation happens to visit. All six true origins in this graph are straight cells. This distinction changes the conclusion from the check output.

All coordinates in the following table are `(column,row)` in the pinned 77×47 viewport.

| Route | True origin | Frame-0 dot | Arrowhead | Distinct dot cells / lap | First return to frame-0 cell |
|---|---|---|---|---:|---|
| CLI → API gateway | (37,11) | (37,12) | (37,14) | 2 | frame 4, 400 ms |
| API gateway → Job queue | (37,19) | (37,20) | (24,22) | 13 | frame 26, 2600 ms |
| API gateway → Auth | (39,19) | (39,20) | (50,22) | 11 | frame 22, 2200 ms |
| Job queue → Worker pool | (24,27) | (24,28) | (24,30) | 2 | frame 4, 400 ms |
| Worker pool → Postgres | (24,35) | (24,36) | (37,38) | 13 | frame 26, 2600 ms |
| Auth → Postgres | (50,27) | (50,28) | (39,38) | 19 | frame 38, 3800 ms |

**Frame 0 misses the true origin on all six routes, by exactly one drawn cell downstream. No dot visits any of these true-origin cells in the full capture.** In the shorter 83×51 sequence, frame-0 dots similarly sit at (40,14), (40,22), (42,22), (27,30), (27,38), and (53,30), one cell after their corresponding true origins.

### Tracks, rate, direction, corners, and arrival

Observed ordered dot tracks, pinned coordinates, with consecutive identical 100 ms samples collapsed:

- CLI → API gateway: (37,12), (37,13), then wrap.
- API gateway → Job queue: (37,20), then row 21 columns 36 down through 25, then wrap.
- API gateway → Auth: (39,20), then row 21 columns 40 up through 49, then wrap.
- Job queue → Worker pool: (24,28), (24,29), then wrap.
- Worker pool → Postgres: (24,36), then row 37 columns 25 up through 36, then wrap.
- Auth → Postgres: column 50 rows 28 through 36, then row 37 columns 49 down through 40, then wrap.

For every route, frame `f` occupies visited-cell index `floor(f/2) mod N`, where N is the distinct-dot-cell count above. Thus all six share exactly one visited-cell advance per 200 ms, equivalent to 0.5 visited cells per 100 ms step; no route is sped up to match a common arrival time. Every sampled position persists for two successive frames. All progression is source-to-target except the periodic reset to the initial interior cell.

This shared cadence is NOT a completely uniform distance along the full drawn grid: four turning routes skip corners, producing two-cell Manhattan jumps at a bend. For example API gateway → Job queue moves from (37,20) at frames 0–1 to (36,21) at frames 2–3, bypassing corner (37,21). Auth → Postgres moves from (50,36) at frames 16–17 to (49,37) at frames 18–19, bypassing corner (50,37). The two straight routes have one-cell non-wrap steps only; the four bent routes have both one- and two-cell non-wrap steps. No evidence supports a claim of perfectly constant physical grid-distance speed through corners, although the visited-cell cadence is shared exactly.

- No dot rests on any non-origin corner. Eight isolated bend cells are never occupied. No bridges exist to occupy. No dot occupies a graph label or node border.
- **No route's dot ever reaches its arrowhead.** All six arrowhead cells remain arrowheads, not dots, through complete observed laps. Straight routes wrap from the cell just before their arrowhead; the turning routes wrap before their final bend and arrowhead. Thus zero routes arrive, and there is no frame at which every route's dot reaches its arrowhead. This is not merely a lack of synchronized arrival: individual arrival is absent too.
- The full drawn origin-to-arrowhead paths have 4, 17, 15, 4, 17, and 23 cells respectively in the table's route order, versus only 2, 13, 11, 2, 13, and 19 visited dot cells.
- The pinned dump spans more than the longest observed 38-frame lap, so missing origin/arrowhead visits are demonstrated over full loops, not inferred from an incomplete sample.

### Check output versus capture

`check.txt` reports `6 constant at 0.5c/step`, zero dot violations, and `origins: 6/6 routes start at their arrow origin`. The shared visited-cell cadence is supported. The origin claim is contradicted by all six measured frame-0 positions under the explicitly pinned first-drawn-cell rule. Its `arrivals: 0/0 same-arrival routes ...` is vacuous for this constant-speed spec, not evidence of six successful arrivals. The captures show zero actual arrowhead visits.

## Fit and routing

- Normal and selected ANSI grids measure exactly 83 columns × 51 rows, each row padded to 83 cells. The text snapshot omits trailing padding and the final empty row: 50 saved text lines, maximum 72 characters; this does not mean the viewport is 72×50.
- The short dump explicitly records `viewport: 83x51 zoom: 1.00 natural`. The pinned dump records `viewport: 77x47 zoom: 1.00 natural`, with 47 rows per frame. Its text also omits trailing blank columns, so its viewport width is declared, not independently proved by padded text.
- `check.txt` itself says `viewport: unknown zoom: 1.00 natural`. Manifest pane columns and pane rectangle are null, pane rows 51, and viewport token `83x51 @100%`. I do not silently replace the unknown check viewport with a measured pane rectangle.
- All graph boxes, all labels, all routes, all arrowheads, and the controls fit at 100% in both captured sizes. Zero visibly clipped items, zero visible hidden/pan-only/zoom-only items. No live pan test was performed.
- Graph ink bounds, excluding header/controls: final columns 26–57, rows 9–44, or 32×36 cells; pinned columns 23–54, rows 7–42, also 32×36. Reported extent is 36×40, four cells larger on each dimension, compatible with extra margin rather than clipping.
- Reported `crossings: 0 bridges, 0 touching bends` matches visible evidence.
- No `routes: N/M near-minimal` line is present, so that reported metric is missing. Independently, all six routes are monotone between their endpoints, without backtracking or loops; the longer Auth descent reaches the common lower destination level without a conspicuous detour.

## Tool-usable blind scorecard

Counts are observations, not a rubric-derived grade. Dot violation totals below distinguish affected routes from route-property failures and do not double-count them as extra dots.

```json
{
  "stage": "A",
  "case": "pipeline",
  "spec_sha256": "fdb8c42f6810b541b8a5367d9572d2d47ced3e756598658ff61f1c833a935f2f",
  "visible_nodes": 6,
  "visible_edges": 6,
  "visible_graph_labels": 10,
  "visible_node_labels": 6,
  "visible_edge_labels": 4,
  "visible_ui_text_items": 5,
  "traceable_edges": 6,
  "intact_arrowheads": 6,
  "crossings": 0,
  "bridges": 0,
  "touching_bends": 0,
  "isolated_route_bends": 8,
  "drawn_junctions": 0,
  "semantic_fanouts": 1,
  "semantic_convergences": 1,
  "accidental_apparent_branches": 0,
  "uncertain_label_owners": 0,
  "labels_on_route_cells": 0,
  "clipped_items": 0,
  "visible_pan_or_zoom_only_items": 0,
  "complete_color_continuous_normal_borders": 6,
  "selected_state_coverage_final_view": {"captured": 6, "total": 6},
  "selected_state_coverage_both_viewport_sizes": {"captured": 6, "total": 12},
  "full_lap_frames": 53,
  "short_capture_frames": 19,
  "dots_per_full_lap_frame_min": 6,
  "dots_per_full_lap_frame_max": 6,
  "animated_routes": 6,
  "single_dot_routes": 6,
  "dot_count_violations": 0,
  "true_origin_frame0_passes": 0,
  "true_origin_frame0_violations": 6,
  "shared_visited_cell_cadence_routes": 6,
  "visited_cell_cadence_violations": 0,
  "nonuniform_grid_distance_corner_skip_routes": 4,
  "nonorigin_corner_dot_hits": 0,
  "bridge_dot_hits": 0,
  "label_dot_hits": 0,
  "arrowhead_dot_hits": 0,
  "routes_with_arrowhead_visit": 0,
  "routes_without_arrowhead_visit_over_full_lap": 6,
  "simultaneous_arrowhead_arrival_frames": 0,
  "dot_violations_affected_routes": 6,
  "dot_origin_plus_arrival_route_property_failures": 12,
  "reported_near_minimal_route_metric": null,
  "unsupported_or_unreadable_capture_files": []
}
```

## Evidence limitations and execution note

No supplied capture was unreadable. The full-lap evidence is plain text, not an ANSI color sequence. Although `v1-frames.ansi` has terminal escapes, its dot cells decode without foreground color; it does not establish animated-dot RGB. Normal/selected ANSI do establish static dot and border colors. No selected-color capture exists at 77×47. The unknown check viewport, null pane rectangle/column measurement, missing near-minimal metric, and absence of an actual interactive selection sequence remain limitations rather than inferred successes.

One read-only analysis invocation failed because the shell could not create a heredoc temporary file (`No space left on device`). I reran the capture-only measurement via `uv run --no-project python -c`, which succeeded, without deleting files or changing evidence. This record is the stage-A save and must not be modified after hashing.
