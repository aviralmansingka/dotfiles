# Stage A — blind observation: gb300-rack-software, round 04

This record precedes the expectation reveal. It describes the supplied captures, not an inferred intended diagram. No source, expected data, rubric, dataset manifest, earlier round, or check log was read. No viewer was launched and no diagram was changed. Coordinates below are 1-based terminal cells, including the status row: `[column,row,width,height]`. Route vertices use `(column,row)`.

## Evidence and binding

Read the three named spec files; normal text/ANSI and selected ANSI captures for v1/v2/v3; all supplied text frame sequences; ANSI frame evidence for v2/v3; capture manifests; and the pane geometry capture. The manifests were used only to bind captures and hashes, not as evidence of diagram correctness. All recorded text/ANSI capture artifact hashes checked against their respective manifests match.

`shasum -a 256` on the named final specs gives:

| Spec | SHA-256 |
|---|---|
| `specs/v1-oob-rail.json` | `1f909cae469b2d37668fb8dfafe0a69750704d625a9b63a8d8f3e85ab5c67e96` |
| `specs/v2-mgmt-api.json` | `ef9dcfb927a6bfdf22eba4d028aad51c48a9abe20771b97e337fe83c669847c1` |
| `specs/v3-inband-host.json` | `c810d8e2762b023c61c2f5410ae3c2e30f4ee7fc34388c6e98400b06363217e0` |

**v2 binding discrepancy:** the captured status line and capture manifest name `v2-mgmt-api-a3.json`, not the named final `v2-mgmt-api.json`. I read that additional spec to establish the discrepancy. Its SHA-256 is `ae706bef201671ef2eb665c51b6116d5afdfb3f9ce7151cb620dc8b69fae4000`, matching the manifest. The named final v2 spec says `nv-rms (mgmt)` and has top-to-bottom direction; the captured a3 spec says `nv-rms (src build)` and has left-to-right direction. Thus the v2 observations below are of the actual a3 capture. They must not be silently attributed to a rendering of the named final v2 file.

v1's unlisted `v1-frames-77x47.txt` was read directly. It contains a viewport line and exactly one frame, frame 0 at 0ms, with no dots. This is sufficient to describe that static capture; it is not an animated cycle. v2 and v3 `*-frames-77x47.txt` each contain frames 0–20, at 100ms intervals through 2000ms. Their original `*-frames.txt` and `*-frames.ansi` files start with a truncated, unheaded first frame, followed by headed frames 1–20. The supplemental 77x47 sequences supply the complete frame-0 grids. None of these formats was unreadable.

## Viewport, fit, and visible chrome

The geometry probe records a 159×49 tab split into an 80×49 pane and a **79×49** pane. It records closing that probe pane. This supports the supplied 77×47 interior measurement, but is a measurement of the probe pane, not a separate rectangle measurement of each captured diagram pane. All three captured status rows say `77x47 @100%`; all three supplemental frame sequences begin, verbatim:

`viewport: 77x47 zoom: 1.00 natural`

No node, diagram label, or arrowhead is visibly clipped. All diagram content is present at 100%, without evidence of a required pan or zoom. Content bounds, excluding chrome, are v1 columns 12–65 / rows 12–37; v2 columns 2–76 / rows 13–36; v3 columns 8–70 / rows 7–42. v2 uses nearly the entire width but retains its right border at column 76. v3's bottom node and the left control box share some rows but do not overlap in columns.

Every visible chrome label:

| View | Verbatim label | Bounds |
|---|---|---|
| v1 | `rataflow-view · 77x47 @100% · v1-oob-rail.json · 5 nodes · 1 edges · q quit` | `[2,1,75,1]` |
| v2 | `rataflow-view · 77x47 @100% · v2-mgmt-api-a3.json · 6 nodes · 5 edges · q qu` | `[2,1,76,1]` |
| v3 | `rataflow-view · 77x47 @100% · v3-inband-host.json · 6 nodes · 5 edges · q qu` | `[2,1,76,1]` |
| each view | `+ [+]` | `[4,42,5,1]` |
| each view | `− [-]` | `[4,43,5,1]` |
| each view | `⊡ [f]` | `[4,44,5,1]` |
| each view | `□ [i]` | `[4,45,5,1]` |

