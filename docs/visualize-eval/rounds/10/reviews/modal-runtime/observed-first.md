# Blind observation — round 10, modal-runtime

Only the supplied final spec files and capture/evidence files were inspected. Coordinates below are 1-based `[column,row,width,height]` in the 82×51 text captures; they locate graph text, not its enclosing box. UI header and four zoom/fit controls are not graph labels. `shasum -a 256` of final specs matches the evidence manifests:
- `specs/v1-seams.json`: `ae21002480ab26a2d6a6770820f172feb10028fad89860c38667654bfbdcc9d2`
- `specs/v2-exec-storage.json`: `2ce2ddb343d92f323dcf882248d321016500bfdd982c6b3442f26f6d7e33e301`

## View 1: seams

Four visible nodes and four visible directed routes, each with an arrowhead. Text:

| Label | Bounds | Kind |
|---|---|---|
| modal-worker | [36,18,12,1] | node |
| modal-runtime | [36,26,13,1] | node |
| modal-daemon | [28,34,12,1] | node |
| Task engine | [45,34,11,1] | node |
| task in + ctrl gRPC | [44,21,19,1] | edge |
| events + mgmt gRPC | [44,22,18,1] | edge |
| dispatch tasks | [44,29,14,1] | edge |
| fs HTTP over UDS | [25,30,16,1] | edge |

Routes: worker → runtime down, arrowhead ▼ at [41,24]; runtime → worker up, arrowhead ▲ at [42,21]; runtime → daemon down, arrowhead ▼ at [33,32]; runtime → Task engine down, arrowhead ▼ at [50,32]. All four geometrical routes can be traced end-to-end; the reciprocal routes run very close and need careful inspection. The opposite paths have four immediately adjacent bend glyphs `╰╮╰╮` at columns 40–43, row 23: a visual touch but not an actual route junction; no visible bridge glyph, crossing, or true branch. The two lower paths leave separate bottom ports, not a shared branch. Arrowheads are present and point into their respective target boxes.

The pair has two distinct directed routes, but their label-to-route association is not independently clear at a glance: both labels occupy the same right-hand gutter. At rows 21–22 the downward lane is column 40, the upward lane column 42, and both labels start at column 44. Using horizontal cell distance from each label's first cell to the lane on the same row gives 4 cells to the downward lane versus 2 to the upward lane for *both* labels. Thus `task in + ctrl gRPC`, although specified for the downward route, is nearer the upward route; the visible geometry alone does not reliably assign these two labels to different routes. Count 2 uncertain label owners. The remaining two labels are positioned against their corresponding lower routes.

The spec pins worker to rank 1, runtime to rank 2, engine and daemon to rank 3. The capture shows those ranks, with left-to-right sibling order `[modal-daemon, Task engine]`, rather than the spec's listed `[engine, daemon]`; check reports 4 pins, 0 conflicts, and automatic within-rank order. Pinning establishes rank, not this sibling order.

Unselected ANSI shows `seams`: worker RGB (115,206,183), daemon (153,219,203), both cyan/teal; `control`: runtime (206,115,138), engine (219,153,170), both pink. There are no group containers, outlines, group titles, or tier markings. All four boxes have complete four-sided borders and corners, consistently colored within each individual border. Their separate selected-state capture shows every border in the selected amber (216,166,87).

## View 2: execution and storage

Five visible nodes and four visible directed routes, not eight nodes in this single view. Across the two views there are nine node occurrences, eight distinct node labels because Task engine occurs in both, and eight edge occurrences.

| Label | Bounds | Kind |
|---|---|---|
| Task engine | [13,26,11,1] | node |
| Container backend | [32,23,17,1] | node |
| Task container | [56,23,14,1] | node |
| Filesystem + volumes | [30,28,20,1] | node |
| Blobnet | [60,28,7,1] | node |
| starts/manages | [14,23,14,1] | edge |
| user process | [46,26,12,1] | edge |
| mount+snapshot | [20,31,14,1] | edge |
| image+volume | [46,31,12,1] | edge |

Routes: Task engine → Container backend, right/up/right, with ▶ at [30,23]; Container backend → Task container right with ▶ at [55,23]; Task engine → Filesystem + volumes right/down/right with ▶ at [28,28]; Filesystem + volumes → Blobnet right with ▶ at [59,28]. Each has an intact arrowhead and a traceable route. No crossing, bridge, touching bend, or actual branch is visible; the two engine routes leave separate side ports. Attachments are on box sides, not corners; side ports need not be at mathematical midpoints, notably the two engine ports.

