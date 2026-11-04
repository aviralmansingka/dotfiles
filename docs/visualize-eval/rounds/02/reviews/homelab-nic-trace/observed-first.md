# homelab-nic-trace — round 02, Stage A blind observation

This record uses only the supplied final captures and `v1.json`, `v2.json`, and `v3.json`. I read the blind-task contract first. I did not read expectations, a source brief, a rubric, other cases, or earlier results. I did not open a viewer, re-render, change a spec, or treat a check/validator/generator claim as visual evidence.

## Evidence and coordinate convention

For each of v1, v2, and v3 I read the complete `*-text.txt`, `*-ansi.ansi`, `*-selected.ansi`, `*-frames.txt`, and `*-frames.ansi` in `homelab-nic-trace/evidence/<view>/`. All these files were readable. Coordinates below are 1-based cells of the diagram viewport, with its status line as row 1. Bounds are `[column,row,width,height]`. Route points use `(column,row)`. Labels are transcribed from captures, not substituted from the spec. I used a small offline ANSI-cell extraction to confirm coordinates and perimeter colors; it read saved files only.

The three ordinary ANSI captures each contain 47 rows of 77 cells. Text motion captures have timestamp headings and shell scrollback around each diagram: those surrounding lines are not diagram labels. The diagram portions of the motion `.ansi` captures contain plain glyphs without ANSI color styling; their shell scrollback is colored. Motion therefore proves glyph positions, not motion-frame border colors.

## Blind scorecard

Counts are occurrences across the three final views, not deduplicated concepts. “Labels” counts node and edge labels, excluding UI chrome.

```json
{
  "case": "homelab-nic-trace",
  "stage": "A",
  "views": 3,
  "visible_nodes": 16,
  "visible_edges": 14,
  "visible_arrowheads": 14,
  "traceable_routes": 14,
  "visible_labels": 30,
  "visible_node_labels": 16,
  "visible_edge_labels": 14,
  "crossings": 0,
  "bridge_glyphs": 0,
  "inter_edge_junctions": 0,
  "uncertain_label_owners": 3,
  "fused_label_pairs": 0,
  "clipped_items": 0,
  "normal_border_occurrences_checked": 16,
  "normal_border_occurrences_uncheckable": 0,
  "selected_state_covered": 16,
  "selected_state_total": 16,
  "dot_count_violations_observed": 0,
  "dot_corner_bridge_junction_arrowhead_violations_observed": 0,
  "stationary_animated_routes_in_sample": 2,
  "measured_viewports": {"v1": "77x47", "v2": "77x47", "v3": "77x47"},
  "measured_zoom": "1.00 natural",
  "unreadable_capture_files": 0
}
```

There are additionally 15 UI label occurrences: one status line and four control labels per view. Zero observed dot-hazard violations does **not** certify unsampled animation times. Two requested animated routes show no displacement at the sampled timestamps, as detailed below.

## Every visible content label

### v1 — 8 node labels, 8 edge labels

| Kind | Verbatim visible label | Bounds |
|---|---|---|
| node | `VM vnet0` | [10,11,8,1] |
| node | `ctr veth` | [35,11,8,1] |
| node | `virbr0` | [11,19,6,1] |
| node | `docker0` | [35,19,7,1] |
| node | `homelab host v6 ULA` | [4,27,19,1] |
| node | `tailscale0` | [9,36,10,1] |
| node | `bond0 192.168.1.197` | [29,36,19,1] |
| node | `wlp8s0 192.168.1.213` | [54,36,20,1] |
| edge | `192.168.122.x` | [12,15,13,1] |
| edge | `172.18.2.x` | [37,15,10,1] |
| edge | `NAT bridge` | [13,22,10,1] |
| edge | `docker bridge` | [15,23,13,1] |
| edge | `backup path` | [25,30,11,1] |
| edge | `eno1 2.5 GbE` | [10,32,12,1] |
| edge | `overlay` | [3,34,7,1] |
| edge | `UDP encap` | [19,34,9,1] |

