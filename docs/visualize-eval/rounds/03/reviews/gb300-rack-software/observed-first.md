# Blind observation — round 03 / gb300-rack-software / stage A

Judge: independent Sol. This record uses only the final `specs/v1.json`, `specs/v2.json` and supplied captures/checks/manifests under `evidence/v1/` and `evidence/v2/`. No source, expectations, rubric, dataset manifest, other case, earlier round, or implementation source was consulted. No viewer session was launched. This file is the immutable stage-A record; its SHA-256 is reported separately after saving.

## Coordinate and counting conventions

All coordinates are 1-based screen cells in the supplied 77-column × 47-row grids, including the title row. Label rectangles are `[column,row,width,height]`, with no surrounding whitespace. Routes use `(column,row)` points. A polyline lists its visible first cell, all its bends, and its arrowhead; straight intermediate cells are implicit. Node rectangles include their borders.

“Visible edges” counts distinct source-to-target arrows, including each trunk destination. It is not the title's ordinary-edge count. Diagram labels count node labels and route-label occurrences, not UI chrome. Crossings mean geometric overpasses between independent routes; declared shared-bus junctions are counted separately. Label-owner uncertainty is a perceptual finding, not uncertainty about what the JSON declares.

## Fit and evidence limits

Both normal ANSI grids and both selected ANSI grids decode to exactly **77 × 47 cells**. The text files omit right-hand blanks and the final blank row; their displayed positions agree with the ANSI grids. The five captured frame grids per view likewise have 47 rows. Both titles show `77x47 @100%`.

Each frame transcript contains `viewport: 77x47 zoom: 1.00 natural` three times, for the ordinary, selected, and frame commands. Each check file instead begins `viewport: unknown zoom: 1.00 natural`. The manifests have `pane_cols: null`, `pane_rect: null`, `pane_rows: 47`, and `viewport_line: null`; thus no independent pane-column measurement or populated manifest viewport line is available. The captured viewport line and grid dimensions are available and agree.

- v1 check extent: `59x31 cells`; `crossings: 3`; `labels: 6/6 placed, 0 on route cells, 0 skipped`.
- v2 check extent: `33x37 cells`; `crossings: 0`; `labels: 5/5 placed, 0 on route cells, 0 skipped`.
- All observed nodes, route labels, route segments and arrowheads fit at 100%. No item is visibly clipped, hidden by the controls, or dependent on pan/zoom to read. v2's Fabric Mgr box shares rows with the controls but is horizontally separate.
- The v1 check's three crossings are not three visible overpasses: I see **one bridge/overpass and two bus junctions**. I preserve these counts separately rather than assume how the check counts them.

## v1 — visible labels

### Node labels

| Verbatim label | Label rectangle |
|---|---|
| `nv-rms` | `[13,11,6,1]` |
| `OOB LAN` | `[13,20,7,1]` |
| `Compute BMC` | `[11,29,11,1]` |
| `NVSwitch BMC` | `[28,29,12,1]` |
| `Power shelf` | `[46,29,11,1]` |
| `NVOS` | `[63,29,4,1]` |
| `NMX-C/T` | `[13,37,7,1]` |

### Route labels

| Verbatim label | Label rectangle | What it sits beside |
|---|---|---|
| `NVUE REST+gRPC` | `[34,14,14,1]` | Above the long top-right horizontal run at row 15 leading to NVOS. |
| `Redfish/HTTPS` | `[25,16,13,1]` | Between that row-15 NVOS run and the row-17 run leading to Power shelf. Its proximity alone does not identify which of those parallel routes owns it. The JSON assigns it to nv-rms → Power shelf. |
| `client on LAN` | `[15,18,13,1]` | Immediately right of the downward arrow at `(13,18)` entering OOB LAN. |
| `OOB drops` | `[26,24,9,1]` | Above the middle of the long shared bus at row 25. |
| `Redfish/HTTPS` | `[14,27,13,1]` | Immediately right of the OOB-bus arrow into Compute BMC at `(13,27)`, and between that arrow and the NVSwitch BMC bus arrow at `(28,27)`. The separate nv-rms → Compute BMC arrow is farther left at `(11,27)`. This is an uncertain/misleading owner placement despite the JSON assigning the label to that separate nv-rms route. |
| `hosts NMX-C/T` | `[32,33,13,1]` | Above the long leftward horizontal run at row 34 from NVOS toward NMX-C/T. |

There are 13 diagram-label occurrences in v1 (7 node + 6 route); `NMX-C/T` inside `hosts NMX-C/T` is not an additional independent label.

### UI labels

| Verbatim label | Label rectangle |
|---|---|
| `rataflow-view · 77x47 @100% · v1.json · 7 nodes · 5 edges · q quit` | `[2,1,66,1]` |
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

## v1 — every visible arrow and route

