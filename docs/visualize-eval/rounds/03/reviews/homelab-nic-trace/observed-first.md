# Blind observation — round 03 / homelab-nic-trace / stage A

This record was made before receiving expectations. I read the three final specs and their saved text, ANSI, selected-ANSI, frame, manifest, and check evidence only. I did not read source, expected data, a rubric, the dataset manifest, other cases, or earlier rounds. I did not inspect local attempts, run a viewer, spawn agents, or change the candidate.

## Coordinate and count conventions

Coordinates are 1-based terminal cells, with the header on row 1. Rectangles are `[column,row,width,height]`. Label rectangles include the complete literal text, not enclosing borders or padding. Paths below list `[column,row]` waypoints in source-to-target order; intervening cells follow the stated orthogonal direction. Graph counts exclude the viewer header and control panel, which are inventoried separately. Counts across views count occurrences, not inferred unique physical devices.

The ANSI snapshots contain 47 rows of 77 cells each. The plain text snapshots have 46 rows and omit the final blank row; all their nonblank content matches ANSI after trimming right padding. Selected snapshots preserve the normal snapshots' exact glyph positions. All graph-label characters here have one-cell width.

## Overall observations

- There are **16 node occurrences, 14 arrows, and 30 graph labels**: 16 node labels and 14 edge labels.
- Every graph label is fully visible. Every arrow has one intact downward `▼` at its target and no source arrowhead. All 14 topological routes can be traced without choosing between intersecting lines.
- There are **0 crossings, 0 bridge glyphs, 0 shared route cells, and 0 inline junctions/forks** visible. Several routes converge on separate ports of a box; that is not an edge junction.
- There is **1 uncertain/misassociated label owner**: `UDP encap` in view 2. Its visible placement abuts the short tailscale-to-host route, although the spec assigns it to the long bypass to bond0. The adjacent `overlay` label also sits beside that short route, but its own short-route ownership remains readable. I do not count `overlay` a second time as an uncertain owner.
- All **16 normal node borders** have all four corners and complete top, bottom, left, and right sides. ANSI confirms each individual border is color-continuous. All **16/16 node occurrences** also have their own selected border captured in their view's all-selected snapshot. These are simultaneous all-selected captures, not 16 independent interaction demonstrations.
- **No motion appears.** Every supplied frame is static. No flow dots are visible on any route in any frame. The middle dots `·` in the header are stationary separators, not flow dots.
- All graph content fits at 100% in the saved 77 × 47 viewports. No graph item is clipped or shown as requiring pan/zoom. The header's help tail is cut off differently in each view; this is recorded separately as three clipped chrome/header tails, not clipped graph items.
- View 2's disconnected `no global v6 (ULA only)` box has the same rounded node shape, interior height, label styling, and selectable border as the devices/interfaces. Its wording reads as a condition/note rather than a device, but its visual grammar makes it look like an isolated peer node. No connector identifies what the condition applies to.

## View 1 — v1-virtual-nets

### Every graph label, verbatim

| Kind / local ID | Visible label | `[column,row,width,height]` |
|---|---|---|
| Node vm | `vm vnet0` | `[24,16,8,1]` |
| Node ctr | `ctr veth` | `[48,16,8,1]` |
| Node virbr | `virbr0 libvirt NAT` | `[19,24,18,1]` |
| Node dkbr | `docker 172.18.2.1` | `[43,24,17,1]` |
| Node box | `homelab rack-bench` | `[19,32,18,1]` |
| Edge vm → virbr | `192.168.122.x` | `[26,20,13,1]` |
| Edge ctr → dkbr | `172.18.2.x` | `[50,20,10,1]` |
| Edge virbr → box | `NAT bridge` | `[21,28,10,1]` |
| Edge dkbr → box | `docker bridge` | `[26,30,13,1]` |

### Borders and selected evidence

For every row below: normal and selected geometry has a complete top and bottom horizontal side, two complete vertical sides, and all four rounded corners `╭ ╮ ╰ ╯`. The normal RGB color covers every perimeter cell without interruption. The corresponding selected snapshot gives every perimeter cell RGB `(216,166,87)` and bold. Label color is separate from border color.