### v2 — 4 node labels, 3 edge labels

| Kind | Verbatim visible label | Bounds |
|---|---|---|
| node | `bond0` | [31,16,5,1] |
| node | `wlp8s0` | [54,16,6,1] |
| node | `Fios rtr? 192.168.1.1 NAT/DHCP` | [18,24,30,1] |
| node | `ONT? 169.254.3.1` | [25,32,16,1] |
| edge | `default 0.5 ms` | [17,19,14,1] |
| edge | `metric 600` | [32,20,10,1] |
| edge | `NAT 71.251.12.240` | [20,28,17,1] |

### v3 — 4 node labels, 3 edge labels

| Kind | Verbatim visible label | Bounds |
|---|---|---|
| node | `ONT? 169.254.3.1` | [31,12,16,1] |
| node | `Verizon edge` | [33,20,12,1] |
| node | `AS701` | [37,28,5,1] |
| node | `AS13335` | [36,36,7,1] |
| edge | `4.5 ms` | [33,16,6,1] |
| edge | `6.6 ms` | [31,26,6,1] |
| edge | `6-9 ms` | [39,32,6,1] |

### UI labels in all views

The status text has one leading blank cell, excluded from its bounds. Each line below is at [2,1,66,1] in its respective view:

- v1: `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 8 edges · q quit`
- v2: `rataflow-view · 77x47 @100% · v2.json · 4 nodes · 3 edges · q quit`
- v3: `rataflow-view · 77x47 @100% · v3.json · 4 nodes · 3 edges · q quit`

Each view also has these four labels, with leading layout padding excluded:

| Verbatim visible label | Bounds in each view |
|---|---|
| `+ [+]` | [4,42,5,1] |
| `− [-]` | [4,43,5,1] |
| `⊡ [f]` | [4,44,5,1] |
| `□ [i]` | [4,45,5,1] |

No two content labels fuse into an unseparated word. There are labels touching route glyphs, which is a different issue: v2 `default 0.5 ms` ends at column 30 immediately beside a vertical route at column 31; `metric 600` begins immediately after the bend at (31,20). In v3 `6.6 ms` ends immediately before the down arrow at (37,26).

## Arrow traces from the captures

All 14 endpoint pairs are followable as routes without guessing which corridor to take. This does not mean all edge-label ownership is clear. Arrowheads remain present in all five sampled frames. A point sequence below lists the first visible route cell, every bend, and the arrowhead, not the border cell itself.

### v1

| ID | Visible source → visible target | Direction and complete route | Arrowhead | Followable? |
|---|---|---|---|---|
| A | `VM vnet0` → `virbr0` | down from (10,14), bend (10,16), adjacent bend (11,16), down to (11,17) | `▼` at (11,17) | yes |
| B | `ctr veth` → `docker0` | straight down (35,14)–(35,17) | `▼` at (35,17) | yes |
| C | `virbr0` → `homelab host v6 ULA` | down (11,22), left at (11,23), down at (4,23), end (4,25) | `▼` at (4,25) | yes |
| D | `docker0` → `homelab host v6 ULA` | down (35,22), left at (35,24), down at (6,24), end (6,25) | `▼` at (6,25) | yes |
| E | `tailscale0` → `homelab host v6 ULA` | leave left at (7,36), left to (1,36), up to (1,27), right to (2,27) | `▶` at (2,27) | yes; the entire left-edge corridor is visible |
| F | `tailscale0` → `bond0 192.168.1.197` | straight right (20,36)–(27,36) | `▶` at (27,36) | yes |
| G | `homelab host v6 ULA` → `bond0 192.168.1.197` | down (4,30), right at (4,33), down at (29,33), end (29,34) | `▼` at (29,34) | yes |
| H | `homelab host v6 ULA` → `wlp8s0 192.168.1.213` | down (6,30), right at (6,31), down at (54,31), end (54,34) | `▼` at (54,34) | yes |

