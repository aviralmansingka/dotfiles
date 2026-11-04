# Network — round 05, stage A blind observation

This is an observations-only record. No source request, expected data, rubric, other case, earlier round, raw attempts, probes, or renderer source was read. No viewer was launched and nothing was fixed. Final specs and supplied evidence captures were inspected. Coordinates below are 1-based terminal cells, not file line numbers; rectangles are `[column,row,width,height]`.

## Identity and capture limits

Verified with `shasum -a 256`:

- `specs/v1.json`: `52c9e9905fa6c4bd6e1ffe8d46ce9ba2e14b37536f660785b9e334ebf3852869`
- `specs/v2.json`: `087943b82a67478b1117e7d63772949b47c1e7c2841aee990d89e502e22fd027`

Primary motion evidence is the complete pinned `v1-frames-77x47.txt` (frames 0–8, 0–800 ms) and `v2-frames-77x47.txt` (frames 0–30, 0–3000 ms), each with `viewport: 77x47 zoom: 1.00 natural` and 47 rows per frame. Trailing blank columns are stripped in these text dumps. Their headers say `77x47 @100%`.

Static text, static ANSI, and selected ANSI captures are 83×51; ANSI rows explicitly contain 83 cells and there are 51 rows. Their headers say `83x51 @100%`. Corresponding graph geometry is the pinned geometry translated by **(+3 columns,+2 rows)**. The palette instead stays at column 2 and moves down four rows. Static v2 was captured at a nonzero animation phase; it is not a frame-0 test.

The 83×51 v1 frame dump includes all nine frames. The 83×51 v2 `frames.txt` and nominal `frames.ansi` files are truncated at their beginning: they start with the end of an unidentified preceding frame, then contain complete frames 12–30. Frames 0–11 are missing there, but present in the pinned 77×47 dump. Although named ANSI, the frame-grid bodies do not preserve node foreground colors; escape sequences in those files do not supply color for their borders. Color conclusions below therefore come from static and selected ANSI at 83×51, not the pinned text or the nominal ANSI frame bodies. There is no color-bearing 77×47 selected capture.

Manifest fields `pane_cols`, `pane_rect`, and `viewport_line` are null; each manifest gives 51 rows and token `83x51 @100%`. Both say cleanup `confirmed_closed`. These are recorded claims, not a new pane-close test.

## Every diagram label

All labels are one row tall, readable, untruncated, and do not overlap a drawn route. Coordinates in both supplied viewport sizes are listed explicitly.

| View | Verbatim label | 77×47 rectangle | 83×51 rectangle | Observed owner |
|---|---|---|---|---|
| v1 | `WAN` | [34,8,3,1] | [37,10,3,1] | WAN box |
| v1 | `Firewall` | [34,16,8,1] | [37,18,8,1] | Firewall box |
| v1 | `Core switch` | [34,24,11,1] | [37,26,11,1] | Core switch box |
| v1 | `Redis` | [34,32,5,1] | [37,34,5,1] | Redis box |
| v1 | `DB tier` | [34,40,7,1] | [37,42,7,1] | DB tier box |
| v1 | `1 GbE` | [36,12,5,1] | [39,14,5,1] | WAN → Firewall |
| v1 | `10 GbE` | [36,20,6,1] | [39,22,6,1] | Firewall → Core switch |
| v1 | `25 GbE` | [36,28,6,1] | [39,30,6,1] | Core switch → Redis |
| v1 | `fill` | [36,36,4,1] | [39,38,4,1] | Redis → DB tier |
| v2 | `Core switch` | [36,16,11,1] | [39,18,11,1] | Core switch box |
| v2 | `Web tier` | [36,24,8,1] | [39,26,8,1] | Web tier box |
| v2 | `Redis` | [23,32,5,1] | [26,34,5,1] | Redis box |
| v2 | `DB tier` | [49,32,7,1] | [52,34,7,1] | DB tier box |
| v2 | `10 GbE` | [38,20,6,1] | [41,22,6,1] | Core switch → Web tier |
| v2 | `session` | [27,28,7,1] | [30,30,7,1] | Web tier → Redis |
| v2 | `queries` | [40,28,7,1] | [43,30,7,1] | Web tier → DB tier |

