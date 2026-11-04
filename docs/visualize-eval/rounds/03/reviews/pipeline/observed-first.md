# Pipeline — round 03, stage A blind observation

This record uses only `pipeline/spec-v1.json` and the text/ANSI capture files under `pipeline/evidence/v1/` and `pipeline/evidence/v1-origin/`. No source, expectations, rubric, manifest, check log, attempt log, other case, earlier round, or implementation was read. No viewer was launched. Coordinates below are 1-based terminal cells, relative to the top-left of the captured viewer grid, not the surrounding shell scrollback.

## Fit and evidence

- There is one final view, repeated in two evidence bundles. The full static ANSI grids measure **77 columns × 47 rows**, with exactly 77 cells in each row after SGR removal.
- The viewer header says `77x47 @100%`.
- The origin frame capture contains the exact line `viewport: 77x47 zoom: 1.00 natural` three times, before the static, selected, and motion capture commands. The long frame capture does not retain a `viewport:` line.
- All six boxes, all six arrows, and all ten graph labels fit visibly at 100%. No graph content is visibly clipped, hidden, or dependent on pan or zoom. The graph's bounding rectangle is `[23,7,32,36]`, including its boxes and edges. The separate controls occupy `[2,41,9,6]` and do not overlap the graph.
- There are **0 visible crossings**. No crossing locations need to be enumerated.
- `v1-frames.txt` and `v1-frames.ansi` begin partway through frame 0, with its header and upper portion missing. Frames 1–20 retain full grids. `v1-origin-frames.txt` and its ANSI counterpart retain a complete, explicitly marked `frame 0 at 0ms`, plus frames 1–3. The latter three grids agree with long-capture frames 1–3. The partial long-capture initial grid also agrees where retained.
- The union therefore supplies 21 distinct sampled times, 0–3000 ms at 150 ms intervals. This is not a continuous recording, and times after 3000 ms are absent.
- The frame-file graph grids are plain text even in the `.ansi` files; their escape sequences belong to surrounding shell material. Each full frame grid agrees between its text and ANSI capture. Static and selected ANSI files do retain per-cell RGB and bold evidence.
- No capture was wholly unreadable or in an unsupported format. Partial loss of long-capture frame 0 is the evidence defect noted above; the origin capture recovers it. Unlisted metadata and logs were deliberately not inspected.

## Every visible label

Bounds are `[column,row,width,height]`. The first ten entries are graph labels. The remaining five are viewer chrome, not additional graph nodes or graph labels.

| Verbatim label | Bounds | Visible owner |
|---|---|---|
| `CLI` | `[37,8,3,1]` | CLI box |
| `API gateway` | `[37,16,11,1]` | API gateway box |
| `Job queue` | `[24,24,9,1]` | Job queue box |
| `Auth` | `[50,24,4,1]` | Auth box |
| `Worker pool` | `[24,32,11,1]` | Worker pool box |
| `Postgres` | `[37,40,8,1]` | Postgres box |
| `enqueue` | `[28,20,7,1]` | API gateway → Job queue route, above its left-going horizontal segment |
| `verify` | `[41,20,6,1]` | API gateway → Auth route, above its right-going horizontal segment |
| `write` | `[28,36,5,1]` | Worker pool → Postgres route, above its right-going horizontal segment |
| `read` | `[43,36,4,1]` | Auth → Postgres route, above its left-going horizontal segment |
| `rataflow-view · 77x47 @100% · spec-v1.json · 6 nodes · 6 edges · q quit` | `[2,1,71,1]` | Viewer header |
| `+ [+]` | `[4,42,5,1]` | Controls panel |
| `− [-]` | `[4,43,5,1]` | Controls panel |
| `⊡ [f]` | `[4,44,5,1]` | Controls panel |
| `□ [i]` | `[4,45,5,1]` | Controls panel |

No label is truncated, overwritten, or of uncertain ownership. No label occupies an edge cell. Shell prompts and command echoes around the frame captures are not labels inside the viewer grid.

## Boxes and every border

For every node below, the entire top and bottom, both vertical sides, and all four rounded corners `╭ ╮ ╰ ╯` are present. Borders are not interrupted at the adjacent arrow ports. The listed RGB color is continuous around the entire normal-state perimeter, not merely at the corners. This was checked against static ANSI cells in both bundles.