All v1 routes are solid muted lines. A's two adjacent bends at (10,16) and (11,16) form a one-cell jog: they touch each other as part of the same route, not a branch.

### v2

| ID | Visible source → visible target | Direction and complete route | Arrowhead | Followable? |
|---|---|---|---|---|
| I | `bond0` → `Fios rtr? 192.168.1.1 NAT/DHCP` | down (31,19), left at (31,20), down at (18,20), end (18,22) | `▼` at (18,22) | yes |
| J | `wlp8s0` → `Fios rtr? 192.168.1.1 NAT/DHCP` | down (54,19), left at (54,21), down at (20,21), end (20,22) | `▼` at (20,22) | yes |
| K | `Fios rtr? 192.168.1.1 NAT/DHCP` → `ONT? 169.254.3.1` | down (18,27), right at (18,29), down at (25,29), end (25,30) | `▼` at (25,30) | yes |

I and J are solid; K has visibly dashed vertical/horizontal strokes (`╎` and `╌`), with ordinary solid bend/arrow glyphs.

### v3

| ID | Visible source → visible target | Direction and complete route | Arrowhead | Followable? |
|---|---|---|---|---|
| L | `ONT? 169.254.3.1` → `Verizon edge` | down (31,15), right at (31,17), down at (33,17), end (33,18) | `▼` at (33,18) | yes |
| M | `Verizon edge` → `AS701` | down (33,23), right at (33,25), down at (37,25), end (37,26) | `▼` at (37,26) | yes |
| N | `AS701` → `AS13335` | down (37,31), left at (37,33), down at adjacent bend (36,33), end (36,34) | `▼` at (36,34) | yes |

L is visibly dashed; M and N are solid. N has two touching adjacent bend glyphs at (36,33) and (37,33), a one-cell jog on a single route.

## Crossings, close bends, junctions, and apparent branches

- No route-route crossing, bridge glyph, shared corridor, or inter-edge junction is visible in any view. There are no visible T-junction or four-way junction glyphs.
- v1 C and D are closely nested: C's horizontal run is row 23, columns 4–11; D's row-24 bend (6,24) lies directly below that run and its horizontal run continues right to column 35. There is no blank row between these runs locally. This is a close/touching-looking bend arrangement, but the `╭` at (6,24) opens right/down, not upward into C. The two down arrowheads at (4,25) and (6,25) remain separate. It is not a drawn branch.
- v2 I and J repeat this close nested pattern: I runs across row 20, columns 18–31; J's bend (20,21) is directly below it and runs right to column 54. Again the lower bend opens right/down and does not join the upper run. Arrowheads (18,22) and (20,22) remain separate.
- The same-route adjacent bend pairs in v1 A and v3 N are listed above. Every other route bend is in the route tables; none touches a different route at the same cell.
- v1 the host box receives two arrows from above and one from its left; it emits two distinct bottom-port routes. These are node-level fan-in/fan-out, not an edge splitting in the corridor. `tailscale0` emits two independent routes, left and right. `bond0 192.168.1.197` receives separate top and left arrows. No common drawn trunk is visible.
- v2 the router box receives two separate top arrows and emits a bottom route. v3 is a single chain. Nothing in these captures shows a route branching before a node.

## Uncertain edge-label owners

Three labels have uncertain ownership on the capture alone:

1. v1 `eno1 2.5 GbE` [10,32,12,1] sits between the host-to-wireless horizontal on row 31 and the host-to-bond horizontal on row 33, one row from each. Its owner cannot be assigned solely by proximity. The spec intends G, but that is not visual proof.
2. v1 `UDP encap` [19,34,9,1] is immediately left of G's down arrow at (29,34), below G's horizontal and above the bottom-row boxes. The intended F horizontal is on row 36, with a box top on row 35 beneath the label's left part. The label can readily be read as G's label instead. The spec intends F; the capture does not securely attach it there.
3. v2 `metric 600` [32,20,10,1] starts immediately after I's bend at (31,20), while J's horizontal is one row below. It can read as attached to I or as a label above J. The spec intends J; capture ownership remains uncertain.