| Node | Border rectangle | Normal border RGB | Selected perimeter captured |
|---|---|---|---|
| vm | `[23,15,10,4]` | `(216,166,87)` | yes |
| ctr | `[47,15,10,4]` | `(228,184,111)` | yes |
| virbr | `[18,23,20,4]` | `(200,147,68)` | yes |
| dkbr | `[42,23,19,4]` | `(239,202,138)` | yes |
| box | `[18,31,20,4]` | `(125,174,163)` | yes |

### Every visible arrow and bend

All four routes are solid, muted RGB `(124,111,100)`, individually traceable, and directed overall downward. Each starts immediately below its source's bottom border and ends with an intact `▼` immediately above the target's top border.

| Source box → target box | Visible route waypoints | Arrowhead | Traceable |
|---|---|---|---|
| `vm vnet0` → `virbr0 libvirt NAT` | `[24,19]` down to `[24,21]` `╯`, left to `[19,21]` `╭`, down to `[19,22]` | `▼` at `[19,22]` | yes |
| `ctr veth` → `docker 172.18.2.1` | `[48,19]` down to `[48,21]` `╯`, left to `[43,21]` `╭`, down to `[43,22]` | `▼` at `[43,22]` | yes |
| `virbr0 libvirt NAT` → `homelab rack-bench` | `[19,27]` straight down through `[19,29]` to `[19,30]` | `▼` at `[19,30]` | yes |
| `docker 172.18.2.1` → `homelab rack-bench` | `[43,27]` down to `[43,29]` `╯`, left to `[21,29]` `╭`, down to `[21,30]` | `▼` at `[21,30]` | yes |

The two upper subnet labels sit right of their own source-side vertical runs. `NAT bridge` sits right of the straight route at column 19, above the docker route's horizontal return. `docker bridge` sits below that horizontal return and right of its column-21 arrowhead. These owners are readable, although the latter label is farther from the long source-side vertical segment.

The two arrows entering homelab are at columns 19 and 21, with a blank column between them; they do not merge into a bus. Crossings, bridges, connected touching bends, inline junctions, and apparent inline branches: none. There are six route corner glyphs total, all listed above.

### Fit and motion

- Capture: **77 columns × 47 rows**, header `77x47 @100%`.
- Recorded runtime line: `viewport: 77x47 zoom: 1.00 natural`.
- Check line: `viewport: unknown zoom: 1.00 natural`; this check alone does not establish a measured viewport.
- Check extent: `44x21 cells`; visible graph bounding rectangle `[18,15,43,20]`, including boxes, arrows, and labels.
- No clipped/hidden graph content, pan requirement, or zoom reduction visible. Crossings visible: 0; check reports 0.
- Frames 0–4 at 0, 100, 200, 300, 400 ms: **0 dots each**, identical glyph grids after right-padding normalization. No movement. All four routes are static.
- Selected coverage: **5/5**.

## View 2 — v2-overlay-uplinks

### Every graph label, verbatim

| Kind / local ID | Visible label | `[column,row,width,height]` |
|---|---|---|
| Node ts | `tailscale0 100.113.153.49` | `[14,8,25,1]` |
| Node box | `homelab ASUS bare metal` | `[15,16,23,1]` |
| Node bond0 | `bond0 192.168.1.197` | `[17,25,19,1]` |
| Node wlp | `wlp8s0 192.168.1.213` | `[45,25,20,1]` |
| Node rtr | `Fios rtr 192.168.1.1` | `[17,33,20,1]` |
| Node limit | `no global v6 (ULA only)` | `[15,40,23,1]` |
| Edge label | `UDP encap` | `[17,11,9,1]` |
| Edge label | `overlay` | `[18,12,7,1]` |
| Edge box → bond0 | `eno1 2.5GbE` | `[21,22,11,1]` |
| Edge box → wlp | `backup path` | `[26,19,11,1]` |
| Edge bond0 → rtr | `gw 0.5 ms` | `[19,29,9,1]` |
| Edge wlp → rtr | `metric 600 failover` | `[23,31,19,1]` |

The string `overlay` also occurs inside the filename in the header. That substring is not another graph label.

### Borders and selected evidence