`user process` sits at row 26 between the two horizontal route bands at rows 23 and 28. Its owner is uncertain in the picture alone: the label is physically nearer the lower band (two rows versus three) and spans space above the lower route and box. The spec associates it with backend → container. Count 1 uncertain owner. `starts/manages`, `mount+snapshot`, and `image+volume` are recognizable against their respective routes, although offset from them. There is no explicit pin array in this spec.

ANSI hue families: `control` Task engine pink (206,115,138); `execution` Container backend and Task container green (115,206,115) and (153,219,153); `storage` Filesystem + volumes and Blobnet yellow-green (183,206,115) and (203,219,153). Each paired group's order is left to right as listed; the one-member control group has no sibling order. There are no group boxes, borders, titles, or tier markings. Every individual box has all sides and corners, with a continuous per-node border color; selected-state ANSI shows all five occurrence borders amber (216,166,87).

## Shape and presentation

V1 is a connected four-node graph with a reciprocal two-route pair and two additional outgoing arrows from the runtime. Runtime has fan width three and receives one arrowhead; worker, daemon, and engine each receive one. V2 is a connected five-node shape with two outward chains sharing the engine, maximum fan width two; no node has two incoming arrows and there is no reciprocal pair. Within either view there are no disjoint worlds; the repeated Task engine label is the visible conceptual link *between* the two separate views, not a drawn cross-view edge. Labels are compact but fairly identifier/qualifier-dense (`gRPC`, `UDS`, `mount+snapshot`); v2 left-to-right chains suggest successive steps, without explicit phase or tier labels. The v1 fan endpoints sit on the same lower rank. This is a structural observation, not a family judgment.

All 9/9 node occurrences have selected borders captured. Both views use 0 dots on every route. The pinned 77×47 captures show three identical frames at 0, 100, and 200 ms, with no dots; origin, spacing, travel direction, corner/bridge/arrowhead contact and synchronized arrival are not applicable. No dot violations observed; check reports 0. The pair of compact views remains intact in those pinned captures with no graph clipping. The pinned viewport lines are `viewport: 77x47 zoom: 1.00 natural`; the 82×51 pane text headers report `82x51 @100%`, while each check says `viewport: unknown zoom: 1.00 natural`. Manifests record pane rows 51 and `viewport_token` 82x51, but null `pane_cols`, `pane_rect`, and `viewport_line`. The graph extents reported are 48×20 and 70×11. No graph item is visibly clipped or requires pan/zoom in either capture; the 77-column v2 header itself ends `q q`, so that UI instruction is clipped. Checks report `crossings: 0 bridges, 0 touching bends` in each view, consistent with no crossings/bridges; the adjacent reciprocal bend glyphs are visually touching even though check classifies them as zero touching bends. No `routes:` line is expected.

## Disclosures and evidence limits

The task states that the generator classified the shape as `family: service-meshes`, with fan-of-three and anti-parallel-pair evidence, no secondary recipe driver, and v2 borrowing chain rhythm. The full classification line and its location are not in the files permitted for this blind stage, so I cannot quote the entire line verbatim or verify its location. The task also discloses one cold-start race and re-capture; recorded neutrally, without treating it as a diagram defect. No authorized capture or spec was unreadable. Generation metadata was not opened because this stage restricts reads to captures and specs; pins above come from the spec and capture, not independently from generation metadata.

## Blind scorecard

| Metric | V1 | V2 | Total / distinction |
|---|---:|---:|---|
| node occurrences | 4 | 5 | 9 (8 distinct labels) |
| directed edges | 4 | 4 | 8 |
| node + edge labels | 8 | 9 | 17 (8 edge labels) |
| group hue families | 2 | 3 | 4 distinct named groups, control shared |
| rank pins shown / conflicts | 4 / 0 | 0 / 0 | 4 / 0 |
| crossings / bridges | 0 / 0 | 0 / 0 | 0 / 0 |
| visually touching adjacent bend clusters | 1 | 0 | 1; checker says 0 touching bends |
| uncertain edge-label owners | 2 | 1 | 3 |
| clipped graph items | 0 | 0 | 0 (77×47 v2 UI header clipped) |
| selected node occurrences | 4/4 | 5/5 | 9/9 |
| dots / observed dot violations | 0 / 0 | 0 / 0 | 0 / 0 |