All eight target arrows are intact `▼`, pointing downward into the target's top edge on the next row. No reverse/source arrowheads are visible. All routes can be followed geometrically; label attribution is a separate issue noted above.

| Source → target | Visible route / arrowhead | Direction and traceability |
|---|---|---|
| nv-rms → OOB LAN | `(15,14) → (15,17) → (13,17) → (13,18)` | Down, left, down; complete and traceable. |
| nv-rms → Compute BMC | `(13,14) → (13,16) → (10,16) → (10,26) → (11,26) → (11,27)` | Down, left, down, right, down; complete and traceable, separate from the trunk arrow at column 13. |
| nv-rms → Power shelf | `(17,14) → (17,17) → (46,17) → (46,27)` | Down, right, down; the vertical run crosses the bus at `(46,25)`, with the bus drawn as a bridge there. Traceable using that bridge convention. |
| nv-rms → NVOS | `(19,14) → (19,16) → (20,16) → (20,15) → (63,15) → (63,27)` | Down, short right/up jog, right, down; complete. The compact jog is crowded but not a branch. |
| OOB LAN → Power shelf | Shared stem `(13,23) → (13,25)`, then bus right to `(48,25)`, then `(48,27)` | Down, right, down; complete, with two intermediate bus branches and the bridge at column 46. |
| OOB LAN → Compute BMC | Same stem and bus through `(16,25)`, then `(16,26) → (13,26) → (13,27)` | Downstream of the first bus junction; complete and traceable. |
| OOB LAN → NVSwitch BMC | Same stem and bus through `(34,25)`, then `(34,26) → (28,26) → (28,27)` | Downstream of the second bus junction; complete and traceable. |
| NVOS → NMX-C/T | `(63,32) → (63,34) → (13,34) → (13,35)` | Down, left, down; complete and traceable. |

The title's `5 edges` excludes the trunk's three visible target arrows. There are eight visible arrows in total.

### v1 crossings, junctions, touching bends and apparent branches

- **One visible crossing:** `(46,25)` is `⌒`. The OOB bus runs horizontally across the vertical nv-rms → Power shelf route. Vertical `│` is visible above and below the bridge. This reads as an overpass, not a connection.
- **Two actual junction glyphs:** `┬` at `(16,25)` and `(34,25)`. Each feeds its own downward branch, to Compute BMC and NVSwitch BMC respectively. The bus continues right to Power shelf.
- The OOB bus is one continuous shared horizontal run, but it does **not** read as one single split point. It reads as **two spatially separated splits/taps plus a final downward end**, yielding three destinations. The crossing's `⌒` is not a third junction.
- The nv-rms → NVOS route has adjacent `╰╯` at `(19,16)` and `(20,16)`, with `╭` immediately above at `(20,15)`. These are a tight U-shaped jog on the same route, not an independent-route connection.
- The nv-rms → Compute BMC route has adjacent `╰╮` at `(10,26)` and `(11,26)`, a one-cell rightward jog on the same route, not a branch.
- The independent nv-rms → Power shelf and trunk → Power shelf routes descend at columns 46 and 48, with a blank column between them. Their arrowheads remain distinct.
- Every remaining non-box bend is covered by the route polylines above: client route `(15,17)/(13,17)`; Compute route `(13,16)/(10,16)`; Power route `(17,17)/(46,17)`; NVOS route `(63,15)`; trunk `(13,25)/(48,25)`, Compute branch `(16,26)/(13,26)`, NVSwitch branch `(34,26)/(28,26)`; and NMX route `(63,34)/(13,34)`. No other crossing, bridge, junction, or independent-route touching bend is visible.

## v2 — visible labels

### Node labels

| Verbatim label | Label rectangle |
|---|---|
| `Kubernetes` | `[26,8,10,1]` |
| `GPU Operator` | `[25,16,12,1]` |
| `DCGM` | `[29,24,4,1]` |
| `dcgm-exporter` | `[24,32,13,1]` |
| `Driver+CUDA` | `[43,32,11,1]` |
| `Fabric Mgr` | `[26,40,10,1]` |

### Route labels

| Verbatim label | Label rectangle | What it sits beside |
|---|---|---|
| `runs on K8s` | `[28,12,11,1]` | Right of the Kubernetes → GPU Operator vertical route. |
| `DaemonSet` | `[27,20,9,1]` | Right of the GPU Operator → DCGM vertical route, above its rightward bend. |
| `NVML (local)` | `[32,28,12,1]` | Immediately right of the DCGM → Driver+CUDA vertical stem at column 31 and above its rightward run. |
| `Prometheus :9400` | `[26,30,16,1]` | Between the two downward arrows at columns 24 and 43. There is one blank cell between the label and each arrow. This can be read as labeling either nearby target route; the JSON assigns it to DCGM → dcgm-exporter. Owner uncertain from proximity alone. |
| `hosts FM?` | `[31,36,9,1]` | Above the dashed leftward horizontal run at row 37, left of its dashed vertical stem at column 43. It clearly belongs to Driver+CUDA → Fabric Mgr. The question mark is visible. |

