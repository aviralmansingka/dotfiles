# Blind observations — round 05, gb300-rack-software, stage A

This record uses only the four final JSON specs and the saved evidence captures (text, ANSI, selected ANSI, frame dumps, captured checks, and capture manifests). No source narrative, expectations, rubric, dataset manifest, attempts, probes, other cases, or previous rounds were consulted. No viewer was launched. These are observations, not a comparison with unrevealed expectations.

## Evidence identity and coordinate convention

Final spec SHA-256 values, calculated with `shasum -a 256` and matching their capture manifests:

| Spec | SHA-256 |
|---|---|
| `v1-oob-rail.json` | `0239c7b29fa04f96bdc0f8b736d6fe18ce54ec39d272d7fad6f93d47b5d8a801` |
| `v2-rms-apis.json` | `fa5c790f1c76f9a8dd390ce1ed7482652c0142f3614cc60285952408cabffc42` |
| `v3-nvswitch-sw.json` | `3425e2863c313eb2dc214f9afa424e10dd61bbd71969150846d01d5dc6d67920` |
| `v4-inband-compute.json` | `70cafa96988990a96badf8cecef0d01ad30671db40705df15f4d96b2da20973f` |

All four pinned target dump hashes pass `shasum -a 256 -c evidence/target-dumps.sha256`. All seven artifact hashes in each of the four capture manifests also match their files. The manifests name binary SHA-256 `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`; this is capture metadata, not a fresh binary execution.

All coordinates below are 1-based `[column,row,width,height]` on the **77×47 target canvas**, excluding the preceding `viewport:` and `frame` metadata lines. A point is written `(column,row)`. Every graph label, graph border, arrow, and bend listed below has the same geometry in the 83×51 captures translated by **(+3 columns,+2 rows)**. Thus every listed graph label has an explicit corresponding 83×51 position by this translation; its width and height are unchanged. The UI positions use the separate rules given below.

The target dumps contain three frames, at 0, 100, and 200 ms. The original text and ANSI frame captures contain five frames, at 0, 100, 200, 300, and 400 ms. Every target frame has 47 canvas rows. The 83×51 ANSI snapshots have 51 rows of 83 cells; the standalone text snapshots omit the last blank row and trim trailing spaces. This does not remove graph content.

## v1 — OOB rail

### Every visible graph label

| Verbatim text | Target label rectangle | Owner |
|---|---|---|
| `nv-rms` | `[5,24,6,1]` | left node |
| `OOB LAN` | `[33,24,7,1]` | middle node |
| `Compute BMC` | `[61,16,11,1]` | upper-right node |
| `NVSwitch BMC` | `[61,24,12,1]` | middle-right node |
| `Power shelf` | `[61,32,11,1]` | lower-right node |
| `client` | `[18,23,6,1]` | nv-rms → OOB LAN |
| `physical reach` | `[43,23,14,1]` | OOB bus, above its shared horizontal run |

There is no uncertain label owner. `physical reach` ends at column 56 immediately beside the upper branch's vertical stroke at column 57, but it does not replace that stroke.

### Every visible arrow and route

All four arrowheads are complete `▶` glyphs, directed right. All routes are traceable from a box to the indicated destination without guessing connectivity.

1. **nv-rms → OOB LAN**, `client`: leaves the source's right border after `(11,24)`, runs horizontally through columns 12–30, and ends in `▶` at `(31,24)`, immediately before OOB LAN's left border at column 32.
2. **OOB LAN → Compute BMC**, shared `physical reach` bus: leaves the right border after `(40,24)`, follows the bus to the junction at `(57,24)`, rises at column 57, bends `╭` at `(57,16)`, and runs right to `▶` at `(59,16)`, immediately before the destination at column 60.
3. **OOB LAN → NVSwitch BMC**, same bus: continues horizontally on row 24 to `▶` at `(59,24)`, immediately before the destination at column 60.
4. **OOB LAN → Power shelf**, same bus: branches down from `(56,24)`, descends at column 56, bends `╰` at `(56,32)`, and runs right to `▶` at `(59,32)`, immediately before the destination at column 60.

### Junctions, branches, crossings, and the one-split question

