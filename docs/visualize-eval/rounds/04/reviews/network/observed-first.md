# Network — stage A blind observation, round 04

This record is based only on the final spec and candidate captures. No source, expectations, rubric, manifest, other case, or earlier round was read. No viewer was launched and no candidate was changed.

Final spec: `network/specs/v1-a3.json`.
Verified SHA-256: `3a2a475ace1149a25048717a2c01e6df4971e74002642b38266baeca8f90f2a3`.

## Coordinate convention and evidence

All coordinates below are **1-based viewport coordinates**, including the application header as row 1. Rectangles are `[column,row,width,height]`. This differs from the helper reports' zero-based column/graph-row coordinates: add 1 to their column and 2 to their graph row.

Primary evidence: `v1-text.txt`, `v1-ansi.ansi`, `v1-selected.ansi`, and all 21 frames in `v1-frames-77x47.txt`, under `network/evidence/v1/`. I also read the check, layout, color, and motion verification captures, but independently measured coordinates, route indices, and ANSI styles rather than accepting those reports as proof. The older `v1-frames.txt` and `v1-frames.ansi` start mid-frame; their frame-0 heading and top portion are absent. They contain subsequent headings 1–20. The pinned dump provides the complete frame 0 and is the motion basis here. The older ANSI file does contain ANSI, despite its opening plain-looking fragment.

The spec declares six nodes and seven edges, all `flow: true, dots: 1`. This records the visible result, not presumed compliance with those declarations.

## Every visible graph label

| Verbatim label | Rectangle | Visible owner |
|---|---|---|
| WAN | [35,3,3,1] | WAN box |
| Firewall | [33,11,8,1] | Firewall box |
| Core switch | [31,19,11,1] | Core switch box |
| Web tier | [33,27,8,1] | Web tier box |
| Redis | [20,36,5,1] | Redis box |
| DB tier | [52,44,7,1] | DB tier box |
| 1 GbE | [37,7,5,1] | WAN → Firewall |
| 10 GbE | [35,15,6,1] | Firewall → Core switch |
| 10 GbE | [35,23,6,1] | Core switch → Web tier |
| 25 GbE | [23,23,6,1] | Core switch → Redis |
| session | [25,32,7,1] | Web tier → Redis |
| queries | [41,39,7,1] | Web tier → DB tier |
| fill | [34,42,4,1] | Redis → DB tier |

There are 13 graph-label occurrences and 12 distinct graph-label strings. Both `10 GbE` occurrences are fully visible. They read as the same bandwidth on two successive links, not as a duplicated node name. Their owners are distinguishable by their separate inter-node gaps and adjacent route stems. The lower one is beside the right-hand Core switch exit; `25 GbE` sits on the left of the other exit. I do not find an uncertain graph-label owner. `queries` is above its long horizontal route, while `fill` is below the lower horizontal route; the two remain traceable, though the lower layout asks for more eye travel than the compact upper chain.

Other visible UI labels, excluded from graph-label counts:

- `rataflow-view · 77x47 @100% · v1-a3.json · 6 nodes · 7 edges · q quit` at [2,1,69,1]. The line has one leading blank.
- `+ [+]` at [4,42,5,1].
- `− [-]` at [4,43,5,1].
- `⊡ [f]` at [4,44,5,1].
- `□ [i]` at [4,45,5,1].

Thus there are 18 label occurrences including the header as one UI label and the four palette labels.

## Boxes, borders, and selected-state evidence

Each box is four rows high. Every top and bottom side, both vertical sides, and all four rounded corners are present. Arrows meet boxes from the immediately adjacent row; they do not replace the box border with a junction glyph.

| Node | Full box rectangle | Border cells checked | Normal border foreground | Selected border foreground |
|---|---|---:|---|---|
| WAN | [34,2,5,4] | 14 | #d8a657 | #d8a657 |
| Firewall | [32,10,10,4] | 24 | #7daea3 | #d8a657 |
| Core switch | [30,18,13,4] | 30 | #d3869b | #d8a657 |
| Web tier | [32,26,10,4] | 24 | #a9b665 | #d8a657 |
| Redis | [19,35,7,4] | 18 | #7da0b8 | #d8a657 |
| DB tier | [51,43,9,4] | 22 | #97b8ce | #d8a657 |

