# Blind observation — modal-runtime, round 08

Stage A only. Coordinates are 1-based `[column,row,width,height]` in the 83×51 pane text, including its status row; text widths are terminal cells. Node occurrences, not unique node names, are counted. No expectation data or attempt logs were consulted.

## Identity and evidence

Final spec SHA-256 values, each matching its capture manifest:
- v1-return-seams: `f1c33e595f47d09da91681533ff1136c0307018c035f9f7417d2bcac48999463`
- v2-task-intake: `2bdfa72af4b82a7610aae0ba97a103688c617184dd0d04d0d96810ef1c706392`
- v3-dispatch-fan: `18378e04cdc0e90c1345527a397b7bdc42d2a050675f0f22b3fc15909ff2b432`
- v4-data-plane: `186f6bed8cb61e6dd18797e8583c3cda586913712eed6ec08a24e7664cf7e8f3`

All manifests identify binary SHA-256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`, check exit 0, and confirmed pane closure. The family evidence lines, verbatim, are:

```text
groups: orchestration(1) compute(1) storage(1)
groups: compute(2) storage(2)
```

These are check output, not proof of complete visible regions. No separate line explicitly named family appears in the final captures.

## Visible labels and arrows

### v1 return seams

Node labels: `modal-daemon` [52,23,12,1]; `modal-runtime` [21,26,13,1]; `modal-worker` [52,28,12,1]. Edge labels: `HTTP over UDS` [36,24,13,1]; `events+mg RPC` [36,28,13,1]. Both are complete as written in the final spec.

- runtime → daemon: rightward, then up, then right into `▶` at [50,23]; traceable. Label belongs to this route.
- runtime → worker: rightward, then down, then right into `▶` at [50,28]; traceable. Label belongs to this route.

The runtime border is [20,24,15,5], daemon [51,22,14,4], worker [51,27,14,4]; all four sides and rounded corners present. Routes leave distinct runtime border positions. No observed crossings, bridge glyphs, touching bends, junctions or branches.

### v2 task intake

Node labels: `modal-worker` [21,26,12,1]; `modal-runtime` [51,26,13,1]. Edge label: `task+ctrl RPC` [35,27,13,1], complete as written in the final spec.

- worker → runtime: horizontal right into `▶` at [49,26]; traceable and label owner clear.

Worker border [20,25,14,4], runtime [50,25,15,4], all sides and corners present. The anti-parallel worker/runtime relationship is split across v1 and v2; it is not visible as a simultaneous pair in one view. All three abbreviated seam labels above survive verbatim; the captures do not establish the full unabbreviated strings. No crossings, bridge glyphs, touching bends, junctions or branches.

### v3 dispatch fan

Node labels: `modal-runtime` [36,5,13,1]; `Task engine` [37,25,11,1]; `Container backend` [21,46,17,1]; `Filesystem + volumes` [43,46,20,1]. Edge labels: `task dispatch` [38,15,13,1]; `starts/manages` [22,42,14,1]; `mount/snapshot` [41,35,14,1]. Region text: `compute` [22,44,7,1]; `storage` [53,44,7,1]. No `orchestration` title is visible.

- runtime → Task engine: down, short right jog, `▼` at [37,23]; traceable; `task dispatch` is adjacent to its vertical run.
- Task engine → Container backend: down, left, then down to `▼` at [21,44]; traceable, `starts/manages` adjacent to that run.
- Task engine → Filesystem + volumes: down, right, then down to `▼` at [43,44]; traceable, `mount/snapshot` adjacent to that run. Two output runs appear to emerge from the engine but are distinct; no actual shared junction is visible.

Node borders are runtime [35,4,15,4], engine [36,24,13,4], backend [20,45,19,4], filesystem [42,45,22,4]; each has all four sides and four rounded corners. There are extra route/region strokes in or next to boxes, e.g. the vertical stroke in engine and filesystem interior, but the node border itself is complete. No bridge glyphs or route crossings or touching bends observed. Region strokes intersect or overwrite the routes and node vicinity: at row 44 the arrowheads replace parts of the region top boundaries. There is no clearly rendered closed, titled orchestration region: only fragments around engine, no title or corners. The compute and storage titles are visible left-to-right, but neither region has four visible corners or complete sides: storage's left and bottom boundary are interrupted/absent; compute's corners are absent. Both member boxes appear by their respective title, not inside complete rectangles. Region bottom fragments lie at row 49.

### v4 data plane

Node labels: `Container backend` [21,14,17,1]; `Filesystem + volumes` [43,14,20,1]; `Task container` [29,38,14,1]; `Blobnet` [48,38,7,1]. Edge labels: `runs user process` [23,26,17,1]; `image+volume data` [45,26,17,1]. Region text: `compute` [22,12,7,1]; `storage` [48,12,7,1].

- Container backend → Task container: down then right then `▼` at [29,36]; traceable, label adjacent to vertical route.
- Filesystem + volumes → Blobnet: down then right then `▼` at [48,36]; traceable but vertical route sits directly alongside region strokes; its label is adjacent. The source's interior has additional vertical strokes.

Node borders backend [20,13,19,4], filesystem [42,13,22,4], container [28,37,16,4], Blobnet [47,37,9,4]: four complete sides and corners each. Region titles appear compute then storage. The visible region strokes form adjoining/overlapping top and bottom runs, but do not show four corners for either region; interior boundary strokes are crowded with the routes, and the putative membership boundaries are not cleanly distinguishable as two closed titled rectangles. No bridge glyph, route crossing or touching bend observed; region/route adjacency can look like junctions but check reports none.

## Border color and selected states

ANSI cell audit of all 13 node border occurrences: each complete border has one continuous foreground color. Normal-state border RGBs, in the node order listed above, are v1 `(216,166,87)`, `(125,174,163)`, `(147,194,183)` for runtime, daemon, worker; v2 `(216,166,87)`, `(125,174,163)`; v3 `(216,166,87)`, `(125,160,184)`, `(211,134,155)`, `(125,160,184)`; v4 `(211,134,155)`, `(125,160,184)`, `(226,156,175)`, `(151,184,206)`. In each `--select-all` ANSI capture, every border cell of every node occurrence is `(216,166,87)`: selected coverage **13/13**. Region border continuity is not established by node-border color; the region shapes are incomplete as described above.

## Motion, fit and reporting

Specs declare no flows or dots. Checks report `dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms`, `origins: 0/0 routes start at their arrow origin`, and `arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step`. No flow-dot glyphs appear on routes in the recorded frames. The status header contains typographic `·` separators; these are not route dots. Dot spacing, direction, corner/bridge/arrowhead occupancy, origin and simultaneous arrival are not applicable.

Despite the bundle description saying five frames, every manifest and capture actually contains **three** frames, at 0, 100 and 200 ms; the two additional frames are missing. In all four 77×47 pinned files, the three frame bodies are byte-identical. The 83×51 evidence frame bodies, compared as their first 51 lines, are also byte-identical in both text and ANSI; the last frame in each evidence file is followed by extra captured shell prompt bytes, so splitting the whole file at frame headers without bounding the body produces unequal last segments.

Each check says `viewport: unknown zoom: 1.00 natural`. Frame captures say `viewport: 83x51 zoom: 1.00 natural`; pinned captures say `viewport: 77x47 zoom: 1.00 natural`. Manifest pane columns and viewport line are null; header token is `83x51 @100%`. Check extents v1 56×9, v2 56×4, v3 57×47, v4 57×30. The node labels and borders are visible at both sizes, but v3's incomplete regions and missing orchestration title are visible at both; header command text is truncated at 77 columns. No diagram node or edge is visibly clipped or requires pan/zoom in these captures; missing region title/boundaries are a distinct visible loss, and these captures cannot prove whether panning would recover them. Check reports `crossings: 0 bridges, 0 touching bends` for each, consistent with observed route crossings. No notable route loops; v3 has long vertical runs and small jogs. No pins-conflict line appears; final specs do not declare minlen or pins, so rank-gap and pin-conflict behavior cannot be assessed.

## Blind scorecard

- Visible node occurrences: **13** (3 + 2 + 4 + 4).
- Visible arrows/edges: **8** (2 + 1 + 3 + 2), all arrowheads visible and all routes traceable, though v4 is crowded against region strokes.
- Visible graph labels: **25** = 13 node labels + 8 edge labels + 4 region titles. The declared orchestration title is not visible. UI labels/status excluded.
- Route crossings/bridges/touching bends: **0 / 0 / 0** observed; region strokes overlap/obscure boundary segments as described.
- Uncertain edge-label owners: **0**.
- Clipped node/edge items: **0 observed**; **1 declared region title absent**, and declared region outlines incomplete; 77-column status text truncated.
- Selected-state coverage: **13/13** node occurrences.
- Dot violations observed: **0**, with **0 animated routes**.
- Missing evidence: frames 3 and 4 of the requested five; manifest pane columns and viewport line. All supplied capture formats were readable.