`25 GbE` sits right of the single vertical corridor between Core switch and Redis; it does not describe Redis → DB tier. `session` sits left of the left departing Web tier corridor, immediately above its horizontal leftward run; it does not describe the right-hand DB route. I can assign both without consulting the specs. There are **zero uncertain diagram-label owners**.

### All visible viewer UI labels

Each view/size has one header at [2,1,66,1], verbatim:

- v1 pinned: `rataflow-view · 77x47 @100% · v1.json · 5 nodes · 4 edges · q quit`
- v1 static: `rataflow-view · 83x51 @100% · v1.json · 5 nodes · 4 edges · q quit`
- v2 pinned: `rataflow-view · 77x47 @100% · v2.json · 4 nodes · 3 edges · q quit`
- v2 static: `rataflow-view · 83x51 @100% · v2.json · 4 nodes · 3 edges · q quit`

Each view also has the same palette labels: `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]`, each width 5 and height 1, starting at column 4. Their rows are 42,43,44,45 in the pinned capture, respectively, and 46,47,48,49 at 83×51. The leading interior blank before each label is not part of the label. The palette outline is [2,41,9,6] pinned and [2,45,9,6] static. Its four corners and all sides are present. Static ANSI shows its border continuously RGB (168,153,104).

## Boxes and borders

Every node has all four complete sides and all four rounded corners `╭ ╮ ╰ ╯`; none is replaced by a route, label, dot, or palette cell. The following rectangles specify every corner and side: top/bottom span the rectangle width and left/right span its height. Static normal and selected ANSI prove continuous border foreground around the entire perimeter, including all corners.

| View | Box | 77×47 rectangle | 83×51 rectangle | Normal border RGB | Border cells |
|---|---|---|---|---|---:|
| v1 | WAN | [33,7,5,4] | [36,9,5,4] | (211,134,155) | 14 |
| v1 | Firewall | [33,15,10,4] | [36,17,10,4] | (226,156,175) | 24 |
| v1 | Core switch | [33,23,13,4] | [36,25,13,4] | (187,108,131) | 30 |
| v1 | Redis | [33,31,7,4] | [36,33,7,4] | (125,174,163) | 18 |
| v1 | DB tier | [33,39,9,4] | [36,41,9,4] | (147,194,183) | 22 |
| v2 | Core switch | [35,15,13,4] | [38,17,13,4] | (211,134,155) | 30 |
| v2 | Web tier | [35,23,10,4] | [38,25,10,4] | (125,174,163) | 24 |
| v2 | Redis | [22,31,7,4] | [25,33,7,4] | (147,194,183) | 18 |
| v2 | DB tier | [48,31,9,4] | [51,33,9,4] | (99,151,141) | 22 |

Selected ANSI shows every one of these nine occurrences with its own complete border uniformly RGB (216,166,87): **9/9 coverage**, in two all-selected images. This is not evidence of nine separate interactive selections. All 202 node-border cells per combined pair of views are present and uniformly colored within each box, both normal and selected. Frame-grid geometry also preserves all these borders in every available complete frame.

**Palette overwrites:** zero node-border cells overwritten. At 77×47, the palette shares rows 41–42 with DB tier in v1, but the palette ends at column 10 and that node starts at column 33; row coincidence is not overlap. No route or label is covered either.

**Group hue stability:** v1 WAN/Firewall/Core switch occupy a pink family; v1 Redis/DB tier occupy a teal family. V2 Core switch remains pink and Web tier/Redis/DB tier remain teal. The two group families are stable across the views, but individual shared-node RGB values are not: Core switch changes (187,108,131) → (211,134,155), Redis (125,174,163) → (147,194,183), and DB tier (147,194,183) → (99,151,141). Stable hue family must not be reported as exact per-node color stability. Node text is RGB (235,219,178), routes/head glyphs are muted RGB (124,111,100), and dots use the selection accent RGB (216,166,87), all on RGB (40,40,40).

## Every arrow, bend, crossing, and branch

