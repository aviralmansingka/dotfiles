# Round 04 — homelab-nic-trace — stage A blind observation

This record is based on the four supplied final specs and their existing text, ANSI, selected-state, pinned motion captures, and captured check diagnostics. No source, expected data, rubric, other case, earlier round, or candidate-attempt material was read. No viewer was launched and nothing was fixed. This is an observation record, not a claim of source completeness or factual network correctness. Coordinates are 1-based `[column,row,width,height]`; route coordinates are 1-based `(column,row)`. Each view has its own origin at the upper-left canvas cell, excluding the frame and viewport metadata lines.

## Spec hashes

Computed with `shasum -a 256` on the supplied files:

| Spec | SHA-256 |
|---|---|
| `v1.json` | `62b7d422292799f591c09328b69df9cfdfa63a18c806a007d1ce9abfe50c1d99` |
| `v2-lan.json` | `341c30f13c4bad79e5e49227fb58fbba97df639ea36ea41932456475cee729f1` |
| `v3-overlay.json` | `0ad360e08757b87c8ce57ee22626882363d76495947a22b0ec10920f147ca8d2` |
| `v4-wan.json` | `198f2eb19ac4537530f001de6e1173d25af2bec45489e8f123cb65c01f9f8b83` |

## Visible text — verbatim and located

These are semantic graph labels, including all their punctuation and abbreviated identifiers. Each label appears once in its specified graph position. A substring also occurring inside another label or the title is not counted again as an independent graph label.

### v1

| Kind | Visible label | Rectangle |
|---|---|---|
| node | `VM vnet0` | `[53,16,8,1]` |
| node | `ctr veth` | `[9,16,8,1]` |
| node | `virbr0 NAT bridge` | `[53,24,17,1]` |
| node | `dkbr 172.18.2.1` | `[9,24,15,1]` |
| node | `homelab ~/rack-bench` | `[31,32,20,1]` |
| edge | `192.168.122.x` | `[55,20,13,1]` |
| edge | `libvirt NAT` | `[38,28,11,1]` |
| edge | `172.18.2.x` | `[11,20,10,1]` |
| edge | `docker bridge` | `[14,28,13,1]` |

### v2-lan

| Kind | Visible label | Rectangle |
|---|---|---|
| node | `homelab ASUS/Linux7` | `[29,12,19,1]` |
| node | `bond0 192.168.1.197/24` | `[5,20,22,1]` |
| node | `wlp8s0 .213 failover` | `[53,20,20,1]` |
| node | `claimed Fios rtr 0.5ms` | `[29,28,22,1]` |
| node | `Fios path: 1 ISP` | `[29,36,16,1]` |
| edge | `eno1 2.5 GbE` | `[11,16,12,1]` |
| edge | `backup path` | `[37,16,11,1]` |
| edge | `192.168.1.1` | `[12,24,11,1]` |
| edge | `metric 600, not ECMP` | `[32,24,20,1]` |
| edge | `no committed rate` | `[31,32,17,1]` |

### v3-overlay

| Kind | Visible label | Rectangle |
|---|---|---|
| node | `tailscale0 100.113.153.49` | `[9,22,25,1]` |
| node | `homelab ~/rack-bench` | `[49,22,20,1]` |
| node | `bond0 192.168.1.197` | `[49,27,19,1]` |
| edge | `overlay` | `[37,20,7,1]` |
| edge | `UDP encap` | `[36,24,9,1]` |

### v4-wan

| Kind | Visible label | Rectangle |
|---|---|---|
| node | `Fios rtr: NAT, DHCP` | `[34,8,19,1]` |
| node | `claimed ONT 169.254.3.1` | `[9,16,23,1]` |
| node | `v6 internet` | `[59,16,11,1]` |
| node | `VZ agg 100.41.x` | `[9,24,15,1]` |
| node | `VZ bbone AS701` | `[9,32,14,1]` |
| node | `CF AS13335 1.1.1.1` | `[9,40,18,1]` |
| edge | `pool 71.251.12.240` | `[13,12,18,1]` |
| edge | `ULA only, no route` | `[38,12,18,1]` |
| edge | `4.5ms` | `[11,20,5,1]` |
| edge | `6.6ms` | `[11,28,5,1]` |
| edge | `6-9ms` | `[11,36,5,1]` |

