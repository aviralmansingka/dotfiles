# Stage A — blind observation: homelab-nic-trace, round 05

This is an observation record, not an expectations-based grade. No source, expected data, rubric, dataset manifest, other case, or earlier-round material was read. No viewer was launched, no subagent was spawned, and no implementation or spec was changed. The record covers the four final specs and their saved captures. Coordinates below are 1-based `[column,row,width,height]`, relative to the diagram screen, not the surrounding shell transcript. A point is `(column,row)`.

## Identity and evidence boundaries

SHA-256 was calculated with `shasum -a 256` for each final spec:

| Spec | SHA-256 |
|---|---|
| v1.json | `7c23ec5bf060ea5e18cff4d08738773990bb1b787e438a7d3b004ec2363e8a1c` |
| v2.json | `97b91fd312b17b2fdfa9b4890d9c8ff1be54c6ced7a6131ed440dbd0afcf89a0` |
| v3.json | `4409b833c5f2d213918e2795b4a944c7035cfc29c1e36f3b0adbd03e3d04d31e` |
| v4.json | `922b3f7fb40b25fbf7698d8caa5061b2a4434f24404249f9a9c3948066de9017` |

All four hashes match the corresponding evidence manifests. Every artifact hash listed in each manifest was recomputed and matched. This is an integrity check of the saved bundle, not proof that a target-size live session was captured. The manifests bind the normal ANSI, selected ANSI, text, frame text/ANSI and check files; they do not bind the additional `vN-77x47.txt` files.

The identity-grounded final-view captures show **83 columns × 51 rows at 100%**, not 77×47. Each normal and selected ANSI capture decodes to exactly 51 rows of 83 cells. The ordinary text capture omits right-hand padding and the final blank row; its first 50 rows agree with the corresponding normal ANSI grid after right-padding is ignored. Frame transcripts include shell commands before, and a shell prompt after, the five diagram grids; these are not diagram labels.

**Target-size evidence gap:** as specified in the task, the only pinned 77×47 dump is `attempts/v4-a1-frames.txt`; its screen title says `v4-a1.json`, 7 nodes and 4 edges, and it renders a rejected spec. It is not the final v4, whose title says `v4.json`, 7 nodes and 5 edges. It cannot establish the final specs' fit at 77×47. The additional, unmanifested `evidence/vN/vN-77x47.txt` captures were inspected as supplemental captures only; their filenames and titles do not supply the missing pinned provenance. Their contents do not justify declaring all final views fitted anyway; see Fit below.

## Visible labels and node borders at 83×51

All graph labels are single-line and are transcribed verbatim below. IDs are used only to identify boxes; IDs that do not appear in the label are not claimed as visible text. Every listed box has all four sides and all four rounded corners, in both the normal and selected capture. Border RGB is the normal-state foreground, with background `(40,40,40)` throughout. Every perimeter cell of a given box has the same foreground; no palette/control widget, edge, or other drawing overwrites any perimeter cell in these 83×51 captures.

### v1 — 5 nodes, 4 edges

| Box ID | Visible node label | Label rectangle | Border rectangle | Normal border RGB | Perimeter cells |
|---|---|---|---|---|---:|
| ctr | `ctr · veth` | [10,18,10,1] | [9,17,12,4] | (216,166,87) | 28 |
| vm | `vm · vnet0` | [64,18,10,1] | [63,17,12,4] | (211,134,155) | 28 |
| dkbr | `docker 172.18.2.1` | [10,26,17,1] | [9,25,19,4] | (228,184,111) | 42 |
| virbr | `virbr0 NAT` | [64,26,10,1] | [63,25,12,4] | (226,156,175) | 28 |
| box | `homelab (ASUS, Linux 7.0)` | [37,34,25,1] | [36,33,27,4] | (231,138,78) | 58 |

| Visible edge label | Label rectangle | Owner |
|---|---|---|
| `172.18.2.x` | [12,22,10,1] | ctr → dkbr |
| `192.168.122.x` | [51,22,13,1] | vm → virbr |
| `docker bridge` | [17,30,13,1] | dkbr → box |
| `NAT bridge` | [47,30,10,1] | virbr → box |