The bus visibly draws **two adjacent junction glyphs**, not one: **`┬` at `(56,24)` and `┴` at `(57,24)`**, literally `┬┴` on the horizontal run. The lower branch attaches at the first cell and the upper branch at the next cell; the third destination is straight ahead.

At a broad glance this makes a compact three-destination fork from one shared incoming bus. At character-grid resolution, however, it is **two one-cell-separated taps**, not a single three-way split at one junction. The three destinations are unambiguous, and the bus is one connected structure; the visual does not establish a literal single-junction fan-out. No separate conceptual branching node is drawn. The captured check's `2 junctions` agrees with the two visible T glyphs.

There are no bridge crossings, touching bends, or other apparent branches. The only non-box route corner glyphs are `(57,16) ╭` and `(56,32) ╰`. No conspicuous loops occur.

## v2 — RMS APIs

### Every visible graph label

| Verbatim text | Target label rectangle | Owner |
|---|---|---|
| `nv-rms (mgmt)` | `[19,25,13,1]` | left node |
| `Compute BMC` | `[49,19,11,1]` | upper-right node |
| `Power shelf` | `[49,29,11,1]` | lower-right node |
| `Redfish/HTTPS` | `[33,23,13,1]` | upper route to Compute BMC |
| `Redfish shelf` | `[33,27,13,1]` | lower route to Power shelf |

The lower label is exactly **`Redfish shelf`**, not `Redfish/HTTPS`, and no longer protocol expansion is visible for that edge. It is readable, complete, and attached to the Power shelf route by placement. It is an abbreviated/different label, not a clipped rendering. No label owner is uncertain.

### Every visible arrow and route

Both arrowheads are complete rightward `▶` glyphs. Both routes are wholly traceable.

1. **nv-rms (mgmt) → Compute BMC**, `Redfish/HTTPS`: leaves the right side on row 24 after column 32, goes right to `(46,24) ╯`, rises at column 46 to `(46,19) ╭`, and ends at `(47,19) ▶`, immediately before the target's column-48 border.
2. **nv-rms (mgmt) → Power shelf**, `Redfish shelf`: leaves the right side on row 26 after column 32, goes right to `(46,26) ╮`, descends to `(46,29) ╰`, and ends at `(47,29) ▶`, immediately before the target's column-48 border.

There are no bridge crossings, touching bends, junction glyphs, or shared runs. These are two separate source ports, not a drawn bus split. All four non-box route corner glyphs are listed above. No conspicuous loop occurs.

## v3 — NVSwitch software

### Every visible graph label

| Verbatim text | Target label rectangle | Owner |
|---|---|---|
| `nv-rms (mgmt)` | `[40,16,13,1]` | upper node |
| `NVOS (tray)` | `[25,24,11,1]` | middle-left node |
| `NMX-C/T` | `[40,32,7,1]` | lower node |
| `NVUE REST` | `[30,20,9,1]` | nv-rms → NVOS route |
| `gRPC` | `[42,24,4,1]` | long nv-rms → NMX-C/T route |
| `hosts` | `[30,28,5,1]` | NVOS → NMX-C/T route |

No label owner is uncertain. `NVUE REST` is on the left side of the pair of source strokes; tracing the route, rather than simply selecting the nearest source stroke, is necessary because its horizontal segment bridges the other route.

### Every visible arrow and route

All three arrowheads are complete downward `▼` glyphs. All three routes can be traced without assuming a connection at the crossing.

1. **nv-rms (mgmt) → NVOS (tray)**, `NVUE REST`: leaves the upper box at column 42 below row 18, descends to `(42,21) ╯`, travels left on row 21 over the bridge at column 40 to `(25,21) ╭`, and ends at `(25,22) ▼`, directly above the target's row-23 top border.
2. **nv-rms (mgmt) → NMX-C/T**, `gRPC`: leaves the upper box at column 40 below row 18, descends through the crossed location `(40,21)`, continues down column 40, bends at `(40,28) ╰`, moves right to `(42,28) ╮`, and descends to `(42,30) ▼`, directly above the target's row-31 top border.
3. **NVOS (tray) → NMX-C/T**, `hosts`: leaves the middle box at column 25 below row 26, descends to `(25,29) ╰`, travels right to `(40,29) ╮`, and ends at `(40,30) ▼`, directly above the same lower box at a separate port.