All seven arrows are solid, terminate with intact downward `▼`, and are wholly traceable without guessing. There are no bidirectional heads, missing heads, or heads hidden by dots. Coordinates in this section are pinned 77×47; add (3,2) for the corresponding 83×51 graph geometry.

| View | Arrow | Whole visible corridor outside source box | Head | Direction / traceability |
|---|---|---|---|---|
| v1 | WAN → Firewall | column 34, rows 11–14 | [34,14] | Straight down; clear |
| v1 | Firewall → Core switch | column 34, rows 19–22 | [34,22] | Straight down; clear |
| v1 | Core switch → Redis | column 34, rows 27–30 | [34,30] | Straight down; clear |
| v1 | Redis → DB tier | column 34, rows 35–38 | [34,38] | Straight down; clear |
| v2 | Core switch → Web tier | column 36, rows 19–22 | [36,22] | Straight down; clear |
| v2 | Web tier → Redis | [36,27] down to `╯` [36,29], left along row 29 to `╭` [23,29], down to head | [23,30] | Down, left, down; clear |
| v2 | Web tier → DB tier | [38,27] down to `╰` [38,29], right along row 29 to `╮` [49,29], down to head | [49,30] | Down, right, down; clear |

All four route corners are explicitly listed in the last two rows. They are ordinary corners, not bridges or junctions. They never touch another route. The departing v2 vertical corridors are two columns apart, with a full blank column between them, and their horizontal runs go in opposite directions. The apparent fork is **two distinct outputs of the Web tier box**, not one shared bus splitting at a T. There are no `┬`, `┴`, `├`, `┤`, `┼`, bridge arcs, shared runs, touching bends, or crossings in either view. The straight v1 chain's collinear incoming and outgoing arrows are separated by the intervening boxes, not route junctions.

No conspicuous loop, backtrack, or detour is visible. All routes are monotone between their box attachments. The v2 horizontal excursions are required to reach the separated lower boxes rather than gratuitous loops.

## Motion: coordinate evidence, not the checker's assertions

All seven spec edges declare `flow: true` and `dots: 1`, without a speed override. In every captured pinned frame v1 has exactly four dots, one per arrow, and v2 exactly three dots, one per arrow. No duplicate/missing dot occurs; within-route dot spacing is inapplicable to a single-dot route. Distinct-route dots never collide.

### Frame-0 origin test

For the pinned rule, I identify the source port as the source-box border attachment and the origin as the **first drawn corridor cell immediately outside that border**, including a corner if one occupied that first cell. This is a visual coordinate test; it does not adopt a hidden path index or the checker's definition of origin.

| View | Route | Source border attachment | First drawn cell after port | Actual frame-0 dot | Result |
|---|---|---|---|---|---|
| v1 | WAN → Firewall | [34,10] | [34,11] | [34,12] | One drawn cell late |
| v1 | Firewall → Core switch | [34,18] | [34,19] | [34,20] | One drawn cell late |
| v1 | Core switch → Redis | [34,26] | [34,27] | [34,28] | One drawn cell late |
| v1 | Redis → DB tier | [34,34] | [34,35] | [34,36] | One drawn cell late |
| v2 | Core switch → Web tier | [36,18] | [36,19] | [36,20] | One drawn cell late |
| v2 | Web tier → Redis | [36,26] | [36,27] | [36,28] | One drawn cell late |
| v2 | Web tier → DB tier | [38,26] | [38,27] | [38,28] | One drawn cell late |

Thus **0/7 frame-0 dots satisfy this first-drawn-cell origin rule**, notwithstanding the supplied checks claiming 4/4 and 3/3 origins. All first corridor cells remain plain vertical glyphs throughout the captured laps. There is no need to infer origin from the spec: the source border, next corridor glyph, and displaced dot are visible simultaneously.

### The five short, two-position animations

For each v1 arrow, let `r` be its frame-0 dot row (12,20,28,36), with fixed column 34. The nine frames' dot rows are:

`r, r, r+1, r+1, r, r, r+1, r+1, r` at 0,100,…,800 ms.