The `192.168.122.x` label ends at column 63 immediately beside its route at column 64; it does not replace the route. Interface substrings are `veth` [16,18,4,1], `vnet0` [69,18,5,1], and `virbr0` [64,26,6,1]. The Docker bridge address is `172.18.2.1` [17,26,10,1]. All are readable in full.

### v2 — 4 nodes, 3 edges

| Box ID | Visible node label | Label rectangle | Border rectangle | Normal border RGB | Perimeter cells |
|---|---|---|---|---|---:|
| ts | `tailscale0 100.113.153.49` | [32,18,25,1] | [31,17,27,4] | (169,182,101) | 58 |
| box | `homelab rack-bench` | [32,26,18,1] | [31,25,20,4] | (231,138,78) | 44 |
| bond0 | `bond0 192.168.1.197` | [5,34,19,1] | [4,33,21,4] | (125,174,163) | 46 |
| wlp | `wlp8s0 192.168.1.213` | [59,34,20,1] | [58,33,22,4] | (147,194,183) | 48 |

| Visible edge label | Label rectangle | Owner |
|---|---|---|
| `overlay` | [34,22,7,1] | ts → box |
| `2.5 GbE` | [16,30,7,1] | box → bond0 |
| `backup` | [43,30,6,1] | box → wlp |

Identifier substrings are `tailscale0` [32,18,10,1], `100.113.153.49` [43,18,14,1], `bond0` [5,34,5,1], `192.168.1.197` [11,34,13,1], `wlp8s0` [59,34,6,1], and `192.168.1.213` [66,34,13,1]. All are readable in full at the captured size.

### v3 — 4 nodes, 3 edges

| Box ID | Visible node label | Label rectangle | Border rectangle | Normal border RGB | Perimeter cells |
|---|---|---|---|---|---:|
| ts | `tailscale0 100.113.153.49` | [26,14,25,1] | [25,13,27,4] | (169,182,101) | 58 |
| bond0 | `bond0 192.168.1.197/24 · eno1` | [26,22,29,1] | [25,21,31,4] | (125,174,163) | 66 |
| rtr | `rtr 192.168.1.1 NAT+DHCP·claimed` | [26,30,32,1] | [25,29,34,4] | (211,134,155) | 72 |
| pool | `pool 71.251.12.240` | [26,38,18,1] | [25,37,20,4] | (169,182,101) | 44 |

| Visible edge label | Label rectangle | Owner |
|---|---|---|
| `encap over UDP` | [28,18,14,1] | ts → bond0 |
| `def gw 0.5 ms` | [28,26,13,1] | bond0 → rtr |
| `NAT egress` | [28,34,10,1] | rtr → pool |

Important identifier/qualifier substrings are `tailscale0` [26,14,10,1], `100.113.153.49` [37,14,14,1], `bond0` [26,22,5,1], `192.168.1.197/24` [32,22,16,1], `eno1` [51,22,4,1], router address `192.168.1.1` [30,30,11,1], `claimed` [51,30,7,1], and public address `71.251.12.240` [31,38,13,1]. The slash prefix length and the `claimed` suffix are not clipped.

### v4 — 7 nodes, 5 edges

| Box ID | Visible node label | Label rectangle | Border rectangle | Normal border RGB | Perimeter cells |
|---|---|---|---|---|---:|
| limits | `no v6 (ULA), no committed rate` | [26,4,30,1] | [25,3,32,4] | (216,166,87) | 68 |
| wlp | `wlp8s0 192.168.1.213` | [30,8,20,1] | [29,7,22,4] | (125,174,163) | 48 |
| rtr | `rtr WNC ToR/spine/BF claimed` | [30,16,28,1] | [29,15,30,4] | (211,134,155) | 64 |
| ont | `ont 169.254.3.1 · claimed` | [30,24,25,1] | [29,23,27,4] | (211,134,155) | 58 |
| vzagg | `vz edge 100.41.x` | [30,32,16,1] | [29,31,18,4] | (226,156,175) | 40 |
| vzbb | `vz bb AS701` | [30,40,11,1] | [29,39,13,4] | (187,108,131) | 30 |
| cf | `cf 1.1.1.1 AS13335` | [30,48,18,1] | [29,47,20,4] | (238,180,196) | 44 |

