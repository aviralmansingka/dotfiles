# gb300-rack-software — round 02, Stage A blind observation

This record uses only the assigned final `v1.json` and `v2.json` specs and their saved evidence captures. No source brief, expected relationships, rubric, manifest, other case, or earlier-round result was read. Specs establish intention only; the observations below come from the captures. No viewer was launched and no evidence was regenerated. Checks, validators, and generator claims were not used as visual evidence.

## Evidence and coordinate convention

Read in full for each view: `<view>-text.txt`, `<view>-ansi.ansi`, `<view>-selected.ansi`, `<view>-frames.txt`, and `<view>-frames.ansi`, under `gb300-rack-software/evidence/<view>/`. All were readable. Coordinates are 1-based `[column,row,width,height]`, with the status bar at row 1. Point coordinates use `(column,row)`. Coordinates refer to the captured character grid, not the enclosing shell transcript.

The normal and selected ANSI files each contain 47 rows of 77 cells. Both frame transcripts contain the measured line `viewport: 77x47 zoom: 1.00 natural`; both status bars show `77x47 @100%`. Timestamped diagram portions of the `frames.ansi` files contain no SGR color styling, despite their extension. They prove glyph positions and changes, not temporal color continuity. Normal and selected ANSI snapshots do supply actual RGB/bold evidence.

## Verbatim visible labels

### v1 — 7 node labels and 7 relationship/bus labels

| Kind | Visible text | Bounds |
|---|---|---|
| Node | `nv-rms` | [3,14,6,1] |
| Edge | `Redfish/HTTPS` | [26,16,13,1] |
| Edge | `NVUE REST/SSH` | [15,18,13,1] |
| Edge | `NMX-C gRPC` | [53,19,10,1] |
| Edge | `client on LAN` | [21,22,13,1] |
| Node | `OOB LAN` | [19,24,7,1] |
| Node | `NVOS` | [38,24,4,1] |
| Edge | `hosts` | [53,27,5,1] |
| Bus | `1/10/25G Eth` | [26,28,12,1] |
| Edge | `Redfish/HTTPS` | [4,31,13,1] |
| Node | `Compute BMC` | [17,33,11,1] |
| Node | `NVSwitch BMC` | [34,33,12,1] |
| Node | `Power shelf` | [52,33,11,1] |
| Node | `NMX-C/T` | [69,33,7,1] |

### v2 — 6 node labels and 5 relationship labels

| Kind | Visible text | Bounds |
|---|---|---|
| Node | `Kubernetes` | [26,8,10,1] |
| Edge | `deployed in` | [28,12,11,1] |
| Node | `GPU Operator` | [25,16,12,1] |
| Edge | `DaemonSet` | [27,20,9,1] |
| Node | `DCGM` | [29,24,4,1] |
| Edge | `NVML read` | [33,28,9,1] |
| Edge | `metrics :9400` | [26,30,13,1] |
| Node | `dcgm-exporter` | [24,32,13,1] |
| Node | `Driver+CUDA` | [43,32,11,1] |
| Edge | `co-resident` | [30,36,11,1] |
| Node | `Fabric Mgr` | [26,40,10,1] |

### Visible interface text (separate from diagram-label counts)

