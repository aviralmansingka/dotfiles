# Modal runtime — blind observation, stage A

Evidence read: final v1/v2 specs, their 83×51 text and ANSI captures, select-all ANSI, frame and 77×47 captures, check outputs, manifests, and generation.json. No source, expected data, rubric, earlier round, or new viewer session was used. Coordinates below are 1-based screen character positions in the 83×51 plain-text captures, including the header row; each is [column,row,width,height], for visible text rather than the enclosing box. Widths are character cells.

## Visible graph labels

| View | Label, verbatim | [column,row,width,height] |
|---|---|---|
| v1 | `Task engine` | [53,23,11,1] |
| v1 | `events + mgmt gRPC` | [28,23,18,1] |
| v1 | `dispatch tasks` | [35,24,14,1] |
| v1 | `modal-runtime` | [20,27,13,1] |
| v1 | `modal-worker` | [52,29,12,1] |
| v1 | `task input + ctrl gRPC` | [24,31,22,1] |
| v2 | `Task engine` | [28,17,11,1] |
| v2 | `modal-runtime` | [44,17,13,1] |
| v2 | `starts / manages` | [16,22,16,1] |
| v2 | `mounts / snapshots` | [26,24,18,1] |
| v2 | `fs HTTP over UDS` | [47,24,16,1] |
| v2 | `Container backend` | [14,26,17,1] |
| v2 | `Filesystem + vols` | [36,26,17,1] |
| v2 | `modal-daemon` | [58,26,12,1] |
| v2 | `image + volume data` | [46,30,19,1] |
| v2 | `runs user process` | [18,32,17,1] |
| v2 | `Task container` | [29,34,14,1] |
| v2 | `Blobnet` | [48,34,7,1] |

The header is ` rataflow-view · 83x51 @100% · v1.json · 3 nodes · 3 edges · q quit` or the corresponding v2 header ` rataflow-view · 83x51 @100% · v2.json · 7 nodes · 5 edges · q quit`, both at [1,1,68,1] (including leading space); the bottom-left control box contains ` + [+]`, ` − [-]`, ` ⊡ [f]`, ` □ [i]` at [3,46,6,1], [3,47,6,1], [3,48,6,1], [3,49,6,1]. These are UI text, not graph labels.

## Arrows and legibility

All eight routes are solid and have an explicit, visible arrowhead. Routes themselves can be followed end to end without guessing, though label assignment in v1 is problematic as noted below. Head directions describe the last segment, not an implied semantic direction.

- v1 worker → runtime: the route leaves worker's left border, bends up and runs left into `◀` on runtime's right border; traceable. Spec label: `task input + ctrl gRPC`.
- v1 runtime → worker: leaves runtime right border, runs right and bends down into `▶` on worker's left border; traceable. Spec label: `events + mgmt gRPC`.
- v1 runtime → Task engine: leaves runtime right border, runs right, bends up and into `▶` on engine's left border; traceable. Spec label: `dispatch tasks`.
- v2 Task engine → Container backend: two bends, final `▼`, traceable; `starts / manages`.
- v2 Task engine → Filesystem + vols: two bends, final `▼`, traceable; `mounts / snapshots`.
- v2 modal-runtime → modal-daemon: two bends, final `▼`, traceable; `fs HTTP over UDS`.
- v2 Container backend → Task container: two bends, final `▼`, traceable; `runs user process`.
- v2 Filesystem + vols → Blobnet: two bends, final `▼`, traceable; `image + volume data`.

The v1 pair's label placement is visually misleading: `events + mgmt gRPC` is above the dispatch lane, whereas `task input + ctrl gRPC` is below and nearest the outgoing runtime → worker lane. Their intended owners are identifiable from the spec, not reliably from placement alone; both pair labels have uncertain visual ownership, despite the check reporting 0 ambiguous owners. `dispatch tasks` is close to its lane, but the extra label above that lane makes the area crowded. In v2 `mounts / snapshots`, `fs HTTP over UDS`, and `runs user process` end directly against their `▼` glyphs; all three are readable but have no intervening blank cell. The other v2 labels are associated by proximity with distinct routes.

No crossings, bridge glyphs, route-to-route touching bends, junction glyphs, or route branches are visible in either view; check agrees: each reports `crossings: 0 bridges, 0 touching bends`. Two outgoing engine routes occupy separate adjacent ports, not a branching glyph. Their regular corner bends do not touch. No route crosses a label cell per check: 3/3 and 5/5 placed, 0 skipped and 0 on route cells.

## Groups, ranks, borders, selection

ANSI normal-state colors establish individual continuous border colors, not just plain text. Every node occurrence has four intact sides and all four rounded corners, with a continuous single color around its own border. v1: runtime RGB (206,115,138), Task engine (219,153,170), worker (183,206,115). v2: runtime (206,115,138), Task engine (219,153,170), Container backend (115,161,206), Task container (153,186,219), Filesystem + vols (183,206,115), Blobnet (203,219,153), modal-daemon (206,161,115). Routes are muted (124,111,100). Selected ANSI shows all ten node occurrences with complete amber (216,166,87) selected borders simultaneously: selected-state coverage 3/3 and 7/7, 10/10 total, rather than ten separate individual selection frames.