### Persistent UI text

In every view, the following controls appear at these rectangles: `+ [+]` `[4,42,5,1]`, `− [-]` `[4,43,5,1]`, `⊡ [f]` `[4,44,5,1]`, `□ [i]` `[4,45,5,1]`. Their palette outline occupies `[2,41,9,6]` with square corners `(2,41)`, `(10,41)`, `(2,46)`, `(10,46)`.

The title text is one label per view, beginning at column 2, row 1 (the leading blank cell is not part of the label):

- v1: `rataflow-view · 77x47 @100% · v1.json · 5 nodes · 4 edges · q quit` `[2,1,61,1]`.
- v2-lan: `rataflow-view · 77x47 @100% · v2-lan.json · 5 nodes · 5 edges · q quit` `[2,1,65,1]`.
- v3-overlay: `rataflow-view · 77x47 @100% · v3-overlay.json · 3 nodes · 2 edges · q quit` `[2,1,69,1]`.
- v4-wan: `rataflow-view · 77x47 @100% · v4-wan.json · 6 nodes · 5 edges · q quit` `[2,1,65,1]`.

## Arrows and route traceability

The following coordinate polylines list the first exterior route cell, every bend, and the arrowhead cell. Consecutive coordinates connect along the indicated row or column. Every listed arrow is visible and its entire route is traceable without guessing. None is bidirectional. Arrowheads remain ordinary solid triangles even on the dashed route.

### v1: four solid, downward arrows

| Source → target | Route | Head |
|---|---|---|
| `VM vnet0` → `virbr0 NAT bridge` | `(53,19) → (53,22)` | `▼` at `(53,22)` |
| `ctr veth` → `dkbr 172.18.2.1` | `(9,19) → (9,22)` | `▼` at `(9,22)` |
| `virbr0 NAT bridge` → `homelab ~/rack-bench` | `(53,27) → (53,29) → (33,29) → (33,30)` | `▼` at `(33,30)` |
| `dkbr 172.18.2.1` → `homelab ~/rack-bench` | `(9,27) → (9,29) → (31,29) → (31,30)` | `▼` at `(31,30)` |

Ordinary route bends: `(9,29)` `╰`, `(31,29)` `╮`, `(33,29)` `╭`, `(53,29)` `╯`. The two incoming arrows use separate ports, not a junction. At columns 31 and 33 their closest runs leave column 32 empty. No crossings, bridge glyphs, touching bends, or shared runs.

### v2-lan: five solid, downward arrows

| Source → target | Route | Head |
|---|---|---|
| `homelab ASUS/Linux7` → `bond0 192.168.1.197/24` | `(29,15) → (29,17) → (5,17) → (5,18)` | `▼` at `(5,18)` |
| `homelab ASUS/Linux7` → `wlp8s0 .213 failover` | `(31,15) → (31,17) → (53,17) → (53,18)` | `▼` at `(53,18)` |
| `bond0 192.168.1.197/24` → `claimed Fios rtr 0.5ms` | `(5,23) → (5,25) → (29,25) → (29,26)` | `▼` at `(29,26)` |
| `wlp8s0 .213 failover` → `claimed Fios rtr 0.5ms` | `(53,23) → (53,25) → (31,25) → (31,26)` | `▼` at `(31,26)` |
| `claimed Fios rtr 0.5ms` → `Fios path: 1 ISP` | `(29,31) → (29,34)` | `▼` at `(29,34)` |

Ordinary bends: `(5,17)` `╭`, `(29,17)` `╯`, `(31,17)` `╰`, `(53,17)` `╮`, `(5,25)` `╰`, `(29,25)` `╮`, `(31,25)` `╭`, `(53,25)` `╯`. The apparent fan-out and fan-in are through distinct source/target ports on boxes, not line junctions. Closest paired columns 29 and 31 retain a blank column between them. No crossings, bridges, touching bends, shared corridors, or false branches.

### v3-overlay: two solid, rightward arrows