The v2/v3 quit hints end visibly at `q qu`; two UI labels are truncated, distinct from zero clipped diagram items. Each view's control frame has complete square corners at `(2,41)`, `(10,41)`, `(2,46)`, `(10,46)`, with complete sides. Its ANSI border color is RGB `(168,153,104)`.

The allowed grid captures do not display `crossings: N bridges, M touching bends` or `routes: N/M near-minimal` lines. I did not read check logs in this captures-and-specs-only stage. Consequently no numeric checker comparison is claimed. Observed geometry, including detours, is recorded below.

## v1 — OOB rail

### Labels and borders

All diagram labels, verbatim:

| Label | Label bounds | Node border bounds, if applicable | Normal border RGB |
|---|---|---|---|
| `nv-rms (mgmt)` | `[13,13,13,1]` | `[12,12,15,4]` | `(216,166,87)` |
| `OOB LAN 1/10/25G` | `[32,21,16,1]` | `[31,20,18,4]` | `(125,174,163)` |
| `NVSwitch BMC` | `[14,35,12,1]` | `[13,34,14,4]` | `(211,134,155)` |
| `Compute BMC` | `[35,35,11,1]` | `[34,34,13,4]` | `(226,156,175)` |
| `Power shelf` | `[54,35,11,1]` | `[53,34,13,4]` | `(187,108,131)` |
| `Redfish client` | `[15,17,14,1]` | — | — |
| `Redfish/HTTPS` | `[19,27,13,1]` | — | — |

For **each** of these five node rectangles, all top/bottom horizontal cells, both vertical sides, and all four rounded corners are present. Corner order is `╭ ╮ ╰ ╯`. Every cell on each node perimeter has the single normal RGB listed above; no border color discontinuity was found. The selected ANSI capture shows all five complete perimeters in bold RGB `(216,166,87)`, distinct from the muted routes: **5/5 node occurrences covered**. This is simultaneous select-all coverage, not five individual-selection screenshots.

### Every visible arrow and its path

1. `nv-rms (mgmt)` → `OOB LAN 1/10/25G`: exits below the controller at `(13,16)`, goes down to `(13,18)`, right to `(32,18)`, then down to a visible `▼` at `(32,19)`, immediately above the OOB box. `Redfish client` labels this route. The whole route is traceable without guessing.
2. `OOB LAN 1/10/25G` → `NVSwitch BMC`: exits at `(32,24)`, continues down through the rail and `(32,32)` to `(32,35)`, then turns left to visible `◀` at `(27,35)`, immediately right of the NVSwitch BMC border. This is a leftward terminal arrow, despite the overall downward arrangement. It is traceable using the bridge convention at `(32,30)`.
3. `OOB LAN 1/10/25G` → `Compute BMC`: shares the incoming rail to `(32,32)`, turns right to `(35,32)`, then down to visible `▼` at `(35,33)`, above Compute BMC. Traceable from the explicit junction.
4. `OOB LAN 1/10/25G` → `Power shelf`: shares the incoming rail to `(32,32)`, turns **left** to `(30,32)`, goes **up** to `(30,30)`, then right across the rail to `(54,30)`, then down to visible `▼` at `(54,33)`, above Power shelf. This is traceable if the bridge at `(32,30)` is read as a non-connecting crossover. It is conspicuously indirect.

The one `Redfish/HTTPS` label is immediately left of the common incoming rail, ending at column 31 while the rail is at 32. It reads as a shared rail label, not a separate label per recipient. I do not count its owner as uncertain.

### Junction, crossing, and apparent loop

There is **one explicit four-arm junction**: `┼` at **`(32,32)`**, with the source arriving from the north and outgoing arms west, east, and south. Its west arm leads to Power shelf via the detour above; its east arm leads to Compute BMC; its south arm leads to NVSwitch BMC. Thus, topologically, the grid does show **one junction splitting three ways**, not three separate split junctions.