| Visible edge label | Label rectangle | Owner |
|---|---|---|
| `metric 600` | [32,12,10,1] | wlp → rtr |
| `NAT out` | [32,20,7,1] | rtr → ont |
| `4.5 ms hist` | [32,28,11,1] | ont → vzagg |
| `6.6 ms hist` | [32,36,11,1] | vzagg → vzbb |
| `6-9 ms hist` | [32,44,11,1] | vzbb → cf |

Important substrings are `wlp8s0` [30,8,6,1], `192.168.1.213` [37,8,13,1], `WNC ToR/spine/BF` [34,16,16,1], router `claimed` [51,16,7,1], `169.254.3.1` [34,24,11,1], ONT `claimed` [48,24,7,1], `100.41.x` [38,32,8,1], `AS701` [36,40,5,1], and `AS13335` [41,48,7,1]. The final endpoint address `1.1.1.1` is part of the fully visible cf label above.

The visible historical qualifiers are exactly `hist` at [39,28,4,1], [39,36,4,1], and [39,44,4,1]. The literal word `historical` is **not** drawn, and the spec group name `historical traceroute` is **not** a visible group heading. Color similarity alone is not a textual historical marker. The three `hist` labels and dashed edges are visible evidence of qualification; whether that is the desired wording is reserved for stage B.

The entire annotation `no v6 (ULA), no committed rate` is visible at [26,4,30,1]. Its owner as a label is unquestionably the limits box. That box is isolated: it has no incoming or outgoing line. Its bottom border on row 6 is immediately above the wlp top border on row 7; they occupy different cells, not a shared border. The annotation's intended applicability to the host, a particular interface, or the whole drawing is not encoded by a connector. This is **one annotation-scope ambiguity**, not a floating label with an uncertain box owner. No semantic meaning is inferred from its isolation.

### Visible interface chrome, all four views

Each header occupies [2,1,66,1], verbatim:

- v1: `rataflow-view · 83x51 @100% · v1.json · 5 nodes · 4 edges · q quit`
- v2: `rataflow-view · 83x51 @100% · v2.json · 4 nodes · 3 edges · q quit`
- v3: `rataflow-view · 83x51 @100% · v3.json · 4 nodes · 3 edges · q quit`
- v4: `rataflow-view · 83x51 @100% · v4.json · 7 nodes · 5 edges · q quit`

The four control labels in every view are `+ [+]` [4,46,5,1], `− [-]` [4,47,5,1], `⊡ [f]` [4,48,5,1], and `□ [i]` [4,49,5,1]. Their rectangular control border is [2,45,9,6], complete and color-continuous, RGB (168,153,104), background (40,40,40). This control palette does not intersect a graph border. In v4 it shares rows 47–50 with the cf box but lies in columns 2–10, while cf lies in columns 29–48.

## Every visible arrow and route

All 15 arrows have one visible, intact downward `▼` at their target end; there are no source arrowheads, missing heads, bidirectional heads, or heads concealed by text. Each route is traceable without guessing from just below its source border to the arrowhead immediately above its target border. All routes are muted rather than selected/accented in the normal/selected ANSI captures.

The following coordinates enumerate the full route geometry. Endpoint points are route cells, not cells that overwrite a box. Straight segments include their endpoints.

| View | Source → target | Direction and complete route | Head | Style | Traceable |
|---|---|---|---|---|---|
| v1 | ctr → dkbr | down, (10,21) through (10,24) | ▼ (10,24) | solid | yes |
| v1 | vm → virbr | down, (64,21) through (64,24) | ▼ (64,24) | solid | yes |
| v1 | dkbr → box | down (10,29) to bend ╰ (10,31), right to bend ╮ (37,31), down to (37,32) | ▼ (37,32) | solid | yes |
| v1 | virbr → box | down (64,29) to bend ╯ (64,31), left to bend ╭ (39,31), down to (39,32) | ▼ (39,32) | solid | yes |
| v2 | ts → box | down, (32,21) through (32,24) | ▼ (32,24) | solid | yes |
| v2 | box → bond0 | down (32,29) to bend ╯ (32,31), left to bend ╭ (5,31), down to (5,32) | ▼ (5,32) | solid | yes |
| v2 | box → wlp | down (34,29) to bend ╰ (34,31), right to bend ╮ (59,31), down to (59,32) | ▼ (59,32) | solid | yes |
| v3 | ts → bond0 | down, (26,17) through (26,20) | ▼ (26,20) | solid | yes |
| v3 | bond0 → rtr | down, (26,25) through (26,28) | ▼ (26,28) | solid | yes |
| v3 | rtr → pool | down, (26,33) through (26,36) | ▼ (26,36) | solid | yes |
| v4 | wlp → rtr | down, (30,11) through (30,14) | ▼ (30,14) | solid | yes |
| v4 | rtr → ont | down, (30,19) through (30,22) | ▼ (30,22) | solid | yes |
| v4 | ont → vzagg | down, ╎ at (30,27), (30,28), (30,29), then head | ▼ (30,30) | dashed | yes |
| v4 | vzagg → vzbb | down, ╎ at (30,35), (30,36), (30,37), then head | ▼ (30,38) | dashed | yes |
| v4 | vzbb → cf | down, ╎ at (30,43), (30,44), (30,45), then head | ▼ (30,46) | dashed | yes |