### The bridge and nearby bends

There is **one visible bridge**, **`⌒` at `(40,21)`** (83×51 coordinate `(43,23)`). It lies in the leftward horizontal NVUE REST route over the vertical gRPC route. The vertical line is visible above and below the bridge cell. There is no `┼`, T junction, or apparent intended connection at this crossing. This agrees with `crossings: 1 bridges, 0 touching bends`.

The two lower routes are close: their bends include `(40,28) ╰`, `(42,28) ╮`, and `(40,29) ╮`. In particular, the two corners in column 40 on rows 28 and 29 are vertically adjacent. Their connecting stroke directions do **not** join: the upper corner turns upward/right, and the lower corner turns left/down. I can distinguish the routes, so I count zero touching-bend connections, while recording this close adjacency explicitly. The complete non-box corner list is `(25,21) ╭`, `(42,21) ╯`, `(40,28) ╰`, `(42,28) ╮`, `(25,29) ╰`, `(40,29) ╮`.

There are no junctions or shared buses. The source has two distinct outgoing ports; the bottom node has two distinct incoming arrowheads. The crossing and short lower dogleg add visual tracing effort but no conspicuous route loop.

## v4 — in-band compute

### Every visible graph label

| Verbatim text | Target label rectangle | Owner |
|---|---|---|
| `Kubernetes` | `[33,8,10,1]` | top node |
| `GPU Operator` | `[33,16,12,1]` | second node |
| `DCGM (host)` | `[33,24,11,1]` | third node |
| `dcgm-exporter` | `[48,32,13,1]` | lower-right node |
| `Driver+CUDA` | `[18,32,11,1]` | lower-left node |
| `Fabric Mgr` | `[18,40,10,1]` | bottom-left node |
| `hosts` | `[35,12,5,1]` | Kubernetes → GPU Operator |
| `DaemonSet` | `[35,20,9,1]` | GPU Operator → DCGM |
| `serves :9400` | `[35,30,12,1]` | DCGM → dcgm-exporter |
| `reads NVML` | `[21,28,10,1]` | DCGM → Driver+CUDA |
| `unconfirmed` | `[20,37,11,1]` | Driver+CUDA → Fabric Mgr |

All labels are complete and their owners are clear. `serves :9400` ends at column 46, with the arrowhead at column 48 on the same row; it does not overwrite the arrowhead.

### Every visible arrow and route

All five arrowheads are complete downward `▼` glyphs, and all five routes are wholly traceable.

1. **Kubernetes → GPU Operator**, `hosts`: straight down column 33, rows 11–14, ending at `(33,14) ▼` immediately above the target's row-15 border.
2. **GPU Operator → DCGM (host)**, `DaemonSet`: straight down column 33, rows 19–22, ending at `(33,22) ▼` immediately above the target's row-23 border.
3. **DCGM (host) → dcgm-exporter**, `serves :9400`: leaves below the DCGM box at column 35, descends to `(35,29) ╰`, moves right to `(48,29) ╮`, and ends at `(48,30) ▼` immediately above the row-31 target border.
4. **DCGM (host) → Driver+CUDA**, `reads NVML`: leaves below the DCGM box at column 33, descends to `(33,29) ╯`, moves left to `(18,29) ╭`, and ends at `(18,30) ▼` immediately above the row-31 target border.
5. **Driver+CUDA → Fabric Mgr**, `unconfirmed`: leaves below the source at column 18; rows 35–37 contain dashed vertical `╎` glyphs, and `(18,38) ▼` is a solid, complete arrowhead immediately above the row-39 target border. This route is visibly dashed, not missing or disconnected.

There are no bridges, touching bends, junction glyphs, or shared runs. The pair below DCGM is a conceptual fan-out through distinct ports at columns 33 and 35, not a bus with a junction. All four non-box route corner glyphs are listed above. No conspicuous loop occurs.

## Every node border, colors, and selected-state coverage