There is also **one non-connecting bridge/crossover**, `⌒` at **`(32,30)`**, two rows above the junction. The Power shelf detour crosses the incoming OOB rail there. It is not a second `┼` junction. The detour bends at `(30,32)`, `(30,30)`, `(54,30)`, plus the Compute bend at `(35,32)` and the NVSwitch bend at `(32,35)`. The bridge causes a visually loop-like formation around columns 30–32 / rows 30–32. It is not a clean fan-out silhouette: recognizing the single split requires distinguishing the bridge from the junction. No unrelated touching-bend collision is visible. No additional branch is visible elsewhere.

No dots appear in the normal, selected, or single-frame v1 grid.

## v2 — management API (captured a3)

### Labels and borders

All diagram labels, verbatim:

| Label | Label bounds | Node border bounds, if applicable | Normal border RGB |
|---|---|---|---|
| `nv-rms (src build)` | `[3,17,18,1]` | `[2,13,20,9]` | `(216,166,87)` |
| `Compute BMC` | `[40,17,11,1]` | `[39,16,13,4]` | `(125,174,163)` |
| `NVSwitch BMC` | `[40,24,12,1]` | `[39,23,14,4]` | `(147,194,183)` |
| `Power shelf` | `[40,29,11,1]` | `[39,28,13,4]` | `(99,151,141)` |
| `NVOS (tray)` | `[40,34,11,1]` | `[39,33,13,4]` | `(211,134,155)` |
| `NMX-C/T` | `[69,34,7,1]` | `[68,33,9,4]` | `(226,156,175)` |
| `Redfish/HTTPS` | `[23,13,13,1]` | — | — |
| `power/serial` | `[37,21,12,1]` | — | — |
| `Redfish power` | `[35,27,13,1]` | — | — |
| `NVUE/NMX gRPC` | `[18,27,13,1]` | — | — |
| `hosts` | `[57,33,5,1]` | — | — |

All six node borders have complete top/bottom sides, complete left/right sides, and all four rounded corners, with no missing perimeter cells. Each entire normal perimeter is color-continuous at the RGB listed. All six complete borders have their own bold RGB `(216,166,87)` perimeter in the selected capture: **6/6 occurrences covered**, simultaneously selected.

### Every visible arrow and its path

1. Controller → `Compute BMC`: exits right at `(22,14)`, goes to `(37,14)`, down to `(37,17)`, right to visible `▶` at `(38,17)`. Label `Redfish/HTTPS` sits above the initial horizontal run.
2. Controller → `NVSwitch BMC`: exits right at `(22,16)`, goes to `(35,16)`, down to `(35,24)`, right to visible `▶` at `(38,24)`. Label `power/serial` is to the right of the corresponding vertical corridor.
3. Controller → `Power shelf`: exits right at `(22,18)`, goes to `(33,18)`, down to `(33,29)`, right to visible `▶` at `(38,29)`. Label `Redfish power` is right of that vertical corridor, below the NVSwitch route's termination.
4. Controller → `NVOS (tray)`: exits right at `(22,20)`, goes to `(31,20)`, down to `(31,34)`, right to visible `▶` at `(38,34)`. Label `NVUE/NMX gRPC` is left of that vertical corridor.
5. `NVOS (tray)` → `NMX-C/T`: exits right at `(52,34)`, goes straight right to visible `▶` at `(67,34)`. Label `hosts` is above the horizontal run.

All five arrowheads point right, all meet the exterior cell immediately before their destination border, and all five whole routes are traceable without guessing. The four controller routes have separate ports and nested, parallel corridors at columns 37, 35, 33, and 31. There are no crossings, bridges, inter-edge touching bends, or junctions. There is no external common splitter; the apparent common source is the controller box itself. No conspicuous loop is visible. No label owner is uncertain.

**Controller label observation:** v1 visibly says `nv-rms (mgmt)`; v2 visibly says `nv-rms (src build)`. These are not the same label, and the difference is not a clipping artifact. The latter is present in the captured a3 spec, not the named final v2 spec.

## v3 — in-band host

### Labels and borders

All diagram labels, verbatim:

| Label | Label bounds | Node border bounds, if applicable | Normal border RGB |
|---|---|---|---|
| `Kubernetes` | `[14,8,10,1]` | `[13,7,12,4]` | `(216,166,87)` |
| `GPU Operator` | `[13,16,12,1]` | `[12,15,14,4]` | `(228,184,111)` |
| `DCGM (host)` | `[35,24,11,1]` | `[34,23,13,4]` | `(125,174,163)` |
| `dcgm-exporter (host)` | `[9,32,20,1]` | `[8,31,22,4]` | `(147,194,183)` |
| `Driver+CUDA (host)` | `[52,32,18,1]` | `[51,31,20,4]` | `(99,151,141)` |
| `Fabric Mgr (host)` | `[53,40,17,1]` | `[52,39,19,4]` | `(168,211,200)` |
| `hosts operator` | `[16,11,14,1]` | — | — |
| `host DaemonSet` | `[17,20,14,1]` | — | — |
| `metrics :9400` | `[16,28,13,1]` | — | — |
| `NVML reads` | `[39,28,10,1]` | — | — |
| `host-local` | `[54,36,10,1]` | — | — |

All six node rectangles have complete top/bottom sides, left/right sides, and all four rounded corners. Each full normal perimeter has exactly the listed RGB, without a color discontinuity. All six complete perimeters appear in bold RGB `(216,166,87)` in the selected capture: **6/6 occurrences covered**, simultaneously selected.

### Every visible arrow and its path

1. `Kubernetes` → `GPU Operator`: exits below at `(14,11)`, down to `(14,13)`, left to `(13,13)`, then down to visible `▼` at `(13,14)`. Label `hosts operator`. Traceable; there is a tiny one-column alignment dogleg.
2. `GPU Operator` → `DCGM (host)`: exits below at `(13,19)`, down to `(13,21)`, right to `(35,21)`, then down to visible `▼` at `(35,22)`. Label `host DaemonSet`. Traceable.
3. `DCGM (host)` → `dcgm-exporter (host)`: exits below at `(35,27)`, down to `(35,29)`, left to `(9,29)`, down to visible `▼` at `(9,30)`. Label `metrics :9400`. Traceable; its movement along the long horizontal run is leftward.
4. `DCGM (host)` → `Driver+CUDA (host)`: exits through a different bottom port at `(37,27)`, down to `(37,29)`, right to `(52,29)`, down to visible `▼` at `(52,30)`. Label `NVML reads`. Traceable. These two routes leave the DCGM box separately, with no external junction connecting them.
5. `Driver+CUDA (host)` → `Fabric Mgr (host)`: exits below at `(52,35)`, continues through dashed vertical cells, shifts one column right through `(52,37)` / `(53,37)`, then reaches visible `▼` at `(53,38)`. Label `host-local`. The route is visibly dashed (`╎` and short dashed bend/end strokes, including `╶╷`), unlike the other four solid routes. It remains traceable.

All five arrowheads point down, immediately above their target boxes. There are no inter-edge crossings, bridges, touching bends, or explicit junctions. There are two pairs of **same-route adjacent bends**: `(13,13)` / `(14,13)` in the Kubernetes dogleg, and `(52,37)` / `(53,37)` in the dashed host-local dogleg. These are not collisions between unrelated routes. No loop is visible. No label owner is uncertain.

## Residency framing and absent link

No enclosing residency rectangles, region titles, or visible group names are drawn in any view. The spec groups influence normal border colors, but their strings (`off-rack mgmt`, `oob fabric`, `rack hardware`, `switch software`, `k8s stack`, `host software`) are not rendered as labels. Color families alone do not visibly name residency.

What a reader can explicitly read is `(mgmt)` in the v1 controller, `(src build)` in the captured v2 controller, `(tray)` in `NVOS (tray)`, and `(host)` in four v3 node labels, plus `host DaemonSet` and `host-local`. `NVOS (tray)` → `NMX-C/T` has the visible `hosts` label, which supplies some placement relation. There is no separately labeled off-rack region or rack/host container, and the v2 controller's location cannot be read from a region title.

There is **no visible `oob → nvos` arrow**. v1 has an OOB box but no NVOS box. v2 has NVOS but no OOB box; its incoming NVUE/NMX route traces directly to the controller. v3 has neither OOB nor NVOS. The read specs also do not declare that link. This is an observed absence, not an invented hidden connection.

## Motion observation — flair, not timing semantics

The task calls this case static and describes v2 dots as flair. I therefore do not infer real protocol timing from any dots. Nevertheless the supplied **v3 capture also animates two routes**, and its spec has two `flow: true, dots: 1` entries. That discrepancy is recorded rather than suppressing the visible motion.