| Source → target | Route | Head |
|---|---|---|
| `tailscale0 100.113.153.49` → `homelab ~/rack-bench` | `(35,21) → (46,21) → (46,22) → (47,22)` | `▶` at `(47,22)` |
| `tailscale0 100.113.153.49` → `bond0 192.168.1.197` | `(35,23) → (45,23) → (45,27) → (47,27)` | `▶` at `(47,27)` |

Ordinary bends: `(46,21)` `╮`, `(46,22)` `╰`, `(45,23)` `╮`, `(45,27)` `╰`. The routes leave separate right-side source ports. Near `(45,23)` and `(46,22)` the routes are diagonally adjacent, not touching or joined. No crossings or bridges. The longer lower route is a modest dogleg to the lower destination, not a loop. The upper dot obscures the bend at `(46,22)` in the final pinned frame, but other frames and the standalone capture establish its continuity.

### v4-wan: five downward arrows, one dashed route

| Source → target | Route | Style/head |
|---|---|---|
| `Fios rtr: NAT, DHCP` → `claimed ONT 169.254.3.1` | `(34,11) → (34,13) → (9,13) → (9,14)` | solid; `▼` at `(9,14)` |
| `Fios rtr: NAT, DHCP` → `v6 internet` | `(36,11) → (36,13) → (59,13) → (59,14)` | dashed; `▼` at `(59,14)` |
| `claimed ONT 169.254.3.1` → `VZ agg 100.41.x` | `(9,19) → (9,22)` | solid; `▼` at `(9,22)` |
| `VZ agg 100.41.x` → `VZ bbone AS701` | `(9,27) → (9,30)` | solid; `▼` at `(9,30)` |
| `VZ bbone AS701` → `CF AS13335 1.1.1.1` | `(9,35) → (9,38)` | solid; `▼` at `(9,38)` |

Ordinary solid bends: `(9,13)` `╭`, `(34,13)` `╯`. The dashed route has `╎` at `(36,11)` and `(36,12)`, `╶` at `(36,13)`, horizontal `╌` through `(37,13)`–`(58,13)`, and `╷` at `(59,13)`. These are its own two bend/end glyphs, not crossings or junctions. Distinct source ports, no bus. No crossings, bridges, touching route bends, or route loops. The palette/node-border collision below is a UI overlap, not an edge crossing.

## Label ownership and identifier/qualifier observations

**One uncertain label owner: v2-lan `no committed rate`.** Its rectangle is `[31,32,17,1]`; its middle cell is `(39,32)`. Independently measured Manhattan distances from this middle cell:

- Own router→Fios vertical route at `(29,32)`: **10 cells**.
- Competing wlp→router horizontal route at `(39,25)`: **7 cells**.

Thus the reported 10-versus-7 ambiguity is reproducible without relying on the generator's judgment. The whole-label nearest-cell metric tells a different, useful part of the visual story: the leftmost label cell `(31,32)` is only 2 cells from its own route, whereas the nearest competing route is 7 rows above the label. Its row and immediately adjacent left-hand vertical route make the intended ownership reasonably inferable locally, but its wide center lies nearer another route; I retain **one** uncertain owner rather than claiming unqualified clarity. No other graph label appears owner-ambiguous. None lies directly on route cells.

All 35 graph labels in the specs are readable verbatim in the corresponding captures. This establishes rendering fidelity, not completeness against the withheld source. Specifically:

- The addresses actually visible are `192.168.122.x`, `172.18.2.x`, `172.18.2.1`, `192.168.1.197/24`, `192.168.1.1`, shorthand `.213`, `100.113.153.49`, `192.168.1.197` without prefix length in the overlay view, `169.254.3.1`, `71.251.12.240`, `100.41.x`, and `1.1.1.1`.
- `wlp8s0 .213 failover` does not spell out a full IPv4 address; a reader must infer any omitted prefix. `VZ agg 100.41.x` is also deliberately abbreviated. No expanded addresses are visible elsewhere in those respective views.
- `claimed` appears explicitly on the LAN Fios router and WAN ONT labels. It is not on the WAN router label. There is **no visible `historical` marker in any view**.
- `failover`, `backup path`, `metric 600, not ECMP`, `no committed rate`, `ULA only, no route`, `NAT`, `DHCP`, and the RTT strings are visible as transcribed. The IPv6 node name alone would imply a destination; the adjacent negative qualifier and dashed route supply the visible qualification.
- The WAN ONT/aggregation/backbone/Cloudflare chain uses **solid** arrows, including the RTT-bearing hops. Only the route to `v6 internet` is dashed. There is no visible dashed traceroute-hop chain or legend marking those solid hops as unconfirmed/historical. Whether such marking is required cannot be established without stage-B expectations.