Each listed border has all four complete sides and four complete rounded corners. ANSI confirms one uninterrupted RGB color per normal border. Each corresponding selected border is completely bold RGB `(216,166,87)`.

| Node | Border rectangle | Normal border RGB | Selected perimeter captured |
|---|---|---|---|
| ts | `[13,7,27,4]` | `(216,166,87)` | yes |
| box | `[14,15,25,4]` | `(125,174,163)` | yes |
| bond0 | `[16,24,21,4]` | `(211,134,155)` | yes |
| wlp | `[44,24,22,4]` | `(226,156,175)` | yes |
| rtr | `[16,32,22,4]` | `(169,182,101)` | yes |
| limit | `[14,39,25,4]` | `(125,160,184)` | yes |

The last box has no incoming or outgoing edge. It is beneath the router with three blank rows between their borders. It looks like an isolated node/caption in a device-shaped box, not a connected device on the route. The wording is the only strong cue that it describes an IPv6 limitation. Its blue border does not supply a visible explanatory legend. Selection treats it exactly like the other nodes.

### Every visible arrow and bend

All six routes are solid, muted RGB `(124,111,100)`, and directed overall downward. Every listed arrowhead is intact and single-ended at the target. Topology is traceable in all six cases even where edge-label ownership is not.

| Source box → target box | Visible route waypoints | Arrowhead | Traceable |
|---|---|---|---|
| `tailscale0 100.113.153.49` → `homelab ASUS bare metal` | `[16,11]` down to `[16,13]` `╯`, left to `[15,13]` `╭`, down to `[15,14]` | `▼` at `[15,14]` | yes |
| `tailscale0 100.113.153.49` → `bond0 192.168.1.197` | `[14,11]` down to `[14,13]` `╯`, left to `[12,13]` `╭`, down along column 12 past the host to `[12,22]` `╰`, right to `[17,22]` `╮`, down to `[17,23]` | `▼` at `[17,23]` | yes |
| `homelab ASUS bare metal` → `bond0 192.168.1.197` | `[15,19]` down to `[15,21]` `╰`, right to `[19,21]` `╮`, down to `[19,23]` | `▼` at `[19,23]` | yes |
| `homelab ASUS bare metal` → `wlp8s0 192.168.1.213` | `[17,19]` down to `[17,20]` `╰`, right to `[45,20]` `╮`, down to `[45,23]` | `▼` at `[45,23]` | yes |
| `bond0 192.168.1.197` → `Fios rtr 192.168.1.1` | `[17,28]` straight down through `[17,30]` to `[17,31]` | `▼` at `[17,31]` | yes |
| `wlp8s0 192.168.1.213` → `Fios rtr 192.168.1.1` | `[45,28]` down to `[45,30]` `╯`, left to `[19,30]` `╭`, down to `[19,31]` | `▼` at `[19,31]` | yes |

**Label-owner problem:** `UDP encap` starts at column 17 on row 11, immediately beside the column-16 route to the host, with no blank cell between line and label. The longer route to bond0 is at column 14, separated from the label by the short route itself. `overlay` is one row lower and also right of the column-16 short route. Thus a capture-only reader can reasonably assign both labels to the short route and see the bypass as unlabeled. The spec says `overlay` belongs to ts → box and `UDP encap` to ts → bond0, but that declaration does not repair the visible ownership. I flag `UDP encap` as the one uncertain/misassociated owner; `overlay` itself has a clear adjacent short route.

Other edge-label placements: `backup path` is above the long right-going host-to-Wi-Fi horizontal run; `eno1 2.5GbE` is right of the host-to-bond0 column-19 segment; `gw 0.5 ms` is right of the straight bond0-to-router line; `metric 600 failover` is below the Wi-Fi return's horizontal run and to the right of its router-facing arrowhead. Those four owners are readable.

**Contacts and apparent branches:**