I decoded every border cell in both ANSI captures, not just one sample per box. Every individual border is color-continuous. All normal borders are non-bold; all selected borders have SGR bold enabled. Consequently the selected capture covers **6/6 node occurrences in the one final view**. I do not count the repeated animation frames as new diagram occurrences.

WAN has a real foreground-accent collision: its normal border is already the same gold as selected borders and flow dots. At a glance it can look selected in the normal frame, weakening the selected/unselected color distinction. However, the helper's claim that it is simply identical before and after selection misses the ANSI weight change: WAN becomes bold under selection. Selected-state evidence is therefore present for WAN, but color alone cannot communicate the change. Five other boxes change foreground as well as weight. Redis and DB tier have different shades of blue, visibly consistent as a family rather than identical colors. Routes and arrowheads are muted #7c6f64; dots are gold #d8a657; graph text is #ebdbb2; background is #282828.

The palette also has a complete rectangular border at [2,41,9,6]. It is UI, not a seventh graph node, and it does not overlap a route.

## Visible arrows and route geometry

All seven arrowheads are downward `▼`, complete and visible in every pinned motion frame. Each whole route can be traced without guessing. The following polylines start at the **first drawn cell outside the source border** and end on the arrowhead; consecutive listed vertices are connected orthogonally.

| Source → target | Route vertices (column,row) | Arrowhead | Traceability |
|---|---|---|---|
| WAN → Firewall | (35,6) → (35,8) → (33,8) → (33,9) | (33,9), down | Complete |
| Firewall → Core switch | (33,14) → (33,16) → (31,16) → (31,17) | (31,17), down | Complete |
| Core switch → Web tier | (33,22) → (33,25) | (33,25), down | Complete |
| Core switch → Redis | (31,22) → (31,24) → (20,24) → (20,34) | (20,34), down | Complete |
| Web tier → Redis | (33,30) → (33,33) → (22,33) → (22,34) | (22,34), down | Complete |
| Web tier → DB tier | (35,30) → (35,40) → (54,40) → (54,42) | (54,42), down | Complete |
| Redis → DB tier | (20,39) → (20,41) → (52,41) → (52,42) | (52,42), down | Complete |

All 12 ordinary route bends, including their unoccluded glyphs:

- WAN → Firewall: (35,8) `╯`, (33,8) `╭`.
- Firewall → Core switch: (33,16) `╯`, (31,16) `╭`.
- Core switch → Redis: (31,24) `╯`, (20,24) `╭`.
- Web tier → Redis: (33,33) `╯`, (22,33) `╭`.
- Web tier → DB tier: (35,40) `╰`, (54,40) `╮`.
- Redis → DB tier: (20,41) `╰`, (52,41) `╮`.

There are **0 crossings, 0 touching bends between routes, 0 bridge glyphs, 0 junction glyphs, and 0 shared-route branches**. Core switch and Web tier each visibly emit two separate routes from separate bottom ports; Redis and DB tier each receive two separate arrows. These are node-level fan-outs/fan-ins, not bus splits or shared corridors. Parallel Redis approaches are at columns 20 and 22; DB approaches are at columns 52 and 54. They are distinct with a blank column between them.

The upper WAN and Firewall links each make a small two-column left dogleg. The lower routes are long but monotone toward their endpoints: Core switch and Web tier route left to Redis; Web tier and Redis route right toward DB tier. I see no looping route or reversal detour. The check's `routes: 7/7 near-minimal, 0 detours, 1 shortened` is visually plausible as a geometric description, but it does not prove correct motion.

## Motion: independent measurements

Pinned evidence: `viewport: 77x47 zoom: 1.00 natural`; frames 0–20 inclusive, at 100 ms intervals. All 21 frames show exactly seven dots, one on each route, for 147 dot observations. A single dot has no within-route dot spacing to measure. Routes remain distinct and dots never merge.

