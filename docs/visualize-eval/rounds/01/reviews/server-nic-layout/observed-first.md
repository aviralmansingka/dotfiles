# ASTRA blind observations — server-nic-layout, round01, Stage A

This is an observed-first record, not a rubric verdict or a comparison with expected data. I inspected only the allowed final captures and measured dimension records. No specs, source briefs, renderer/generator code, generator audits, prior rounds, or superseded captures were consulted. No pane/session operations were performed.

## Evidence and coordinate convention

Capture root: `docs/visualize-eval/rounds/01/server-nic-layout/captures/`.

Inspected files:
- `vA/unselected.text.txt`, `vA/unselected.ansi.txt`, `vA/selected-1.text.txt`, `vA/selected-1.ansi.txt`, `vA/selected-2.text.txt`, `vA/selected-2.ansi.txt`, `vA/frame1.text.txt`, `vA/frame2.text.txt`, `vA/stty-size.raw.txt`.
- `vB/unselected.text.txt`, `vB/unselected.ansi.txt`, `vB/selected-1.text.txt`, `vB/selected-1.ansi.txt`, `vB/selected-2.text.txt`, `vB/selected-2.ansi.txt`, `vB/frame1.text.txt`, `vB/frame2.text.txt`, `vB/frame3.text.txt`, `vB/frame4.text.txt`, `vB/stty-size.raw.txt`.

All rectangles below are **1-based [column,row,width,height]**, including single cells. Short filenames resolve beneath the capture root above. I read the raw text and independently decoded ANSI SGR foreground/background runs with an ad hoc Python parser, run through `uv`. No generator helper was used.

Both `stty-size.raw.txt` files visibly report `47 77` (rows, columns). Each of the six ANSI captures has 47 rows, each 77 cells wide. Corresponding text captures match ANSI characters on all their 46 stored rows after trailing-space removal; the remaining ANSI row is blank. This is not missing graph content. The task states 100%; no numerical zoom indicator is visible, so the capture alone does not independently establish zoom percentage.

## vA — visible objects and border geometry

Primary evidence: `vA/unselected.text.txt` and `vA/unselected.ansi.txt`; geometry is unchanged in both selected pairs and both frames.

| Visible node label | Label rectangle | Node rectangle | Unselected border RGB |
|---|---|---|---|
| 7 NICs dark | [13,10,11,1] | [12,9,13,4] | (216,166,87) |
| server2 R7725 .59 | [34,10,17,1] | [33,9,19,4] | (228,184,111) |
| spare .60-.62 | [57,10,13,1] | [56,9,15,4] | (200,147,68) |
| server1 R7725 .58 | [10,19,17,1] | [9,18,19,4] | (125,174,163) |
| eno16595np0 25 GbE | [10,28,18,1] | [9,27,20,4] | (211,134,155) |
| Arista .57 AS132717 | [9,37,19,1] | [8,36,21,4] | (169,182,101) |

Each of these six nodes has a complete top, bottom, left and right side, with rounded corners `╭ ╮ ╰ ╯`. Specific side rectangles, including their corner cells:

| Node | Top | Bottom | Left | Right |
|---|---|---|---|---|
| 7 NICs dark | [12,9,13,1] | [12,12,13,1] | [12,9,1,4] | [24,9,1,4] |
| server2 | [33,9,19,1] | [33,12,19,1] | [33,9,1,4] | [51,9,1,4] |
| spare | [56,9,15,1] | [56,12,15,1] | [56,9,1,4] | [70,9,1,4] |
| server1 | [9,18,19,1] | [9,21,19,1] | [9,18,1,4] | [27,18,1,4] |
| eno16595np0 | [9,27,20,1] | [9,30,20,1] | [9,27,1,4] | [28,27,1,4] |
| Arista | [8,36,21,1] | [8,39,21,1] | [8,36,1,4] | [28,36,1,4] |

The four corner locations are the endpoints of each listed top and bottom. All perimeter cells, including all corners, have the node's listed foreground color in the unselected ANSI capture. All node labels use (235,219,178), distinct from border colors. Background is (40,40,40).

### vA — inferred directed links and exact traces

The following links can be traced from source underside to a downward target arrow. These are observations, not assumptions from the header's edge count.