The dashed traceroute hops are therefore concretely visible as nine `╎` route cells and three downward arrowheads, not inferred solely from `style: dashed` in the spec. Their labels have separate, readable coordinates above.

### Crossings, corners, junctions, and apparent branches

- **All views:** 0 route crossings, 0 bridge glyphs, 0 touching-bend collisions, 0 route junction glyphs, and 0 shared-run cells. The eight ordinary route bends are exactly the eight bend points enumerated in the table. Box corners are not route bends.
- **v1:** there is an apparent convergence on the homelab box, but it uses two distinct ports and does not merge in a junction. The inward bends at (37,31) and (39,31) have blank column 38 between them. The two heads at (37,32) and (39,32) are separate. Left-to-right order remains docker then NAT.
- **v2:** there is one box-level apparent fan-out from homelab, but no branching junction on a line. Separate stems at columns 32 and 34 have blank column 33 between them, including between the bends on row 31. Each can be followed to its own NIC. The incoming overlay route terminates on the top of the box, not on a shared trunk.
- **v3:** a single straight chain, no bends or branches.
- **v4:** a single straight chain plus an isolated annotation box, no bends or branches. Adjacent annotation/wlp border rows do not create a line or junction.
- No graph label sits on a route cell. All 15 edge labels have a clear route owner; all 20 node labels have a clear box owner. Uncertain label-owner count is 0. The isolated annotation's scope caveat is counted separately above.

There are no conspicuous route loops, backtracks, or detours around unrelated boxes. Eleven routes are straight; four have two monotonic right-angle bends to reach a different column. These are visual observations, not a computed minimality certificate. None of the four saved checks contains a `routes: N/M near-minimal` line, so a numerical near-minimal statistic is unavailable.

## Borders and selected-state coverage

Across the final views, **20/20 node occurrences** have their own entire selected border visible in the corresponding `--select-all` capture: v1 5/5, v2 4/4, v3 4/4, v4 7/7. Each selected perimeter cell is bold RGB (216,166,87), background (40,40,40). The ctr and limits boxes already use that RGB in the normal state, but the selected evidence adds bold; their selection is not established by color alone.

The 972 node-perimeter cells across the four normal grids were compared with their expected side/corner glyphs and their ANSI foreground/background, and the same 972 positions were checked in the selected grids. All sides/corners are present and all per-box colors are continuous. **0 border cells are palette-overwritten, in either normal or selected 83×51 evidence.** The four control palettes are also complete and do not intrude on any graph label or route. Selected-all coverage is evidence of each occurrence's selected border; it is not a capture of 20 separate interactive selection transitions.

## Motion — deliberately static

The saved checks report flows=0 for each view, and the final specs contain no flow definitions. Independently, both saved frame formats were parsed at frames 0, 1, 2, 3, 4 (0, 100, 200, 300, 400 ms). After excluding shell preamble/footer, all five 50-row diagram grids in every view are identical to that view's normal text capture.

For **every one of the 15 routes**, visible dot counts are `[0,0,0,0,0]`. No moving or static flow-dot glyph appears: the frame grids contain none of `●`, `•`, `∙`, `◉`, or `⦿`, and the full grid character inventory contains no other unexplained dot-like moving mark. The `·` characters are fixed label/header separators, not dots on routes. The `╎` glyphs are fixed dashed-line cells.