| Node | Outer bounds | Top / bottom rows | Left / right columns | Perimeter cells | Normal RGB |
|---|---|---|---|---:|---|
| CLI | `[36,7,5,4]` | 7 / 10 | 36 / 40 | 14 | `(216,166,87)` |
| API gateway | `[36,15,13,4]` | 15 / 18 | 36 / 48 | 30 | `(125,174,163)` |
| Job queue | `[23,23,11,4]` | 23 / 26 | 23 / 33 | 26 | `(226,156,175)` |
| Auth | `[49,23,6,4]` | 23 / 26 | 49 / 54 | 16 | `(211,134,155)` |
| Worker pool | `[23,31,13,4]` | 31 / 34 | 23 / 35 | 30 | `(169,182,101)` |
| Postgres | `[36,39,10,4]` | 39 / 42 | 36 / 45 | 24 | `(125,160,184)` |

The controls panel has all four square corners `┌ ┐ └ ┘` and complete sides, with continuous RGB `(168,153,104)`, at `[2,41,9,6]`. It is not a graph node.

In both selected ANSI captures, **all 6 of 6 node occurrences in the one final view** have their own complete perimeter captured in bold RGB `(216,166,87)`. All 140 node-perimeter cells retain their border glyphs, color, and bold state. CLI has the same RGB in normal and selected states but gains bold. The other five nodes change to the selected RGB and gain bold. The selected evidence is simultaneous `--select-all` coverage, not six separate isolated selections. Repeating the same view in a second bundle does not increase the denominator to 12.

Normal node labels are RGB `(235,219,178)`. Edge strokes and arrowheads are muted RGB `(124,111,100)` in the static ANSI capture; dots are RGB `(216,166,87)`.

## Every visible arrow

Coordinates here list the first route cell outside the source border, the bends where applicable, and the target-facing arrowhead. Every arrowhead is a distinct, complete downward `▼` immediately above its target's top border. Each whole route is visually traceable without choosing between competing paths. A dot replaces a straight stroke cell, but does not make ownership ambiguous.

| ID | Source → target | Observed route, in travel order | Direction / arrowhead |
|---|---|---|---|
| E1 | CLI → API gateway | `(37,11)` straight to `(37,14)` | Down; intact `▼` at `(37,14)` |
| E2 | API gateway → Auth | `(39,19)` → `(39,21)` → `(50,21)` → `(50,22)` | Down, right, down; intact `▼` at `(50,22)`; label `verify` |
| E3 | API gateway → Job queue | `(37,19)` → `(37,21)` → `(24,21)` → `(24,22)` | Down, left, down; intact `▼` at `(24,22)`; label `enqueue` |
| E4 | Job queue → Worker pool | `(24,27)` straight to `(24,30)` | Down; intact `▼` at `(24,30)` |
| E5 | Worker pool → Postgres | `(24,35)` → `(24,37)` → `(37,37)` → `(37,38)` | Down, right, down; intact `▼` at `(37,38)`; label `write` |
| E6 | Auth → Postgres | `(50,27)` → `(50,37)` → `(39,37)` → `(39,38)` | Down, left, down; intact `▼` at `(39,38)`; label `read` |

All six arrowheads remain visibly intact in every full sampled frame, including frame 0 in the origin bundle. There are no reverse-facing, missing, double, or dot-covered arrowheads.

### Bends, junctions, crossings, and apparent branches

There are exactly eight route bends:

- E2: `╰` at `(39,21)` and `╮` at `(50,21)`.
- E3: `╯` at `(37,21)` and `╭` at `(24,21)`.
- E5: `╰` at `(24,37)` and `╮` at `(37,37)`.
- E6: `╯` at `(50,37)` and `╭` at `(39,37)`.

No bends belonging to different routes touch. There are no bridge glyphs, route crossings, shared route cells, shared corridors, or drawn junction glyphs. At row 21, the two routes below API gateway are separated by the blank column 38. At row 37, the two routes above Postgres are also separated by blank column 38.

API gateway has an apparent two-way outgoing branch at the node level, but the routes leave distinct bottom-border locations, columns 37 and 39, and never join outside the box. Postgres has two separate incoming arrowheads at columns 37 and 39, not a merged bus or a route junction. No other apparent external branches are visible.