| Inferred source → target | Source stem | Remaining route and target head | Associated visible label |
|---|---|---|---|
| 7 NICs dark → server1 R7725 .58 | [13,13,1,3] immediately below source | elbow/horizontal [10,16,4,1]; `▼` [10,17,1,1], immediately above server1 | `7 dark ports` [15,14,12,1] |
| server1 R7725 .58 → eno16595np0 25 GbE | [10,22,1,4] | `▼` [10,26,1,1], above NIC | `only uplink` [12,24,11,1] |
| eno16595np0 25 GbE → Arista .57 AS132717 | [10,31,1,1] | elbow [9,32,2,1], vertical [9,33,1,2], `▼` [9,35,1,1] | `gw 0.1 ms` [12,31,9,1] |
| server2 R7725 .59 → Arista .57 AS132717 | [34,13,1,20] | elbow/horizontal [11,33,24,1], vertical [11,34,1,1], `▼` [11,35,1,1] | `same /29` [19,32,8,1] |
| spare .60-.62 → Arista .57 AS132717 | [57,13,1,21] | elbow/horizontal [13,34,45,1], `▼` [13,35,1,1] | `free? in /29` [29,35,12,1] |

Label associations follow adjacency: `same /29` is above the server2 horizontal run; `free? in /29` is below the spare horizontal run. Those two labels are farther from their source nodes than the other labels, but the separate horizontal runs make the associations readable. The question mark in `free?` is visible; I do not treat the spare addresses as definitely available.

The three Arista heads are separate, at columns 9, 11 and 13 of row 35. They do not share an incoming stem. The nested routes in [9,31,49,5] do not cross or join each other. No edge-edge crossing, T-junction, or false branch is visibly introduced. In particular, server2 and spare do not visibly connect to server1 or to its NIC; their long vertical routes bypass those boxes. No additional link is inferred merely from proximity or matching colors. All fixed edge strokes and arrowheads are muted (124,111,100).

### vA — selection, grouping, fit, animation

- `vA/selected-1.ansi.txt`: the full perimeter of `7 NICs dark` [12,9,13,4] gains SGR bold. Its color remains (216,166,87), already equal to the selection accent. Text-only captures cannot show this distinction.
- `vA/selected-2.ansi.txt`: the full perimeter of server2 [33,9,19,4] becomes bold (216,166,87), rather than its unselected (228,184,111). Other node borders retain their normal colors. No selected border side or corner retains a mismatched hue.
- No separate handle glyphs are visible in any of these captures. Thus handle-specific color/interaction is unobservable; source stems outside the boxes remain muted edges, not colored node handles.
- The top row [12,9,59,4] has three related gold/brown shades. Lower rows use teal, pink and green. This suggests layout-level grouping, but the top row combines dark NICs, a server and spare addresses; it does not visually establish a single semantic device class. There are no enclosing group boxes or group-name labels.
- A left-side chain descends from dark NICs through server1 and its named NIC to Arista. Two long side paths also descend into Arista. The wording suggests host/interface/address context, but exact real-world topology beyond the visible arrows is unknown.
- The diagram fits within [8,9,63,31], ending at column 70 and row 39. Labels and all border sides are present. No graph/control overlap or clipped label is visible.
- `vA/frame1.text.txt` and `vA/frame2.text.txt` show no dots or character changes. The header says `0 flows`. There is no demonstrated animation in this view.

## vB — visible objects and border geometry

Primary evidence: `vB/unselected.text.txt` and `vB/unselected.ansi.txt`; node and label geometry remains the same in both selected pairs and all four frames.

| Visible node label | Label rectangle | Node rectangle | Unselected border RGB |
|---|---|---|---|
| Arista .57 AS132717 | [30,12,19,1] | [29,11,21,4] | (216,166,87) |
| Airtel 14.143.x | [32,20,15,1] | [31,19,17,4] | (125,174,163) |
| Airtel BB 14.141.x | [31,28,18,1] | [30,27,20,4] | (211,134,155) |
| Cloudflare 1.1.1.1 | [31,36,18,1] | [30,35,20,4] | (169,182,101) |

| Node | Top | Bottom | Left | Right |
|---|---|---|---|---|
| Arista | [29,11,21,1] | [29,14,21,1] | [29,11,1,4] | [49,11,1,4] |
| Airtel 14.143.x | [31,19,17,1] | [31,22,17,1] | [31,19,1,4] | [47,19,1,4] |
| Airtel BB | [30,27,20,1] | [30,30,20,1] | [30,27,1,4] | [49,27,1,4] |
| Cloudflare | [30,35,20,1] | [30,38,20,1] | [30,35,1,4] | [49,35,1,4] |

All four sides and all rounded corner endpoints are complete for each node. Every perimeter cell has the corresponding single border RGB in the unselected ANSI. Label foreground and background match vA. No node label is truncated.

### vB — directed links and labels