- At row 13, the long bypass's bend `[14,13]` `╯` and the short route's bend `[15,13]` `╭` are horizontally adjacent with no blank cell. This is one visually touching/adjacent inter-route corner pair. Their facing sides do not form a joined line, and they share no cell; I do not count a crossing or junction there.
- Host-to-bond0 has a horizontal run at row 21, columns 15–19. The bypass-to-bond0 has another at row 22, columns 12–17. These staggered parallel runs are one row apart over columns 15–17, with bends close to the other line, but no connected junction or crossing. The column-19 descent remains separate from the bypass's column-17 arrow.
- The long bypass at column 12 passes one blank column left of the host's column-14 border and never enters that box.
- Tailscale has two distinct outgoing ports at columns 14 and 16; the host has two at columns 15 and 17. These are box-mediated fan-outs, not inline edge branches. Bond0 receives two distinct arrows at columns 17 and 19. The router receives two at columns 17 and 19. No shared trunk is visible.
- Crossings: 0. Bridge glyphs: 0. Inline junctions: 0. Route corner glyphs: 12, all enumerated in the route table.

### Fit and motion

- Capture: **77 columns × 47 rows**, header `77x47 @100%`.
- Recorded runtime line: `viewport: 77x47 zoom: 1.00 natural`.
- Check line: `viewport: unknown zoom: 1.00 natural`.
- Check extent: `54x37 cells`; visible graph bounding rectangle `[12,7,54,36]`.
- The disconnected limit box reaches row 42, to the right of the controls, without overlap or clipping. No graph content requires pan/zoom in the capture. Visible crossings: 0; check reports 0.
- Frames 0–4 at 0, 100, 200, 300, 400 ms: **0 dots each**, identical glyph grids after right-padding normalization. No movement. All six routes are static.
- Selected coverage: **6/6**.

## View 3 — v3-wan-egress

### Every graph label, verbatim

| Kind / local ID | Visible label | `[column,row,width,height]` |
|---|---|---|
| Node rtr | `claimed Fios rtr 192.168.1.1` | `[25,8,28,1]` |
| Node ont | `ONT 169.254.3.1 historical` | `[26,16,26,1]` |
| Node vzagg | `VZ edge 100.41.x historical` | `[26,24,27,1]` |
| Node vzbb | `VZ bb AS701 historical` | `[28,32,22,1]` |
| Node cf | `cf 1.1.1.1 AS13335` | `[30,40,18,1]` |
| Edge rtr → ont | `NAT+DHCP 71.251.12.240` | `[27,12,22,1]` |
| Edge ont → vzagg | `4.5 ms` | `[28,20,6,1]` |
| Edge vzagg → vzbb | `6.6 ms` | `[28,28,6,1]` |
| Edge vzbb → cf | `6-9 ms` | `[30,36,6,1]` |

`claimed` is visible inside the router label. `historical` is visible inside each of the ONT, VZ edge, and VZ backbone labels. All qualifiers are complete, same-row parts of their node labels; none is clipped or floating beside another route. The Cloudflare label does not carry either qualifier. View 2's router label does not say `claimed`; the views themselves supply no explicit connector or identity key across their different host/router wording.

### Borders and selected evidence

Every listed node has complete top, bottom, left, and right sides, all four rounded corners, and an uninterrupted normal border color. Every corresponding selected border is completely bold RGB `(216,166,87)`.

| Node | Border rectangle | Normal border RGB | Selected perimeter captured |
|---|---|---|---|
| rtr | `[24,7,30,4]` | `(216,166,87)` | yes |
| ont | `[25,15,28,4]` | `(228,184,111)` | yes |
| vzagg | `[25,23,29,4]` | `(125,174,163)` | yes |
| vzbb | `[27,31,24,4]` | `(147,194,183)` | yes |
| cf | `[29,39,20,4]` | `(211,134,155)` | yes |

### Every visible arrow and bend

All four routes visibly use dashed vertical `╎` strokes, not the solid `│` of views 1 and 2. Longer horizontal portions use `╌`. Rounded bends and `▼` arrowheads remain solid-shaped glyphs. The muted route color is RGB `(124,111,100)` throughout. There is no visible legend defining dashed semantics, so I observe dashed/qualified links, not an independently verified current WAN path.