There are 11 diagram-label occurrences in v2 (6 node + 5 route).

### UI labels

| Verbatim label | Label rectangle |
|---|---|
| `rataflow-view · 77x47 @100% · v2.json · 6 nodes · 5 edges · q quit` | `[2,1,66,1]` |
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

## v2 — every visible arrow and route

All five target arrows are intact downward `▼`, directly above their target boxes; no source/reverse arrows are visible. All five routes are traceable without guessing their geometry.

| Source → target | Visible route / arrowhead | Direction/style |
|---|---|---|
| Kubernetes → GPU Operator | `(26,11) → (26,13) → (25,13) → (25,14)` | Down, short left jog, down; solid. |
| GPU Operator → DCGM | `(25,19) → (25,21) → (29,21) → (29,22)` | Down, right, down; solid. |
| DCGM → dcgm-exporter | `(29,27) → (29,29) → (24,29) → (24,30)` | Down, left, down; solid. |
| DCGM → Driver+CUDA | `(31,27) → (31,29) → (43,29) → (43,30)` | Down, right, down; solid. |
| Driver+CUDA → Fabric Mgr | `(43,35) → (43,37) → (26,37) → (26,38)` | Down, left, down; visibly dashed straight segments. |

For `hosts FM?`, the stem cells `(43,35)` and `(43,36)` are `╎`; horizontal cells `(27..42,37)` are `╌`. Its bends are solid curved glyphs `╯` at `(43,37)` and `╭` at `(26,37)`, and its arrowhead `(26,38)` is solid `▼`. Thus the uncertainty style is clearly visible along both straight orientations, while the corners and head themselves are not dashed.

There are **zero** visible crossings, bridges, or junction glyphs in v2. DCGM's outgoing routes have separate ports, columns 29 and 31, rather than a shared junction. The adjacent `(25,13) ╭` and `(26,13) ╯` form a short bend on one route, not a branch or contact with another route. All other non-box bends are the coordinates listed in the five polylines; no extra touching bends are visible.

## Borders and selected-state coverage

Each listed node has all four complete sides and all four complete rounded corners (`╭`, `╮`, `╰`, `╯`). All top/bottom cells are continuous horizontal glyphs between the corners; both vertical sides are complete on both interior rows. No arrowhead or route cell overwrites a node border. ANSI inspection confirms that **every perimeter cell of each individual node has one consistent RGB foreground** in its normal capture. This is color evidence, not an inference from plain text.

| View | Node | Border rectangle | Normal perimeter RGB | Complete sides/corners; color-continuous |
|---|---|---|---|---|
| v1 | nv-rms | `[12,10,9,4]` | `(216,166,87)` | Yes; yes |
| v1 | OOB LAN | `[12,19,9,4]` | `(125,174,163)` | Yes; yes |
| v1 | Compute BMC | `[10,28,13,4]` | `(147,194,183)` | Yes; yes |
| v1 | NVSwitch BMC | `[27,28,14,4]` | `(99,151,141)` | Yes; yes |
| v1 | Power shelf | `[45,28,13,4]` | `(168,211,200)` | Yes; yes |
| v1 | NVOS | `[62,28,6,4]` | `(211,134,155)` | Yes; yes |
| v1 | NMX-C/T | `[12,36,9,4]` | `(226,156,175)` | Yes; yes |
| v2 | Kubernetes | `[25,7,12,4]` | `(216,166,87)` | Yes; yes |
| v2 | GPU Operator | `[24,15,14,4]` | `(228,184,111)` | Yes; yes |
| v2 | DCGM | `[28,23,6,4]` | `(200,147,68)` | Yes; yes |
| v2 | dcgm-exporter | `[23,31,15,4]` | `(239,202,138)` | Yes; yes |
| v2 | Driver+CUDA | `[42,31,13,4]` | `(177,136,71)` | Yes; yes |
| v2 | Fabric Mgr | `[25,39,12,4]` | `(125,174,163)` | Yes; yes |

The selected captures preserve every perimeter glyph and make **every perimeter cell** of every node bold with RGB `(216,166,87)`. That includes nv-rms and Kubernetes, whose normal foreground is already that color but whose selected border acquires bold. Coverage is **7/7** node occurrences in v1 and **6/6** in v2: **13/13 total**. These are all-selected frames, not separate one-at-a-time selection screenshots; isolation of a single selected node is not demonstrated.

The controls box is `[2,41,9,6]` in each view, with complete square corners and sides and a continuous `(168,153,104)` perimeter. It is UI, not an additional diagram node. There are no other enclosing node/group borders visible.

## Motion