| Inferred source → target | Source stem / complete corridor | Target head | Label |
|---|---|---|---|
| Arista .57 AS132717 → Airtel 14.143.x | [30,15,1,2], then rightward elbow run [30,17,3,1] | `▼` [32,18,1,1] | `transit 1.8 ms` [32,15,14,1] |
| Airtel 14.143.x → Airtel BB 14.141.x | [32,23,1,2], then leftward elbow [31,25,2,1] | `▼` [31,26,1,1] | `7.1 ms` [34,24,6,1] |
| Airtel BB 14.141.x → Cloudflare 1.1.1.1 | vertical [31,31,1,3] | `▼` [31,34,1,1] | `8.3 ms` [33,32,6,1] |

Dots sometimes replace an edge/corner character inside these corridors; the source stems and destination heads still identify the same chain. No crossings, junctions, false branches, reverse arrows, or extra links are visible. Each edge label sits beside its own isolated between-node corridor. All fixed edge strokes/heads are (124,111,100); dots are (216,166,87).

### vB — selection, grouping and fit

- `vB/selected-1.ansi.txt`: Airtel 14.143.x [31,19,17,4] has an entirely bold, accent-colored (216,166,87) perimeter, replacing its teal border.
- `vB/selected-2.ansi.txt`: Airtel BB [30,27,20,4] has an entirely bold, accent-colored perimeter, replacing its pink border. Airtel 14.143.x returns to teal. All four sides/corners are internally consistent in each capture. Separate handle glyphs are not visible.
- This is one centered, downward chain, apparently from a named switch/AS through two Airtel-labelled stages to a Cloudflare endpoint, with latency-like annotations. The two Airtel nodes share naming but not border hue. No explicit group enclosure or legend establishes stronger grouping.
- Arista repeats the same visible label across vA and vB, but changes from green in vA to gold in vB. Border hue is therefore not a stable cross-view identity color.
- Diagram extent [29,11,21,28] is entirely inside the measured 77×47 pane, with large unused horizontal margins. All four node borders and labels fit; no control overlap is visible.

### vB — observed frame changes, not an assumed animation rate

Each listed dot occupies [column,row,1,1].

| Capture | Visible dot locations |
|---|---|
| `vB/unselected.text.txt` / `.ansi.txt` | [30,16,1,1], [31,17,1,1], [32,25,1,1], [31,32,1,1] |
| `vB/selected-1.text.txt` / `.ansi.txt` | [30,17,1,1], [32,17,1,1], [32,24,1,1], [31,25,1,1], [31,32,1,1], [31,33,1,1] |
| `vB/selected-2.text.txt` / `.ansi.txt` | [31,17,1,1], [32,25,1,1], [31,32,1,1] |
| `vB/frame1.text.txt` | [30,17,1,1], [32,24,1,1], [31,25,1,1], [31,33,1,1] |
| `vB/frame2.text.txt` | [30,17,1,1], [32,24,1,1], [31,25,1,1], [31,32,1,1] |
| `vB/frame3.text.txt` | [30,17,1,1], [32,17,1,1], [32,24,1,1], [31,25,1,1], [31,33,1,1] |
| `vB/frame4.text.txt` | [30,17,1,1], [32,17,1,1], [32,25,1,1], [31,32,1,1] |

The changes demonstrate changing dot positions on the three corridors; boxes, text and heads stay fixed. In frame3, dots replace both corners of the top elbow [30,17,3,1], producing `●─●`; lower elbow dots similarly obscure the corner glyph momentarily. This is not evidence of a branch. No dots appear inside labels or on node borders in the inspected samples. These sparse samples do not establish smoothness, slowness, a measured frame rate, or unambiguous temporal travel direction. Arrowheads establish link direction independently. No timestamp-named records were found among the allowed capture-directory inputs.

## Remaining visible UI text

Both views show the header in [1,1,77,1] including its leading/trailing spaces (visible non-space text starts at column 2 and ends at column 76). vA reads `rataflow-view · vA-host-tor.json · 6 nodes · 5 edges · 0 flows · drag pan ·`; vB substitutes `vB-upstream.json · 4 nodes · 3 edges · 3 flows`. These filenames are visible labels only; the named JSON files were not opened. Header foreground is (102,92,84).

Both views have the same complete control box [2,41,9,6], with square corners and border (168,153,104). Its labels are `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], and `□ [i]` [4,45,5,1], in (235,219,178). The final bottom border is row 46; row 47 is blank in ANSI. No tooltip, separate legend, numerical zoom readout, or fit warning is visible.

## Blind-stage limits

I can recover six visible nodes/five directed links in vA and four visible nodes/three directed links in vB. All visible labels, route endpoints and perimeter colors are recorded above. Correctness against the intended source, omitted facts, intended false branches, intended conceptual groups, and compliance with a full rubric remain unjudged until Stage B. A real-world relationship not drawn here stays unknown rather than being invented.