## Motion

All six specified edges are animated in the captures. Every complete sampled frame has **six dots total, exactly one per route**. The partial initial long-capture frame also retains all six dots. No extra or missing dot is visible on any route. With one dot per route, within-route inter-dot spacing is not applicable; dots on different routes never collide or occupy the same cell.

Movement is along the arrow's source-to-target direction: E1 and E4 down; E2 down then right in this window; E3 down then left; E5 down then right; E6 down then left. Integer-cell motion includes repeated positions across successive frames, especially on the two short vertical routes. There is no observed backward movement or wrap within the captured interval.

### Frame-zero origin and arrowhead arrival, per route

The true visible origin is defined here as the first route cell immediately outside the source border; the actual source-border location is also supplied. **All six frame-zero dots are one cell downstream of this first route cell**, so none starts at its true origin even under this less strict outside-border definition.

| Edge | Source border | First route cell | Frame-0 dot | At true origin? | Arrowhead | Frame-20 dot at 3000 ms | Captured arrival frame |
|---|---|---|---|---|---|---|---|
| E1 | `(37,10)` | `(37,11)` | `(37,12)` | No | `(37,14)` | `(37,13)` | None |
| E2 | `(39,18)` | `(39,19)` | `(39,20)` | No | `(50,22)` | `(46,21)` | None |
| E3 | `(37,18)` | `(37,19)` | `(37,20)` | No | `(24,22)` | `(28,21)` | None |
| E4 | `(24,26)` | `(24,27)` | `(24,28)` | No | `(24,30)` | `(24,29)` | None |
| E5 | `(24,34)` | `(24,35)` | `(24,36)` | No | `(37,38)` | `(33,37)` | None |
| E6 | `(50,26)` | `(50,27)` | `(50,28)` | No | `(39,38)` | `(45,37)` | None |

No dot sits on a corner, bridge, or arrowhead in any supplied sampled frame. The corner glyphs survive throughout. Samples can jump from before a corner to after it, so these captures do not establish what occupies those cells between samples.

**Same-frame arrival verdict within the evidence: not demonstrated.** There is no frame in which every route's dot reaches its arrowhead; in fact, no route's dot reaches its arrowhead in any sampled frame. At the final sample, the two short vertical routes remain one cell short, while the four bent routes have not yet reached their final bends/heads. The spec declares 3000 ms on each animated edge, but the supplied 0–3000 ms sequence does not show an arrival at all. Six routes therefore fail the captured-window arrival observation. This is not evidence that their eventual arrival times differ: later or between-sample arrival/synchronization is unobserved and must not be inferred.

### All sampled dot coordinates

Each entry is `(column,row)`. Frame 0 comes from the origin capture; frames 1–20 come from the long capture. Origin frames 1–3 reproduce the same positions.