Other edge labels are readable and locally attributable: `192.168.122.x` to A, `172.18.2.x` to B, `NAT bridge` to C, `docker bridge` to D, `overlay` beside E's left vertical, `backup path` above H, `default 0.5 ms` to I, `NAT 71.251.12.240` to K, and each v3 latency to the adjacent chain segment. No label is visibly erased or cut off.

## Borders and selected-state coverage

I checked the complete top, bottom, left, right, and four corners of all 16 node occurrences in the ordinary ANSI captures and all 16 in the selected ANSI captures. None is uncheckable. All have complete rounded rectangles, with no route-colored cell replacing a side/corner. The route contacts outside borders do not break border color continuity.

The table gives observed box bounds and the exact ordinary-border foreground RGB. Every perimeter cell in each listed box has that one color. All selected perimeters have the same geometry and are continuously bold RGB (216,166,87), including all four corners and complete sides. Background is RGB (40,40,40). Labels use RGB (235,219,178); ordinary edge glyphs use RGB (124,111,100). Normal dots use RGB (216,166,87).

| View | Node occurrence | Box bounds | Ordinary border RGB | Complete / color-continuous normal and selected |
|---|---|---|---|---|
| v1 | `VM vnet0` | [9,10,10,4] | (216,166,87) | yes / yes |
| v1 | `ctr veth` | [34,10,10,4] | (228,184,111) | yes / yes |
| v1 | `virbr0` | [10,18,8,4] | (125,174,163) | yes / yes |
| v1 | `docker0` | [34,18,9,4] | (147,194,183) | yes / yes |
| v1 | `homelab host v6 ULA` | [3,26,21,4] | (211,134,155) | yes / yes |
| v1 | `tailscale0` | [8,35,12,4] | (169,182,101) | yes / yes |
| v1 | `bond0 192.168.1.197` | [28,35,21,4] | (125,160,184) | yes / yes |
| v1 | `wlp8s0 192.168.1.213` | [53,35,22,4] | (151,184,206) | yes / yes |
| v2 | `bond0` | [30,15,7,4] | (216,166,87) | yes / yes |
| v2 | `wlp8s0` | [53,15,8,4] | (228,184,111) | yes / yes |
| v2 | `Fios rtr? 192.168.1.1 NAT/DHCP` | [17,23,32,4] | (125,174,163) | yes / yes |
| v2 | `ONT? 169.254.3.1` | [24,31,18,4] | (211,134,155) | yes / yes |
| v3 | `ONT? 169.254.3.1` | [30,11,18,4] | (216,166,87) | yes / yes |
| v3 | `Verizon edge` | [32,19,14,4] | (125,174,163) | yes / yes |
| v3 | `AS701` | [36,27,7,4] | (147,194,183) | yes / yes |
| v3 | `AS13335` | [35,35,9,4] | (211,134,155) | yes / yes |

Selected-state coverage is **16/16**, from simultaneous `--select-all` captures, not from sixteen individual interaction recordings. This proves each occurrence's selected border is captured, not that individual focus/navigation was exercised. Motion frames cannot independently establish border color because their diagram bodies have no color escapes.

The control panel rectangle is also complete in every view, [2,41,9,6], with continuous RGB (168,153,104) border and square corners; it is not counted as a node.

## Motion — all animated routes, every timestamp

The supplied motion sample contains five frames at 0, 100, 200, 300, and 400 ms, in each view. Each route has exactly one visible `●` in every frame: totals are 8,8,8,8,8 in v1 and 3,3,3,3,3 in each of v2 and v3. There is therefore no within-route inter-dot spacing to measure. Dots on different routes are not a multi-dot stream.

Table entries are the sole visible dot's `(column,row)` at each timestamp. Route IDs refer to the capture traces above.