| Source box → target box | Visible route waypoints | Arrowhead | Traceable |
|---|---|---|---|
| `claimed Fios rtr 192.168.1.1` → `ONT 169.254.3.1 historical` | `[25,11]` and `[25,12]` `╎`, then `[25,13]` `╰` immediately beside `[26,13]` `╮`, down to `[26,14]` | `▼` at `[26,14]` | yes |
| `ONT 169.254.3.1 historical` → `VZ edge 100.41.x historical` | `[26,19]`, `[26,20]`, `[26,21]` `╎`, straight down to `[26,22]` | `▼` at `[26,22]` | yes |
| `VZ edge 100.41.x historical` → `VZ bb AS701 historical` | `[26,27]` and `[26,28]` `╎`, then row 29: `[26,29]` `╰`, `[27,29]` `╌`, `[28,29]` `╮`, down to `[28,30]` | `▼` at `[28,30]` | yes |
| `VZ bb AS701 historical` → `cf 1.1.1.1 AS13335` | `[28,35]` and `[28,36]` `╎`, then row 37: `[28,37]` `╰`, `[29,37]` `╌`, `[30,37]` `╮`, down to `[30,38]` | `▼` at `[30,38]` | yes |

All are overall downward, single-target arrows. Each label sits right of the only route in the gap between its source and target. No label owner is uncertain here. The adjacent corner pairs are each bends within a single route, not a contact between two routes. There are six route corner glyphs, zero crossings, zero bridges, zero inline junctions, and no apparent branches or edge-less graph boxes in this view.

### Fit and motion

- Capture: **77 columns × 47 rows**, header `77x47 @100%`.
- Recorded runtime line: `viewport: 77x47 zoom: 1.00 natural`.
- Check line: `viewport: unknown zoom: 1.00 natural`.
- Check extent: `31x37 cells`; visible graph bounding rectangle `[24,7,30,36]`.
- The last node reaches row 42, clear of the control panel at columns 2–10. No graph clipping, hidden graph item, pan requirement, or zoom reduction visible. Crossings visible: 0; check reports 0.
- Frames 0–4 at 0, 100, 200, 300, 400 ms: **0 dots each**, identical glyph grids after right-padding normalization. No movement. All four routes are static.
- Selected coverage: **5/5**.

## Viewer chrome — every visible chrome label

These are additional to the 30 graph labels. Each view has one status/header label and four control labels: **15 chrome-label occurrences**, or **45 total visible label occurrences including chrome**.

| View | Verbatim visible header text, including leading/trailing spaces | Rectangle |
|---|---|---|
| v1 | ` rataflow-view · 77x47 @100% · v1-virtual-nets.json · 5 nodes · 4 edges · q q` | `[1,1,77,1]` |
| v2 | ` rataflow-view · 77x47 @100% · v2-overlay-uplinks.json · 6 nodes · 6 edges · ` | `[1,1,77,1]` |
| v3 | ` rataflow-view · 77x47 @100% · v3-wan-egress.json · 5 nodes · 4 edges · q qui` | `[1,1,77,1]` |

The header ends at the right boundary. The help tail is incomplete (`q q`, absent after the separator, or `q qui`). I count one clipped chrome tail in each view, not a clipped graph label.

Each view repeats these four control labels at exactly these rectangles:

| Verbatim control text (excluding padding) | Rectangle |
|---|---|
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

Each control panel border is `[2,41,9,6]`, with complete square corners and sides. Its border is color-continuous RGB `(168,153,104)` and does not change to selected-node styling. It is viewer chrome, not an edge-less graph device.

## Motion scope and evidence limitations

I inspected all five supplied frames in both frame-text and frame-ANSI files for each view. All 15 frames show zero route dots; each view's five frames are identical. Each frame's glyph content also matches its normal snapshot after trimming right padding. The graph portions of the files named `*-frames.ansi` contain no SGR colors; their extension does not prove per-frame color. Normal/selected snapshots do provide SGR border-color evidence.

Because there are no animated routes, dot spacing, motion direction, corner/bridge/arrowhead occupancy, frame-0 origin placement, and synchronized arrival are **not applicable**, not unobserved successes. No unexpected motion or dot violation appears in the supplied 0–400 ms samples. There is no evidence of later times or a full motion cycle, and none is needed to establish that these supplied captures are static.