For v2 Core switch → Web tier, column is 36 and dot row is 20 at frames congruent to 0 or 1 modulo 4, and 21 at frames congruent to 2 or 3 modulo 4, through frame 30.

These dots move one cell down after 200 ms, hold, then jump one cell back up on the 400 ms wrap. Their final displayed position is immediately before the arrowhead; the arrowhead itself is never occupied. The first drawn corridor cell is never occupied either. This is measurable position change, but **I do not find a two-cell forward/back toggle sufficient to read as sustained directional flow**. It reads primarily as a local jitter/blink next to a static downward arrow. The arrow glyph establishes direction more convincingly than the dot. This affects all four v1 routes and the short v2 input route (five occurrences), not the two long output routes. All four v1 toggles happen together, but that is phase coincidence on equal-length routes, not evidence of synchronized arrival at arrowheads.

### The two long v2 animations

Frames occur every 100 ms; the following position holds at each listed even frame and the following odd frame, when present. Ordered coordinate lists enumerate every movement state up to the wrap:

- Web tier → Redis: frame 0 [36,28]; frame 2 [35,29]; frames 4,6,…,24 are [34,29], [33,29], [32,29], [31,29], [30,29], [29,29], [28,29], [27,29], [26,29], [25,29], [24,29]. Frame 26 wraps to [36,28]; frame 28 is [35,29]; frame 30 [34,29]. Lap: 2600 ms.
- Web tier → DB tier: frame 0 [38,28]; frame 2 [39,29]; frames 4,6,…,20 are [40,29], [41,29], [42,29], [43,29], [44,29], [45,29], [46,29], [47,29], [48,29]. Frame 22 wraps to [38,28]; frame 24 [39,29], frame 26 [40,29], frame 28 [41,29], frame 30 [42,29]. Lap: 2200 ms.

Their long horizontal travel is plainly more readable as leftward/rightward movement toward their respective lower targets, at one visible straight-run cell per 200 ms (consistent with the reported constant default 0.5 cell/100 ms step). However, movement is not a complete cell-by-cell traversal of the drawn corridor: frame 0 → frame 2 skips the departing corner [36,29] or [38,29], making a diagonal two-Manhattan-cell hop. The arriving corners [23,29] and [49,29] are also never occupied. The last dot cells [24,29] and [48,29] are one cell before those corners and two Manhattan cells before heads [23,30] and [49,30], before wrapping. Thus “wraps just before the arrowhead” is literally adjacent only on the short straight arrows; the bent arrows wrap before the final corner as well.

Across all supplied full laps: **no dot ever sits on a corner, bridge, or arrowhead**. No bridge exists here. Neither v2 output dot visibly turns downward onto its final head segment. The two long routes wrap at different times, and none of the seven dots reaches its arrowhead in any captured frame. Therefore there is **no common frame of arrowhead arrival**. Equal-arrival was not requested by these final specs; this is an observation, not a fabricated same-arrival-mode failure.

## Fit and reported diagnostics

Both full pinned grids are 77×47 at 100%, without zooming down. V1's visible diagram envelope is columns 33–45, rows 7–42 (13×36); v2's is columns 22–56, rows 15–34 (35×20). Both fit entirely, including labels, corners, heads, and palette. The corresponding 83×51 static images also fit entirely. There are **zero visible clipped, hidden, or pan/zoom-only diagram items**. No claim about unseen interactive pan/zoom behavior is needed.

Supplied check outputs say:

- v1: `viewport: unknown zoom: 1.00 natural`, `extent=17x40 cells`, `crossings: 0 bridges, 0 touching bends`, labels 4/4 placed, 0 on routes, 0 skipped, 0 ambiguous; groups network(3), tiers(2); four single-dot constant routes at 0.5c/step and zero reported violations.
- v2: `viewport: unknown zoom: 1.00 natural`, `extent=39x24 cells`, `crossings: 0 bridges, 0 touching bends`, labels 3/3 placed, 0 on routes, 0 skipped, 0 ambiguous; groups network(1), tiers(3); three single-dot constant routes at 0.5c/step and zero reported violations.