## Borders and color evidence

The following rectangles are whole node outlines. Each ordinary complete node has all four sides and all four rounded corners (`╭╮╰╯`). Colors are decoded foreground RGB values from the ANSI captures, not inferred from plain text. All complete outlines are color-continuous around their entire perimeter in the normal capture. In the selected capture their entire outlines are the selected accent `(216,166,87)`; the already-selected first nodes use this color in the normal capture too.

| View | Node | Outline rectangle | Normal border RGB | Border result |
|---|---|---|---|---|
| v1 | ctr | `[8,15,10,4]` | `(228,184,111)` | complete |
| v1 | VM | `[52,15,10,4]` | `(216,166,87)` | complete |
| v1 | dkbr | `[8,23,17,4]` | `(239,202,138)` | complete |
| v1 | virbr | `[52,23,19,4]` | `(200,147,68)` | complete |
| v1 | homelab | `[30,31,22,4]` | `(125,174,163)` | complete |
| v2-lan | homelab | `[28,11,21,4]` | `(216,166,87)` | complete |
| v2-lan | bond0 | `[4,19,24,4]` | `(125,174,163)` | complete |
| v2-lan | wlp8s0 | `[52,19,22,4]` | `(147,194,183)` | complete |
| v2-lan | claimed router | `[28,27,24,4]` | `(211,134,155)` | complete |
| v2-lan | Fios path | `[28,35,18,4]` | `(226,156,175)` | complete |
| v3-overlay | tailscale0 | `[8,20,27,5]` | `(216,166,87)` | complete |
| v3-overlay | homelab | `[48,21,22,4]` | `(125,174,163)` | complete |
| v3-overlay | bond0 | `[48,26,21,4]` | `(211,134,155)` | complete |
| v4-wan | Fios router | `[33,7,21,4]` | `(216,166,87)` | complete |
| v4-wan | claimed ONT | `[8,15,25,4]` | `(125,174,163)` | complete |
| v4-wan | v6 internet | `[58,15,13,4]` | `(211,134,155)` | complete |
| v4-wan | VZ aggregation | `[8,23,17,4]` | `(147,194,183)` | complete |
| v4-wan | VZ backbone | `[8,31,16,4]` | `(99,151,141)` | complete |
| v4-wan | Cloudflare | `[8,39,20,4]` | `(169,182,101)` on surviving outline | **incomplete / UI-obscured** |

### WAN bottom-node/palette collision

The Cloudflare outline occupies columns 8–27, rows 39–42; the palette occupies columns 2–10, rows 41–46. Their intersection is `[8,41,3,2]` (six cells, including interior cells). Three actual Cloudflare perimeter cells are overwritten:

- `(8,41)`: should be its left-side `│`, but is palette-top `─` in palette RGB `(168,153,104)`.
- `(8,42)`: should be its bottom-left `╰`, but is the palette label's `]` in RGB `(235,219,178)`.
- `(10,42)`: should be bottom-border `─`, but is palette-right `│` in RGB `(168,153,104)`.

Its top side and both top corners are complete. Its right side and bottom-right corner `(27,42)` are complete. Its left side is incomplete, its bottom-left corner is missing, and its bottom side is interrupted at `(10,42)`. The bottom-border fragment at `(9,42)` remains visible between overwritten cells, making the collision especially conspicuous. The label on row 40 is not lost. The same obstruction persists in the selected capture; surviving Cloudflare border cells turn accent, while the palette cells do not. Consequently the Cloudflare perimeter is neither geometrically complete nor color-continuous as a visible node outline.

**Selected-state coverage:** all **19/19 node occurrences** have their own selected border present in the supplied selected captures (5 + 5 + 3 + 6). Only **18/19** have a fully visible, uninterrupted selected perimeter. Cloudflare is the one partial capture. This is an all-selected simultaneous capture, not evidence of 19 independently exercised interactive selection actions. The palette's own square outline is complete in each view, including where it overwrites the WAN node.

