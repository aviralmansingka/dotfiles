# Round 09 — modal-runtime — blind observation, stage A

Coordinates are 1-based [column,row,width,height], measured in the 82×51 text captures, not in the differently centered pinned dumps. Graph labels are separate from interface labels. Counts distinguish node occurrences across views from unique node names. The source and expectations were not consulted.

## Visible labels

| View | Node labels | Edge labels |
|---|---|---|
| v3 | `modal-runtime` [35,19,13,1]; `modal-worker` [36,32,12,1] | `task+ctrl gRPC` [44,22,14,1]; `events+mgmt gRPC` [43,23,16,1] |
| v4 | `modal-runtime` [36,14,13,1]; `modal-daemon` [28,37,12,1]; `Task engine` [45,37,11,1] | `HTTP over UDS` [23,25,13,1]; `dispatches tasks` [40,25,16,1] |
| v5 | `Task engine` [37,5,11,1]; `Container backend` [21,26,17,1]; `Filesystem + volumes` [43,26,20,1]; `Task container` [29,47,14,1]; `Blobnet` [48,47,7,1] | `start/manage` [23,22,12,1]; `mount/snapshot` [41,15,14,1]; `runs user proc` [23,36,14,1]; `image/vol data` [45,36,14,1] |

Generator specifically identifies the two abbreviated v5 labels `runs user proc` and `image/vol data`; the other two v5 action labels are also terse. All graph labels are legible in the 82×51 captures and pinned dumps.

Interface headers: v3 `rataflow-view · 82x51 @100% · v3-seam-pair.json · 2 nodes · 2 edges · q quit` [2,1,76,1]; v4 `rataflow-view · 82x51 @100% · v4-core-fan.json · 3 nodes · 2 edges · q quit` [2,1,75,1]; v5 `rataflow-view · 82x51 @100% · v5-engine-tree.json · 5 nodes · 4 edges · q quit` [2,1,78,1]. In each 82×51 capture, controls `+ [+]` [4,46,5,1], `− [-]` [4,47,5,1], `⊡ [f]` [4,48,5,1], `□ [i]` [4,49,5,1].

## Routes and ownership

- v3 worker → runtime: from worker left side [35,32], left to bend [32,32], up column 32 to [32,19], right-pointing `▶` [33,19] into runtime left side [34,19]. Whole route traceable, no arrowhead missing.
- v3 runtime → worker: from runtime bottom at [35,21], down column 35 to bend [35,29], right to [36,29], downward `▼` [36,30] into worker top [36,31]. Whole route traceable, no arrowhead missing. These are two distinct opposing routes, not a bidirectional glyph; both specs have `minlen: 2` and `label_slot: true`.
- v3 ownership is **visually uncertain for both labels**: the stack at rows 22–23 is separated by blank cells from both vertical runs (columns 32 and 35), with no leader or marked association. The spec assigns `task+ctrl gRPC` to worker → runtime and `events+mgmt gRPC` to runtime → worker, but a reader cannot determine that assignment confidently from proximity or vertical ordering alone. Check reports 0 ambiguous owners; that differs from this observation.
- v4 runtime → daemon: exits bottom at column 36, runs down to [36,34], turns left to [28,34], `▼` [28,35] into daemon top. `HTTP over UDS` touches the column-36 run; route and owner traceable.
- v4 runtime → engine: exits bottom at column 38, runs down to [38,34], turns right to [45,34], `▼` [45,35] into engine top. `dispatches tasks` is immediately right of this run; route and owner traceable. These are **two** separate outgoing ports and arrowheads in this view, not a three-edge fan in one capture. The third outgoing relation to worker is in v3.
- v5 engine → backend: exits column 37, descends to [37,23], turns left to [21,23], `▼` [21,24] into backend; `start/manage` sits by the run. Engine → filesystem: exits column 39, descends to [39,23], turns right to [43,23], `▼` [43,24] into filesystem; `mount/snapshot` is beside the run. Separate ports and arrowheads.
- v5 backend → container: exits column 21, descends to [21,44], turns right to [29,44], `▼` [29,45] into container; `runs user proc` is adjacent. Filesystem → Blobnet: exits column 43, descends to [43,44], turns right to [48,44], `▼` [48,45] into Blobnet; `image/vol data` is adjacent. Both routes and labels are traceable.

All eight arrowheads are present. No visible bridge, crossing, touching bend, junction, or apparent shared branch in any view; each fork comprises separate neighboring routes. `check.txt` independently reports `crossings: 0 bridges, 0 touching bends` for each, and 0 edge-label route cells and 0 skipped. Its 0 ambiguous count is a machine result, not a guarantee of the v3 human-readable association.

## Boxes, groups, ranks and color

All ten node occurrences have complete four-sided rounded borders with all four corners and consistent color along each individual border in the unselected ANSI. Box rectangles [column,row,width,height]: v3 runtime [34,18,15,4], worker [35,31,14,4]; v4 runtime [35,13,15,4], daemon [27,36,14,4], engine [44,36,13,4]; v5 engine [36,4,13,4], backend [20,25,19,4], filesystem [42,25,22,4], container [28,46,16,4], Blobnet [47,46,9,4]. Arrowheads lie outside rather than replacing box borders. Selected ANSI shows a bold gold RGB(216,166,87) border on all 10/10 occurrences, not just their labels.