### Frame-0 origins: all seven helper claims are off by one drawn route cell

Here “source border” is the actual bottom border, not the first route cell below it.

| Route | Actual source-border port | First drawn cell after port | Frame-0 dot | At first drawn cell? |
|---|---|---|---|---|
| WAN → Firewall | (35,5) | (35,6) | (35,7) | No |
| Firewall → Core switch | (33,13) | (33,14) | (33,15) | No |
| Core switch → Web tier | (33,21) | (33,22) | (33,23) | No |
| Core switch → Redis | (31,21) | (31,22) | (31,23) | No |
| Web tier → Redis | (33,29) | (33,30) | (33,31) | No |
| Web tier → DB tier | (35,29) | (35,30) | (35,31) | No |
| Redis → DB tier | (20,38) | (20,39) | (20,40) | No |

The frame-0 dots all sit on the **second** drawn cell beyond their source borders. The first cells remain visible `│` immediately above them. The motion helper calls those first route cells “source ports,” moving the supposed source boundary down one row. That is why its `7/7 origins` claim disagrees with the boxes in the actual capture. No dot occupies the true first drawn cell in any of these 21 frames.

### Equal update cadence does not establish equal speed in physical grid cells

Index each complete drawn route from its first external cell as index 0, including bends and arrowheads. The route-index sequences below list frames 0,2,4,...,20. Every intervening odd frame repeats the preceding position.

| Route | Total drawn route cells | Route indices at even frames |
|---|---:|---|
| WAN → Firewall | 6 | 1,3,4,1,3,4,1,3,4,1,3 |
| Firewall → Core switch | 6 | 1,3,4,1,3,4,1,3,4,1,3 |
| Core switch → Web tier | 4 | 1,2,1,2,1,2,1,2,1,2,1 |
| Core switch → Redis | 24 | 1,3,4,5,6,7,8,9,10,11,12 |
| Web tier → Redis | 16 | 1,2,4,5,6,7,8,9,10,11,12 |
| Web tier → DB tier | 32 | 1,2,3,4,5,6,7,8,9,11,12 |
| Redis → DB tier | 36 | 1,3,4,5,6,7,8,9,10,11,12 |

All routes update on the same 200 ms cadence, but several jump **two actual route cells** over a bend in one update while another route moves one. For example, at frame 0→2 WAN moves (35,7)→(34,8), skipping (35,8); Core switch → Web tier moves (33,23)→(33,24), only one cell. Web tier → DB tier later jumps (35,39)→(36,40) over its bend at frame 16→18. Six routes show a two-cell forward jump within this capture; the straight Core switch → Web tier route does not.

Each of the four long routes advances 11 physical route cells from frame 0 through frame 20, not the helper's asserted 10. That is 0.55 physical route cells per 100 ms over this interval, with local bursts of 1 cell per 100 ms averaged over a two-frame update rather than uniformly 0.5. The two short doglegs repeat their three sampled positions every six frames (600 ms); the straight short route repeats its two positions every four frames (400 ms). They restart before reaching their visible arrowheads. Dot update counts can all be 10 while geometric travel is not uniform. Thus the reported universal constant-speed claim is not supported when “cell” means the drawn character grid.

### Corners and other collisions

Two routes visibly put dots on corners:

- WAN → Firewall: dot at (33,8), replacing `╭`, in frames 4,5,10,11,16,17.
- Firewall → Core switch: dot at (31,16), replacing `╭`, in those same frames.

That is **2 affected routes, 2 distinct corner cells, 12 corner-dot observations**. Each such position persists across two captured frames, just like the ordinary straight-cell positions. The unoccluded corner is recoverable in other frames. The normal still capture also catches both corner replacements.

Within the supplied 0–2000 ms window, no dot occupies a bridge, graph label, node border/interior, or arrowhead. All seven arrowheads stay visible, and **no route's dot reaches its arrowhead in any frame**, much less all routes in a common frame. The long routes have not completed a lap at 2000 ms. Despite the “full-cycle” description, these captures do not establish whole-lap behavior for those four routes. Behavior outside the captured window is missing evidence, not proof of no later corner collisions or of eventual arrival.