### v2, four animated controller routes

All 21 complete supplemental frames show **exactly four dots total, one per animated route**. No dot appears on the `hosts` route. Thus there are 84 observed dot appearances in that sequence. One dot per route makes within-route inter-dot spacing inapplicable. The four dots initially align vertically, with two rows between adjacent routes; they are separate dots on separate paths, not a four-dot stream on one route.

For frames `2k` and `2k+1`, for `k=0…7`, each dot is at column `23+k`, respectively on rows 14, 16, 18, and 20. The remaining samples are:

| Frames | Compute route dot | NVSwitch route dot | Power route dot | NVOS route dot |
|---|---|---|---|---|
| 16,17 | `(31,14)` | `(31,16)` | `(31,18)` | `(31,21)` |
| 18,19 | `(32,14)` | `(32,16)` | `(32,18)` | `(31,22)` |
| 20 | `(33,14)` | `(33,16)` | `(33,19)` | `(31,23)` |

They move away from the controller toward their arrowheads: initially rightward, then downward where a dot reaches its vertical corridor. Each advances approximately one eligible straight cell per 200ms. Corner cells are skipped; for example, the NVOS dot moves from `(30,20)` to `(31,21)`, not onto corner `(31,20)`. No captured dot sits on a corner, bridge, or arrowhead.

**Frame-0 origin:** the first exterior route cells are `(22,14)`, `(22,16)`, `(22,18)`, `(22,20)`, but frame-0 dots are at column 23 on those rows. All four are one cell beyond their true visible origins. This is four observed geometric origin mismatches, not a claim about protocol semantics.

No dot reaches any arrowhead by 2000ms. These are short initial samples, not demonstrated full motion cycles. Whether all four eventually reach their arrowheads in the same frame is **not evidenced**. Different route lengths plus equal sampled speeds must not be substituted for an observed endpoint frame.

### v3, two animated routes

Each of 21 complete supplemental frames has **exactly two dots total, one on GPU Operator → DCGM and one on DCGM → dcgm-exporter**: 42 observed dot appearances. No dots appear on the other three routes. Within-route spacing is inapplicable.

Frames 0 and 1 put the dots at `(13,20)` and `(35,28)`. For `k=1…9`, frames `2k` and `2k+1` put them at `(13+k,21)` and `(35-k,29)`. Frame 20 puts them at `(23,21)` and `(25,29)`. The first dot moves right across its horizontal run toward DCGM; the second moves left toward dcgm-exporter. Both advance about one eligible straight cell per 200ms. Their initial turns skip corners `(13,21)` and `(35,29)`. No captured dot sits on a corner, bridge, or arrowhead.

The first exterior origin cells are `(13,19)` and `(35,27)`, but frame-0 dots are `(13,20)` and `(35,28)`: **two further geometric origin mismatches**. Neither dot reaches an arrowhead during the supplied sequence. Synchronized endpoint arrival and a full cycle are not evidenced.

Across the six animated routes there are **zero observed dot-count violations, zero observed forbidden-cell placements, and six frame-0 origin mismatches** under the explicitly stated first-exterior-cell definition. Missing full-cycle/arrival evidence is recorded separately, not counted as an observed endpoint violation.

## Tool-usable blind scorecard

Counts are per node/label occurrence across the three captured views, not deduplicated software identities. `visible_edges` counts destination arrows, including three v1 trunk destinations; v1's status says `1 edges` because the trunk is not three ordinary spec edges. `visible_labels` excludes chrome unless expressly stated. Crossings exclude an intentional connection junction.