| Frame | ms | E1 | E2 | E3 | E4 | E5 | E6 |
|---:|---:|---|---|---|---|---|---|
| 0 | 0 | `(37,12)` | `(39,20)` | `(37,20)` | `(24,28)` | `(24,36)` | `(50,28)` |
| 1 | 150 | `(37,12)` | `(39,20)` | `(37,20)` | `(24,28)` | `(24,36)` | `(50,29)` |
| 2 | 300 | `(37,12)` | `(40,21)` | `(36,21)` | `(24,28)` | `(25,37)` | `(50,29)` |
| 3 | 450 | `(37,12)` | `(40,21)` | `(36,21)` | `(24,28)` | `(25,37)` | `(50,30)` |
| 4 | 600 | `(37,12)` | `(40,21)` | `(35,21)` | `(24,28)` | `(26,37)` | `(50,31)` |
| 5 | 750 | `(37,12)` | `(41,21)` | `(35,21)` | `(24,28)` | `(26,37)` | `(50,31)` |
| 6 | 900 | `(37,12)` | `(41,21)` | `(34,21)` | `(24,28)` | `(27,37)` | `(50,32)` |
| 7 | 1050 | `(37,12)` | `(42,21)` | `(34,21)` | `(24,28)` | `(27,37)` | `(50,32)` |
| 8 | 1200 | `(37,13)` | `(42,21)` | `(34,21)` | `(24,29)` | `(27,37)` | `(50,33)` |
| 9 | 1350 | `(37,13)` | `(42,21)` | `(33,21)` | `(24,29)` | `(28,37)` | `(50,34)` |
| 10 | 1500 | `(37,13)` | `(43,21)` | `(33,21)` | `(24,29)` | `(28,37)` | `(50,34)` |
| 11 | 1650 | `(37,13)` | `(43,21)` | `(32,21)` | `(24,29)` | `(29,37)` | `(50,35)` |
| 12 | 1800 | `(37,13)` | `(43,21)` | `(32,21)` | `(24,29)` | `(29,37)` | `(50,36)` |
| 13 | 1950 | `(37,13)` | `(44,21)` | `(31,21)` | `(24,29)` | `(30,37)` | `(50,36)` |
| 14 | 2100 | `(37,13)` | `(44,21)` | `(31,21)` | `(24,29)` | `(30,37)` | `(49,37)` |
| 15 | 2250 | `(37,13)` | `(45,21)` | `(30,21)` | `(24,29)` | `(31,37)` | `(48,37)` |
| 16 | 2400 | `(37,13)` | `(45,21)` | `(30,21)` | `(24,29)` | `(31,37)` | `(48,37)` |
| 17 | 2550 | `(37,13)` | `(45,21)` | `(30,21)` | `(24,29)` | `(31,37)` | `(47,37)` |
| 18 | 2700 | `(37,13)` | `(46,21)` | `(29,21)` | `(24,29)` | `(32,37)` | `(47,37)` |
| 19 | 2850 | `(37,13)` | `(46,21)` | `(29,21)` | `(24,29)` | `(32,37)` | `(46,37)` |
| 20 | 3000 | `(37,13)` | `(46,21)` | `(28,21)` | `(24,29)` | `(33,37)` | `(45,37)` |

## Blind scorecard

This is a count-based observation, not a rubric-derived quality score. `dot_violations` counts route/requirement observations: six non-origin starts plus six failures to exhibit arrival within the supplied window. It does not count each repeated frame as another failure, and it does not claim that unseen eventual arrivals are unequal.

```json
{
  "case": "pipeline",
  "round": "03",
  "stage": "A",
  "final_views": 1,
  "viewport_columns": 77,
  "viewport_rows": 47,
  "visible_nodes": 6,
  "visible_edges": 6,
  "traceable_edges": 6,
  "intact_arrowheads": 6,
  "visible_labels": 10,
  "node_labels": 6,
  "edge_labels": 4,
  "viewer_chrome_labels": 5,
  "all_labels_including_chrome": 15,
  "crossings": 0,
  "touching_bends": 0,
  "route_bends": 8,
  "bridge_glyphs": 0,
  "external_route_junctions": 0,
  "uncertain_label_owners": 0,
  "clipped_items": 0,
  "complete_color_continuous_node_borders": 6,
  "selected_state_coverage": {"captured": 6, "total": 6},
  "animated_routes": 6,
  "distinct_sampled_frames": 21,
  "step_ms": 150,
  "sample_window_ms": [0, 3000],
  "dots_per_complete_frame": 6,
  "dots_per_route_per_complete_frame": 1,
  "dot_violations": 12,
  "dot_violation_unit": "route_requirement_observations_within_captured_window",
  "routes_with_dot_violations": 6,
  "dot_count_violations": 0,
  "dot_direction_violations": 0,
  "dot_corner_occupancy_observations": 0,
  "dot_bridge_occupancy_observations": 0,
  "dot_arrowhead_occupancy_observations": 0,
  "dot_frame0_origin_violations": 6,
  "dot_arrival_window_failures": 6,
  "routes_with_captured_arrowhead_arrival": 0,
  "all_routes_reach_arrowheads_same_captured_frame": false,
  "eventual_same_frame_arrival": "unobserved",
  "wholly_unreadable_capture_files": [],
  "evidence_limitations": [
    "Long motion capture loses the beginning of frame 0; origin capture recovers it.",
    "No continuous motion or frames after 3000 ms.",
    "Motion grid bodies lack per-cell ANSI color; static and selected ANSI establish border color."
  ]
}
```