## Fit and check comparison

- ANSI normal and selected captures each contain exactly **77 columns × 47 rows**. The text capture has 46 non-final-blank rows, right-trimmed; its longest line is the 70-character header including its initial blank.
- Visible graph bounds are columns 19–59 and rows 2–46, inclusive: **41 × 45 drawn cells**. The check reports `extent=42x46 cells`, consistent with an additional allocation cell but not identical to the tight visible bounding rectangle.
- The pinned motion capture explicitly says `viewport: 77x47 zoom: 1.00 natural`; `check.txt` instead says `viewport: unknown zoom: 1.00 natural`. The header says `77x47 @100%`.
- Every graph label, border, arrowhead, and traced route fits within the captured viewport. Bottom border is at row 46, leaving row 47 blank; farthest graph cell is column 59. No clipped items are visible and no content needs pan or zoom to read in the supplied state. This is not a claim about unrecorded interaction states.
- The UI palette at columns 2–10, rows 41–46 is separate from graph content beginning at column 19. It obscures nothing here.
- Visible crossings agree with `crossings: 0 bridges, 0 touching bends`. Label completeness agrees with `labels: 7/7 placed, 0 on route cells, 0 skipped, 0 ambiguous owners`.
- Check claims `dots: ... 0 violations, 7 constant at 0.5c/step` and `origins: 7/7 routes start at their arrow origin` do **not** agree with the independent grid-coordinate observations above.

## Tool-usable blind scorecard

No hidden-rubric numeric quality score is assigned. Counts below use distinct graph objects unless explicitly named observations.

```json
{
  "stage": "A",
  "case": "network",
  "round": "04",
  "visible_nodes": 6,
  "visible_edges": 7,
  "visible_arrowheads": 7,
  "fully_traceable_edges": 7,
  "graph_label_occurrences": 13,
  "node_label_occurrences": 6,
  "edge_label_occurrences": 7,
  "distinct_graph_label_strings": 12,
  "ui_label_occurrences": 5,
  "crossings": 0,
  "bridges": 0,
  "touching_bends": 0,
  "ordinary_route_bends": 12,
  "junctions": 0,
  "shared_corridor_branches": 0,
  "uncertain_label_owners": 0,
  "clipped_items": 0,
  "complete_node_borders": 6,
  "color_continuous_node_borders": 6,
  "selected_state_coverage": {"captured": 6, "total": 6},
  "normal_border_selection_accent_collisions": 1,
  "viewport": {"columns": 77, "rows": 47, "zoom": 1.0},
  "visible_graph_bounds": [19, 2, 41, 45],
  "motion_frames": 21,
  "motion_duration_ms": 2000,
  "dots_per_frame_min": 7,
  "dots_per_frame_max": 7,
  "dot_observations": 147,
  "routes_with_dot_count_violations": 0,
  "routes_with_frame0_origin_violations": 7,
  "routes_with_observed_two_cell_forward_jumps": 6,
  "routes_with_corner_dot_violations": 2,
  "distinct_corner_dot_cells": 2,
  "corner_dot_observations": 12,
  "bridge_dot_observations": 0,
  "label_dot_observations": 0,
  "node_box_dot_observations": 0,
  "arrowhead_dot_observations": 0,
  "routes_with_any_observed_dot_violation": 7,
  "routes_observed_reaching_arrowhead": 0,
  "long_routes_without_complete_lap_evidence": 4,
  "wholly_unreadable_evidence_files": [],
  "partial_legacy_motion_files": ["v1-frames.txt", "v1-frames.ansi"]
}
```

No evidence format was wholly unreadable. The two older motion files are incomplete at their beginning; the pinned 77×47 dump supplies the missing initial frame. Selected and normal ANSI were readable and their style differences were measured. This is the saved blind record; it must not be edited after saving.