For **each row of the following table**, I checked a complete top, bottom, left side, right side, and all four corners. All are present. Top corners are `╭`/`╮`; bottom corners are `╰`/`╯`. No route or label replaces a border glyph. Each normal-state border is one continuous foreground RGB color in the **83×51 ANSI evidence**. The table includes every node occurrence, including repeated concepts in different views.

| View / node | Target outer border rectangle | Normal border RGB | Border cells checked |
|---|---|---|---:|
| v1 nv-rms | `[4,23,8,4]` | `(125,160,184)` | 20 |
| v1 OOB LAN | `[32,23,9,4]` | `(125,174,163)` | 22 |
| v1 Compute BMC | `[60,15,13,4]` | `(231,138,78)` | 30 |
| v1 NVSwitch BMC | `[60,23,14,4]` | `(241,164,108)` | 32 |
| v1 Power shelf | `[60,31,13,4]` | `(210,116,56)` | 30 |
| v2 nv-rms (mgmt) | `[18,23,15,5]` | `(125,160,184)` | 36 |
| v2 Compute BMC | `[48,18,13,4]` | `(231,138,78)` | 30 |
| v2 Power shelf | `[48,28,13,4]` | `(241,164,108)` | 30 |
| v3 nv-rms (mgmt) | `[39,15,15,4]` | `(125,160,184)` | 34 |
| v3 NVOS (tray) | `[24,23,13,4]` | `(211,134,155)` | 30 |
| v3 NMX-C/T | `[39,31,9,4]` | `(226,156,175)` | 22 |
| v4 Kubernetes | `[32,7,12,4]` | `(211,134,155)` | 28 |
| v4 GPU Operator | `[32,15,14,4]` | `(226,156,175)` | 32 |
| v4 DCGM (host) | `[32,23,13,4]` | `(125,174,163)` | 30 |
| v4 dcgm-exporter | `[47,31,15,4]` | `(147,194,183)` | 34 |
| v4 Driver+CUDA | `[17,31,13,4]` | `(99,151,141)` | 30 |
| v4 Fabric Mgr | `[17,39,12,4]` | `(168,211,200)` | 28 |

In each saved selected ANSI snapshot, **every one of these 17 borders** is captured in bold RGB `(216,166,87)`. All 498 border cells across the 17 occurrences have the appropriate uniform color in the base snapshot and all 498 have the selected color in the selected snapshot. There are **zero palette-overwritten or differently colored border cells in these ANSI snapshots**. All four sides and corners remain complete in selection. Coverage is **17/17 node occurrences**, not merely four initially selected nodes. This is simultaneous select-all evidence, not a recorded sequence of individual selection interactions.

The pinned 77×47 captures are plain text only: they prove full target-size border geometry, but do **not** independently prove target-size color continuity or selection. No 77×47 ANSI or selected snapshot is supplied. That evidence limitation must not be replaced by an inference from the spec or by the 83×51 colors.

### Groups: only hue, no group blocks or titles

No view draws a group enclosure, group title, enclosing background block, or visible group legend. The evidence shows related hues on node borders, not geometric grouping. For example, v1's three right-side borders are orange-family shades; v3's NVOS and NMX-C/T borders are pink-family shades; v4's top two are pink-family shades and the compute-related four are teal-family shades. The listed group names in the JSON/checks are **not visible canvas labels**. The captures do not establish a group block/title merely because those names exist in the spec.

## Motion: this case is static

There are **zero animated routes and zero flow-dot glyphs** in every supplied view. In each of the five 83×51 text frames, five corresponding ANSI frames, and three 77×47 target frames per view, the visible flow-dot count is **0**. Geometry is identical across each sequence. The middle-dot `·` characters in the title are static text separators, not flow markers; no `●`, `•`, `∙`, `⋅`, or `⦁` marker occurs in the canvases.

Consequently, dot spacing, travel direction, true-origin placement, corner/bridge/arrowhead occupation, and synchronized arrival are **not applicable**, rather than successful animation tests. There are zero observed dot violations. Each captured check agrees: `flows=0`, zero single-dot routes, zero periodic routes, zero violations, and origin/arrival totals `0/0`.

## Fit, viewport evidence, and all UI labels