Animated routes: 0. Dot violations: 0. Dot spacing, movement direction, corner/bridge/head occupation, frame-0 origin, and synchronized arrival are **not applicable**, rather than successful animated-route tests. No dot appears on a corner, bridge, or arrowhead. The check's `origins: 0/0` and `arrivals: 0/0` are vacuous, not motion demonstrations. The `frames.ansi` diagram bodies are plain diagram text inside an ANSI shell transcript; they do not provide additional per-frame color-buffer evidence. Normal and selected ANSI files do provide border colors.

## Fit, measurements, and reported checks

The captured runtime viewport line, appearing in each frame transcript, is exactly:

`viewport: 83x51 zoom: 1.00 natural`

The saved `--check` viewport line is instead exactly:

`viewport: unknown zoom: 1.00 natural`

Thus checks do not independently certify fit to the required 77×47 viewport.

| View | Captured screen | Check extent | Visible graph bounding rectangle, including boxes/routes/graph labels | Visible bridges / touching bends | Check labels placed | Captured graph clipping |
|---|---|---|---|---|---|---|
| v1 | 83×51 @100% | 70×24 | [9,17,66,20] | 0 / 0 | 4/4 | none |
| v2 | 83×51 @100% | 80×24 | [4,17,76,20] | 0 / 0 | 3/3 | none |
| v3 | 83×51 @100% | 38×32 | [25,13,34,28] | 0 / 0 | 3/3 | none |
| v4 | 83×51 @100% | 34×48 | [25,3,34,48] | 0 / 0 | 5/5 | none |

Each check reports `crossings: 0 bridges, 0 touching bends`, matching the visible geometry. Each reports 0 labels on route cells, 0 skipped labels, and 0 ambiguous owners, consistent with the captures. Checks count edge labels only, not all 35 graph-label occurrences. All final labels, border sides and arrowheads are visible at 83×51 without pan or zoom. There is no visible overflow warning in the normal 83×51 grids. The v4 cf bottom border is at row 50, with the ANSI capture's last row 51 blank; it is not hidden under the control palette.

### Required 77×47 comparison

- **v1:** check extent 70×24 is numerically within 77×47. Actual final-spec fit at that viewport remains unproven by the pinned evidence.
- **v2:** check extent **80 columns exceeds 77 by 3**. Therefore its natural layout is over budget at 77 columns, despite being fully readable at captured width 83. Do not mistake the 76-column visible box span for the reported 80-column layout extent, or infer exactly three clipped label columns from that extent difference.
- **v3:** check extent 38×32 is numerically within 77×47. Actual final-spec fit at that viewport remains unproven by the pinned evidence.
- **v4:** check extent **48 rows exceeds 47 by 1**, before accounting for the screen header. The observed graph itself occupies 48 rows, from row 3 to row 50, so it cannot be wholly visible in a 47-row screen at unchanged character scale. It is over budget for the required viewport, even though nothing is clipped at 83×51.

Supplemental, unmanifested `vN-77x47.txt` captures have five repeated frames each. They are not substituted for the pinned evidence:

- v1 and v3 have 77×47 titles, no overflow text, and all their node labels intact.
- v2 has `graph overflows · drag to pan` and all four node labels intact. Block/minimap-like glyphs appear at columns 57–70 on rows 40–43, apart from the graph boxes. This illustrates an overflow warning without proving a particular label is clipped.
- v4 has `graph overflows · drag to pan`; the annotation top border and cf bottom border are absent from its visible screen. The annotation row starts with the visible fragment `no v6 (ULA), no committed`, followed by the overflow warning, so the complete `no v6 (ULA), no committed rate` label is not readable there. Block/minimap-like glyphs are at columns 61–66 on rows 38–45, not over graph borders. This is not a palette-overwritten border in the 83×51 final capture; it is separate smaller-screen clipping/overlay evidence with missing pinned provenance.
- The explicitly pinned rejected `v4-a1` dump is visibly a different graph, including overlapping annotation boxes and different labels. It is excluded from final-view counts and cannot repair this evidence gap.

## Blind scorecard

Counts are node/edge/label **occurrences across the four final views**, not a deduplicated network inventory. `labels` means node labels plus edge labels; UI/header labels are separately counted. No rubric-based quality score is invented before stage B.