**No motion appears. No flow dots appear.** Each view supplies five frames at 0, 100, 200, 300, and 400 ms. Every frame grid is identical to its view's frame 0, and frame 0 matches the normal capture's characters after trailing-space normalization. There are zero visible dots in every frame in each view. The check files independently report `flows=0`, `0 single-dot routes`, `0 periodic routes`, `0 violations`, `0 synchronized at 2000ms`, and `origins: 0/0 routes start at their arrow origin`.

There are no animated routes to assess for dot spacing, movement direction, corner/bridge/head occupancy, true-origin placement, or simultaneous arrival; those properties are not applicable, rather than passed tests of animation. Observed dot violations: zero.

Although named `*-frames.ansi`, the actual frame grid rows contain no ANSI escape sequences; the ANSI sequences in those files are in the surrounding shell transcript. Thus there is no per-frame foreground-color evidence with which to test color-only changes. Ordinary and selected captures do contain readable RGB/bold evidence. The identical captured glyphs show no visible dot movement; they cannot prove behavior outside the 0–400 ms sample window.

## Evidence availability

All final spec files, normal text/ANSI captures, selected ANSI captures, frame text/ANSI captures, checks, and manifests used here were readable. No required capture was missing or in an unsupported format. Limitations are the absent independent pane-column/rectangle data, the check's unknown viewport versus the transcript's measured viewport, all-selected rather than isolated-selection captures, and the absence of ANSI styles within the frame grids. No new evidence was generated.

## Tool-usable blind scorecard

```json
{
  "stage": "A",
  "case": "gb300-rack-software",
  "coordinate_basis": "1-based supplied 77x47 screen grids",
  "counts_exclude_ui_chrome_unless_named": true,
  "views": {
    "v1": {
      "visible_nodes": 7,
      "declared_ordinary_edges": 5,
      "visible_trunk_destination_arrows": 3,
      "visible_edges": 8,
      "visible_arrowheads": 8,
      "traceable_source_target_routes": 8,
      "visible_labels": 13,
      "node_labels": 7,
      "route_labels": 6,
      "ui_labels": 5,
      "visible_crossings": 1,
      "check_reported_crossings": 3,
      "bridge_glyphs": 1,
      "junction_glyphs": 2,
      "uncertain_label_owners": 2,
      "uncertain_label_rectangles": [[25,16,13,1],[14,27,13,1]],
      "clipped_items": 0,
      "selected_state_coverage": {"captured": 7, "total": 7},
      "complete_color_continuous_node_borders": 7,
      "columns": 77,
      "rows": 47,
      "frames": 5,
      "dots_visible_per_frame": [0,0,0,0,0],
      "animated_routes_observed": 0,
      "motion_observed": false,
      "dot_violations": 0
    },
    "v2": {
      "visible_nodes": 6,
      "declared_ordinary_edges": 5,
      "visible_trunk_destination_arrows": 0,
      "visible_edges": 5,
      "visible_arrowheads": 5,
      "traceable_source_target_routes": 5,
      "visible_labels": 11,
      "node_labels": 6,
      "route_labels": 5,
      "ui_labels": 5,
      "visible_crossings": 0,
      "check_reported_crossings": 0,
      "bridge_glyphs": 0,
      "junction_glyphs": 0,
      "uncertain_label_owners": 1,
      "uncertain_label_rectangles": [[26,30,16,1]],
      "clipped_items": 0,
      "selected_state_coverage": {"captured": 6, "total": 6},
      "complete_color_continuous_node_borders": 6,
      "columns": 77,
      "rows": 47,
      "frames": 5,
      "dots_visible_per_frame": [0,0,0,0,0],
      "animated_routes_observed": 0,
      "motion_observed": false,
      "dot_violations": 0
    }
  },
  "total": {
    "visible_nodes": 13,
    "declared_ordinary_edges": 10,
    "visible_edges": 13,
    "visible_arrowheads": 13,
    "visible_labels": 24,
    "ui_labels": 10,
    "visible_labels_including_ui": 34,
    "visible_crossings": 1,
    "check_reported_crossings": 3,
    "bridge_glyphs": 1,
    "junction_glyphs": 2,
    "uncertain_label_owners": 3,
    "clipped_items": 0,
    "selected_state_coverage": {"captured": 13, "total": 13},
    "complete_color_continuous_node_borders": 13,
    "motion_observed": false,
    "dot_violations": 0
  },
  "unreadable_evidence": [],
  "missing_required_capture_files": [],
  "evidence_limits": [
    "manifest pane_cols and pane_rect are null; viewport_line is null",
    "check viewport is unknown; supplied transcript records 77x47 at zoom 1.00",
    "selected captures select all nodes together, not one at a time",
    "frame grid rows have no ANSI styles; color-only animation cannot be evaluated",
    "motion sample covers only 0 through 400 ms"
  ]
}
```
