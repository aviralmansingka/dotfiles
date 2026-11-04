# Round 03 / network — stage A blind observations

This record uses only `specs/v1.json`, `specs/v2.json`, the text/ANSI/selected/frame captures under `evidence/v1/` and `evidence/v2/`, and `frames/v1-direct-frames.txt` / `frames/v2-direct-frames.txt`. No source, expectations, rubric, other cases, earlier rounds, renderer code, or new viewer sessions were consulted. Spec declarations are not treated as proof of visible behavior.

Coordinates are 1-based `[column,row,width,height]`, measured from the captured screen including the title row. Route point coordinates below are `(column,row)`. Counts are occurrences across the two final views, not deduplicated logical entities.

## Visible labels

### v1

| Label, verbatim | Rectangle | Visible owner |
|---|---|---|
| `WAN` | [35,12,3,1] | WAN box |
| `Firewall` | [35,20,8,1] | Firewall box |
| `Core switch` | [35,28,11,1] | Core switch box |
| `Redis` | [22,36,5,1] | Redis box |
| `Web tier` | [48,36,8,1] | Web tier box |
| `1 GbE` | [37,16,5,1] | WAN → Firewall |
| `10 GbE` | [37,24,6,1] | Firewall → Core switch |
| `25 GbE` | [26,32,6,1] | Core switch → Redis |
| `10 GbE` | [39,32,6,1] | Core switch → Web tier |

### v2

| Label, verbatim | Rectangle | Visible owner |
|---|---|---|
| `Web tier` | [40,16,8,1] | Web tier box |
| `Redis` | [30,24,5,1] | Redis box |
| `DB tier` | [40,32,7,1] | DB tier box |
| `session` | [33,20,7,1] | Uncertain visually: immediately abuts the vertical Web tier → DB tier route at (40,20), although the spec assigns it to Web tier → Redis, whose source leg is at column 42 and whose horizontal leg is below it. There is no leader distinguishing ownership. |
| `queries` | [33,22,7,1] | Web tier → DB tier, immediately left of its column-40 vertical leg |
| `fill` | [33,28,4,1] | Redis → DB tier, above its row-29 horizontal leg |

One uncertain label owner: `session`. All graph label strings are fully visible. There are 15 graph-label occurrences: 8 node labels and 7 edge labels.

### Screen chrome, not graph labels