```json
{
  "stage": "A",
  "case": "gb300-rack-software",
  "round": "04",
  "expectations_read": false,
  "coordinate_system": "1-based terminal cells, status row included",
  "views": {
    "v1": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_labels": 7,
      "node_labels": 5,
      "edge_or_trunk_labels": 2,
      "crossings": 1,
      "bridge_glyphs": 1,
      "explicit_junctions": 1,
      "outgoing_arms_at_junction": 3,
      "inter_edge_touching_bends": 0,
      "uncertain_label_owners": 0,
      "clipped_diagram_items": 0,
      "clipped_ui_labels": 0,
      "selected_state_covered": 5,
      "selected_state_total": 5,
      "incomplete_node_borders": 0,
      "color_discontinuous_node_borders": 0,
      "animated_routes_observed": 0,
      "dot_violations_observed": 0
    },
    "v2": {
      "capture_spec": "v2-mgmt-api-a3.json",
      "capture_matches_named_final_spec": false,
      "visible_nodes": 6,
      "visible_edges": 5,
      "visible_labels": 11,
      "node_labels": 6,
      "edge_or_trunk_labels": 5,
      "crossings": 0,
      "bridge_glyphs": 0,
      "explicit_junctions": 0,
      "inter_edge_touching_bends": 0,
      "uncertain_label_owners": 0,
      "clipped_diagram_items": 0,
      "clipped_ui_labels": 1,
      "selected_state_covered": 6,
      "selected_state_total": 6,
      "incomplete_node_borders": 0,
      "color_discontinuous_node_borders": 0,
      "animated_routes_observed": 4,
      "complete_frames_observed": 21,
      "dot_count_violations": 0,
      "dot_forbidden_cell_violations": 0,
      "dot_frame0_origin_mismatches": 4,
      "dot_violations_observed": 4,
      "full_cycle_evidenced": false,
      "synchronized_arrowhead_arrival": null
    },
    "v3": {
      "visible_nodes": 6,
      "visible_edges": 5,
      "visible_labels": 11,
      "node_labels": 6,
      "edge_or_trunk_labels": 5,
      "crossings": 0,
      "bridge_glyphs": 0,
      "explicit_junctions": 0,
      "inter_edge_touching_bends": 0,
      "same_route_adjacent_bend_pairs": 2,
      "uncertain_label_owners": 0,
      "clipped_diagram_items": 0,
      "clipped_ui_labels": 1,
      "selected_state_covered": 6,
      "selected_state_total": 6,
      "incomplete_node_borders": 0,
      "color_discontinuous_node_borders": 0,
      "animated_routes_observed": 2,
      "complete_frames_observed": 21,
      "dot_count_violations": 0,
      "dot_forbidden_cell_violations": 0,
      "dot_frame0_origin_mismatches": 2,
      "dot_violations_observed": 2,
      "full_cycle_evidenced": false,
      "synchronized_arrowhead_arrival": null
    }
  },
  "totals": {
    "visible_nodes": 17,
    "visible_edges": 14,
    "visible_labels": 29,
    "visible_chrome_labels": 15,
    "all_visible_labels_including_chrome": 44,
    "crossings": 1,
    "bridge_glyphs": 1,
    "explicit_junctions": 1,
    "inter_edge_touching_bends": 0,
    "uncertain_label_owners": 0,
    "clipped_diagram_items": 0,
    "clipped_ui_labels": 2,
    "clipped_items_including_ui": 2,
    "selected_state_covered": 17,
    "selected_state_total": 17,
    "incomplete_node_borders": 0,
    "color_discontinuous_node_borders": 0,
    "animated_routes_observed": 6,
    "dot_count_violations": 0,
    "dot_forbidden_cell_violations": 0,
    "dot_frame0_origin_mismatches": 6,
    "dot_violations_observed": 6,
    "animated_routes_without_endpoint_cycle_evidence": 6,
    "visible_residency_enclosures": 0,
    "visible_oob_to_nvos_links": 0
  },
  "unreadable_evidence_files": [],
  "missing_or_limited_evidence": [
    "No supplied capture is bound to named final v2-mgmt-api.json; available v2 captures bind to a3.",
    "v1 supplemental frame dump is not listed in its capture manifest.",
    "Original v2/v3 frame text and ANSI start with a truncated unheaded first frame; supplemental 77x47 text restores complete frame 0.",
    "No full endpoint-to-endpoint motion cycle is evidenced for v2/v3.",
    "Individual captured pane rectangles are null in manifests; separate geometry probe supplies 79x49 half-pane measurement.",
    "No checker crossing/near-minimal report line appears in the allowed grid captures; check logs were not read."
  ]
}
```

This file is the immutable Stage-A record. Its SHA-256 is reported separately after saving; no Stage-B interpretation is included.