Declared groups are logical tags, not enclosing shapes: no group box, border, title, or tier-name text appears, as intended. ANSI border hues:
- `compute`: worker and backend RGB(211,134,155), container RGB(226,156,175), all pink family.
- `orchestration`: runtime RGB(125,160,184); engine RGB(151,184,206) in v4 and RGB(125,160,184) in v5, blue family.
- `storage`: daemon and filesystem RGB(125,160,184), Blobnet RGB(151,184,206), blue family.

Thus three declared groups correspond to only **two visibly distinguishable hue families**: orchestration and storage overlap exactly in RGB, so color alone cannot distinguish those tiers. Individual shade assignment also changes for engine between views. Compute and storage members in v5 maintain their left/right path order from middle to bottom rank; orchestration runtime above engine in v4. Other sibling order cannot be compared across repeated views because sibling sets differ. No separate tier label line or band is shown; borders are the only group-related markings. No rank pins are declared in the final specs or stated in `generation.json`: 0 pinned ranks to verify. Actual ranks: v3 runtime above worker; v4 runtime above daemon and engine; v5 engine above backend/filesystem above container/Blobnet.

## Structure, fit, motion

Per view v3 has 2 nodes/2 directed edges; v4 3/2; v5 5/4. Together they display 10 node occurrences, 8 unique names and 8 unique relations. The widest visible single-view outgoing fan has width 2 (v4 runtime, v5 engine). Across views, runtime has 3 outgoing relations to worker, engine and daemon; the worker/runtime pair is anti-parallel with one route each way. Worker receives one arrowhead and runtime receives one; no box in any capture receives two separate arrowheads. Joining repeated runtime and engine names yields a connected composite, with compute and storage paths rather than independent worlds or a shared bus. Labels contain short module names, RPC protocol abbreviations and action qualifiers, not dense address identifiers. Vertical ranks read as dependency/hop layout, not explicitly named phases.

Live text headers show 82×51 at 100%; checks say `viewport: unknown zoom: 1.00 natural` and extents v3 37×17, v4 41×27, v5 55×46. Pinned dumps each say `viewport: 77x47 zoom: 1.00 natural`, show five frames, their final spec name, complete graph content, no overflow banner and no graph pan/zoom requirement. v5 has only one row of graph-height slack. **Pinned v5 header is clipped**: `... · q qu` rather than `... · q quit`; two terminal characters `it` are missing. This is one clipped UI label, not a clipped node, route or graph label; pinned v3/v4 headers are intact.

Five captured drawing frames per view, at 0/100/200/300/400 ms, are identical; pinned frames are also identical. Zero dots visible on all routes in every frame; all specs specify `dots: 0`. Checks report 0 single-dot, 0 periodic and 0 violations; origins and arrivals 0/0. Dot spacing, direction, origin, simultaneous arrival and dots on corners/bridges/arrowheads are not applicable, not verified motion. The generator states the source never shows motion; that source was not inspected.

## Generator statements, provenance and budget

`generation.md`, `Step 0 — family first`, verbatim:

```text
family: service-meshes
evidence: modal-runtime is the core with a fan of three seams (worker gRPC: task
          input + control RPCs and events + management RPCs; task dispatch to the
          engine; filesystem HTTP over UDS to modal-daemon), and
          worker -> runtime / runtime -> worker is an anti-parallel pair of RPC
          relations between the same two boxes.
```

Its tie-breaker 1 states verbatim: `Fan plus anti-parallel pair is the mesh signature, and the candidate skill's own family table lists modal-runtime under service-meshes.` This is the generator's claim; the skill table was not independently read. The three-edge composite fan is split between v3 and v4.

`attempts.json` discloses 20 recorded `--check` runs: six associated with the shipped view lines (3/2/1), plus 14 in `abandoned_shapes` (4 whole-graph, 6 core-seam-with-fan, 4 paths). Generator calls this a budget overrun. This records the disclosure neutrally, not an independent audit of the raw logs.

SHA-256 duplicate-spec comparison: v3 `f2484f0a664a4a9081b9ed624518bbb775006fe4c62e6318ffbc387a28a84f72`; v4 `93c8066a4ccfb77a141084f1d13d3a45cde000ffbbae71597c4367a835f0449d`; v5 `f1ae35dd1dbd819a07e931c72ee7962353f36bb7d1ee56258d060d44b738855d`; each final spec matches its respectively named duplicate byte-for-byte by hash.

## Blind scorecard

| Metric | v3 | v4 | v5 | Total / note |
|---|---:|---:|---:|---|
| node occurrences | 2 | 3 | 5 | 10; 8 unique |
| edges / arrowheads | 2 / 2 | 2 / 2 | 4 / 4 | 8 / 8 |
| node / edge labels | 2 / 2 | 3 / 2 | 5 / 4 | 10 / 8 |
| declared groups / visually distinct hue families | 2 / 2 | 2 / 1 | 3 / 2 | 3 / 2 overall |
| rank pins | 0 | 0 | 0 | 0 |
| bridges / touching bends | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| human-uncertain edge-label owners | 2 | 0 | 0 | 2; machine check says 0 |
| graph items clipped | 0 | 0 | 0 | 0; pinned v5 has 1 clipped UI header |
| selected node occurrences | 2/2 | 3/3 | 5/5 | 10/10 |
| dots / reported dot violations | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0; motion metrics N/A |

Evidence limitations: no missing or unsupported format encountered among the files examined. Color conclusions derive from ANSI, not plain text; no source, rubric, expected data, manifest, validator outputs, rejected-draft records or new viewer runs were consulted in this stage.