Each view has `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], and `□ [i]` [4,45,5,1]. Their cream-colored text segments include a leading padding space at column 3; that padding is not part of the label.

Status bars, excluding leading/trailing padding:

- v1: `rataflow-view · 77x47 @100% · v1.json · 7 nodes · 6 edges · q quit` [2,1,66,1].
- v2: `rataflow-view · 77x47 @100% · v2.json · 6 nodes · 5 edges · q quit` [2,1,66,1].

There are **25 diagram-label occurrences**, plus 8 control labels and 2 status bars. No two text labels fuse into one word. Several labels touch route glyphs, as discussed below; this is not word-to-word fusion.

## Every visible arrow and its route

The following traces are reconstructed from visible strokes, bends, bridges, and arrowheads, not from the spec. Intermediate points list route bends; straight runs connect them. All arrowheads are visible `▼`, pointing downward into the target box. Treating `⌒` as a horizontal nonconnecting overpass permits tracing the crowded v1 routes without choosing a branch at a crossing. This requires careful inspection; the geometry is not effortless to read.

### v1 — 9 arrowheads / source-to-target connections

| Source → target | Visible trace | Arrowhead | Whole route followable? |
|---|---|---|---|
| nv-rms → OOB LAN | Port (2,17), down to (2,21), right to (19,21), down | (19,22) | Yes, through three overpasses |
| nv-rms → NVOS | Port (4,17), down to (4,19), right to (38,19), down | (38,22) | Yes, but adjacent overpasses and touching bends crowd it |
| nv-rms → Compute BMC | Port (6,17), down to (6,30), right to (17,30), down | (17,31) | Yes, passing below overpasses at rows 19 and 21 |
| nv-rms → Power shelf | Port (8,17), down to (8,20), right to (11,20), up to (11,18), right to (13,18), up to (13,17), right to (52,17), down | (52,31) | Yes, but the tight up/down jog and adjacent bridge pair demand care |
| nv-rms → NMX-C/T | Port (10,17), down to (10,22), right to (16,22), up to (16,20), right to (21,20), down to (21,21), right to (37,21), up to (37,20), right to (69,20), down | (69,31) | Yes under the overpass convention; most circuitous and crowded trace |
| NVOS → NMX-C/T | Port (38,27), down to (38,28), right to (71,28), down | (71,31) | Yes, through two overpasses |
| OOB LAN → Compute BMC | Port (19,27), down to (19,29), right along bus to junction (22,29), down to (22,30), left to (19,30), down | (19,31) | Yes; visibly a branch of the bus |
| OOB LAN → NVSwitch BMC | Same bus to junction (40,29), down to (40,30), left to (34,30), down | (34,31) | Yes; visibly a second branch of the bus |
| OOB LAN → Power shelf | Same bus continuing right to (54,29), down | (54,31) | Yes; visibly the bus continuation |

Thus the visible count is nine directed connections, although the status bar says six edges: the latter does not count the three visible bus destinations. Counting route systems rather than endpoint connections gives six individual routes plus one branching bus.

### v2 — 5 arrowheads / directed connections

| Source → target | Visible trace | Arrowhead | Whole route followable? |
|---|---|---|---|
| Kubernetes → GPU Operator | Port (26,11), down to (26,13), left to (25,13), down | (25,14) | Yes |
| GPU Operator → DCGM | Port (25,19), down to (25,21), right to (29,21), down | (29,22) | Yes |
| DCGM → dcgm-exporter | Port (29,27), down to (29,29), left to (24,29), down | (24,30) | Yes |
| DCGM → Driver+CUDA | Separate port (31,27), down to (31,29), right to (43,29), down | (43,30) | Yes |
| Driver+CUDA → Fabric Mgr | Port (43,35), down to (43,37), left to (26,37), down; vertical `╎` and horizontal `╌` indicate dashing | (26,38) | Yes |

No v2 crossing or shared-route junction appears. DCGM has two separate outgoing ports, not a shared-stem junction. All v2 relationship-label owners are clear.

## Crossings, bridges, touching bends, and branches

### v1

There are **13 visible `⌒` crossing cells**, all horizontal overpasses:

| Cell | Horizontal route over vertical route |
|---|---|
| (6,19) | nv-rms → NVOS over nv-rms → Compute BMC |
| (8,19) | nv-rms → NVOS over nv-rms → Power shelf, first vertical segment |
| (10,19) | nv-rms → NVOS over nv-rms → NMX-C/T, first vertical segment |
| (11,19) | nv-rms → NVOS over nv-rms → Power shelf, returning vertical segment |
| (10,20) | nv-rms → Power shelf over nv-rms → NMX-C/T |
| (38,20) | nv-rms → NMX-C/T over nv-rms → NVOS |
| (52,20) | nv-rms → NMX-C/T over nv-rms → Power shelf |
| (6,21) | nv-rms → OOB LAN over nv-rms → Compute BMC |
| (10,21) | nv-rms → OOB LAN over nv-rms → NMX-C/T, first vertical segment |
| (16,21) | nv-rms → OOB LAN over nv-rms → NMX-C/T, returning vertical segment |
| (52,28) | NVOS → NMX-C/T over nv-rms → Power shelf |
| (69,28) | NVOS → NMX-C/T over nv-rms → NMX-C/T |
| (52,29) | OOB LAN bus over nv-rms → Power shelf |

Two real visible junction glyphs, `┬` at (22,29) and (40,29), make the OOB LAN bus appear to branch to Compute BMC and NVSwitch BMC, with the right-hand continuation reaching Power shelf. These are not classified as nonconnecting crossings. No other explicit junction glyph appears.

Close contacts that invite misreading:

- The independent vertical at (10,18) touches the different route's `╭` at (11,18).
- The two overpasses at (10,19) and (11,19) touch with no separator (`⌒⌒`).
- The overpass (10,20) directly touches the Power-shelf route's corner `╯` at (11,20).
- The NMX-C/T route's corner `╭` at (37,20) directly touches the NVOS overpass (38,20).
- The corner `╯` at (37,21) touches the separate NVOS vertical at (38,21).
- The same NMX-C/T route also has a one-row jog between corners (21,20) and (21,21), and (37,21) and (37,20). These are connected same-route bends, not extra branches.

The bridge pair and corner/vertical contacts can look like merges at a glance. Following each overpass straight across rather than treating it as a junction resolves the traces. There is no visible `┼` or additional explicit multiway junction.

### v2

Zero crossings, bridges, or inter-route touching bends. The adjacent corners (25,13) and (26,13) form a tight, connected jog on the same Kubernetes route; they are not an apparent branch. The two DCGM routes remain separated by at least one blank column near their ports.

## Uncertain relationship-label ownership

Four v1 labels have uncertain ownership from placement alone:

1. `NVUE REST/SSH` [15,18,13,1] lies between two long horizontal routes, one immediately above (toward Power shelf) and one immediately below (toward NVOS). No leader explicitly assigns it.
2. `NMX-C gRPC` [53,19,10,1] directly abuts the vertical at column 52, which traces to Power shelf; the route to NMX-C/T runs below it at row 20 and turns down at column 69. Geometry alone does not clearly assign the text.
3. `hosts` [53,27,5,1] likewise directly abuts that same column-52 Power-shelf route. The separate route leaving NVOS runs horizontally one row below, so proximity gives competing owners.
4. `1/10/25G Eth` [26,28,12,1] sits immediately left of the NVOS outgoing bend (38,28), but above the OOB LAN bus at row 29. It can read as the label for either route.

The upper `Redfish/HTTPS` is over the long Power-shelf-bound run; the lower `Redfish/HTTPS` ends immediately before the Compute-BMC-bound arrowhead. `client on LAN` starts two columns after the OOB-LAN-bound arrowhead. These three are sufficiently locally associated to trace; the lower Redfish label touches an arrowhead, not another text label. No v2 label owner is uncertain. No fused text-label occurrences were observed.

## Borders and selected state

Every node below has four complete sides and all four rounded corners in both its normal and selected capture. Every perimeter cell was checked for foreground RGB and bold continuity. All normal borders are internally color-continuous. All selected borders are internally color-continuous **bold RGB (216,166,87)**. Interior text is cream RGB (235,219,178); background is RGB (40,40,40). Edge strokes are muted RGB (124,111,100), and visible dots use RGB (216,166,87) in the styled static captures.

| View | Node | Box bounds | Normal border RGB | Selected perimeter |
|---|---|---|---|---|
| v1 | nv-rms | [1,13,11,4] | (216,166,87) | Complete, continuous, bold gold |
| v1 | OOB LAN | [18,23,9,4] | (125,174,163) | Complete, continuous, bold gold |
| v1 | NVOS | [37,23,6,4] | (211,134,155) | Complete, continuous, bold gold |
| v1 | Compute BMC | [16,32,13,4] | (147,194,183) | Complete, continuous, bold gold |
| v1 | NVSwitch BMC | [33,32,14,4] | (99,151,141) | Complete, continuous, bold gold |
| v1 | Power shelf | [51,32,13,4] | (168,211,200) | Complete, continuous, bold gold |
| v1 | NMX-C/T | [68,32,9,4] | (226,156,175) | Complete, continuous, bold gold |
| v2 | Kubernetes | [25,7,12,4] | (216,166,87) | Complete, continuous, bold gold |
| v2 | GPU Operator | [24,15,14,4] | (228,184,111) | Complete, continuous, bold gold |
| v2 | DCGM | [28,23,6,4] | (200,147,68) | Complete, continuous, bold gold |
| v2 | dcgm-exporter | [23,31,15,4] | (177,136,71) | Complete, continuous, bold gold |
| v2 | Driver+CUDA | [42,31,13,4] | (239,202,138) | Complete, continuous, bold gold |
| v2 | Fabric Mgr | [25,39,12,4] | (187,151,91) | Complete, continuous, bold gold |

Normal-border checkable node occurrences: **13/13**; uncheckable: **0**. Selected-state coverage: **13/13** node occurrences, with 7 in v1 and 6 in v2. Selection is shown simultaneously for all nodes, not as isolated single-node interactions. For nv-rms and Kubernetes the selected foreground equals their normal foreground; bold distinguishes the selected state in the ANSI data. No timestamped color claim is possible from the unstyled motion diagrams.

The interface control box is also complete at [2,41,9,6] in both views, RGB (168,153,104), and is not counted as a graph node. No node border is overdrawn by a route, label, or control box.

## Motion — every timestamped route

Each tuple below is the single visible dot's `(column,row)` at **0, 100, 200, 300, 400 ms**, respectively. These are discrete observations; unsampled instants are not proven.

### v1

| Animated route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms | Observed movement |
|---|---|---|---|---|---|---|
| nv-rms → OOB LAN | (2,18) | (2,19) | (2,20) | (3,21) | (4,21) | Down then right, toward target |
| nv-rms → NVOS | (4,18) | (5,19) | (7,19) | (9,19) | (12,19) | Down then right, toward target; skips bridges |
| nv-rms → Compute BMC | (6,18) | (6,20) | (6,22) | (6,23) | (6,24) | Down, toward target; skips crossing cells |
| nv-rms → Power shelf | (8,18) | (9,20) | (12,18) | (14,17) | (15,17) | Down/right/up/right through the jog, following the route toward target |
| nv-rms → NMX-C/T | (10,18) | (11,22) | (12,22) | (13,22) | (14,22) | Down then right, toward target; large first jump past bridges/corner |
| NVOS → NMX-C/T | (39,28) | (40,28) | (41,28) | (42,28) | (43,28) | Right at one cell per 100 ms |

Six dots are visible in each of the five frames, one for each individually animated route. The bus and its three destination legs have no visible moving dots. At 0 ms the five nv-rms dots are two columns apart; there is no dot train on any single route. Later spacing varies between independent routes.

Cadence is 100-ms sampling, not uniform geometric speed: bends and bridges are skipped, producing multi-cell jumps. In particular, the NMX-C/T dot moves from (10,18) to (11,22) in the first interval. The Power-shelf dot moves around multiple bends between sampled frames. None of the visible sampled dots replaces a bridge, corner, junction, or arrowhead.

### v2

| Animated route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms | Observed movement |
|---|---|---|---|---|---|---|
| Kubernetes → GPU Operator | (26,12) | (26,12) | (26,12) | (26,12) | (26,12) | Stationary throughout; direction/cadence cannot be established |
| GPU Operator → DCGM | (25,20) | (26,21) | (27,21) | (28,21) | (25,20) | Down/right, then wraps to earlier position at 400 ms |
| DCGM → dcgm-exporter | (29,28) | (28,29) | (27,29) | (26,29) | (25,29) | Down/left, toward target |
| DCGM → Driver+CUDA | (31,28) | (32,29) | (33,29) | (34,29) | (35,29) | Down/right, toward target |
| Driver+CUDA → Fabric Mgr | (43,36) | (42,37) | (41,37) | (40,37) | (39,37) | Down/left, toward target on dashed route |

Five dots are visible in each frame, one on each route; no route has multiple simultaneous dots. Except for initial bend skips and the observed wrap, the moving dots progress one horizontal cell per 100 ms. The Kubernetes dot does not visibly move during the entire 400-ms sample. No sampled dot occupies a corner, bridge, junction, or arrowhead. A dot near a corner is not classified as sitting on that corner.

Across both views: **0 observed dot-count violations**, **0 forbidden-cell dot occurrences** in 55 route/frame observations, **1 stationary animated route**, and visibly nonuniform geometric cadence on several bend/bridge-heavy routes. No assertion is made about motion outside the supplied five frames.

## Fit and evidence limits

Both views measure **77 columns × 47 rows**, with the exact measured token `viewport: 77x47 zoom: 1.00 natural`. The graph is at 100%, not shrunk below native character size.

- v1 graph spans columns 1–76 and rows 13–35. The left border at column 1 is complete; the rightmost node ends at column 76 with a blank column remaining. No label or arrow is cut off.
- v2 graph spans columns 23–54 and rows 7–42. Fabric Mgr reaches row 42 but has its complete bottom border. The control box at columns 2–10 does not overlap it.
- Both control boxes end at row 46, inside the captured 47 rows.
- **0 visibly clipped items**. Nothing visible requires pan or zoom to read. The captures cannot establish whether unknown source content was omitted; no such content is inferred.
- No supplied capture was unreadable or unsupported. Temporal RGB evidence is absent in the diagram portions of `frames.ansi`, as noted above. This limits temporal color claims, not static normal/selected border checks.

## Tool-usable blind scorecard

Counts are across the two final views. Edges count visible source-to-target arrow connections, including three bus destinations; relationship route systems count the bus once. Labels exclude UI text unless stated.

```json
{
  "case": "gb300-rack-software",
  "round": "02",
  "stage": "A",
  "visible_nodes": 13,
  "visible_edges": 14,
  "visible_arrowheads": 14,
  "relationship_route_systems": 12,
  "visible_labels": 25,
  "node_labels": 13,
  "relationship_labels": 12,
  "ui_control_labels": 8,
  "ui_status_bars": 2,
  "crossings": 13,
  "explicit_bus_junctions": 2,
  "uncertain_label_owners": 4,
  "fused_labels": 0,
  "clipped_items": 0,
  "normal_border_coverage": {"checked": 13, "total": 13, "uncheckable": 0},
  "selected_state_coverage": {"checked": 13, "total": 13},
  "dot_count_violations": 0,
  "dot_forbidden_cell_occurrences": 0,
  "stationary_animated_routes": 1,
  "sampled_route_frames": 55,
  "measured_viewports": {"v1": "77x47", "v2": "77x47"},
  "viewport_token": "viewport: 77x47 zoom: 1.00 natural",
  "unreadable_capture_files": [],
  "missing_evidence": ["SGR diagram color styling within timestamped frames.ansi captures"]
}
```

This file is the pre-expectation observation record. Its SHA-256 is recorded separately after saving; it must not be modified after hashing.