Visible zero-crossing/zero-touching geometry agrees with those counts. The check extents are four cells larger in each dimension than the visible diagram envelopes; they fit inside either captured viewport. Neither check includes a `routes: N/M near-minimal` line, so the requested numerical near-minimal comparison is **missing**, not silently passed. No detour is visually conspicuous. Check viewport is unknown, whereas the full-lap dump's explicit viewport line establishes 77×47 and the static ANSI grid establishes 83×51.

## Tool-usable blind scorecard

Counts refer to graph occurrences summed across the two final views, not repeated animation frames or two viewport-size copies. `labels` means node labels plus edge labels; UI labels are separately counted. `dot_violations` counts distinct routes failing the stipulated visual origin test, not a sum of overlapping symptom categories. No expectation-based grade or numeric rubric score is assigned in stage A.

```json
{
  "stage": "A",
  "case": "network",
  "round": "05",
  "views": {
    "v1": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_labels": 9,
      "edge_labels": 4,
      "crossings": 0,
      "bridges": 0,
      "touching_bends": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_state_captured": 5,
      "selected_state_total": 5,
      "animated_routes": 4,
      "dots_per_frame": 4,
      "dot_violations": 4,
      "frame0_origin_failures": 4,
      "short_toggle_motion_routes": 4
    },
    "v2": {
      "visible_nodes": 4,
      "visible_edges": 3,
      "visible_labels": 7,
      "edge_labels": 3,
      "crossings": 0,
      "bridges": 0,
      "touching_bends": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_state_captured": 4,
      "selected_state_total": 4,
      "animated_routes": 3,
      "dots_per_frame": 3,
      "dot_violations": 3,
      "frame0_origin_failures": 3,
      "short_toggle_motion_routes": 1,
      "routes_skipping_drawn_corners": 2
    }
  },
  "total": {
    "visible_nodes": 9,
    "unique_node_labels": 6,
    "visible_edges": 7,
    "visible_labels": 16,
    "node_labels": 9,
    "edge_labels": 7,
    "ui_labels_across_two_views_at_one_size": 10,
    "crossings": 0,
    "bridges": 0,
    "touching_bends": 0,
    "route_corners": 4,
    "route_junctions": 0,
    "apparent_box_fanouts": 1,
    "uncertain_label_owners": 0,
    "clipped_items": 0,
    "hidden_or_pan_zoom_only_items": 0,
    "complete_node_borders": 9,
    "color_continuous_node_borders_proved_at_83x51": 9,
    "palette_overwritten_node_border_cells": 0,
    "selected_state_captured": 9,
    "selected_state_total": 9,
    "animated_routes": 7,
    "dot_violations": 7,
    "frame0_origin_passes": 0,
    "frame0_origin_failures": 7,
    "dot_count_violations": 0,
    "short_toggle_motion_routes": 5,
    "routes_skipping_drawn_corners": 2,
    "dot_corner_occupancies": 0,
    "dot_bridge_occupancies": 0,
    "dot_arrowhead_occupancies": 0,
    "routes_observed_reaching_arrowhead": 0,
    "all_routes_same_frame_arrowhead_arrival": false,
    "group_hue_families_stable": true,
    "shared_nodes_with_exact_rgb_changes": 3,
    "near_minimal_diagnostic_available": false
  },
  "unreadable_formats": [],
  "evidence_gaps": [
    "83x51 v2 frame dumps lack complete frames 0 through 11; pinned 77x47 dump supplies them",
    "No color-bearing pinned 77x47 normal or selected capture",
    "Nominal frames.ansi grid bodies do not preserve node border foreground colors",
    "No routes N/M near-minimal line in either supplied check",
    "Manifest pane_cols, pane_rect, and viewport_line are null; dimensions instead verified from captures"
  ]
}
```

Blind overall observation: clean, small, fully readable topology; all seven label owners and arrows are clear; complete selected borders and stable group hue families. Motion is the weak part: five routes only jitter over two cells, all seven start after the first visible route cell under the stipulated origin rule, and the two longer routes visibly skip corners and reset before completing their final turns. This record ends stage A without consulting expectations.