Every pinned file states exactly **`viewport: 77x47 zoom: 1.00 natural`**. Each original five-frame capture contains **`viewport: 83x51 zoom: 1.00 natural`**. The captured checks instead say **`viewport: unknown zoom: 1.00 natural`**; they do not themselves demonstrate the target viewport. The actual target frame canvases do.

| View | Tight visible graph rectangle at 77×47 | Captured check extent | Captured crossing report | Observed graph clipping |
|---|---|---|---|---|
| v1 | `[4,15,70,20]` | `74x24 cells` | `0 bridges, 0 touching bends` | none |
| v2 | `[18,18,43,14]` | `48x19 cells` | `0 bridges, 0 touching bends` | none |
| v3 | `[24,15,30,20]` | `34x24 cells` | `1 bridges, 0 touching bends` | none |
| v4 | `[17,7,45,36]` | `49x40 cells` | `0 bridges, 0 touching bends` | none |

The check extents and tight visible rectangles are different measures; I report both without treating their difference as clipped content. Every graph node, relationship label, arrowhead, and complete route fits at natural 100% in both captured sizes. Nothing in the visible graph requires pan or zoom. In target v4, Fabric Mgr's bottom border at row 42 is alongside the control widget but horizontally clear of it: node columns 17–28 versus widget columns 2–10. No palette/control overlay reaches a node border.

There is **no `routes: N/M near-minimal` line in any supplied check**. A numeric near-minimal comparison therefore has no captured evidence. Visually, routes use straight runs or compact doglegs, and no conspicuous loop is visible. The v3 crossing/dogleg is the main extra tracing burden.

The complete visible title strings are included below, including the leading-space exclusion in their rectangles:

| View/size | Verbatim title text | Rectangle |
|---|---|---|
| v1 77×47 | `rataflow-view · 77x47 @100% · v1-oob-rail.json · 5 nodes · 1 edges · q quit` | `[2,1,75,1]` |
| v2 77×47 | `rataflow-view · 77x47 @100% · v2-rms-apis.json · 3 nodes · 2 edges · q quit` | `[2,1,75,1]` |
| v3 77×47 | `rataflow-view · 77x47 @100% · v3-nvswitch-sw.json · 3 nodes · 3 edges · q qu` | `[2,1,76,1]` |
| v4 77×47 | `rataflow-view · 77x47 @100% · v4-inband-compute.json · 6 nodes · 5 edges · q` | `[2,1,76,1]` |
| v1 83×51 | `rataflow-view · 83x51 @100% · v1-oob-rail.json · 5 nodes · 1 edges · q quit` | `[2,1,75,1]` |
| v2 83×51 | `rataflow-view · 83x51 @100% · v2-rms-apis.json · 3 nodes · 2 edges · q quit` | `[2,1,75,1]` |
| v3 83×51 | `rataflow-view · 83x51 @100% · v3-nvswitch-sw.json · 3 nodes · 3 edges · q quit` | `[2,1,78,1]` |
| v4 83×51 | `rataflow-view · 83x51 @100% · v4-inband-compute.json · 6 nodes · 5 edges · q quit` | `[2,1,81,1]` |

Thus **two UI titles are clipped at 77 columns**: v3 loses the final `it` of `quit`; v4 loses ` quit` after `q`. No title is clipped in the 83-column captures. Graph clipping is zero; counting all UI content, clipped items are two. The title's v1 `1 edges` counts the ordinary edge, not the three visible trunk destination arrows.

All views also show these exact four UI labels at 77×47: `+ [+]` at `[4,42,5,1]`, `− [-]` at `[4,43,5,1]`, `⊡ [f]` at `[4,44,5,1]`, and `□ [i]` at `[4,45,5,1]`. Their complete widget border is `[2,41,9,6]` with four square corners. At 83×51, the same labels are `[4,46,5,1]`, `[4,47,5,1]`, `[4,48,5,1]`, and `[4,49,5,1]`; the complete widget border is `[2,45,9,6]`. The widget is separate UI, not a graph node or graph group.

## Tool-usable blind scorecard

Counts refer to graph occurrences across the four final views, not duplicate frames or duplicate viewport captures. `visible_edges` counts destination-arrow relationships: v1 has one ordinary edge plus three trunk legs. `visible_labels` counts node labels plus relationship/bus labels and excludes UI labels. `crossings` counts bridges, not bus junctions. `clipped_items` includes the two truncated UI titles; graph-only clipping is separately zero. No unrevealed rubric score is assigned.