Declared group membership: orchestration = runtime and Task engine (pink family in both views, with the same individual shades); worker-plane = worker in v1 and daemon in v2 (green in v1, orange in v2, so the group does not preserve one common hue across these views); compute = backend and container (blue shades in v2); storage = filesystem and Blobnet (green shades in v2). Thus v1 has 2 declared groups and v2 4; 4 distinct declared names overall, but the worker-plane hue varies between views and green also appears for storage. Engine precedes runtime visually in both captures (above in v1; left in v2); compute and storage members appear at different depths, not a common sibling rank. No drawn group boundary, enclosing box, group title, tier label, or tier hue band is visible beyond the node borders. No source-named tiers can be established from the permitted captures.

No rank pins are declared in either final spec or identified in generation.json; pinned ranks: 0. Actual rows: v1 engine label row 23, runtime 27, worker 29; v2 engine/runtime row 17, backend/filesystem/daemon row 26, container/Blobnet row 34. These are observed screen positions, not evidence of rank constraints.

## Shape, classification and fit

v1 contains 3 nodes and 3 directed edges, one pair connected both ways by two separate routes, and widest outgoing fan 2 from runtime. v2 contains 7 nodes and 5 directed edges, widest outgoing fan 2 from Task engine, no opposite-direction pair, and two disconnected components: a five-node engine/compute/storage component and a two-node runtime/daemon component. Neither view has a node receiving arrowheads from two separate routes. Across views, repeating runtime and Task engine visually joins those components through the v1 runtime → engine edge; this join is not drawn in v2. Across the two views there are 10 node occurrences, 8 distinct node names and 8 edges; widest combined outgoing fan is 3 from runtime. v2 shows two downward two-hop chains and one downward one-hop seam, which has a phase-like top-to-bottom order; v1 is primarily a horizontal pair with an upper third destination. Labels contain service identifiers, payloads, abbreviated terms and explicit `gRPC` / `HTTP over UDS` protocol qualifiers; they are moderately dense rather than addresses or port numbers.

Generator classification in generation.json, step0_classification, verbatim:

`family: service-meshes`

`evidence: one core (modal-runtime) carries a fan of three out-relations (dispatches tasks, fs HTTP over UDS, events + management RPCs) and an anti-parallel pair worker -> runtime / runtime -> worker stated as two distinct relations.`

Checks report v1 extent 57×11, v2 58×21; both checks say `viewport: unknown zoom: 1.00 natural`. Live text headers say 83×51 at 100%; pinned dumps say `viewport: 77x47 zoom: 1.00 natural`. Both complete graphs and UI controls are visible at both sizes, with no observed clipping, hidden items or need to pan/zoom. Both manifests report cleanup confirmed_closed. The supplied generator describes 11 whole-graph/merged-seam probes plus one extra related variant; these are its claims, not independently verified in this stage-A record. Its stated reason for splitting is bridges, ambiguous labels or overflow in those attempts; the final captures alone do not establish impossibility of a cleaner combined view.

## Motion and evidence limits

Static: no flow routes or dots are declared in either spec or visible on any captured route. Four 83×51 text frame payloads per view at 0, 100, 200, 300 ms compare byte-identically after excluding timestamp metadata. Dots per route per frame = 0; spacing, direction, corner/bridge/head occupancy, frame-0 origin, and synchronized arrival are not applicable. Checks show 0 dot violations, 0/0 origins, and 0/0 arrivals. Pinned 77×47 evidence supplies three identical-looking frames per view, not four.

No evidence format used here was unreadable. The captures do not prove behavior outside the observed frames, individual selection transitions, source-level coverage, or that all possible merged layouts fail. Frame payload equality does not mean the full files including timestamp headers are byte-identical.

## Tool-usable blind scorecard

```json
{"v1":{"visible_nodes":3,"visible_edges":3,"node_labels":3,"edge_labels":3,"declared_groups":2,"observed_group_hue_families":2,"rank_pins":0,"bridges":0,"touching_bends":0,"visually_uncertain_label_owners":2,"checker_ambiguous_label_owners":0,"clipped_items":0,"selected_occurrences":3,"node_occurrences":3,"dot_violations":0},"v2":{"visible_nodes":7,"visible_edges":5,"node_labels":7,"edge_labels":5,"declared_groups":4,"observed_group_hue_families":4,"rank_pins":0,"bridges":0,"touching_bends":0,"visually_uncertain_label_owners":0,"checker_ambiguous_label_owners":0,"clipped_items":0,"selected_occurrences":7,"node_occurrences":7,"dot_violations":0},"total":{"node_occurrences":10,"distinct_node_labels":8,"visible_edges":8,"graph_label_occurrences":18,"distinct_declared_groups":4,"rank_pins":0,"bridges":0,"touching_bends":0,"visually_uncertain_label_owners":2,"clipped_items":0,"selected_occurrences":10,"dot_violations":0,"animated_routes":0}}
```