Normal route lines and arrowheads use muted `(124,111,100)`; dots and selected borders use accent `(216,166,87)`. Node text uses `(235,219,178)`. ANSI supports these distinctions.

## Motion — pinned 77×47 captures

v1 has no animated routes: the capture is static, there is no frames dump, and no dots appear. I cannot use its single static view to prove temporal behavior; this is consistent with the supplied documented static-motion decision.

The other views each have **21 complete pinned frames, 0–20, at 0–2000 ms in 100-ms increments**, with `viewport: 77x47 zoom: 1.00 natural`. Counts are exactly 5, 2, and 4 dots per frame respectively, one on every animated route. Total: **231 dot appearances** across 63 frame views. There are no periodic dot trains; inter-dot spacing along a single route is inapplicable. Different routes have separate dots even where they leave the same box. Initial paired separation is two columns for the LAN top/bottom route pairs, and two rows for the overlay pair.

The following formulas enumerate every frame's dot coordinates. Let `k = floor(frame / 2)` for frames 0 through 20 (so positions generally repeat across each adjacent pair of 100-ms frames).

### v2-lan

- homelab→bond0: for k=0, `(29,16)`; for k=1..10, `(29-k,17)`.
- homelab→wlp: for k=0, `(31,16)`; for k=1..10, `(31+k,17)`.
- bond0→router: for k=0, `(5,24)`; for k=1..10, `(5+k,25)`.
- wlp→router: for k=0, `(53,24)`; for k=1..10, `(53-k,25)`.
- router→Fios path: `(29,32)` for even k; `(29,33)` for odd k.

The four long-route dots move toward their arrowheads, not backward. The short fifth route visibly alternates between its two interior cells; it resets rather than displaying the source-adjacent or arrowhead cells. No LAN dot occupies a corner, bridge, or arrowhead in the sampled frames. At frame 20 the dots are `(19,17)`, `(41,17)`, `(15,25)`, `(43,25)`, `(29,32)`; none is at an arrowhead.

### v3-overlay

- tailscale→homelab: k=0..9, `(36+k,21)`; k=10, `(46,22)`.
- tailscale→bond0: k=0..8, `(36+k,23)`; k=9, `(45,24)`; k=10, `(45,25)`.

Both move toward the rightward targets. **At frame 20 (2000 ms), the upper route's dot is on the bend `(46,22)`, replacing its `╰` glyph.** This is one directly observed corner-contact event on one route in one frame. The lower dot is on a straight vertical cell. Neither reaches an arrowhead in this window. No bridge exists for a dot to occupy.

### v4-wan

- router→ONT: k=0, `(34,12)`; k=1..10, `(34-k,13)`.
- ONT→aggregation: `(9,20)` for even k; `(9,21)` for odd k.
- aggregation→backbone: `(9,28)` for even k; `(9,29)` for odd k.
- backbone→Cloudflare: `(9,36)` for even k; `(9,37)` for odd k.

The long-route dot moves left along its route toward the downward arrow at column 9. The three short-route dots alternate synchronously between their two interior cells, progressing downward then resetting upward; they do not reach their arrowheads. The dashed IPv6 route has zero dots in every frame, consistent with its static spec. No WAN dot occupies a corner, bridge, or arrowhead in the sampled frames. At frame 20 the dots are `(24,13)`, `(9,20)`, `(9,28)`, `(9,36)`.

### Origins, speed, and arrivals: observed versus reported

The captured checks report constant default speed `0.5c/step` for all 11 animated routes, 0 dot violations, and `origins: 11/11` in aggregate. Their single-dot counts agree with the frames. The paired-frame repeats and roughly one-cell advance per 200 ms on straight runs support that default constant-speed mode, rather than a same-arrival schedule. Corner-skipping changes raster displacements locally; these frames do not constitute a continuous-time speed measurement.

However, **no frame-0 dot is on the first visible exterior cell at the arrow's true source**. All are one cell farther along:

| View/route | First exterior source cell | Frame-0 dot |
|---|---|---|
| LAN homelab→bond0 | `(29,15)` | `(29,16)` |
| LAN homelab→wlp | `(31,15)` | `(31,16)` |
| LAN bond0→router | `(5,23)` | `(5,24)` |
| LAN wlp→router | `(53,23)` | `(53,24)` |
| LAN router→Fios | `(29,31)` | `(29,32)` |
| overlay tailscale→homelab | `(35,21)` | `(36,21)` |
| overlay tailscale→bond0 | `(35,23)` | `(36,23)` |
| WAN router→ONT | `(34,11)` | `(34,12)` |
| WAN ONT→aggregation | `(9,19)` | `(9,20)` |
| WAN aggregation→backbone | `(9,27)` | `(9,28)` |
| WAN backbone→Cloudflare | `(9,35)` | `(9,36)` |

The actual box ports are another cell upstream, on their borders. Thus the literal frame-0-at-origin criterion is **0/11 satisfied, 11/11 mismatched**, despite the check's origin statement. This distinguishes a visible origin criterion from a possible internal eligibility definition. I do not silently substitute the check's definition for the captured cells.

**No route's dot occupies its arrowhead in any supplied pinned frame.** Therefore the routes do not all reach their arrowheads in the same captured frame; none even does so individually in this 2-second sample. Same-arrival is not enabled, and absence of same-arrival is not charged as a constant-speed violation. Motion beyond 2000 ms is unobserved: these captures cannot prove that the long routes eventually reach their arrowheads, remain corner-free later, or repeat correctly over a full cycle.

## Fit, diagnostics, and evidence limits

All four normal and selected ANSI canvases decode to exactly **77 columns × 47 rows**. The plain-text snapshots omit trailing spaces and the final blank row; their 46-line files are not proof of a 46-row terminal. All title tokens read `77x47 @100%`. There is no zoom below 100% in the supplied evidence.

The original captured check logs for all four views say `viewport: unknown zoom: 1.00 natural`; they do not independently establish a measured terminal viewport. The pinned animated captures explicitly say `viewport: 77x47 zoom: 1.00 natural`. No equivalent pinned viewport line exists for the static v1 view; its 77×47 dimensions are directly recoverable from the ANSI grid and supported by its title token.

| View | Captured extent | Graph on-screen bounds | Reported crossings | Observed route crossings | Reported near-minimal routes |
|---|---|---|---|---|---|
| v1 | 67×24 | cols 8–70, rows 15–34 | 0 bridges, 0 touching bends | 0 / 0 | 4/4; 0 detours |
| v2-lan | 74×32 | cols 4–73, rows 11–38 | 0 bridges, 0 touching bends | 0 / 0 | 5/5; 0 detours |
| v3-overlay | 63×11 | cols 8–69, rows 20–29 | 0 bridges, 0 touching bends | 0 / 0 | 2/2; 0 detours |
| v4-wan | 67×40 | cols 8–70, rows 7–42 | 0 bridges, 0 touching bends | 0 / 0 | 5/5; 0 detours |

The extent diagnostics are not identical to tight visible graph bounds, but none exceeds the 77×47 canvas. No label, arrowhead, or edge is viewport-clipped, and no graph item is shown as requiring pan/zoom to read it. There are no conspicuous route loops or gratuitous excursions contradicting the near-minimal reports. There is nevertheless **one UI-obscured node outline** in v4-wan: fitting inside the viewport did not reserve space for the palette. This must not be conflated with zero viewport clipping.

The checks report edge labels 4/4, 5/5, 2/2, 5/5 placed; zero on route cells, zero skipped; one ambiguous owner in LAN only. Those placement and ambiguity counts are supported by the visible evidence, with the ownership nuance above. Their zero crossings agree with what is visible. Their zero dot violations do not capture the literal frame-0 origin discrepancy or the overlay corner event.

**Evidence limits / readability:**