| View / route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms | Observed direction / cadence |
|---|---|---|---|---|---|---|
| v1 A | (10,15) | (10,15) | (10,15) | (10,15) | (10,15) | stationary at all sampled times; no direction demonstrated |
| v1 B | (35,15) | (35,16) | (35,15) | (35,16) | (35,15) | down one cell, then resets upward; two-position / 200-ms repeat |
| v1 C | (10,23) | (9,23) | (8,23) | (7,23) | (6,23) | left, one cell per 100 ms, toward target |
| v1 D | (35,23) | (34,24) | (33,24) | (32,24) | (31,24) | down/left past the bend, then left one cell per 100 ms |
| v1 E | (6,36) | (5,36) | (4,36) | (3,36) | (2,36) | left one cell per 100 ms, initially away from the box toward the return corridor |
| v1 F | (21,36) | (22,36) | (23,36) | (24,36) | (25,36) | right one cell per 100 ms toward target |
| v1 G | (4,31) | (4,32) | (5,33) | (6,33) | (7,33) | down, then right; one sampled step per 100 ms, with a bend skipped |
| v1 H | (7,31) | (8,31) | (9,31) | (10,31) | (11,31) | right one cell per 100 ms toward target |
| v2 I | (30,20) | (29,20) | (28,20) | (27,20) | (26,20) | left one cell per 100 ms toward target |
| v2 J | (54,20) | (53,21) | (52,21) | (51,21) | (50,21) | down/left past bend, then left one cell per 100 ms |
| v2 K | (18,28) | (19,29) | (20,29) | (21,29) | (22,29) | down/right past bend, then right one cell per 100 ms |
| v3 L | (31,16) | (32,17) | (31,16) | (32,17) | (31,16) | down/right past bend, resets up/left; two-position / 200-ms repeat |
| v3 M | (33,24) | (34,25) | (35,25) | (36,25) | (33,24) | down/right then right; reset at 400 ms, four-position / 400-ms repeat |
| v3 N | (37,32) | (37,32) | (37,32) | (37,32) | (37,32) | stationary at all sampled times; no direction demonstrated |

At each sampled timestamp, every dot is on a straight segment, never on a corner, bridge, junction, node border, or arrowhead. Bend-skipping steps are diagonal changes in successive cell positions, not proof of occupying the intermediate corner. No bridge or junction exists here for a dot to occupy.

C, D, E, F, G, H, I, J, and K show forward progress along a portion of their route during the sample; their full transit/period is not captured. B, L, and M visibly repeat a short sub-sequence instead of showing full endpoint-to-endpoint travel. A and N are motion-evidence shortcomings: exactly one dot is present, but sampled motion is absent. I do not infer unseen animation from the spec or the presence of a `--frames` command. Frame timestamps establish sampling cadence, not live wall-clock smoothness.

## Fit, clipping, and missing evidence

All three captures show the status token `77x47 @100%`. The scrollback in each corresponding frames capture contains the exact line:

`viewport: 77x47 zoom: 1.00 natural`

This line appears for the ordinary, selected, and frame command sequences. The ordinary ANSI grids independently measure 77 columns × 47 rows. All visible content is within those bounds. Node/edge/label content fits without pan or zoom in each supplied view. The v1 return corridor is exactly on column 1, but its corner and vertical cells are present rather than cut off. Lowest node borders are row 38 in v1/v3 and row 34 in v2; the control panel ends at row 46 with row 47 blank. No viewport warning or visibly truncated label appears.

The case is presented as three separate views; there is no single combined capture. Fit claims here apply separately to these captures, not to an unprovided whole-case canvas. No interactive pan/zoom or per-node selection navigation recording is supplied. The motion sample is only 400 ms long, and its diagram frames do not preserve ANSI colors. These are evidence limits, not assumptions about hidden content.

All required named capture formats were readable. No unsupported or missing required capture file was encountered. This document is the saved blind record; after hashing it I will not modify it in Stage B.