Manifests give `pane_rows: 47`, but `pane_cols`, `pane_rect`, and `viewport_line` are null. The 77 × 47 measurement is supported instead by the full ANSI grids, the header token, and the literal runtime viewport lines in the frame captures. A separately populated external pane rectangle/column measurement is missing. The `--check` runs themselves say `viewport: unknown`; I do not replace that with an inferred value in their output. Their natural extents include layout space beyond the tight visible bounds listed above.

No supplied capture format was unreadable, and no required normal, selected, text-frame, or ANSI-frame capture was missing. I did not attempt to infer missing evidence from the specs. I cannot prove offscreen interaction behavior or single-node selection transitions from these saved all-selected snapshots.

## Tool-usable blind scorecard

```json
{
  "stage": "A",
  "case": "homelab-nic-trace",
  "count_basis": "occurrences across final views; graph labels exclude viewer chrome",
  "views": {
    "v1-virtual-nets": {
      "columns": 77,
      "rows": 47,
      "zoom_percent": 100,
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_node_labels": 5,
      "visible_edge_labels": 4,
      "visible_labels": 9,
      "crossings": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "clipped_chrome_tails": 1,
      "complete_color_continuous_node_borders": 5,
      "selected_state_captured": 5,
      "selected_state_total": 5,
      "animated_routes": 0,
      "dots_per_frame": [0, 0, 0, 0, 0],
      "unexpected_motion": false,
      "dot_violations": 0
    },
    "v2-overlay-uplinks": {
      "columns": 77,
      "rows": 47,
      "zoom_percent": 100,
      "visible_nodes": 6,
      "visible_edges": 6,
      "visible_node_labels": 6,
      "visible_edge_labels": 6,
      "visible_labels": 12,
      "crossings": 0,
      "uncertain_label_owners": 1,
      "uncertain_labels": ["UDP encap"],
      "clipped_items": 0,
      "clipped_chrome_tails": 1,
      "complete_color_continuous_node_borders": 6,
      "selected_state_captured": 6,
      "selected_state_total": 6,
      "edgeless_node_occurrences": 1,
      "adjacent_interroute_corner_pairs": 1,
      "animated_routes": 0,
      "dots_per_frame": [0, 0, 0, 0, 0],
      "unexpected_motion": false,
      "dot_violations": 0
    },
    "v3-wan-egress": {
      "columns": 77,
      "rows": 47,
      "zoom_percent": 100,
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_node_labels": 5,
      "visible_edge_labels": 4,
      "visible_labels": 9,
      "crossings": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "clipped_chrome_tails": 1,
      "complete_color_continuous_node_borders": 5,
      "selected_state_captured": 5,
      "selected_state_total": 5,
      "dashed_edges": 4,
      "animated_routes": 0,
      "dots_per_frame": [0, 0, 0, 0, 0],
      "unexpected_motion": false,
      "dot_violations": 0
    }
  },
  "totals": {
    "visible_nodes": 16,
    "visible_edges": 14,
    "topologically_traceable_edges": 14,
    "visible_node_labels": 16,
    "visible_edge_labels": 14,
    "visible_labels": 30,
    "visible_chrome_labels": 15,
    "visible_labels_including_chrome": 45,
    "crossings": 0,
    "bridge_glyphs": 0,
    "inline_junctions": 0,
    "shared_route_cells": 0,
    "uncertain_label_owners": 1,
    "clipped_items": 0,
    "clipped_chrome_tails": 3,
    "complete_color_continuous_node_borders": 16,
    "selected_state_captured": 16,
    "selected_state_total": 16,
    "edgeless_node_occurrences": 1,
    "adjacent_interroute_corner_pairs": 1,
    "dashed_edges": 4,
    "frames_inspected": 15,
    "animated_routes": 0,
    "unexpected_motion": false,
    "dot_violations": 0,
    "unreadable_capture_files": 0,
    "missing_required_capture_files": 0
  },
  "limitations": [
    "External pane rectangle and pane-column fields are null in manifests.",
    "Check viewport is unknown; runtime captures separately establish 77x47.",
    "Frame-ANSI graph grids have no SGR color evidence.",
    "Only simultaneous all-selected states, not per-node interaction transitions, are captured.",
    "No motion cycle is present; motion-specific quality measures are not applicable."
  ]
}
```

Stage A ends here. This record is to remain unchanged after saving and hashing.