```json
{
  "stage": "A",
  "case": "homelab-nic-trace",
  "round": "05",
  "coordinate_basis": "1-based screen cells",
  "per_view": {
    "v1": {"visible_nodes": 5, "visible_edges": 4, "node_labels": 5, "edge_labels": 4, "labels": 9, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 4, "uncertain_label_owners": 0, "clipped_items_at_83x51": 0, "selected_node_occurrences": 5, "node_occurrences": 5, "dot_violations": 0, "dots_per_frame": [0,0,0,0,0], "check_extent": [70,24], "extent_exceeds_77x47": false, "pinned_final_77x47_fit_proven": false},
    "v2": {"visible_nodes": 4, "visible_edges": 3, "node_labels": 4, "edge_labels": 3, "labels": 7, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 4, "uncertain_label_owners": 0, "clipped_items_at_83x51": 0, "selected_node_occurrences": 4, "node_occurrences": 4, "dot_violations": 0, "dots_per_frame": [0,0,0,0,0], "check_extent": [80,24], "extent_exceeds_77x47": true, "pinned_final_77x47_fit_proven": false},
    "v3": {"visible_nodes": 4, "visible_edges": 3, "node_labels": 4, "edge_labels": 3, "labels": 7, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 0, "uncertain_label_owners": 0, "clipped_items_at_83x51": 0, "selected_node_occurrences": 4, "node_occurrences": 4, "dot_violations": 0, "dots_per_frame": [0,0,0,0,0], "check_extent": [38,32], "extent_exceeds_77x47": false, "pinned_final_77x47_fit_proven": false},
    "v4": {"visible_nodes": 7, "visible_edges": 5, "node_labels": 7, "edge_labels": 5, "labels": 12, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 0, "uncertain_label_owners": 0, "annotation_scope_ambiguities": 1, "clipped_items_at_83x51": 0, "selected_node_occurrences": 7, "node_occurrences": 7, "dot_violations": 0, "dots_per_frame": [0,0,0,0,0], "check_extent": [34,48], "extent_exceeds_77x47": true, "pinned_final_77x47_fit_proven": false}
  },
  "totals": {
    "visible_nodes": 20,
    "visible_edges": 15,
    "traceable_edges": 15,
    "visible_arrowheads": 15,
    "dashed_edges": 3,
    "node_labels": 20,
    "edge_labels": 15,
    "labels": 35,
    "ui_header_and_control_labels": 20,
    "labels_including_ui": 55,
    "crossings": 0,
    "bridges": 0,
    "touching_bends": 0,
    "ordinary_route_bends": 8,
    "route_junctions": 0,
    "box_level_fanouts": 1,
    "box_level_convergences": 1,
    "uncertain_label_owners": 0,
    "annotation_scope_ambiguities": 1,
    "labels_on_route_cells": 0,
    "clipped_items_at_83x51": 0,
    "pan_or_zoom_required_items_at_83x51": 0,
    "complete_normal_node_borders": 20,
    "complete_selected_node_borders": 20,
    "node_border_palette_overwritten_cells": 0,
    "selected_state_coverage": {"captured": 20, "total": 20},
    "animated_routes": 0,
    "visible_flow_dots": 0,
    "dot_violations": 0,
    "final_views_with_pinned_77x47_fit_proof": 0,
    "views_over_77x47_by_reported_extent": 2,
    "unsupported_or_unreadable_evidence_files": 0
  },
  "evidence_gaps": [
    "No pinned 77x47 capture of any final spec; pinned v4-a1 capture is rejected and not final v4.",
    "Saved check viewport is unknown; actual final-pane evidence is 83x51.",
    "Supplemental vN-77x47.txt files are not hash-bound by the saved manifests.",
    "No saved routes N/M near-minimal statistic.",
    "Frame transcript diagram bodies do not contain per-cell ANSI colors; color continuity comes from normal and selected ANSI captures."
  ]
}
```

## Readability and stopping point

All examined formats were readable: JSON specs/manifests, text captures/checks, SGR ANSI normal/selected captures, and frame transcripts. No examined evidence file was unsupported or unreadable. The absence of pinned final target-size evidence is a provenance/coverage gap, not a decoding failure. No required motion behavior is inferred from the static specs.

This record is saved before receiving expectations and must not be modified later. Stage B has not been performed.