```json
{
  "stage": "A",
  "case": "gb300-rack-software",
  "views": {
    "v1": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "ordinary_spec_edges": 1,
      "trunk_destination_arrows": 3,
      "visible_labels": 7,
      "node_labels": 5,
      "relationship_labels": 2,
      "crossings": 0,
      "touching_bend_connections": 0,
      "junction_glyphs": 2,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "graph_clipped_items": 0,
      "selected_state_covered": 5,
      "selected_state_total": 5,
      "animated_routes": 0,
      "dot_violations": 0,
      "palette_overwritten_border_cells_83x51": 0
    },
    "v2": {
      "visible_nodes": 3,
      "visible_edges": 2,
      "ordinary_spec_edges": 2,
      "trunk_destination_arrows": 0,
      "visible_labels": 5,
      "node_labels": 3,
      "relationship_labels": 2,
      "crossings": 0,
      "touching_bend_connections": 0,
      "junction_glyphs": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "graph_clipped_items": 0,
      "selected_state_covered": 3,
      "selected_state_total": 3,
      "animated_routes": 0,
      "dot_violations": 0,
      "palette_overwritten_border_cells_83x51": 0
    },
    "v3": {
      "visible_nodes": 3,
      "visible_edges": 3,
      "ordinary_spec_edges": 3,
      "trunk_destination_arrows": 0,
      "visible_labels": 6,
      "node_labels": 3,
      "relationship_labels": 3,
      "crossings": 1,
      "touching_bend_connections": 0,
      "junction_glyphs": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 1,
      "graph_clipped_items": 0,
      "selected_state_covered": 3,
      "selected_state_total": 3,
      "animated_routes": 0,
      "dot_violations": 0,
      "palette_overwritten_border_cells_83x51": 0
    },
    "v4": {
      "visible_nodes": 6,
      "visible_edges": 5,
      "ordinary_spec_edges": 5,
      "trunk_destination_arrows": 0,
      "visible_labels": 11,
      "node_labels": 6,
      "relationship_labels": 5,
      "crossings": 0,
      "touching_bend_connections": 0,
      "junction_glyphs": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 1,
      "graph_clipped_items": 0,
      "selected_state_covered": 6,
      "selected_state_total": 6,
      "animated_routes": 0,
      "dot_violations": 0,
      "palette_overwritten_border_cells_83x51": 0
    }
  },
  "totals": {
    "visible_nodes": 17,
    "visible_edges": 14,
    "ordinary_spec_edges": 11,
    "trunk_destination_arrows": 3,
    "visible_labels": 29,
    "node_labels": 17,
    "relationship_labels": 12,
    "crossings": 1,
    "touching_bend_connections": 0,
    "junction_glyphs": 2,
    "uncertain_label_owners": 0,
    "clipped_items": 2,
    "graph_clipped_items": 0,
    "selected_state_covered": 17,
    "selected_state_total": 17,
    "selected_state_viewport": "83x51",
    "selected_state_covered_at_77x47": 0,
    "animated_routes": 0,
    "flow_dot_glyphs": 0,
    "dot_violations": 0,
    "complete_color_continuous_borders_83x51": 17,
    "palette_overwritten_border_cells_83x51": 0,
    "palette_overwritten_border_cells_77x47": null,
    "visible_group_blocks": 0,
    "visible_group_titles": 0,
    "target_frames_per_view": 3,
    "original_frames_per_view": 5,
    "unreadable_evidence_files": 0
  },
  "missing_evidence": [
    "77x47 ANSI color snapshots",
    "77x47 selected-state snapshots",
    "captured routes: N/M near-minimal diagnostic"
  ]
}
```

No supplied evidence file used here was unreadable or in an unsupported format. Target-only color/selection and a numeric near-minimal route diagnostic are missing, as distinguished from unreadable evidence. The zero dots, adjacent two-junction bus, single bridge, exact `Redfish shelf` wording, absent group blocks/titles, and color-continuous captured borders are direct capture observations. This is the saved stage-A record; it must not be modified after saving.
