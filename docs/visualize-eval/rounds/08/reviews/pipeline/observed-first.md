# Round 08 pipeline — blind observations, stage A

Evidence inspected: final `specs/pipeline-tb.json` and `evidence/v1/` captures, including the pinned 77×47 text dump and 83×51 ANSI/selected capture. The spec SHA-256 is `e0180ab5749af5739d4a20a25112f39ae7914afcad04b2a85c435d46ab9db10d`. No expectations, rubric, source, or attempt logs were consulted. Coordinates below are **1-based [column,row,width,height]**, with row 1 the viewer header; a separate zero-based coordinate comparison is supplied for the origin defect.

## Visible labels and ownership

Pinned frame 0, 77×47:

| Text | Rectangle | Owner |
|---|---|---|
| CLI | [38,3,3,1] | CLI node |
| API gateway | [34,11,11,1] | API node |
| Auth | [30,25,4,1] | Auth node |
| Job queue | [39,25,9,1] | queue node |
| Worker pool | [37,33,11,1] | worker node |
| Postgres | [35,45,8,1] | database node |
| verify | [27,18,6,1] | API → Auth |
| enqueue | [38,18,7,1] | API → Job queue |
| read | [25,35,4,1] | Auth → Postgres |
| write | [39,39,5,1] | Worker pool → Postgres |

All four edge labels sit beside their own route, not on it; none has uncertain ownership. Viewer chrome, not graph labels: `rataflow-view · 77x47 @100% · pipeline-tb.json · 6 nodes · 6 edges · q quit` at [2,1,75,1]; `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], `□ [i]` [4,45,5,1].

## Routes and borders

Six routes are visually traceable, each ending in a downward `▼` immediately above its destination border: CLI → API gateway, API gateway → Auth (`verify`), API gateway → Job queue (`enqueue`), Job queue → Worker pool, Worker pool → Postgres (`write`), Auth → Postgres (`read`). All primarily flow downward; horizontal bends route around other paths. The two outgoing API routes use separate ports, as do the two incoming Postgres routes: there is no shared branching junction. There are zero visible crossings, bridge glyphs, touching bends, or apparent route branches, consistent with `crossings: 0 bridges, 0 touching bends`. The long Auth → Postgres route descends beside the worker and turns right near the end; it is a purposeful detour, not a loop. Animated dots temporarily replace route glyphs, but the sequence resolves the route.

Pinned-frame node border rectangles: CLI [37,2,5,4], API gateway [33,10,13,4], Auth [29,24,6,4], Job queue [38,24,11,4], Worker pool [36,32,13,4], Postgres [34,44,10,4]. Each has four complete sides and four corners. In the 83×51 ANSI capture all six node borders are color-continuous, each with one consistent RGB foreground along all sides and corners. The selected capture shows all six with continuous bold RGB(216,166,87) borders: selected-state coverage **6/6 node occurrences**. The control legend is a separate complete rectangular border, not a graph region.

## Motion and origin measurement

The spec declares `flow: true`, `dots: 1` on all six edges, with the default constant rate. The 36 pinned frames, numbered 0–35 at 100 ms intervals, each show exactly six dots, one per route. Single-dot routes have no intra-route dot spacing to measure. Dots visibly advance toward the target, holding a position for pairs of frames; each wraps separately. In this complete captured interval the dots do not occupy any route corner, bridge, or arrowhead; in particular, they wrap before the arrowhead. They do not all reach arrowheads in the same frame: no captured frame shows any dot on an arrowhead. This is not a same-arrival configuration.

Frame 0 starts **one cell beyond the first painted route cell** on every route, not at the actual origin. This independently measured table uses 1-based coordinates; port is the source border cell, stem is the first painted route cell immediately below it, dot is the second painted route cell:

| Route | Port | Painted stem `│` | Frame-0 `●` |
|---|---|---|---|
| CLI → API | (38,5) | (38,6) | (38,7) |
| API → Auth | (34,13) | (34,14) | (34,15) |
| API → queue | (36,13) | (36,14) | (36,15) |
| queue → worker | (39,27) | (39,28) | (39,29) |
| worker → Postgres | (37,35) | (37,36) | (37,37) |
| Auth → Postgres | (30,27) | (30,28) | (30,29) |

For comparison in zero-based coordinates, CLI → API port is (37,4), painted stem (37,5), dot (37,6). All six initial dots miss the port and also skip the first painted route cell. Thus the check's `origins: 6/6 routes start at their arrow origin` is contradicted by the captured pixels. Count **6 frame-0 origin violations**, distinct from the check's reported zero dot violations.

Verbatim generator evidence from `check.txt`, without a separate family verdict:

`dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms`

A separately named family-evidence line is not present in the permitted capture files; no attempt/command logs were read to find one.

## Fit and structure

Pinned line: `viewport: 77x47 zoom: 1.00 natural`. All six boxes, all routes, all four edge labels, and controls fit in the 77×47 captured view with no visible clipping, hidden graph items, or need to pan/zoom. `check.txt` separately says `viewport: unknown zoom: 1.00 natural` and `extent=31x46 cells`; the pane capture header reports 83×51 @100%. The pinned dump proves the smaller fit directly.

No group is declared in the spec and no titled, bordered group region is visible. This is a branching pipeline rather than a pure chain; no region is needed for the visible connections to be legible, and adding unsubstantiated boxes could imply structure not shown. No sibling-region ordering or rank-gap constraint applies; there is no `minlen` declaration, and `check.txt` contains no `pins-conflict:` line.

## Blind scorecard

- Visible graph nodes: 6; edges: 6; graph labels: 10 (6 node + 4 edge).
- Crossings: 0; touching bends: 0; bridge glyphs: 0; uncertain label owners: 0; clipped graph items: 0.
- Selected-state coverage: 6/6.
- Dot count violations: 0 observed in 36 frames; origin violations: 6/6 routes; arrowhead occupancy: 0/6 observed in the captured frames. The generator's check reports 0 dot violations, a different measure from the observed origin defect.
- No supplied capture format was unreadable. A separately identified generator family-evidence line was not found in the permitted captures.