- No unsupported evidence format was encountered. ANSI text was parsed for glyph positions and foreground color, not treated as a screenshot.
- v1's motion dump is absent by design. Temporal claims for that view remain unverified rather than inferred from the spec.
- The original `*-frames.txt` and `*-frames.ansi` streams have a leading partial frame with no frame-0 header; their first labeled frame is frame 1. I do not treat that cropped fragment as complete frame-0 evidence. The supplied `*-frames-pinned.txt` streams contain complete, explicitly labeled frames 0–20 at the pinned size and are the basis for all motion measurements above.
- The pinned motion files are text, not full-color motion buffers. The separate normal/selected ANSI snapshots prove those states' colors, but not every animation frame's color continuity.
- No missing identifier or qualifier can be adjudicated against withheld expectations at this stage. Visible omissions/abbreviations and solid-versus-dashed distinctions are recorded above without guessing their source requirements.

## Tool-usable blind scorecard

Counts use node/edge occurrences across views, not unique conceptual entities. Graph-label counts exclude UI labels; UI counts are included separately. `clipped_items` means viewport clipping only. Dot violations are decomposed so the check-reported zero cannot mask observed failures. The 12 events comprise 11 route-level initial-origin mismatches plus one route/frame corner event; they are not a count of every repeated dot appearance.

```json
{
  "stage": "A",
  "case": "homelab-nic-trace",
  "coordinate_basis": "1-based 77x47 per-view canvas",
  "per_view": {
    "v1": {"visible_nodes": 5, "visible_edges": 4, "graph_labels": 9, "crossings": 0, "bridges": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items": 0, "ui_obscured_nodes": 0, "selected_border_present": 5, "selected_border_complete": 5, "animated_routes": 0, "motion_frames": 0, "origin_mismatches": 0, "dot_corner_events": 0},
    "v2-lan": {"visible_nodes": 5, "visible_edges": 5, "graph_labels": 10, "crossings": 0, "bridges": 0, "touching_bends": 0, "uncertain_label_owners": 1, "clipped_items": 0, "ui_obscured_nodes": 0, "selected_border_present": 5, "selected_border_complete": 5, "animated_routes": 5, "motion_frames": 21, "origin_mismatches": 5, "dot_corner_events": 0},
    "v3-overlay": {"visible_nodes": 3, "visible_edges": 2, "graph_labels": 5, "crossings": 0, "bridges": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items": 0, "ui_obscured_nodes": 0, "selected_border_present": 3, "selected_border_complete": 3, "animated_routes": 2, "motion_frames": 21, "origin_mismatches": 2, "dot_corner_events": 1},
    "v4-wan": {"visible_nodes": 6, "visible_edges": 5, "graph_labels": 11, "crossings": 0, "bridges": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items": 0, "ui_obscured_nodes": 1, "selected_border_present": 6, "selected_border_complete": 5, "animated_routes": 4, "motion_frames": 21, "origin_mismatches": 4, "dot_corner_events": 0}
  },
  "totals": {
    "visible_nodes": 19,
    "visible_edges": 16,
    "fully_traceable_edges": 16,
    "graph_labels": 35,
    "ui_labels": 20,
    "all_visible_labels_including_ui": 55,
    "crossings": 0,
    "bridges": 0,
    "touching_bends": 0,
    "line_junctions": 0,
    "uncertain_label_owners": 1,
    "clipped_items": 0,
    "ui_obscured_nodes": 1,
    "overwritten_node_border_cells": 3,
    "selected_state_coverage": {"border_present": 19, "border_complete": 18, "node_occurrences": 19},
    "animated_routes": 11,
    "frame_views": 63,
    "dot_appearances": 231,
    "dot_violations": {
      "count_mismatch_frames": 0,
      "origin_mismatch_routes": 11,
      "corner_contact_route_frame_events": 1,
      "bridge_contact_route_frame_events": 0,
      "arrowhead_contact_route_frame_events": 0,
      "observed_events_total": 12,
      "affected_routes": 11,
      "check_reported_violations": 0
    },
    "routes_seen_reaching_arrowhead": 0,
    "same_arrival_captured": false,
    "same_arrival_required_for_constant_speed": false,
    "unreadable_formats": [],
    "missing_temporal_evidence": ["v1 frames dump (documented static view)"],
    "incomplete_original_motion_streams": ["v2-lan original frame 0", "v3-overlay original frame 0", "v4-wan original frame 0"],
    "complete_pinned_motion_streams": 3
  }
}
```

Stage A ends here. No expectations or generator-identity assessment has been used.