- v1 title: `rataflow-view · 77x47 @100% · v1.json · 5 nodes · 4 edges · q quit` at [2,1,66,1].
- v2 title: `rataflow-view · 77x47 @100% · v2.json · 3 nodes · 3 edges · q quit` at [2,1,66,1].
- In each view: `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], `□ [i]` [4,45,5,1].
- Thus 10 further chrome-label occurrences, or 25 labels including chrome.
- Spec node IDs and group strings are not printed as additional labels.

## Boxes, borders, and selection

Each listed node has a complete rounded rectangle: continuous top and bottom horizontal sides, both vertical sides, and all four corners `╭ ╮ ╰ ╯`. No route erases a border. Ports meet the box from outside rather than replacing border cells. ANSI-cell inspection confirms a single RGB foreground across every border cell of each node.

| View | Node | Box rectangle | Border cells | Normal border RGB |
|---|---|---|---:|---|
| v1 | WAN | [34,11,5,4] | 14 | (216,166,87) |
| v1 | Firewall | [34,19,10,4] | 24 | (228,184,111) |
| v1 | Core switch | [34,27,13,4] | 30 | (125,174,163) |
| v1 | Redis | [21,35,7,4] | 18 | (169,182,101) |
| v1 | Web tier | [47,35,10,4] | 24 | (211,134,155) |
| v2 | Web tier | [39,15,10,4] | 24 | (216,166,87) |
| v2 | Redis | [29,23,7,4] | 18 | (125,174,163) |
| v2 | DB tier | [39,31,9,4] | 22 | (147,194,183) |

The selected ANSI capture for each view shows every node border in bold RGB (216,166,87), on every side and corner. Coverage is **5/5 in v1, 3/3 in v2, 8/8 total**. These are simultaneous all-selected captures, not separate recordings of individual click interactions. They do capture each occurrence's own selected border. Colors are continuous in both states. The same named nodes do not retain identical normal colors between the views (notably Web tier and Redis).

The control panel is a complete square-corner rectangle [2,41,9,6], RGB (168,153,104), in both views. Graph labels are RGB (235,219,178); background is (40,40,40). Static route strokes and arrowheads are muted (124,111,100); visible static dots use (216,166,87).

## Visible arrows, bends, crossings, and branches

All seven routes have a visible terminal downward `▼`, adjacent above the target's top border. No arrowhead is clipped, reversed, or missing. Each complete route can be traced geometrically from its source to its target; this does not resolve the separate `session` label-ownership problem.

### v1: four arrows, zero crossings

1. **WAN → Firewall**: first exterior route cell (35,15), straight down to arrowhead (35,18). Source bottom border is at row 14; target top border is row 19. Downward direction throughout; no bend.
2. **Firewall → Core switch**: (35,23) straight down to (35,26) `▼`. Source bottom row 22, target top row 27. No bend.
3. **Core switch → Redis**: (35,31) down to `╯` (35,33), left along row 33 to `╭` (22,33), then down to `▼` (22,34). Source bottom row 30, target top row 35. Direction down–left–down.
4. **Core switch → Web tier**: (37,31) down to `╰` (37,33), right along row 33 to `╮` (48,33), then down to `▼` (48,34). Direction down–right–down.

The last two routes leave Core switch through distinct columns (35 and 37), with a blank column between them. They form a conceptual two-way fan-out at the box, not a drawn shared trunk or junction. Their inner bends at (35,33) and (37,33) do not touch. No bridge glyphs, shared runs, touching bends between distinct routes, or unintended apparent branches are visible.

### v2: three arrows, one crossing

1. **Web tier → Redis**: first exterior cell (42,19), down to `╯` (42,21), left along row 21, across a `⌒` bridge at (40,21), to `╭` (30,21), then down to `▼` (30,22). Direction down–left–down.
2. **Web tier → DB tier**: first exterior cell (40,19), down column 40 through the row-21 crossing to `╰` (40,28), right across (41,28) to `╮` (42,28), then down through (42,29) to `▼` (42,30). Direction down–right–down. At the crossing its vertical continuity is represented by the bridge convention rather than an ordinary vertical glyph at that cell.
3. **Redis → DB tier**: first exterior cell (30,27), down to `╰` (30,29), right to `╮` (40,29), then down to `▼` (40,30). Direction down–right–down.

**Crossing:** (40,21), where the horizontal Web tier → Redis route bridges the vertical Web tier → DB tier route. The `⌒` distinguishes a crossing from a junction; there is no `┼`/T-junction. The label `session` immediately above and left of this crossing crowds the wrong vertical leg.

Other bends are (42,21), (30,21), (40,28), (42,28), (30,29), (40,29). There is a notable near-touch: (40,28) on Web tier → DB tier and (40,29) on Redis → DB tier occupy vertically adjacent cells, but the upper `╰` exits right, not down. This is close-packed, not a connecting junction. The two DB-bound arrowheads are separated by one blank column. Web tier has a conceptual two-route fan-out and DB tier a two-route fan-in at distinct ports; neither is a drawn branch junction or shared run. No additional crossing or touching bend is visible.

## Motion: direct full-cycle frame evidence

Both direct dumps begin with **`viewport: 77x47 zoom: 1.00 natural`** and contain frames 0–20 at 100 ms intervals, from 0 to 2000 ms. I inspected all samples, not just a representative middle frame. The bundled frame text and frame ANSI files supply matching later samples 1–20 but have an initial partial-screen fragment instead of a complete frame-0 header. The direct dumps supply the complete frame 0.

There is never more than one visible dot per route. With one dot there is no within-route inter-dot spacing to assess. Neighboring source dots are two columns apart in both fan-outs. Dots advance in the correct directed sense along straight route interiors, but jump over corners and the bridge. There is **no visible dot on any corner, bridge, or arrowhead** in these sampled frames. Arrowheads remain `▼` when dots disappear; no visible `●` arrives there. The later frame portions of the nominal frame-ANSI files are plain text, so these portions do not prove an accent-colored arrowhead or a hidden dot at an endpoint.

### Frame-0 origin test

| View / route | Source border coordinate | First exterior route cell (visible origin) | Frame-0 dot | At true origin? |
|---|---|---|---|---|
| v1 WAN → Firewall | (35,14) | (35,15) | (35,16) | No |
| v1 Firewall → Core switch | (35,22) | (35,23) | (35,24) | No |
| v1 Core switch → Redis | (35,30) | (35,31) | (35,32) | No |
| v1 Core switch → Web tier | (37,30) | (37,31) | (37,32) | No |
| v2 Web tier → Redis | (42,18) | (42,19) | (42,20) | No |
| v2 Web tier → DB tier | (40,18) | (40,19) | (40,20) | No |
| v2 Redis → DB tier | (30,26) | (30,27) | (30,28) | No |

All seven frame-0 dots start on the **second exterior route cell**, one cell downstream of the visible route origin, not at the source boundary or even the first exterior cell.

### v1: dot coordinates per route per frame

`—` means no visible dot, not an inferred endpoint position. Route order: WAN → Firewall; Firewall → Core switch; Core switch → Redis; Core switch → Web tier.

| Frame / ms | WAN→Firewall | Firewall→Core | Core→Redis | Core→Web | Visible dots |
|---|---|---|---|---|---:|
| 0 / 0 | (35,16) | (35,24) | (35,32) | (37,32) | 4 |
| 1 / 100 | (35,16) | (35,24) | (34,33) | (38,33) | 4 |
| 2 / 200 | (35,16) | (35,24) | (34,33) | (38,33) | 4 |
| 3 / 300 | (35,16) | (35,24) | (33,33) | (39,33) | 4 |
| 4 / 400 | (35,16) | (35,24) | (32,33) | (39,33) | 4 |
| 5 / 500 | (35,17) | (35,25) | (32,33) | (40,33) | 4 |
| 6 / 600 | (35,17) | (35,25) | (31,33) | (40,33) | 4 |
| 7 / 700 | (35,17) | (35,25) | (30,33) | (41,33) | 4 |
| 8 / 800 | (35,17) | (35,25) | (30,33) | (41,33) | 4 |
| 9 / 900 | (35,17) | (35,25) | (29,33) | (42,33) | 4 |
| 10 / 1000 | (35,17) | (35,25) | (28,33) | (43,33) | 4 |
| 11 / 1100 | (35,17) | (35,25) | (28,33) | (43,33) | 4 |
| 12 / 1200 | (35,17) | (35,25) | (27,33) | (44,33) | 4 |
| 13 / 1300 | (35,17) | (35,25) | (27,33) | (44,33) | 4 |
| 14 / 1400 | (35,17) | (35,25) | (26,33) | (45,33) | 4 |
| 15 / 1500 | — | — | (25,33) | (45,33) | 2 |
| 16 / 1600 | — | — | (25,33) | (46,33) | 2 |
| 17 / 1700 | — | — | (24,33) | (46,33) | 2 |
| 18 / 1800 | — | — | (23,33) | (47,33) | 2 |
| 19 / 1900 | — | — | (23,33) | (47,33) | 2 |
| 20 / 2000 | — | — | — | — | 0 |

WAN → Firewall and Firewall → Core switch lose their dots at frame 15; both long routes lose theirs at frame 20. No route shows a dot at its arrowhead at any sampled frame, and there is no common visible arrival frame. The short-route disappearance occurs 500 ms earlier than the long-route disappearance. Across 84 route-frame opportunities, 70 dots are visible and **14 are missing**.

### v2: dot coordinates per route per frame

Route order: Web tier → Redis; Web tier → DB tier; Redis → DB tier.

| Frame / ms | Web→Redis | Web→DB | Redis→DB | Visible dots |
|---|---|---|---|---:|
| 0 / 0 | (42,20) | (40,20) | (30,28) | 3 |
| 1 / 100 | (41,21) | (40,20) | (31,29) | 3 |
| 2 / 200 | (41,21) | (40,22) | (31,29) | 3 |
| 3 / 300 | (39,21) | (40,22) | (32,29) | 3 |
| 4 / 400 | (39,21) | (40,23) | (32,29) | 3 |
| 5 / 500 | (38,21) | (40,23) | (33,29) | 3 |
| 6 / 600 | (38,21) | (40,24) | (33,29) | 3 |
| 7 / 700 | (37,21) | (40,24) | (34,29) | 3 |
| 8 / 800 | (37,21) | (40,25) | (34,29) | 3 |
| 9 / 900 | (36,21) | (40,25) | (35,29) | 3 |
| 10 / 1000 | (35,21) | (40,26) | (35,29) | 3 |
| 11 / 1100 | (35,21) | (40,26) | (36,29) | 3 |
| 12 / 1200 | (34,21) | (40,26) | (36,29) | 3 |
| 13 / 1300 | (34,21) | (40,27) | (37,29) | 3 |
| 14 / 1400 | (33,21) | (40,27) | (37,29) | 3 |
| 15 / 1500 | (33,21) | (41,28) | (38,29) | 3 |
| 16 / 1600 | (32,21) | (41,28) | (38,29) | 3 |
| 17 / 1700 | (32,21) | (42,29) | (39,29) | 3 |
| 18 / 1800 | (31,21) | (42,29) | (39,29) | 3 |
| 19 / 1900 | (31,21) | — | — | 1 |
| 20 / 2000 | — | — | — | 0 |

Web → Redis jumps from (41,21) to (39,21), skipping the bridge (40,21). Web → DB jumps from (40,20) to (40,22), skipping the same crossing cell. Other jumps skip bends rather than place dots on them. DB-bound dots disappear at frame 19, while Web → Redis disappears at frame 20. No visible dot reaches any arrowhead; there is no shared visible arrival frame. Across 63 route-frame opportunities, 58 dots are visible and **5 are missing**.

### Motion judgment

- Seven of seven routes fail the frame-0 true-origin observation.
- Seven of seven routes never visibly place a dot at their arrowhead in the supplied full-cycle samples.
- Neither view demonstrates simultaneous arrowhead arrival; both have unequal disappearance frames. A common all-empty frame 20 is not evidence of simultaneous arrival.
- Seven of seven routes have at least one frame with no visible dot. There are **19 missing-dot route-frame samples total**. No excess-dot sample, reversed direction, dot-on-corner, dot-on-bridge, or dot-on-arrowhead sample is visible.
- These are overlapping categories, not 33 independent defects: the count of distinct animated routes with any observed motion violation is **7**. Motion between the 100 ms samples and any hidden renderer phase are not observable and are not inferred.

## Fit and evidence limitations

Both normal ANSI grids and both selected ANSI grids measure **77 columns × 47 rows**. Both direct dumps explicitly say `viewport: 77x47 zoom: 1.00 natural`; both title bars say `77x47 @100%`. Graph bounds including boxes, routes and labels are v1 [21,11,36,28] and v2 [29,15,20,20]. The control panel ends on row 46, inside the grid. No box, label, route, or arrowhead is cut off; no graph content needs pan or zoom to see it in these captured views. Counts of visible crossings: v1 0, v2 1, total 1, explicitly located at (40,21) in v2. No hidden content is indicated by these captures; interactive panning itself was not tested.

No supplied text/ANSI capture was unreadable or unsupported. There are evidence limitations: bundled frame files have an initial partial fragment rather than a full labeled frame 0 (repaired for observation by the supplied direct dumps); later nominal frame-ANSI samples do not supply motion colors; 100 ms samples do not reveal intermediate instants. All-selected captures show border appearance, not independently exercised selection interactions. No hidden endpoint dot or colored arrival state is inferred from the spec or absent color evidence.

## Tool-usable blind scorecard

```json
{
  "stage": "A",
  "case": "network",
  "coordinate_system": "1-based screen columns and rows, including title",
  "count_basis": "occurrences across final views; chrome excluded unless named",
  "views": {
    "v1": {
      "columns": 77,
      "rows": 47,
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_labels": 9,
      "visible_node_labels": 5,
      "visible_edge_labels": 4,
      "crossings": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_border_coverage": {"captured": 5, "total": 5},
      "animated_routes": 4,
      "dot_violations": {
        "distinct_routes_affected": 4,
        "frame0_not_at_true_origin_routes": 4,
        "no_visible_arrowhead_arrival_routes": 4,
        "missing_dot_route_frames": 14,
        "excess_dot_route_frames": 0,
        "wrong_direction_routes": 0,
        "dot_on_corner_samples": 0,
        "dot_on_bridge_samples": 0,
        "dot_on_arrowhead_samples": 0,
        "simultaneous_visible_arrowhead_arrival": false,
        "first_missing_dot_frames_by_route": {
          "WAN->Firewall": 15,
          "Firewall->Core switch": 15,
          "Core switch->Redis": 20,
          "Core switch->Web tier": 20
        }
      }
    },
    "v2": {
      "columns": 77,
      "rows": 47,
      "visible_nodes": 3,
      "visible_edges": 3,
      "visible_labels": 6,
      "visible_node_labels": 3,
      "visible_edge_labels": 3,
      "crossings": 1,
      "crossing_coordinates": [[40,21]],
      "uncertain_label_owners": 1,
      "uncertain_labels": ["session"],
      "clipped_items": 0,
      "selected_border_coverage": {"captured": 3, "total": 3},
      "animated_routes": 3,
      "dot_violations": {
        "distinct_routes_affected": 3,
        "frame0_not_at_true_origin_routes": 3,
        "no_visible_arrowhead_arrival_routes": 3,
        "missing_dot_route_frames": 5,
        "excess_dot_route_frames": 0,
        "wrong_direction_routes": 0,
        "dot_on_corner_samples": 0,
        "dot_on_bridge_samples": 0,
        "dot_on_arrowhead_samples": 0,
        "simultaneous_visible_arrowhead_arrival": false,
        "first_missing_dot_frames_by_route": {
          "Web tier->Redis": 20,
          "Web tier->DB tier": 19,
          "Redis->DB tier": 19
        }
      }
    }
  },
  "total": {
    "visible_nodes": 8,
    "visible_edges": 7,
    "visible_labels": 15,
    "chrome_labels": 10,
    "labels_including_chrome": 25,
    "crossings": 1,
    "uncertain_label_owners": 1,
    "clipped_items": 0,
    "selected_border_coverage": {"captured": 8, "total": 8},
    "incomplete_node_borders": 0,
    "color_discontinuous_node_borders": 0,
    "animated_routes_with_dot_violations": 7,
    "frame0_not_at_true_origin_routes": 7,
    "routes_without_visible_arrowhead_arrival": 7,
    "missing_dot_route_frames": 19,
    "excess_dot_route_frames": 0,
    "views_without_simultaneous_visible_arrowhead_arrival": 2,
    "unreadable_evidence_files": 0
  }
}
```
